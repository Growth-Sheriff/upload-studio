import { beforeEach, describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ shop: { updateMany: vi.fn() }, shopBilling: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn() }))
vi.mock('~/lib/prisma.server', () => ({ default: store }))
import { requestShopifyBillingApproval, syncShopifyBilling } from './shopifyBilling.server'

describe('merchant-approved Shopify limits', () => {
  beforeEach(() => { vi.clearAllMocks(); store.shop.updateMany.mockResolvedValue({ count: 1 }); store.$transaction.mockImplementation(run => run(store)) })
  it('does not activate a cap increase until Shopify returns it as effective', async () => {
    const previous = { status: 'active', usageLineItemId: 'line-1', cappedAmountUsd: 50, pendingCapUsd: null }
    store.shopBilling.findUnique.mockResolvedValue(previous)
    store.shopBilling.upsert.mockImplementation(({ create }) => create)
    const admin = { graphql: vi.fn(async (query: string) => new Response(JSON.stringify(query.includes('PublicBillingStatus') ? { data: { currentAppInstallation: { activeSubscriptions: [{ id: 'sub-1', status: 'ACTIVE', test: false, lineItems: [{ id: 'line-1', plan: { pricingDetails: { __typename: 'AppUsagePricing', cappedAmount: { amount: '50', currencyCode: 'USD' }, balanceUsed: { amount: '41', currencyCode: 'USD' } } } }] }] } } } : { data: { appSubscriptionLineItemUpdate: { userErrors: [], confirmationUrl: 'https://a.myshopify.com/approve' } } }), { status: 200 })) }
    const url = await requestShopifyBillingApproval('shop-a', admin, 200, 'https://app.example.com/app/billing')
    expect(url).toBe('https://a.myshopify.com/approve')
    expect(store.shopBilling.update).toHaveBeenCalledWith({ where: { shopId: 'shop-a' }, data: { pendingApprovalUrl: url, pendingCapUsd: 200 } })
    expect(store.shopBilling.update.mock.calls[0][0].data).not.toHaveProperty('cappedAmountUsd')
  })
  it('does not enable uploads on a non-USD or ambiguous provider subscription', async () => {
    store.shopBilling.findUnique.mockResolvedValue(null)
    store.shopBilling.upsert.mockImplementation(({ create }) => create)
    const admin = { graphql: vi.fn(async () => new Response(JSON.stringify({ data: { currentAppInstallation: { activeSubscriptions: [{ id: 'sub-1', status: 'ACTIVE', lineItems: [{ id: 'line-1', plan: { pricingDetails: { __typename: 'AppUsagePricing', cappedAmount: { amount: '50', currencyCode: 'CAD' } } } }] }] } } }), { status: 200 })) }
    const state = await syncShopifyBilling('shop-a', admin)
    expect(state.status).toBe('review_required')
    expect(store.shop.updateMany).toHaveBeenLastCalledWith({ where: { id: 'shop-a', erasureStartedAt: null, uninstalledAt: null, billingStatus: { notIn: ['erasing', 'uninstalled'] } }, data: { billingStatus: 'inactive' } })
  })
  it('does not reactivate a shop erased while awaiting the provider', async () => {
    store.shopBilling.findUnique.mockResolvedValue(null)
    store.shop.updateMany.mockResolvedValue({ count: 0 })
    const admin = { graphql: vi.fn(async () => new Response(JSON.stringify({ data: { currentAppInstallation: { activeSubscriptions: [] } } }))) }
    await expect(syncShopifyBilling('shop-a', admin)).rejects.toThrow('cannot reactivate')
    expect(store.shopBilling.upsert).not.toHaveBeenCalled()
  })
})
