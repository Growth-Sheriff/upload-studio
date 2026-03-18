import { Decimal } from '@prisma/client/runtime/library'
import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import crypto from 'crypto'
import prisma from '~/lib/prisma.server'
import { getCommissionRate } from '~/lib/billing.server'

// Verify Shopify webhook signature
function verifyWebhookSignature(body: string, hmac: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac))
}

// POST /webhooks/orders-create
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

    // Get shop from database
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    })

    if (!shop) {
      console.log(`[Webhook] Shop not found: ${shopDomain}`)
      return json({ success: true }) // Still return success to Shopify
    }

    // Get all configured products for this shop to detect missing uploads
    const productConfigs = await prisma.productConfig.findMany({
      where: { shopId: shop.id, uploadEnabled: true },
      select: { productId: true, mode: true },
    })
    
    // Create a Set of product IDs (numeric strings) from GIDs
    const configuredProductIds = new Map(
      productConfigs.map((p) => [
        p.productId.split('/').pop() || '',
        p.mode
      ])
    )

    // Process line items looking for upload_lift properties
    const processedUploads: string[] = []
    let hasUploadLiftItems = false

    for (const lineItem of order.line_items || []) {
      const uploadLiftId = lineItem.properties?.find(
        (p: { name: string }) => p.name === '_ul_upload_id'
      )?.value

      if (uploadLiftId && !processedUploads.includes(uploadLiftId)) {
        hasUploadLiftItems = true
        console.log(`[Webhook] Found upload ${uploadLiftId} in order ${order.id}`)

        // Verify upload exists and belongs to this shop
        const upload = await prisma.upload.findFirst({
          where: {
            id: uploadLiftId,
            shopId: shop.id,
          },
        })

        if (upload) {
          // Create or update order link (upsert for idempotency - Shopify may retry webhooks)
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

          // Update upload with order info and status
          await prisma.upload.updateMany({
            where: { id: uploadLiftId, shopId: shop.id },
            data: {
              orderId: String(order.id),
              status: upload.status === 'blocked' ? 'blocked' : 'needs_review',
            },
          })

          // Audit log
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
        // CASE: "Buy Now" button bypass or JS error
        // The product is configured for upload, but no upload ID is passed in properties.
        // We create a "Missing Upload" record to alert the merchant.
        
        console.warn(`[Webhook] Missing upload for configured product ${lineItem.product_id} in order ${order.id}`)
        hasUploadLiftItems = true // Mark as valid app order for commission logic
        
        const mode = configuredProductIds.get(String(lineItem.product_id)) || 'dtf'
        
        // Create a ghost upload record
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
        
        // Link it to order
        await prisma.orderLink.create({
          data: {
            shopId: shop.id,
            orderId: String(order.id),
            uploadId: ghostUpload.id,
            lineItemId: String(lineItem.id),
          },
        })
        
        // Create an empty item so it shows in the UI list (with error status)
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
        
        // Audit log
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

    // Create commission record if order contains upload items
    // Commission rate depends on upload mode: $0.10 default, $0.50 for builder
    if (hasUploadLiftItems && processedUploads.length > 0) {
      // Determine highest commission rate among processed uploads
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

      // Upsert for idempotency (Shopify may retry webhooks)
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

      // Audit log for commission
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
