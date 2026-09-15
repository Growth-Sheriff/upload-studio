import { describe, expect, it } from 'vitest'
import {
  COMMISSION_CAP_USD,
  buildAutoChargeIdempotencyKey,
  calculateCommissionAmount,
  isZeroPaymentOrder,
} from './billing.server'

describe('auto-charge idempotency key', () => {
  const day = new Date('2026-09-15T01:00:00Z')
  it('is identical for the same shop, order set and amount regardless of order', () => {
    const a = buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['3', '1', '2'], '50.37', day)
    const b = buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2', '3'], '50.37', day)
    expect(a).toBe(b)
    expect(a.startsWith('us-autocharge-')).toBe(true)
  })
  it('changes when the orders, amount, shop or day change', () => {
    const base = buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2'], '50.37', day)
    expect(buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2', '4'], '50.37', day)).not.toBe(base)
    expect(buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2'], '50.38', day)).not.toBe(base)
    expect(buildAutoChargeIdempotencyKey('fast-dtf-az.myshopify.com', ['1', '2'], '50.37', day)).not.toBe(base)
    expect(buildAutoChargeIdempotencyKey('e3bd2d-3.myshopify.com', ['1', '2'], '50.37', new Date('2026-09-16T01:00:00Z'))).not.toBe(base)
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
