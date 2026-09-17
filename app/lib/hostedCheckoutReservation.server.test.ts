import { describe, expect, it } from 'vitest'
import {
  HOSTED_CHECKOUT_RESERVED_STATUS,
  HostedCheckoutReservationError,
  amountStringToCents,
  getHostedCheckoutSettlementReviewOrderIds,
  parseHostedCheckoutReservation,
  validateHostedCheckoutPreCapture,
  validateHostedCheckoutSettlement,
  type HostedCheckoutReservationSnapshot,
  type HostedCheckoutSettlementRow,
} from './hostedCheckoutReservation.server'

const snapshot: HostedCheckoutReservationSnapshot = {
  version: 1,
  reservationRef: 'hco_stripe_test',
  provider: 'stripe',
  orderIds: ['order-1', 'order-2'],
  totalCents: 625,
  currency: 'USD',
  monthKey: '2026-09',
}

function reservedRows(): HostedCheckoutSettlementRow[] {
  return [
    {
      orderId: 'order-1',
      commissionAmount: 1.25,
      orderCurrency: 'USD',
      status: HOSTED_CHECKOUT_RESERVED_STATUS,
      paymentRef: snapshot.reservationRef,
      paymentProvider: 'stripe',
    },
    {
      orderId: 'order-2',
      commissionAmount: 5,
      orderCurrency: 'USD',
      status: HOSTED_CHECKOUT_RESERVED_STATUS,
      paymentRef: snapshot.reservationRef,
      paymentProvider: 'stripe',
    },
  ]
}

function validate(rows = reservedRows(), overrides: Record<string, unknown> = {}) {
  return validateHostedCheckoutSettlement({
    snapshot,
    rows,
    provider: 'stripe',
    captureRef: 'pi_123',
    providerAmountCents: 625,
    providerCurrency: 'usd',
    ...overrides,
  })
}

describe('hosted checkout reservation metadata', () => {
  it('parses only the versioned, exact reservation snapshot', () => {
    expect(
      parseHostedCheckoutReservation({ hostedCheckoutReservation: snapshot })
    ).toEqual(snapshot)
    expect(parseHostedCheckoutReservation({ orderIds: snapshot.orderIds })).toBeNull()
    expect(
      parseHostedCheckoutReservation({
        hostedCheckoutReservation: { ...snapshot, totalCents: 0 },
      })
    ).toBeNull()
  })
})

describe('hosted checkout settlement validation', () => {
  it('accepts the exact reserved row set, amount and currency', () => {
    expect(validate()).toEqual({ alreadyProcessed: false, totalCents: 625 })
  })

  it('recognises an idempotent replay only for the same capture and provider', () => {
    const rows = reservedRows().map((row) => ({
      ...row,
      status: 'paid',
      paymentRef: 'pi_123',
    }))
    expect(validate(rows)).toEqual({ alreadyProcessed: true, totalCents: 625 })
    expect(() =>
      validate(rows.map((row) => ({ ...row, paymentRef: 'pi_other' })))
    ).toThrow(HostedCheckoutReservationError)
  })

  it.each([
    { providerAmountCents: 624 },
    { providerAmountCents: 626 },
    { providerCurrency: 'EUR' },
  ])('rejects provider amount/currency drift: %o', (overrides) => {
    expect(() => validate(reservedRows(), overrides)).toThrow(
      HostedCheckoutReservationError
    )
  })

  it('rejects a changed row set or changed persisted amount', () => {
    expect(() => validate(reservedRows().slice(0, 1))).toThrow(
      HostedCheckoutReservationError
    )
    const changed = reservedRows()
    changed[1].commissionAmount = 4.99
    expect(() => validate(changed)).toThrow(HostedCheckoutReservationError)
  })

  it('rejects rows claimed by auto-charge or another checkout', () => {
    const claimed = reservedRows()
    claimed[0] = {
      ...claimed[0],
      status: 'charging',
      paymentRef: 'claim_other',
    }
    expect(() => validate(claimed)).toThrow(HostedCheckoutReservationError)
  })

  it('records a provider-confirmed payment while keeping refund/cancellation review visible', () => {
    const rows = reservedRows()
    rows[0] = {
      ...rows[0],
      reviewRequiredAt: new Date('2026-09-17T10:00:00Z'),
      reviewReason: 'shopify_order_partially_refunded_provider_reconciliation_required',
      shopifyRefundStatus: 'partial',
    }

    // The provider already moved money, so settlement remains valid; the
    // affected order is carried into the settlement audit/review gate.
    expect(validate(rows)).toEqual({ alreadyProcessed: false, totalCents: 625 })
    expect(getHostedCheckoutSettlementReviewOrderIds(rows)).toEqual(['order-1'])
  })

  it('detects a persisted terminal fact even if its review marker raced behind it', () => {
    const rows = reservedRows()
    rows[1] = {
      ...rows[1],
      shopifyCancelledAt: new Date('2026-09-17T10:00:00Z'),
    }
    expect(getHostedCheckoutSettlementReviewOrderIds(rows)).toEqual(['order-2'])
  })
})

describe('hosted checkout pre-capture validation', () => {
  function validatePreCapture(rows = reservedRows()) {
    return validateHostedCheckoutPreCapture({ snapshot, rows, provider: 'stripe' })
  }

  it('accepts only the exact unchanged reservation immediately before capture', () => {
    expect(validatePreCapture()).toEqual({ totalCents: 625 })
  })

  it.each([
    { reviewRequiredAt: new Date('2026-09-17T10:00:00Z') },
    { shopifyCancelledAt: new Date('2026-09-17T10:00:00Z') },
    { shopifyRefundStatus: 'partial' },
  ])('refuses to initiate capture after safety drift: %o', (unsafeFact) => {
    const rows = reservedRows()
    rows[0] = { ...rows[0], ...unsafeFact }
    expect(() => validatePreCapture(rows)).toThrow(HostedCheckoutReservationError)
  })

  it('refuses a changed claim, amount, or exact row set', () => {
    const changedClaim = reservedRows()
    changedClaim[0] = { ...changedClaim[0], paymentRef: 'hco_paypal_other' }
    expect(() => validatePreCapture(changedClaim)).toThrow(HostedCheckoutReservationError)

    const changedAmount = reservedRows()
    changedAmount[0] = { ...changedAmount[0], commissionAmount: 1.24 }
    expect(() => validatePreCapture(changedAmount)).toThrow(HostedCheckoutReservationError)
    expect(() => validatePreCapture(reservedRows().slice(0, 1))).toThrow(
      HostedCheckoutReservationError
    )
  })
})

describe('provider amount parsing', () => {
  it('converts provider decimal strings to exact cents', () => {
    expect(amountStringToCents('6.25')).toBe(625)
    expect(amountStringToCents('6')).toBe(600)
    expect(amountStringToCents('0.01')).toBe(1)
  })

  it.each(['', '-1.00', '1.001', 'NaN', '1,00'])('rejects invalid amount %s', (value) => {
    expect(() => amountStringToCents(value)).toThrow(HostedCheckoutReservationError)
  })
})
