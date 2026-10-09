import { describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ shop: { findUnique: vi.fn() } }))
vi.mock('~/lib/prisma.server', () => ({ default: store }))
import { BILLING_POLICY, MAX_FILE_SIZE_MB, billingCapState, buildUsageIdempotencyKey, calculateCommissionAmount, checkUploadAllowed, recommendedBillingCap, sumMoneyCents } from './billing.server'
import { parseEcbRates } from './billingFx.server'

describe('public order fees', () => {
  it('charges 3.5% after discounts and never more than US$6', () => {
    expect(BILLING_POLICY.rate).toBe(0.035)
    expect(calculateCommissionAmount(30.6)).toBe(1.07)
    expect(calculateCommissionAmount(100)).toBe(3.5)
    expect(calculateCommissionAmount(200)).toBe(6)
    expect(calculateCommissionAmount(1000) / 1000).toBe(0.006)
    expect(calculateCommissionAmount(0)).toBe(0)
    expect(calculateCommissionAmount(-100)).toBe(0)
    expect(calculateCommissionAmount(NaN)).toBe(0)
  })
  it('keeps one logical key across retries and webhook deliveries, scoped to shop/order', () => {
    expect(buildUsageIdempotencyKey('shop-a', 'order-1')).toBe(buildUsageIdempotencyKey('shop-a', 'order-1'))
    expect(buildUsageIdempotencyKey('shop-b', 'order-1')).not.toBe(buildUsageIdempotencyKey('shop-a', 'order-1'))
    expect(buildUsageIdempotencyKey('shop-a', 'order-2')).not.toBe(buildUsageIdempotencyKey('shop-a', 'order-1'))
  })
  it('allows exactly the approved cents, blocks overflow, prompts at 80%', () => {
    expect(billingCapState(50, 39)).toBe('available')
    expect(billingCapState(50, 40)).toBe('approaching')
    expect(billingCapState(50, 49.99, 0.01)).toBe('approaching')
    expect(billingCapState(50, 49.99, 0.02)).toBe('exhausted')
    expect(billingCapState(50, 50)).toBe('exhausted')
    expect(sumMoneyCents([0.1, 0.2])).toBe(30)
    expect(recommendedBillingCap()).toBe(50)
    expect(recommendedBillingCap(10000)).toBe(500)
  })
  it('converts a CAD order to USD before applying the dollar cap', () => {
    const { rates } = parseEcbRates(`<Cube time='2026-10-08'><Cube currency='USD' rate='1.1'/><Cube currency='CAD' rate='1.5'/></Cube>`, new Date('2026-10-09T12:00:00Z'))
    const usd = 150 * rates.get('USD')! / rates.get('CAD')!
    expect(usd).toBeCloseTo(110)
    expect(calculateCommissionAmount(usd)).toBe(3.85)
    expect(calculateCommissionAmount(150)).toBe(5.25)
  })
  it('rejects stale, future and missing FX instead of inventing USD', () => {
    expect(() => parseEcbRates(`<Cube time='2026-09-01'><Cube currency='USD' rate='1.1'/></Cube>`, new Date('2026-10-09'))).toThrow('stale')
    expect(() => parseEcbRates(`<Cube time='2026-10-10'><Cube currency='USD' rate='1.1'/></Cube>`, new Date('2026-10-09'))).toThrow('stale')
    expect(() => parseEcbRates(`<Cube time='2026-10-08'/>`, new Date('2026-10-09'))).toThrow('USD')
  })
  it('does not accept files exceeding worker capacity or an erasing shop', async () => {
    store.shop.findUnique.mockResolvedValue({ billingStatus: 'active', erasureStartedAt: null, uninstalledAt: null })
    expect(MAX_FILE_SIZE_MB).toBe(1024)
    expect((await checkUploadAllowed('shop-a', 'gang_sheet', 1024)).allowed).toBe(true)
    expect((await checkUploadAllowed('shop-a', 'gang_sheet', 1024.001)).allowed).toBe(false)
    store.shop.findUnique.mockResolvedValue({ billingStatus: 'active', erasureStartedAt: new Date(), uninstalledAt: null })
    expect((await checkUploadAllowed('shop-a', 'gang_sheet', 1)).allowed).toBe(false)
  })
})
