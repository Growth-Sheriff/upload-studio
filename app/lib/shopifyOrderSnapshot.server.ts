import { shopifyConfig } from '~/lib/shopify.server'

/**
 * Refund webhooks carry the refund, not a complete order. Fetch the current
 * read-only order snapshot so fee reconciliation uses Shopify's authoritative
 * financial/cancellation/refund state and the original app line attribution.
 */
export async function fetchShopifyOrderSnapshot(
  shopDomain: string,
  accessToken: string,
  orderId: string
): Promise<any> {
  if (!/^\d+$/.test(orderId)) throw new Error('Shopify order id is invalid')
  const response = await fetch(
    `https://${shopDomain}/admin/api/${shopifyConfig.apiVersion}/orders/${orderId}.json?status=any`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
    }
  )
  if (!response.ok) {
    throw new Error(`Shopify order snapshot fetch failed with HTTP ${response.status}`)
  }
  const payload = (await response.json()) as { order?: unknown }
  if (!payload.order || typeof payload.order !== 'object') {
    throw new Error('Shopify order snapshot response did not contain an order')
  }
  return payload.order
}
