import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { reconcileOrder, verifyShopifyWebhookHmac } from '~/lib/orderReconciler.server'

/**
 * orders/updated is the catch-all financial-state carrier. It covers payment
 * state changes that are neither a fresh order nor a final paid event and is
 * safe on replay because the reconciler applies monotone state decisions.
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
    const order = JSON.parse(body)
    const shop = await prisma.shop.findUnique({ where: { shopDomain } })
    if (!shop) return json({ received: true })
    const summary = await reconcileOrder(shop, order, 'orders/updated')
    return json({ received: true, processed: summary.affectedUploadIds.length })
  } catch (error) {
    console.error('[Webhook] Error processing orders/updated:', error)
    return json({ error: 'Processing failed' }, { status: 500 })
  }
}
