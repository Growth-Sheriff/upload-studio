import { describe, expect, it } from 'vitest'
import {
  buildFailedProviderDisableUpdates,
  shouldQuarantineClaimAfterProviderError,
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
