import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  shop: { findUnique: vi.fn(), updateMany: vi.fn() },
  shopBilling: { findUnique: vi.fn(), upsert: vi.fn() },
  commission: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn(), upsert: vi.fn() },
  billingCredit: { upsert: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('~/lib/prisma.server', () => ({ default: mocks }))
import { runShopUsageBilling } from './billingRunner.server'
import { buildUsageIdempotencyKey } from './billing.server'

describe('Shopify usage recording', () => {
  let row: any
  let cap: number
  let used: number
  let usage: ReturnType<typeof vi.fn>
  let lookup: ReturnType<typeof vi.fn>
  let admin: any
  beforeEach(() => {
    vi.clearAllMocks()
    cap = 50; used = 0
    row = { id: 'fee-1', shopId: 'shop-a', orderId: 'order-1', orderNumber: '#123', status: 'pending', commissionAmount: 3.5, paymentRef: null, collectibleAt: new Date(), reviewRequiredAt: null, shopifyFinancialStatus: 'paid', shopifyRefundStatus: null, shopifyCancelledAt: null, usageIdempotencyKey: null, usageLineItemId: null, usageRequestStartedAt: null, nextBillingAttemptAt: null }
    mocks.shop.findUnique.mockResolvedValue({ id: 'shop-a', shopDomain: 'a.myshopify.com', uninstalledAt: null })
    mocks.shop.updateMany.mockResolvedValue({ count: 1 })
    mocks.shopBilling.findUnique.mockResolvedValue(null)
    mocks.shopBilling.upsert.mockImplementation(({ create }) => create)
    mocks.commission.findMany.mockImplementation(() => Promise.resolve(row.status === 'paid' ? [] : [{ ...row }]))
    mocks.commission.findFirst.mockImplementation(() => Promise.resolve({ ...row }))
    mocks.commission.updateMany.mockImplementation(({ where, data }) => {
      if (where.status && row.status !== where.status) return Promise.resolve({ count: 0 })
      if (where.paymentRef !== undefined && row.paymentRef !== where.paymentRef) return Promise.resolve({ count: 0 })
      if (where.usageRequestStartedAt === null && row.usageRequestStartedAt) return Promise.resolve({ count: 0 })
      if (where.OR && row.nextBillingAttemptAt && row.nextBillingAttemptAt > new Date()) return Promise.resolve({ count: 0 })
      Object.assign(row, data)
      return Promise.resolve({ count: 1 })
    })
    mocks.$transaction.mockImplementation((run) => run(mocks))
    usage = vi.fn().mockResolvedValue({ data: { appUsageRecordCreate: { userErrors: [], appUsageRecord: { id: 'gid://shopify/AppUsageRecord/1' } } } })
    lookup = vi.fn().mockImplementation(() => ({ data: { node: { lineItems: [{ id: 'line-1', usageRecords: { nodes: [{ id: 'gid://shopify/AppUsageRecord/1', idempotencyKey: row.usageIdempotencyKey, createdAt: new Date().toISOString(), price: { amount: '3.50', currencyCode: 'USD' } }], pageInfo: { hasNextPage: false } } }] } } }))
    admin = { graphql: vi.fn(async (query: string, options: any) => {
      const payload = query.includes('PublicBillingStatus') ? { data: { currentAppInstallation: { activeSubscriptions: [{ id: 'sub-1', status: 'ACTIVE', test: true, currentPeriodEnd: '2026-11-01', lineItems: [{ id: 'line-1', plan: { pricingDetails: { __typename: 'AppUsagePricing', cappedAmount: { amount: cap, currencyCode: 'USD' }, balanceUsed: { amount: used, currencyCode: 'USD' } } } }] }] } } } : query.includes('PublicUsageLookup') ? await lookup(options.variables) : await usage(options.variables)
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) }
  })
  it('records exactly one fee for concurrent duplicate deliveries', async () => {
    await Promise.all([runShopUsageBilling('shop-a', admin), runShopUsageBilling('shop-a', admin)])
    expect(usage).toHaveBeenCalledTimes(1)
    expect(usage.mock.calls[0][0]).toMatchObject({ price: { amount: '3.50', currencyCode: 'USD' }, key: buildUsageIdempotencyKey('shop-a', 'order-1') })
    expect(row.status).toBe('paid')
    await runShopUsageBilling('shop-a', admin)
    expect(usage).toHaveBeenCalledTimes(1)
  })
  it('does not record unpaid, cancelled, refunded or partial-refund orders', async () => {
    for (const facts of [{ collectibleAt: null, shopifyFinancialStatus: 'pending' }, { shopifyCancelledAt: new Date() }, { shopifyRefundStatus: 'full' }, { shopifyRefundStatus: 'partial', reviewRequiredAt: new Date() }]) {
      const original = { ...row }
      Object.assign(row, facts)
      await runShopUsageBilling('shop-a', admin)
      Object.assign(row, original)
    }
    expect(usage).not.toHaveBeenCalled()
  })
  it('recovers a crashed pre-request lease without treating it as money moved', async () => {
    row.status = 'charging'
    row.paymentRef = buildUsageIdempotencyKey('shop-a', 'order-1')
    row.nextBillingAttemptAt = new Date(0)
    await runShopUsageBilling('shop-a', admin)
    expect(row.status).toBe('paid')
    expect(usage).toHaveBeenCalledOnce()
  })
  it('keeps fees pending at the approved cap; provider rejection never becomes paid', async () => {
    used = 49
    await runShopUsageBilling('shop-a', admin)
    expect(usage).not.toHaveBeenCalled()
    expect(row.status).toBe('pending')
    used = 0
    usage.mockResolvedValueOnce({ data: { appUsageRecordCreate: { userErrors: [{ message: 'Total price exceeds balance remaining' }], appUsageRecord: null } } })
    await runShopUsageBilling('shop-a', admin)
    expect(row.status).toBe('pending')
    expect(row.paidAt).toBeUndefined()
  })
  it('quarantines a lost outcome and retries only the same amount, key and line', async () => {
    usage.mockRejectedValueOnce(new Error('response lost after provider accepted'))
    await runShopUsageBilling('shop-a', admin)
    expect(row.status).toBe('charging')
    expect(row.paymentRef).toBe(buildUsageIdempotencyKey('shop-a', 'order-1'))
    row.nextBillingAttemptAt = new Date(0)
    await runShopUsageBilling('shop-a', admin)
    expect(usage.mock.calls[1][0]).toEqual(usage.mock.calls[0][0])
    expect(row.status).toBe('paid')
    expect(mocks.billingCredit.upsert).not.toHaveBeenCalled()
  })
  it('looks up, but never creates, usage when an unknown request is followed by cancellation', async () => {
    usage.mockRejectedValueOnce(new Error('response lost after provider accepted'))
    await runShopUsageBilling('shop-a', admin)
    row.nextBillingAttemptAt = new Date(0)
    row.shopifyCancelledAt = new Date()
    row.reviewRequiredAt = new Date()
    await runShopUsageBilling('shop-a', admin)
    expect(usage).toHaveBeenCalledOnce()
    expect(lookup).toHaveBeenCalledOnce()
    expect(row.status).toBe('paid')
    expect(mocks.billingCredit.upsert).toHaveBeenCalledOnce()
  })
  it('keeps a cancelled unknown request quarantined when no provider record is found', async () => {
    usage.mockRejectedValueOnce(new Error('request may not have reached Shopify'))
    await runShopUsageBilling('shop-a', admin)
    row.nextBillingAttemptAt = new Date(0)
    row.shopifyCancelledAt = new Date()
    lookup.mockResolvedValue({ data: { node: { lineItems: [{ id: 'line-1', usageRecords: { nodes: [], pageInfo: { hasNextPage: false } } }] } } })
    await runShopUsageBilling('shop-a', admin)
    expect(usage).toHaveBeenCalledOnce()
    expect(row.status).toBe('charging')
    expect(row.paidAt).toBeUndefined()
  })
})
