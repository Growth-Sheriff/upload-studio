import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { BillingAdmin } from './shopifyBilling.server'

const url = process.env.PUBLIC_APP_TEST_DATABASE_URL
const enabled = url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/public_app_test(?:\?|$)/.test(url)
const describeDb = enabled ? describe : describe.skip
let prisma: typeof import('./prisma.server').default
let context: typeof import('./tenantContext.server').withTenantContext
let run: typeof import('./billingRunner.server').runShopUsageBilling
const domains: string[] = []
beforeAll(async () => {
  if (!enabled) return
  process.env.DATABASE_URL = url
  vi.stubEnv('PUBLIC_LEGAL_ENTITY_NAME', 'Disposable database fixture operator')
  vi.stubEnv('PUBLIC_LEGAL_ENTITY_ADDRESS', 'Disposable database fixture address')
  vi.stubEnv('PUBLIC_LEGAL_REVIEW_APPROVED', 'true')
  prisma = (await import('./prisma.server')).default
  context = (await import('./tenantContext.server')).withTenantContext
  run = (await import('./billingRunner.server')).runShopUsageBilling
})
afterAll(async () => {
  if (!enabled) return
  await prisma.shop.deleteMany({ where: { shopDomain: { in: domains } } })
  await prisma.$disconnect()
  vi.unstubAllEnvs()
})

async function fixture(order: string) {
  const domain = `usage-${randomUUID()}.myshopify.com`; domains.push(domain)
  const version = (await import('./publicLegal.server')).getPublicLegalOperator().version
  const shop = await prisma.shop.create({ data: { shopDomain: domain, accessToken: 'local-test-no-shopify-access', billingStatus: 'active', legalAgreementVersion: version, legalAgreementAcceptedAt: new Date(), legalAgreementActorId: '123' } })
  const fee = await context(shop.id, () => prisma.commission.create({ data: { shopId: shop.id, orderId: order, orderTotal: 100, attributableCapturedAmount: 100, servedAmountUsd: 100, commissionAmount: 3.5, status: 'pending', collectibleAt: new Date(), shopifyFinancialStatus: 'paid' } }))
  return { shop, fee }
}

function provider(lostFirstResponse = false) {
  const namespace = randomUUID()
  const records = new Map<string, { id: string; amount: string }>()
  let attempts = 0
  const admin: BillingAdmin = { graphql: async (query, options) => {
    let data: unknown
    if (query.includes('PublicBillingStatus')) data = { currentAppInstallation: { activeSubscriptions: [{ id: 'gid://shopify/AppSubscription/1', status: 'ACTIVE', test: true, lineItems: [{ id: 'gid://shopify/AppSubscriptionLineItem/1', plan: { pricingDetails: { __typename: 'AppUsagePricing', cappedAmount: { amount: '50', currencyCode: 'USD' }, balanceUsed: { amount: '0', currencyCode: 'USD' } } } }] }] } }
    else if (query.includes('PublicOrderUsage')) {
      attempts++
      const vars: any = options?.variables
      const prior = records.get(vars.key)
      if (prior && prior.amount !== vars.price.amount) throw new Error('Frozen provider key amount changed')
      const record = prior || { id: `gid://shopify/AppUsageRecord/${namespace}-${records.size + 1}`, amount: vars.price.amount }
      records.set(vars.key, record)
      if (lostFirstResponse && attempts === 1) throw new Error('Simulated lost provider response after acceptance')
      data = { appUsageRecordCreate: { appUsageRecord: { id: record.id }, userErrors: [] } }
    } else throw new Error('Unexpected provider call in isolated billing test')
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } }
  return { admin, records, attempts: () => attempts }
}

describeDb('real PostgreSQL usage claims, simulated provider transport', () => {
  it('concurrent deliveries make one durable record per shop/order and never collect unpaid/cancelled rows', async () => {
    const first = await fixture('101')
    const second = await fixture('101')
    const a = provider(); const b = provider()
    await context(first.shop.id, async () => {
      await prisma.commission.create({ data: { shopId: first.shop.id, orderId: 'unpaid', orderTotal: 100, commissionAmount: 3.5, status: 'awaiting_payment', shopifyFinancialStatus: 'pending' } })
      await prisma.commission.create({ data: { shopId: first.shop.id, orderId: 'cancelled', orderTotal: 100, commissionAmount: 0, status: 'void', shopifyCancelledAt: new Date() } })
    })
    await Promise.all([run(first.shop.id, a.admin), run(first.shop.id, a.admin), run(second.shop.id, b.admin)])
    await run(first.shop.id, a.admin)
    expect(a.attempts()).toBe(1); expect(b.attempts()).toBe(1)
    const feeA = await context(first.shop.id, () => prisma.commission.findUniqueOrThrow({ where: { id: first.fee.id } }))
    const feeB = await context(second.shop.id, () => prisma.commission.findUniqueOrThrow({ where: { id: second.fee.id } }))
    expect(feeA.status).toBe('paid'); expect(Number(feeA.commissionAmount)).toBe(3.5)
    expect(feeA.usageIdempotencyKey).not.toBe(feeB.usageIdempotencyKey)
    expect(await context(first.shop.id, () => prisma.commission.count({ where: { status: 'paid' } }))).toBe(1)
    expect(await context(second.shop.id, () => prisma.commission.count({ where: { status: 'paid' } }))).toBe(1)
  })
  it('an accepted request with a lost response stays quarantined and reuses its immutable claim', async () => {
    const { shop, fee } = await fixture('102')
    const p = provider(true)
    await run(shop.id, p.admin)
    const unknown = await context(shop.id, () => prisma.commission.findUniqueOrThrow({ where: { id: fee.id } }))
    expect(unknown.status).toBe('charging'); expect(unknown.usageRequestStartedAt).not.toBeNull(); expect(unknown.usageRecordId).toBeNull()
    await context(shop.id, () => prisma.commission.update({ where: { id: fee.id }, data: { nextBillingAttemptAt: new Date(0) } }))
    await Promise.all([run(shop.id, p.admin), run(shop.id, p.admin)])
    const settled = await context(shop.id, () => prisma.commission.findUniqueOrThrow({ where: { id: fee.id } }))
    expect(settled.status).toBe('paid'); expect(settled.usageIdempotencyKey).toBe(unknown.usageIdempotencyKey)
    expect(settled.usageLineItemId).toBe(unknown.usageLineItemId); expect(Number(settled.commissionAmount)).toBe(3.5)
    expect(p.records.size).toBe(1); expect(p.attempts()).toBe(2)
  })
})
