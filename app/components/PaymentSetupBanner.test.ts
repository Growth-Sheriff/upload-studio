import { describe, expect, it } from 'vitest'
import { billingBannerForRender, revalidateAfterBilling } from './PaymentSetupBanner'

describe('provider-reconciled billing banner', () => {
  const pending = { status: 'pending', capUsd: 0, usedUsd: 0 }
  it('uses the reconciled child result instead of the parallel stale parent, without hiding cap warnings', () => {
    expect(billingBannerForRender(pending, { billing: { status: 'active', capUsd: 50, usedUsd: 0 } })).toBeNull()
    expect(billingBannerForRender(null, { billing: { status: 'active', capUsd: 50, usedUsd: 40 } })).toEqual({ status: 'active', capUsd: 50, usedUsd: 40 })
    expect(billingBannerForRender(null, { billing: pending })).toEqual(pending)
    expect(billingBannerForRender(pending, undefined)).toEqual(pending)
    expect(billingBannerForRender(pending, { billing: { status: 'active', capUsd: NaN, usedUsd: 0 } })).toEqual(pending)
  })
  it('refreshes parent DB state when leaving Billing, not on every sibling navigation', () => {
    expect(revalidateAfterBilling('/app/billing', '/app', false)).toBe(true)
    expect(revalidateAfterBilling('/app/billing/', '/app/products', false)).toBe(true)
    expect(revalidateAfterBilling('/app/products', '/app/uploads', false)).toBe(false)
    expect(revalidateAfterBilling('/app/billing', '/app/billing', false)).toBe(false)
    expect(revalidateAfterBilling('/app/products', '/app/uploads', true)).toBe(true)
  })
})
