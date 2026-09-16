import { describe, expect, it } from 'vitest'
import {
  HOSTED_CHECKOUT_RESERVED_STATUS,
  HostedCheckoutReservationError,
  amountStringToCents,
  parseHostedCheckoutReservation,
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
