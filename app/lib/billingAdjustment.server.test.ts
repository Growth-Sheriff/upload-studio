import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ $transaction: vi.fn() }))
vi.mock('./prisma.server', () => ({ default: mocks }))
vi.mock('~/lib/prisma.server', () => ({ default: mocks }))
import { recordManualBillingAdjustment, validateManualBillingAdjustment, type ManualBillingAdjustment } from './billingAdjustment.server'
import { buildUsageIdempotencyKey } from './billing.server'
import { getTenantShopId, withTenantContext } from './tenantContext.server'

describe('owner bookkeeping of already confirmed Shopify adjustments', () => {
  let fee: any
  let review: any
  let audits: Map<string, any>
  let input: ManualBillingAdjustment
  let auditFailure: boolean
  let closed: boolean
  beforeEach(() => {
    vi.stubEnv('PUBLIC_APP_RUNTIME', 'true')
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No financial provider calls are allowed') }))
    vi.clearAllMocks()
    const key = buildUsageIdempotencyKey('shop-a', 'order-1')
    fee = { id: 'fee-1', shopId: 'shop-a', orderId: 'order-1', status: 'paid', paymentProvider: 'shopify', billingCurrency: 'USD', reviewRequiredAt: new Date(), commissionAmount: new Prisma.Decimal('3.50'), usageIdempotencyKey: key, usageRecordId: 'gid://shopify/AppUsageRecord/1', paymentRef: 'gid://shopify/AppUsageRecord/1', usageSubscriptionId: 'sub-1', usageLineItemId: 'line-1' }
    review = { id: 'review-1', shopId: 'shop-a', commissionId: 'fee-1', amountUsd: new Prisma.Decimal('3.50'), status: 'review', providerRef: null, settledAt: null, settledAmountUsd: null, receiptFingerprint: null, idempotencyKey: `credit-${key}` }
    audits = new Map(); auditFailure = false; closed = false
    input = { shopId: 'shop-a', shopDomain: 'a.myshopify.com', reviewId: 'review-1', commissionId: 'fee-1', expectedUsageRecordId: fee.usageRecordId, expectedFeeUsd: '3.50', operation: 'credit', outcome: 'confirmed', currency: 'USD', amountUsd: '3.50', providerRef: 'provider-credit-1', providerConfirmedAt: '2026-10-01T00:00:00Z', operator: 'owner-fixture', reason: 'Verified cancelled order and exact Shopify history receipt' }
    let queue = Promise.resolve()
    // In-memory atomic transaction model: failures discard both review and
    // audit changes. A separate opt-in PostgreSQL test proves real locking.
    mocks.$transaction.mockImplementation(run => {
      const pending = queue.then(async () => {
        const nextReview = { ...review }; const nextAudits = new Map(audits)
        const tx = {
          $queryRaw: vi.fn((_sql, owner, domain) => Promise.resolve(!closed && owner === 'shop-a' && domain === 'a.myshopify.com' ? [{ id: 'shop-a' }] : [])),
          commission: { findFirst: vi.fn(({ where }) => Promise.resolve(where.id === fee.id && where.shopId === fee.shopId ? { ...fee } : null)) },
          billingCredit: {
            findFirst: vi.fn(({ where }) => Promise.resolve(where.id === nextReview.id && where.shopId === nextReview.shopId && where.commissionId === nextReview.commissionId ? { ...nextReview } : null)),
            updateMany: vi.fn(({ where, data }) => {
              if (where.shopId !== getTenantShopId() || where.status !== nextReview.status || nextReview.providerRef || nextReview.settledAt) return Promise.resolve({ count: 0 })
              Object.assign(nextReview, data, data.settledAmountUsd ? { settledAmountUsd: new Prisma.Decimal(data.settledAmountUsd) } : {}); return Promise.resolve({ count: 1 })
            }),
          },
          auditLog: {
            findFirst: vi.fn(({ where }) => Promise.resolve(nextAudits.get(where.id)?.shopId === where.shopId ? nextAudits.get(where.id) : null)),
            create: vi.fn(({ data }) => {
              if (auditFailure) throw new Error('Simulated audit write failure')
              if (nextAudits.has(data.id)) throw new Prisma.PrismaClientKnownRequestError('Duplicate receipt', { code: 'P2002', clientVersion: '5.22.0' })
              nextAudits.set(data.id, data); return Promise.resolve(data)
            }),
          },
        }
        const result = await run(tx)
        review = nextReview; audits = nextAudits
        return result
      })
      queue = pending.then(() => undefined, () => undefined)
      return pending
    })
  })
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('concurrent identical receipts settle one review with one audit and leave the paid fee untouched', async () => {
    const originalFee = { ...fee }
    const results = await Promise.all([recordManualBillingAdjustment(input), recordManualBillingAdjustment(input)])
    expect(results.map(result => result.replayed)).toEqual([false, true])
    expect(review.status).toBe('credited'); expect(review.providerRef).toBe(input.providerRef)
    expect(audits.size).toBe(1); expect(fee).toEqual(originalFee)
    audits.clear()
    expect((await recordManualBillingAdjustment(input)).replayed).toBe(true)
    expect(audits.size).toBe(0) // Do not recreate an expired audit.
    await expect(recordManualBillingAdjustment({ ...input, providerRef: 'different-receipt' })).rejects.toThrow('already has an outcome')
    await expect(recordManualBillingAdjustment({ ...input, amountUsd: '1.00' })).rejects.toThrow('conflicting')
    expect(audits.size).toBe(0)
  })
  it('quarantines unknown results, then records explicit partial relief without claiming a full refund', async () => {
    const unknown = { ...input, outcome: 'unknown', providerRef: undefined, providerConfirmedAt: undefined }
    expect((await recordManualBillingAdjustment(unknown)).status).toBe('quarantined')
    expect((await recordManualBillingAdjustment(unknown)).replayed).toBe(true)
    expect(review.providerRef).toBeNull(); expect(review.settledAt).toBeNull()
    const confirmed = { ...input, operation: 'refund', amountUsd: '1.50' }
    expect((await recordManualBillingAdjustment(confirmed)).status).toBe('partially_refunded')
    expect(Number(review.amountUsd)).toBe(3.5)
    expect([...audits.values()].find(audit => audit.action === 'shopify_manual_adjustment_recorded').metadata.amountUsd).toBe('1.50')
    expect(fee.status).toBe('paid')
  })
  it('rolls back review settlement when its audit fails or a receipt belongs to another shop', async () => {
    auditFailure = true
    await expect(recordManualBillingAdjustment(input)).rejects.toThrow('audit write failure')
    expect(review.status).toBe('review'); expect(review.providerRef).toBeNull(); expect(audits.size).toBe(0)
    auditFailure = false
    const result = await recordManualBillingAdjustment(input)
    audits.set(result.auditId, { ...audits.get(result.auditId), shopId: 'foreign-shop' })
    Object.assign(review, { status: 'review', providerRef: null, settledAt: null, settledAmountUsd: null, receiptFingerprint: null })
    await expect(recordManualBillingAdjustment(input)).rejects.toThrow('Receipt was already recorded or conflicts')
    expect(review.status).toBe('review'); expect(review.providerRef).toBeNull()
  })
  it('rejects foreign scopes, mismatched immutable references, erasing shops and non-public runtimes', async () => {
    await expect(withTenantContext('foreign-shop', () => recordManualBillingAdjustment(input))).rejects.toThrow('cross an existing shop context')
    await expect(recordManualBillingAdjustment({ ...input, reviewId: 'foreign-review' })).rejects.toThrow('not found')
    await expect(recordManualBillingAdjustment({ ...input, expectedUsageRecordId: 'other-usage' })).rejects.toThrow('does not match')
    await expect(recordManualBillingAdjustment({ ...input, expectedFeeUsd: '4.00' })).rejects.toThrow('does not match')
    fee.status = 'charging'
    await expect(recordManualBillingAdjustment(input)).rejects.toThrow('does not match')
    fee.status = 'paid'; closed = true
    await expect(recordManualBillingAdjustment(input)).rejects.toThrow('closed for erasure')
    vi.stubEnv('PUBLIC_APP_RUNTIME', 'false')
    await expect(recordManualBillingAdjustment(input)).rejects.toThrow('Public app runtime')
    expect(audits.size).toBe(0)
  })
  it('requires explicit identity, USD cents, a non-future confirmation and no fake receipt for unknown outcomes', () => {
    for (const change of [{ operator: '' }, { reason: '' }, { amountUsd: '1.001' }, { amountUsd: '3.51' }, { currency: 'CAD' }, { providerRef: '' }, { providerConfirmedAt: '2999-01-01T00:00:00Z' }, { outcome: 'unknown' }, { unexpected: true }]) expect(() => validateManualBillingAdjustment({ ...input, ...change })).toThrow()
    expect(() => validateManualBillingAdjustment(input)).not.toThrow()
    expect(mocks.$transaction).not.toHaveBeenCalled()
  })
})
