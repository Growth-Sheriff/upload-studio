import { Decimal } from '@prisma/client/runtime/library'
import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import crypto from 'crypto'
import prisma from '~/lib/prisma.server'
import { getCommissionRate } from '~/lib/billing.server'
import { matchUploadFromLineItem, normalizeCartToken } from '~/lib/orderMatching.server'
import { buildIdentityUrl } from '~/lib/uploadUrls.server'


function verifyWebhookSignature(body: string, hmac: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac))
}

function extractVipUploadIdFromOrderNote(note: unknown): string | null {
  const match = String(note || '').match(/(?:VIP|Custom pricing) checkout for upload ([A-Za-z0-9_-]+)/i)
  return match?.[1] || null
}

// Best-effort: mirror the linked uploads onto the order as a metafield so the
// upload<->order relation survives on Shopify's side even if this DB is lost.
// Failure here must never fail the webhook.
async function writeOrderUploadsMetafield(
  shop: { shopDomain: string; accessToken: string },
  orderId: string,
  uploads: Array<{ uploadId: string; matchSource: string }>
): Promise<void> {
  if (!uploads.length || !shop.accessToken) return
  try {
    const value = JSON.stringify(
      uploads.map((u) => ({
        uploadId: u.uploadId,
        identityUrl: buildIdentityUrl(u.uploadId),
        matchSource: u.matchSource,
      }))
    )
    const response = await fetch(
      `https://${shop.shopDomain}/admin/api/2025-10/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': shop.accessToken,
        },
        body: JSON.stringify({
          query: `mutation setOrderUploads($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
            }
          }`,
          variables: {
            metafields: [
              {
                ownerId: `gid://shopify/Order/${orderId}`,
                namespace: 'upload_studio',
                key: 'uploads',
                type: 'json',
                value,
              },
            ],
          },
        }),
      }
    )
    const result = await response.json().catch(() => null)
    const userErrors = result?.data?.metafieldsSet?.userErrors
    if (userErrors?.length) {
      console.warn('[Webhook] Order metafield userErrors:', JSON.stringify(userErrors))
    }
  } catch (error) {
    console.warn('[Webhook] Order metafield write failed (non-fatal):', error)
  }
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

    // Server-side fallback carrier: uploads bound to this cart via
    // /api/cart/bind. Consulted when a line arrives with its properties
    // stripped by a third-party cart app or a checkout permalink.
    const cartToken = normalizeCartToken(order.cart_token)
    const tokenUploads = cartToken
      ? await prisma.upload.findMany({
          where: { shopId: shop.id, cartToken },
          select: { id: true, productId: true, variantId: true, status: true },
        })
      : []
    const unconsumedTokenUploads = new Set(tokenUploads.map((u) => u.id))

    const processedUploads: string[] = []
    const linkedForMetafield: Array<{ uploadId: string; matchSource: string }> = []
    let hasUploadLiftItems = false

    const linkUpload = async (
      uploadId: string,
      lineItemId: string | null,
      matchSource: string
    ): Promise<boolean> => {
      const upload = await prisma.upload.findFirst({
        where: { id: uploadId, shopId: shop.id },
      })
      if (!upload) {
        console.warn(`[Webhook] Upload ${uploadId} not found for shop ${shopDomain} (source=${matchSource})`)
        return false
      }

      await prisma.orderLink.upsert({
        where: {
          orderId_uploadId: {
            orderId: String(order.id),
            uploadId,
          },
        },
        create: {
          shopId: shop.id,
          orderId: String(order.id),
          uploadId,
          lineItemId,
        },
        update: {
          lineItemId,
        },
      })

      await prisma.upload.updateMany({
        where: { id: uploadId, shopId: shop.id },
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
          resourceId: uploadId,
          metadata: {
            orderId: order.id,
            orderName: order.name,
            lineItemId,
            customerEmail: order.email,
            matchSource,
          },
        },
      })

      processedUploads.push(uploadId)
      linkedForMetafield.push({ uploadId, matchSource })
      unconsumedTokenUploads.delete(uploadId)
      console.log(`[Webhook] Linked upload ${uploadId} to order ${order.id} (source=${matchSource})`)
      return true
    }

    for (const lineItem of order.line_items || []) {
      const match = matchUploadFromLineItem(lineItem)

      if (match && !processedUploads.includes(match.uploadId)) {
        hasUploadLiftItems = true
        console.log(`[Webhook] Found upload ${match.uploadId} in order ${order.id} via ${match.source}`)
        await linkUpload(match.uploadId, String(lineItem.id), match.source)
      } else if (!match && configuredProductIds.has(String(lineItem.product_id))) {
        hasUploadLiftItems = true

        // Properties were stripped: try the cart-token carrier before
        // declaring the upload missing. Prefer an unconsumed upload whose
        // product/variant matches this line.
        const lineProductGid = `gid://shopify/Product/${lineItem.product_id}`
        const lineVariantGid = `gid://shopify/ProductVariant/${lineItem.variant_id}`
        const tokenCandidate =
          tokenUploads.find(
            (u) => unconsumedTokenUploads.has(u.id) && u.variantId === lineVariantGid
          ) ||
          tokenUploads.find(
            (u) => unconsumedTokenUploads.has(u.id) && u.productId === lineProductGid
          ) ||
          tokenUploads.find((u) => unconsumedTokenUploads.has(u.id))

        if (tokenCandidate) {
          console.log(
            `[Webhook] Line ${lineItem.id} had no properties; recovered upload ${tokenCandidate.id} via cart_token`
          )
          await linkUpload(tokenCandidate.id, String(lineItem.id), 'cart_token')
          continue
        }

        console.warn(`[Webhook] Missing upload for configured product ${lineItem.product_id} in order ${order.id}`)

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

    // Deliberately no order-level "residual" linking of leftover token-bound
    // uploads: a token-bound upload the customer removed from the cart before
    // ordering would be a false positive. The per-line fallback above covers
    // the real stripped-properties case; leftovers stay unlinked.
    if (unconsumedTokenUploads.size > 0) {
      console.log(
        `[Webhook] ${unconsumedTokenUploads.size} cart_token upload(s) not consumed by order ${order.id} (likely removed from cart)`
      )
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
              matchSource: 'order_note',
            },
          },
        })

        processedUploads.push(vipNoteUploadId)
        linkedForMetafield.push({ uploadId: vipNoteUploadId, matchSource: 'order_note' })
        console.log(`[Webhook] Linked VIP upload ${vipNoteUploadId} to order ${order.id} via note fallback`)
      } else {
        console.warn(`[Webhook] VIP upload ${vipNoteUploadId} from order note not found for shop ${shopDomain}`)
      }
    }

    // Mirror linked uploads onto the order itself (survives app data loss).
    await writeOrderUploadsMetafield(
      { shopDomain: shop.shopDomain, accessToken: shop.accessToken },
      String(order.id),
      linkedForMetafield
    )


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
