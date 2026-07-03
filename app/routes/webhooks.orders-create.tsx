import { Decimal } from '@prisma/client/runtime/library'
import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import crypto from 'crypto'
import prisma from '~/lib/prisma.server'
import { getCommissionRate } from '~/lib/billing.server'


function verifyWebhookSignature(body: string, hmac: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac))
}

function extractVipUploadIdFromOrderNote(note: unknown): string | null {
  const match = String(note || '').match(/(?:VIP|Custom pricing) checkout for upload ([A-Za-z0-9_-]+)/i)
  return match?.[1] || null
}


export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  const hmac = request.headers.get('X-Shopify-Hmac-Sha256')
  const shopDomain = request.headers.get('X-Shopify-Shop-Domain')

  if (!hmac || !shopDomain) {
    return json({ error: 'Missing headers' }, { status: 400 })
  }

  const body = await request.text()
  const secret = process.env.SHOPIFY_API_SECRET || ''

  if (!verifyWebhookSignature(body, hmac, secret)) {
    return json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    const order = JSON.parse(body)
    console.log(`[Webhook] Order created: ${order.id} for shop: ${shopDomain}`)


    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    })

    if (!shop) {
      console.log(`[Webhook] Shop not found: ${shopDomain}`)
      return json({ success: true })
    }


    const productConfigs = await prisma.productConfig.findMany({
      where: { shopId: shop.id, uploadEnabled: true },
      select: { productId: true, mode: true },
    })


    const configuredProductIds = new Map(
      productConfigs.map((p) => [
        p.productId.split('/').pop() || '',
        p.mode
      ])
    )


    const processedUploads: string[] = []
    let hasUploadLiftItems = false

    for (const lineItem of order.line_items || []) {
      const uploadLiftId = lineItem.properties?.find(
        (p: { name: string }) => p.name === '_ul_upload_id'
      )?.value

      if (uploadLiftId && !processedUploads.includes(uploadLiftId)) {
        hasUploadLiftItems = true
        console.log(`[Webhook] Found upload ${uploadLiftId} in order ${order.id}`)


        const upload = await prisma.upload.findFirst({
          where: {
            id: uploadLiftId,
            shopId: shop.id,
          },
        })

        if (upload) {

          await prisma.orderLink.upsert({
            where: {
              orderId_uploadId: {
                orderId: String(order.id),
                uploadId: uploadLiftId,
              },
            },
            create: {
              shopId: shop.id,
              orderId: String(order.id),
              uploadId: uploadLiftId,
              lineItemId: String(lineItem.id),
            },
            update: {
              lineItemId: String(lineItem.id),
            },
          })


          await prisma.upload.updateMany({
            where: { id: uploadLiftId, shopId: shop.id },
            data: {
              orderId: String(order.id),
              status: upload.status === 'blocked' ? 'blocked' : 'needs_review',
            },
          })


          await prisma.auditLog.create({
            data: {
              shopId: shop.id,
              action: 'order_linked',
              resourceType: 'upload',
              resourceId: uploadLiftId,
              metadata: {
                orderId: order.id,
                orderName: order.name,
                lineItemId: lineItem.id,
                customerEmail: order.email,
              },
            },
          })

          processedUploads.push(uploadLiftId)
          console.log(`[Webhook] Linked upload ${uploadLiftId} to order ${order.id}`)
        } else {
          console.warn(`[Webhook] Upload ${uploadLiftId} not found for shop ${shopDomain}`)
        }
      } else if (!uploadLiftId && configuredProductIds.has(String(lineItem.product_id))) {




        console.warn(`[Webhook] Missing upload for configured product ${lineItem.product_id} in order ${order.id}`)
        hasUploadLiftItems = true

        const mode = configuredProductIds.get(String(lineItem.product_id)) || 'dtf'


        const ghostUpload = await prisma.upload.create({
          data: {
            shopId: shop.id,
            productId: `gid://shopify/Product/${lineItem.product_id}`,
            variantId: `gid://shopify/ProductVariant/${lineItem.variant_id}`,
            customerId: order.customer?.id ? String(order.customer.id) : null,
            customerEmail: order.email,
            orderId: String(order.id),
            status: 'blocked', // Blocked so merchant sees it immediately
            mode: mode,
            preflightSummary: {
              overall: 'error',
              errorType: 'missing_upload',
              message: 'Upload data missing. Customer likely used "Buy Now" button or bypassed upload.',
              lineItems: [lineItem.name],
            },
          },
        })


        await prisma.orderLink.create({
          data: {
            shopId: shop.id,
            orderId: String(order.id),
            uploadId: ghostUpload.id,
            lineItemId: String(lineItem.id),
          },
        })


        await prisma.uploadItem.create({
          data: {
            uploadId: ghostUpload.id,
            location: 'unknown',
            storageKey: '', // Empty
            originalName: 'Missing File',
            preflightStatus: 'error',
            preflightResult: {
              overall: 'error',
              checks: [{
                name: 'upload_check',
                status: 'error',
                message: 'File not found. Please contact customer for the file.'
              }]
            }
          }
        })

        processedUploads.push(ghostUpload.id)


        await prisma.auditLog.create({
          data: {
            shopId: shop.id,
            action: 'ghost_upload_created',
            resourceType: 'upload',
            resourceId: ghostUpload.id,
            metadata: {
              orderId: order.id,
              reason: 'missing_properties',
              productId: lineItem.product_id
            },
          },
        })
      }
    }

    const vipNoteUploadId = extractVipUploadIdFromOrderNote(order.note)
    if (vipNoteUploadId && !processedUploads.includes(vipNoteUploadId)) {
      const fallbackLineItem = order.line_items?.[0] || null
      const upload = await prisma.upload.findFirst({
        where: {
          id: vipNoteUploadId,
          shopId: shop.id,
        },
      })

      if (upload) {
        hasUploadLiftItems = true

        await prisma.orderLink.upsert({
          where: {
            orderId_uploadId: {
              orderId: String(order.id),
              uploadId: vipNoteUploadId,
            },
          },
          create: {
            shopId: shop.id,
            orderId: String(order.id),
            uploadId: vipNoteUploadId,
            lineItemId: fallbackLineItem?.id ? String(fallbackLineItem.id) : null,
          },
          update: {
            lineItemId: fallbackLineItem?.id ? String(fallbackLineItem.id) : null,
          },
        })

        await prisma.upload.updateMany({
          where: { id: vipNoteUploadId, shopId: shop.id },
          data: {
            orderId: String(order.id),
            status: upload.status === 'blocked' ? 'blocked' : 'needs_review',
          },
        })

        await prisma.auditLog.create({
          data: {
            shopId: shop.id,
            action: 'order_linked_note_fallback',
            resourceType: 'upload',
            resourceId: vipNoteUploadId,
            metadata: {
              orderId: order.id,
              orderName: order.name,
              lineItemId: fallbackLineItem?.id || null,
              customerEmail: order.email,
            },
          },
        })

        processedUploads.push(vipNoteUploadId)
        console.log(`[Webhook] Linked VIP upload ${vipNoteUploadId} to order ${order.id} via note fallback`)
      } else {
        console.warn(`[Webhook] VIP upload ${vipNoteUploadId} from order note not found for shop ${shopDomain}`)
      }
    }



    if (hasUploadLiftItems && processedUploads.length > 0) {

      const uploads = await prisma.upload.findMany({
        where: { id: { in: processedUploads }, shopId: shop.id },
        select: { mode: true },
      })
      let maxRate = 0
      for (const u of uploads) {
        maxRate = Math.max(maxRate, getCommissionRate(u.mode))
      }
      if (maxRate === 0) maxRate = getCommissionRate('dtf')

      const orderTotal = new Decimal(order.total_price || '0')
      const commissionAmount = new Decimal(maxRate)


      await prisma.commission.upsert({
        where: {
          commission_shop_order: {
            shopId: shop.id,
            orderId: String(order.id),
          },
        },
        create: {
          shopId: shop.id,
          orderId: String(order.id),
          orderNumber: order.name || order.order_number?.toString(),
          orderTotal: orderTotal,
          orderCurrency: order.currency || 'USD',
          commissionRate: new Decimal(0), // Not percentage based
          commissionAmount: commissionAmount,
          status: 'pending',
        },
        update: {
          orderTotal: orderTotal,
          orderCurrency: order.currency || 'USD',
          commissionAmount: commissionAmount,
        },
      })

      console.log(
        `[Webhook] Commission created: $${commissionAmount.toFixed(3)} (fixed fee) for order ${order.id}`
      )


      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: 'commission_created',
          resourceType: 'commission',
          resourceId: String(order.id),
          metadata: {
            orderId: order.id,
            orderName: order.name,
            orderTotal: orderTotal.toString(),
            commissionAmount: commissionAmount.toString(),
            currency: order.currency,
          },
        },
      })
    }

    console.log(`[Webhook] Processed ${processedUploads.length} uploads for order ${order.id}`)
    return json({ success: true, linkedUploads: processedUploads.length })
  } catch (error) {
    console.error('[Webhook] Error processing order:', error)
    return json({ error: 'Processing failed' }, { status: 500 })
  }
}
