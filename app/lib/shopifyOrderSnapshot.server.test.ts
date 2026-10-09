import { describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ shopifyGraphQL: vi.fn() }))
vi.mock('~/lib/shopify.server', () => api)
import { fetchShopifyOrderSnapshot, normalizeShopifyOrderSnapshot } from './shopifyOrderSnapshot.server'
import { extractShopifyCommissionFacts } from './commissionEligibility.server'

const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: 'CAD' } })
function fixture() { return { id: 'gid://shopify/Order/123', legacyResourceId: '123', name: '#123', currencyCode: 'CAD', displayFinancialStatus: 'REFUNDED', displayFulfillmentStatus: 'FULFILLED', cancelledAt: '2026-10-09T12:00:00Z', updatedAt: '2026-10-09T12:00:00Z', totalPriceSet: bag('100.00'), currentTotalPriceSet: bag('0.00'), subtotalPriceSet: bag('100.00'), lineItems: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid://shopify/LineItem/1', quantity: 2, originalUnitPriceSet: bag('60.00'), discountAllocations: [{ allocatedAmountSet: bag('20.00') }], customAttributes: [{ key: 'Sheet Identity', value: '/i/upload123' }] }] }, refunds: [{ legacyResourceId: '2', transactions: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid://shopify/OrderTransaction/3', kind: 'REFUND', status: 'SUCCESS', amountSet: bag('100.00') }] } }] } }
describe('GraphQL order snapshots', () => {
  it('preserves complete financial/refund/attribution facts without buyer contacts', async () => {
    api.shopifyGraphQL.mockResolvedValue({ order: fixture() })
    const order = await fetchShopifyOrderSnapshot('shop.myshopify.com', 'offline-token', '123')
    expect(order.line_items[0]).toMatchObject({ id: '1', price: '60.00', quantity: 2, discount_allocations: [{ amount: '20.00' }], properties: [{ name: 'Sheet Identity', value: '/i/upload123' }] })
    expect(extractShopifyCommissionFacts(order)).toMatchObject({ refundState: 'full', captureConfirmed: false })
    expect(order).not.toHaveProperty('email')
    expect(api.shopifyGraphQL.mock.calls[0][2]).not.toMatch(/\b(email|phone|firstName|lastName|shippingAddress)\b/)
    expect(api.shopifyGraphQL.mock.calls[0][2]).toContain('customer { id }')
    expect(api.shopifyGraphQL.mock.calls[0][3]).toEqual({ id: 'gid://shopify/Order/123' })
  })
  it('fails closed on missing or truncated orders/refunds and mismatched currency', async () => {
    const truncated = fixture(); truncated.lineItems.pageInfo.hasNextPage = true
    expect(() => normalizeShopifyOrderSnapshot(truncated)).toThrow('truncated')
    const missingRefund = fixture(); missingRefund.refunds[0].transactions.pageInfo.hasNextPage = true
    expect(() => normalizeShopifyOrderSnapshot(missingRefund)).toThrow('truncated')
    const wrongCurrency = fixture(); wrongCurrency.totalPriceSet.shopMoney.currencyCode = 'USD'
    expect(() => normalizeShopifyOrderSnapshot(wrongCurrency)).toThrow('money')
    api.shopifyGraphQL.mockResolvedValue({ order: null })
    await expect(fetchShopifyOrderSnapshot('shop.myshopify.com', 'token', '123')).rejects.toThrow('unavailable')
  })
})
