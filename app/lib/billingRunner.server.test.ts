import { describe, expect, it } from 'vitest'
import {
  buildFailedProviderDisableUpdates,
  shouldQuarantineClaimAfterProviderError,
  validateAutoChargeClaimBeforeProvider,
} from './billingRunner.server'

describe('auto-charge saved-method isolation', () => {
  const savedMethods = {
    stripePaymentMethodId: 'pm_saved',
    paypalVaultId: 'vault_saved',
  }

  it('disables only a declined Stripe method', () => {
    expect(buildFailedProviderDisableUpdates('stripe', savedMethods)).toEqual({
      stripeAutoCharge: false,
      stripePaymentMethodId: null,
    })
  })

  it('disables only a declined PayPal vault', () => {
    expect(buildFailedProviderDisableUpdates('paypal', savedMethods)).toEqual({
      paypalAutoCharge: false,
      paypalVaultId: null,
    })
  })
})

describe('auto-charge provider outcome safety', () => {
  it('quarantines a claim when a provider request times out', () => {
    expect(
      shouldQuarantineClaimAfterProviderError(
        true,
        'api_connection_error: socket hang up after request'
      )
    ).toBe(true)
  })

  it('releases a claim after a provider-confirmed hard decline', () => {
    expect(
      shouldQuarantineClaimAfterProviderError(true, 'card_declined: insufficient_funds')
    ).toBe(false)
  })

  it.each(['Capture status: DECLINED', 'Capture status: FAILED'])(
    'releases a claim after PayPal confirms no capture with %s',
    (message) => {
      expect(shouldQuarantineClaimAfterProviderError(true, message)).toBe(false)
    }
  )

  it.each([
    'Your card was declined.',
    'Your card has insufficient funds.',
    'Your card has expired.',
    "Your card's security code is incorrect.",
  ])('releases a claim for a confirmed Stripe hard decline: %s', (message) => {
    expect(shouldQuarantineClaimAfterProviderError(true, message)).toBe(false)
  })

  it('keeps a pending PayPal capture quarantined for review', () => {
    expect(
      shouldQuarantineClaimAfterProviderError(true, 'Capture status: PENDING')
    ).toBe(true)
  })

  it('releases a claim when no provider request started', () => {
    expect(
      shouldQuarantineClaimAfterProviderError(false, 'local validation failed')
    ).toBe(false)
  })
})

describe('auto-charge final eligibility gate', () => {
  const eligibleRow = {
    orderId: 'order-1',
    status: 'charging',
    paymentRef: 'claim-1',
    collectibleAt: new Date('2026-09-17T10:00:00Z'),
    reviewRequiredAt: null,
    shopifyFinancialStatus: 'paid',
    shopifyRefundStatus: null,
    shopifyCancelledAt: null,
  }

  it('allows only the exact still-eligible claimed row set', () => {
    expect(
      validateAutoChargeClaimBeforeProvider({
        claimRef: 'claim-1',
        expectedOrderIds: ['order-1'],
        rows: [eligibleRow],
      })
    ).toEqual({ safe: true, reason: null, unsafeOrderIds: [] })
  })

  it.each([
    { reviewRequiredAt: new Date('2026-09-17T10:01:00Z') },
    { shopifyCancelledAt: new Date('2026-09-17T10:01:00Z') },
    { shopifyRefundStatus: 'partial' },
    { shopifyFinancialStatus: 'refunded' },
  ])('aborts before the provider when terminal/review facts race the claim: %o', (change) => {
    expect(
      validateAutoChargeClaimBeforeProvider({
        claimRef: 'claim-1',
        expectedOrderIds: ['order-1'],
        rows: [{ ...eligibleRow, ...change }],
      })
    ).toEqual({
      safe: false,
      reason: 'eligibility_changed_after_claim',
      unsafeOrderIds: ['order-1'],
    })
  })

  it('aborts when the exact claimed set or claim ownership changed', () => {
    expect(
      validateAutoChargeClaimBeforeProvider({
        claimRef: 'claim-1',
        expectedOrderIds: ['order-1', 'order-2'],
        rows: [eligibleRow],
      }).safe
    ).toBe(false)
    expect(
      validateAutoChargeClaimBeforeProvider({
        claimRef: 'claim-1',
        expectedOrderIds: ['order-1'],
        rows: [{ ...eligibleRow, paymentRef: 'another-claim' }],
      }).safe
    ).toBe(false)
  })
})
