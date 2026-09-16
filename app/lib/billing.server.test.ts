import { describe, expect, it } from 'vitest'
import {
  COMMISSION_CAP_USD,
  buildAutoChargeIdempotencyKey,
  calculateCommissionAmount,
  centsToMoney,
  isSupportedBillingCurrency,
  isZeroPaymentOrder,
  moneyToCents,
  sumMoneyCents,
} from './billing.server'

describe('auto-charge idempotency key', () => {
  it('is identical for retries of the same logical attempt regardless of order', () => {
    const a = buildAutoChargeIdempotencyKey(
      'e3bd2d-3.myshopify.com',
      ['3', '1', '2'],
      '50.37',
      'claim-1'
    )
    const b = buildAutoChargeIdempotencyKey(
      'e3bd2d-3.myshopify.com',
      ['1', '2', '3'],
      '50.37',
      'claim-1'
    )
    expect(a).toBe(b)
    expect(a.startsWith('us-autocharge-')).toBe(true)
  })
  it('changes for a new attempt, order set, amount or shop', () => {
    const base = buildAutoChargeIdempotencyKey(
      'e3bd2d-3.myshopify.com',
      ['1', '2'],
      '50.37',
      'claim-1'
    )
    expect(buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2', '4'], '50.37', 'claim-1')).not.toBe(base)
    expect(buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2'], '50.38', 'claim-1')).not.toBe(base)
    expect(buildAutoChargeIdempotencyKey('fast-dtf-az.myshopify.com', ['1', '2'], '50.37', 'claim-1')).not.toBe(base)
    expect(buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2'], '50.37', 'claim-2')).not.toBe(base)
  })
})

describe('order fee', () => {
  it('is 4% of the served amount, rounded to cents', () => {
    expect(calculateCommissionAmount(30.6)).toBe(1.22)
    expect(calculateCommissionAmount(100)).toBe(4)
  })

  it('never exceeds the per-order cap', () => {
    expect(calculateCommissionAmount(150)).toBe(COMMISSION_CAP_USD)
    expect(calculateCommissionAmount(643.2)).toBe(6)
    expect(calculateCommissionAmount(149.99)).toBe(6)
    expect(calculateCommissionAmount(149)).toBe(5.96)
  })

  it('treats invalid or zero amounts as no fee', () => {
    expect(calculateCommissionAmount(0)).toBe(0)
    expect(calculateCommissionAmount(-5)).toBe(0)
    expect(calculateCommissionAmount(Number.NaN)).toBe(0)
  })

  it('recognises orders the customer paid nothing for', () => {
    expect(isZeroPaymentOrder({ total_price: '0.00' })).toBe(true)
    expect(isZeroPaymentOrder({ total_price: '36.00', current_total_price: '0.00' })).toBe(true)
    expect(isZeroPaymentOrder({ total_price: '36.00' })).toBe(false)
    expect(isZeroPaymentOrder({})).toBe(true)
  })
})

describe('money totals', () => {
  it('sums persisted fee rows in integer cents at the auto-charge threshold', () => {
    const totalCents = sumMoneyCents(Array.from({ length: 4_999 }, () => 0.01))

    expect(totalCents).toBe(4_999)
    expect(centsToMoney(totalCents)).toBe(49.99)
  })

  it('rounds each fee row to its persisted cent value', () => {
    expect(moneyToCents(1.01)).toBe(101)
    expect(sumMoneyCents([10.1, 20.2, 19.69])).toBe(4_999)
  })
})

describe('billing currency', () => {
  it('allows only USD until an explicit FX policy exists', () => {
    expect(isSupportedBillingCurrency('USD')).toBe(true)
    expect(isSupportedBillingCurrency(' usd ')).toBe(true)
    expect(isSupportedBillingCurrency('CAD')).toBe(false)
    expect(isSupportedBillingCurrency(null)).toBe(false)
  })
})
