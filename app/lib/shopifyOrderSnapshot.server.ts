import { shopifyGraphQL } from '~/lib/shopify.server'

const ORDER_SNAPSHOT_QUERY = `query PublicOrderFinancialSnapshot($id: ID!) {
  order(id: $id) {
    id legacyResourceId name currencyCode displayFinancialStatus displayFulfillmentStatus
    cancelledAt updatedAt processedAt cartToken note
    customer { id }
    transactions(first: 250) { kind status processedAt }
    totalPriceSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    subtotalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 250) {
      pageInfo { hasNextPage }
      nodes {
        id quantity title product { id } variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
        customAttributes { key value }
      }
    }
    refunds {
      legacyResourceId
      transactions(first: 100) {
        pageInfo { hasNextPage }
        nodes { id kind status amountSet { shopMoney { amount currencyCode } } }
      }
    }
  }
}`

function numericId(value: unknown, resource: string): string {
  const id = String(value || '')
  const numeric = id.match(new RegExp(`^(?:gid://shopify/${resource}/)?(\\d+)$`))?.[1]
  if (!numeric) throw new Error(`Shopify ${resource} snapshot identifier is invalid`)
  return numeric
}
function money(bag: any, currency: string): string {
  const value = bag?.shopMoney
  if (!value || value.currencyCode !== currency || !/^\d+(?:\.\d+)?$/.test(String(value.amount))) throw new Error('Shopify order snapshot money missing or inconsistent')
  return String(value.amount)
}

/** Normalize only fields the proven reconciler needs. No buyer contact/name/
 * address is requested. Truncated snapshots fail closed instead of repricing. */
export function normalizeShopifyOrderSnapshot(order: any): any {
  if (!order || !/^[A-Z]{3}$/.test(order.currencyCode) || typeof order.displayFinancialStatus !== 'string' || !order.updatedAt || order.lineItems?.pageInfo?.hasNextPage !== false || !Array.isArray(order.lineItems?.nodes) || !Array.isArray(order.refunds)) throw new Error('Shopify order snapshot incomplete or truncated')
  const currency = order.currencyCode
  const lineItems = order.lineItems.nodes.map((line: any) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 0 || !Array.isArray(line.discountAllocations) || !Array.isArray(line.customAttributes)) throw new Error('Shopify order line snapshot incomplete')
    return {
      id: numericId(line.id, 'LineItem'), quantity: line.quantity, title: line.title,
      product_id: line.product ? numericId(line.product.id, 'Product') : null,
      variant_id: line.variant ? numericId(line.variant.id, 'ProductVariant') : null,
      price: money(line.originalUnitPriceSet, currency),
      discount_allocations: line.discountAllocations.map((allocation: any) => ({ amount: money(allocation.allocatedAmountSet, currency) })),
      properties: line.customAttributes.map((attribute: any) => ({ name: attribute.key, value: attribute.value })),
    }
  })
  const refunds = order.refunds.map((refund: any) => {
    if (refund.transactions?.pageInfo?.hasNextPage !== false || !Array.isArray(refund.transactions?.nodes)) throw new Error('Shopify refund snapshot incomplete or truncated')
    return { id: numericId(refund.legacyResourceId, 'Refund'), transactions: refund.transactions.nodes.map((transaction: any) => {
      if (!transaction.kind || !transaction.status) throw new Error('Shopify refund transaction snapshot incomplete')
      return { id: numericId(transaction.id, 'OrderTransaction'), kind: String(transaction.kind).toLowerCase(), status: String(transaction.status).toLowerCase(), amount: money(transaction.amountSet, currency) }
    }) }
  })
  return {
    id: numericId(order.legacyResourceId || order.id, 'Order'), name: order.name,
    currency, financial_status: order.displayFinancialStatus.toLowerCase(),
    fulfillment_status: order.displayFulfillmentStatus === 'FULFILLED' ? 'fulfilled' : order.displayFulfillmentStatus === 'PARTIALLY_FULFILLED' ? 'partial' : null,
    cancelled_at: order.cancelledAt || null, updated_at: order.updatedAt, processed_at: order.processedAt,
    cart_token: order.cartToken, note: order.note,
    customer: order.customer ? { id: numericId(order.customer.id, 'Customer') } : null,
    // Order.transactions is a bounded list, not a connection. Exactly the
    // bound cannot prove completeness and is excluded from volume eligibility.
    volume_transactions_complete: Array.isArray(order.transactions) && order.transactions.length < 250,
    transactions: Array.isArray(order.transactions) ? order.transactions.map((transaction: any) => ({
      kind: String(transaction.kind || '').toLowerCase(),
      status: String(transaction.status || '').toLowerCase(),
      processed_at: transaction.processedAt || null,
    })) : [],
    total_price: money(order.totalPriceSet, currency), current_total_price: money(order.currentTotalPriceSet, currency), subtotal_price: money(order.subtotalPriceSet, currency),
    line_items: lineItems, refunds,
  }
}

export async function fetchShopifyOrderSnapshot(shopDomain: string, accessToken: string, orderId: string): Promise<any> {
  const id = numericId(orderId, 'Order')
  const data = await shopifyGraphQL<{ order: unknown }>(shopDomain, accessToken, ORDER_SNAPSHOT_QUERY, { id: `gid://shopify/Order/${id}` })
  if (!data.order) throw new Error('Shopify order snapshot unavailable (missing or outside read_orders access)')
  return normalizeShopifyOrderSnapshot(data.order)
}
