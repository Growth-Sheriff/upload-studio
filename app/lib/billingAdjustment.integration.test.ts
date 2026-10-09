import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.PUBLIC_APP_TEST_DATABASE_URL
const enabled = Boolean(url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/public_app_test(?:\?|$)/.test(url))
const describeDb = enabled ? describe : describe.skip
let prisma: typeof import('./prisma.server').default
let context: typeof import('./tenantContext.server').withTenantContext
let record: typeof import('./billingAdjustment.server').recordManualBillingAdjustment
let key: typeof import('./billing.server').buildUsageIdempotencyKey
const domains: string[] = []
beforeAll(async () => {
  if (!enabled) return
  process.env.DATABASE_URL = url
  prisma = (await import('./prisma.server')).default
  context = (await import('./tenantContext.server')).withTenantContext
  record = (await import('./billingAdjustment.server')).recordManualBillingAdjustment
  key = (await import('./billing.server')).buildUsageIdempotencyKey
})
afterAll(async () => {
  if (!enabled) return
  await prisma.shop.deleteMany({ where: { shopDomain: { in: domains } } })
  await prisma.$disconnect()
})

describeDb('real PostgreSQL manual-result bookkeeping, no provider transport', () => {
  it('serializes identical receipts and rolls back reuse across shops without editing either paid fee', async () => {
    async function fixture() {
      const shopDomain = `adjustment-${randomUUID()}.myshopify.com`; domains.push(shopDomain)
      const shop = await prisma.shop.create({ data: { shopDomain, accessToken: 'disposable-test-no-provider-access', billingStatus: 'active' } })
      return context(shop.id, async () => {
        const usageKey = key(shop.id, '101')
        const usageId = `gid://shopify/AppUsageRecord/${randomUUID()}`
        const fee = await prisma.commission.create({ data: { shopId: shop.id, orderId: '101', orderTotal: 100, commissionAmount: 3.5, status: 'paid', paymentProvider: 'shopify', billingCurrency: 'USD', paymentRef: usageId, usageRecordId: usageId, usageIdempotencyKey: usageKey, usageSubscriptionId: 'fixture-sub', usageLineItemId: 'fixture-line', reviewRequiredAt: new Date(), reviewReason: 'disposable fixture cancellation' } })
        const review = await prisma.billingCredit.create({ data: { shopId: shop.id, commissionId: fee.id, amountUsd: 3.5, idempotencyKey: `credit-${usageKey}` } })
        const input = { shopId: shop.id, shopDomain, commissionId: fee.id, reviewId: review.id, expectedUsageRecordId: usageId, expectedFeeUsd: '3.50', currency: 'USD', operation: 'refund', outcome: 'confirmed', amountUsd: '1.50', providerRef: `fixture-receipt-${randomUUID()}`, providerConfirmedAt: '2020-01-01T00:00:00Z', operator: 'disposable-test-operator', reason: 'Simulated already-confirmed provider receipt; no real money action' }
        return { shop, fee, review, input }
      })
    }
    const first = await fixture(); const second = await fixture()
    const results = await Promise.all([record(first.input), record(first.input)])
    expect(results.filter(result => !result.replayed)).toHaveLength(1)
    expect(await context(first.shop.id, () => prisma.auditLog.count({ where: { action: 'shopify_manual_adjustment_recorded', resourceId: first.review.id } }))).toBe(1)
    expect(await context(first.shop.id, () => prisma.commission.findUniqueOrThrow({ where: { id: first.fee.id } }))).toEqual(first.fee)
    // Even loss/expiry of the audit must not let another store reuse money's
    // receipt: BillingCredit itself owns the durable unique constraint.
    await context(first.shop.id, () => prisma.auditLog.deleteMany({ where: { action: 'shopify_manual_adjustment_recorded', resourceId: first.review.id } }))
    expect((await record(first.input)).replayed).toBe(true)
    expect(await context(first.shop.id, () => prisma.auditLog.count({ where: { action: 'shopify_manual_adjustment_recorded', resourceId: first.review.id } }))).toBe(0)
    await expect(record({ ...second.input, providerRef: first.input.providerRef })).rejects.toThrow('Receipt was already recorded or conflicts')
    const secondReview = await context(second.shop.id, () => prisma.billingCredit.findUniqueOrThrow({ where: { id: second.review.id } }))
    expect(secondReview.status).toBe('review'); expect(secondReview.providerRef).toBeNull(); expect(secondReview.settledAt).toBeNull()
    expect(await context(second.shop.id, () => prisma.auditLog.count({ where: { action: 'shopify_manual_adjustment_recorded' } }))).toBe(0)
    expect(await context(second.shop.id, () => prisma.commission.findUniqueOrThrow({ where: { id: second.fee.id } }))).toEqual(second.fee)
  })
})
