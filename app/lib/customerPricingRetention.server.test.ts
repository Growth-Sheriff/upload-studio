import { describe, expect, it } from 'vitest'
import { normalizeVolumeProgram } from './customerPricingModel.server'
import { paidVolumeLinkRetentionPolicy } from './customerPricingRetention.server'
import { validateVolumeLookbackMonths, volumeLookbackStart } from './customerPricingShared'

const domain = 'public-fixture.myshopify.com'
const now = new Date('2026-10-10T12:00:00Z')
const settings = (months: unknown = 12) => ({ customerPricing: { model: 'both' }, alphaProDiscount: {
  enabled: true, products: ['1', '2'], tiers: [{ min_qty: 1, price_per_inch: 0.2 }],
  autoEligibility: { enabled: true, months, minInches: 100 },
} })

describe('paid-volume identity lifetime', () => {
  it('shows a twelve-month default and uses the exact inclusive pricing cutoff for every program product', () => {
    expect(normalizeVolumeProgram({}).autoEligibility.months).toBe(12)
    const policy = paidVolumeLinkRetentionPolicy(domain, settings(), now)
    expect(policy).toEqual({ kind: 'unlink', before: volumeLookbackStart(12, now.getTime()) })
    if (policy.kind !== 'unlink' || !policy.before) throw new Error('Expected active window')
    expect(policy.before.toISOString()).toBe('2025-10-15T12:00:00.000Z')
    // Pricing includes paidAt === cutoff; retention uses strictly less than.
    expect(new Date(policy.before.getTime() - 1) < policy.before).toBe(true)
    expect(policy.before < policy.before).toBe(false)
  })
  it('does not retain history for a disabled program, model or automatic qualification', () => {
    const disabled = settings(); disabled.alphaProDiscount.enabled = false
    const manual = settings(); manual.alphaProDiscount.autoEligibility.enabled = false
    const off = settings(); off.customerPricing.model = 'status_rates'
    for (const config of [disabled, manual, off]) expect(paidVolumeLinkRetentionPolicy(domain, config, now)).toEqual({ kind: 'unlink', before: null })
  })
  it('rejects new unsupported edits and defers old stored values instead of clamping a live pricing window', () => {
    expect(validateVolumeLookbackMonths('12')).toBe(12)
    for (const value of [0, 1.5, 13, '', 'invalid', 1e100]) {
      expect(() => validateVolumeLookbackMonths(value)).toThrow('whole number from 1 to 12')
      expect(paidVolumeLinkRetentionPolicy(domain, settings(value), now)).toEqual({ kind: 'defer', reason: 'invalid_lookback_months' })
    }
    expect(normalizeVolumeProgram(settings(18)).autoEligibility.months).toBe(18)
  })
})
