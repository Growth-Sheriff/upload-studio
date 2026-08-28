import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import crypto from 'crypto'
import prisma from '~/lib/prisma.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import { recordOrderForVisitor } from '~/lib/visitor.server'
import {
  extractVipUploadIdsFromOrderNote,
  matchUploadFromLineItem,
} from '~/lib/orderMatching.server'


function verifyWebhookSignature(body: string, hmac: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac))
}


const ORDER_METAFIELD_MUTATION = `
  mutation orderMetafieldSet($input: OrderInput!) {
    orderUpdate(input: $input) {
      order {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`


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
    console.log(`[Webhook] Order paid: ${order.id} for shop: ${shopDomain}`)


    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    })

    if (!shop) {
      console.log(`[Webhook] Shop not found: ${shopDomain}`)
      return json({ success: true })
    }

    const orderTotal = parseFloat(order.total_price) || 0
    const orderCurrency = order.currency || 'USD'

    const uploadDesigns: Array<{
      lineItemId: string
      uploadId: string
      location: string
      originalFile: string
      previewUrl: string
      transform: unknown
      preflightStatus: string
    }> = []
    const processedUploadIds = new Set<string>()

    // Marks one upload paid: OrderLink upsert, order data + approved status,
    // design manifest rows, visitor revenue. Idempotent per upload.
    const processPaidUpload = async (
      uploadId: string,
      lineItemId: string | null,
      matchSource: string
    ): Promise<void> => {
      if (processedUploadIds.has(uploadId)) return

      const upload = await prisma.upload.findFirst({
        where: { id: uploadId, shopId: shop.id },
        include: {
          items: {
            select: {
              location: true,
              originalName: true,
              previewKey: true,
              thumbnailKey: true,
              transform: true,
              preflightStatus: true,
            },
          },
        },
      })

      if (!upload) {
        console.warn(
          `[Webhook] Paid upload ${uploadId} not found for shop ${shopDomain} (source=${matchSource})`
        )
        return
      }

      await prisma.orderLink.upsert({
        where: {
          orderId_uploadId: {
            orderId: String(order.id),
            uploadId: upload.id,
          },
        },
        update: lineItemId ? { lineItemId } : {},
        create: {
          shopId: shop.id,
          orderId: String(order.id),
          uploadId: upload.id,
          lineItemId,
        },
      })

      await prisma.upload.updateMany({
        where: { id: upload.id, shopId: shop.id },
        data: {
          status: 'approved',
          orderId: String(order.id),
          orderName: order.name ? String(order.name) : null,
          orderTotal: orderTotal,
          orderCurrency: orderCurrency,
          orderPaidAt: new Date(),
        },
      })

      console.log(
        `[Webhook] Upload ${upload.id} marked paid (${orderTotal} ${orderCurrency}, source=${matchSource})`
      )

      for (const item of upload.items) {
        uploadDesigns.push({
          lineItemId: lineItemId || `order-${order.id}`,
          uploadId: upload.id,
          location: item.location,
          originalFile: item.originalName || '',
          previewUrl: item.thumbnailKey || item.previewKey || '',
          transform: item.transform,
          preflightStatus: item.preflightStatus,
        })
      }

      if (upload.visitorId) {
        try {
          await recordOrderForVisitor(shop.id, upload.visitorId, orderTotal)
          console.log(`[Webhook] Revenue recorded for visitor ${upload.visitorId}: $${orderTotal}`)
        } catch (visitorErr) {
          console.warn(`[Webhook] Visitor revenue tracking failed:`, visitorErr)
        }
      }

      processedUploadIds.add(upload.id)
    }

    // Source 1: line item carriers (legacy ids, Design Identity/File URLs).
    for (const lineItem of order.line_items || []) {
      const match = matchUploadFromLineItem(lineItem)
      if (match) {
        await processPaidUpload(match.uploadId, String(lineItem.id), match.source)
      }
    }

    // Source 2: OrderLink rows already resolved by orders/create — this is
    // what recovers lines whose properties a third-party cart app stripped
    // (orders/create matched them via cart_token; the paid payload alone
    // cannot).
    const existingLinks = await prisma.orderLink.findMany({
      where: { shopId: shop.id, orderId: String(order.id) },
      select: { uploadId: true, lineItemId: true },
    })
    for (const link of existingLinks) {
      await processPaidUpload(link.uploadId, link.lineItemId, 'order_link')
    }

    // Source 3: VIP/measured-checkout note ids (multi-upload aware).
    for (const vipNoteUploadId of extractVipUploadIdsFromOrderNote(order.note)) {
      const fallbackLineItem = order.line_items?.[0] || null
      await processPaidUpload(
        vipNoteUploadId,
        fallbackLineItem?.id ? String(fallbackLineItem.id) : null,
        'order_note'
      )
    }


    if (uploadDesigns.length > 0 && shop.accessToken) {
      const metafieldValue = JSON.stringify({
        version: '1.0',
        totalDesigns: uploadDesigns.length,
        designs: uploadDesigns,
        processedAt: new Date().toISOString(),
      })

      try {
        await shopifyGraphQL(shopDomain, shop.accessToken, ORDER_METAFIELD_MUTATION, {
          input: {
            id: `gid://shopify/Order/${order.id}`,
            metafields: [
              {
                namespace: 'upload_lift',
                key: 'designs',
                value: metafieldValue,
                type: 'json',
              },
            ],
          },
        })

        console.log(`[Webhook] Order metafield written for order ${order.id}`)
      } catch (error) {
        console.error(`[Webhook] Failed to write order metafield:`, error)
      }
    }

    return json({ success: true, designsLinked: uploadDesigns.length })
  } catch (error) {
    console.error('[Webhook] Error processing orders/paid:', error)
    return json({ error: 'Processing failed' }, { status: 500 })
  }
}
