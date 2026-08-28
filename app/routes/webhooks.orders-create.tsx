import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { reconcileOrder, verifyShopifyWebhookHmac } from '~/lib/orderReconciler.server'

// Thin adapter: verify -> parse -> reconcile. All linking/status/commission
// logic lives in the convergent reconciler (app/lib/orderReconciler.server.ts)
// so webhook delivery order and retries cannot produce divergent state.

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
  if (!verifyShopifyWebhookHmac(body, hmac, process.env.SHOPIFY_API_SECRET || '')) {
    return json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    const order = JSON.parse(body)
    console.log(`[Webhook] Order created: ${order.id} for shop: ${shopDomain}`)

    const shop = await prisma.shop.findUnique({ where: { shopDomain } })
    if (!shop) {
      console.log(`[Webhook] Shop not found: ${shopDomain}`)
      return json({ success: true })
    }

    const summary = await reconcileOrder(shop, order, 'orders/create')

    return json({ success: true, linkedUploads: summary.linked.length })
  } catch (error) {
    console.error('[Webhook] Error processing order:', error)
    return json({ error: 'Processing failed' }, { status: 500 })
  }
}
