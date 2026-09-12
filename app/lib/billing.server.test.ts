import { describe, expect, it } from 'vitest'
import { COMMISSION_CAP_USD, calculateCommissionAmount, isZeroPaymentOrder } from './billing.server'

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
