import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import {
  quarantineCommissionForVerifiedRefundSnapshotFailure,
  reconcileOrder,
  verifyShopifyWebhookHmac,
} from '~/lib/orderReconciler.server'
import { fetchShopifyOrderSnapshot } from '~/lib/shopifyOrderSnapshot.server'

/**
 * refunds/create does not contain a full order. Verify the notification, read
 * the current order from Shopify, then feed the same convergent reconciler.
 * A failed read returns 500 so Shopify retries. The signed refund fact also
 * quarantines any existing commission immediately, without guessing whether
 * the refund is partial or full.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hmac = request.headers.get('x-shopify-hmac-sha256')
  const shopDomain = request.headers.get('x-shopify-shop-domain')
  if (!hmac || !shopDomain) return json({ error: 'Missing headers' }, { status: 400 })

  const body = await request.text()
  if (!verifyShopifyWebhookHmac(body, hmac, process.env.SHOPIFY_API_SECRET || '')) {
    return json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    const refund = JSON.parse(body) as { id?: string | number; order_id?: string | number }
    const orderId = String(refund.order_id || '')
    if (!/^\d+$/.test(orderId)) {
      return json({ error: 'Missing order id' }, { status: 400 })
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain } })
    if (!shop) return json({ received: true })

    let order: any
    try {
      order = await fetchShopifyOrderSnapshot(shopDomain, shop.accessToken, orderId)
    } catch (snapshotError) {
      const snapshotErrorMessage =
        snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
      const quarantine = await quarantineCommissionForVerifiedRefundSnapshotFailure({
        shopId: shop.id,
        orderId,
        refundId: refund.id ? String(refund.id) : null,
        snapshotError: snapshotErrorMessage,
      })
      console.error(
        `[Webhook] refunds/create order snapshot failed for ${shopDomain}/${orderId}; ` +
          `commissionFound=${quarantine.commissionFound} reviewFlagAdded=${quarantine.reviewFlagAdded}:`,
        snapshotError
      )
      return json({ error: 'Processing failed' }, { status: 500 })
    }
    // Do not depend on read-after-write timing in the order endpoint. Carry
    // the verified webhook refund into the snapshot when Shopify's order read
    // has not exposed it yet; the fact classifier can then quarantine/void the
    // fee immediately instead of briefly making it collectible again.
    const currentRefunds = Array.isArray(order.refunds) ? order.refunds : []
    if (!currentRefunds.some((entry: any) => String(entry?.id || '') === String(refund.id || ''))) {
      order.refunds = [...currentRefunds, refund]
    }
    const summary = await reconcileOrder(shop, order, 'refunds/create')
    return json({
      received: true,
      refundId: refund.id ? String(refund.id) : null,
      processed: summary.affectedUploadIds.length,
    })
  } catch (error) {
    console.error('[Webhook] Error processing refunds/create:', error)
    return json({ error: 'Processing failed' }, { status: 500 })
  }
}
