import { describe, expect, it } from 'vitest'
import {
  COMMISSION_AWAITING_PAYMENT_STATUS,
  extractShopifyCommissionFacts,
  isCommissionCollectible,
  planCommissionReconciliation,
  type CurrentCommissionState,
} from './commissionEligibility.server'

const emptyCurrent: CurrentCommissionState = { status: null, paymentRef: null }

function plan(
  order: Parameters<typeof extractShopifyCommissionFacts>[0],
  current: CurrentCommissionState = emptyCurrent,
  servedAmount = 100
) {
  return planCommissionReconciliation({
    current,
    facts: extractShopifyCommissionFacts(order),
    servedAmount,
    zeroPayment: Number(order.current_total_price ?? order.total_price ?? 0) <= 0,
  })
}

describe('Shopify fee eligibility facts', () => {
  it('does not treat authorized, pending, or partially paid money as captured', () => {
    for (const financial_status of ['authorized', 'pending', 'partially_paid']) {
      expect(plan({ financial_status, total_price: '100.00' })).toEqual({
        action: 'await_payment',
        status: COMMISSION_AWAITING_PAYMENT_STATUS,
      })
    }
  })

  it('carries the app-attributable captured amount only after Shopify says paid', () => {
    expect(plan({ financial_status: 'paid', total_price: '100.00' })).toEqual({
      action: 'make_collectible',
      status: 'pending',
    })
  })

  it('recognises refund totals even when the financial status lags', () => {
    const facts = extractShopifyCommissionFacts({
      financial_status: 'paid',
      total_price: '100.00',
      current_total_price: '100.00',
      refunds: [
        { transactions: [{ kind: 'refund', status: 'success', amount: '100.00' }] },
      ],
    })
    expect(facts.refundState).toBe('full')
    expect(planCommissionReconciliation({ current: emptyCurrent, facts, servedAmount: 100, zeroPayment: false })).toMatchObject({
      action: 'void',
      reason: 'shopify_order_fully_refunded',
    })
  })

  it('quarantines a refund webhook whose provider outcome is still unknown', () => {
    const facts = extractShopifyCommissionFacts({
      financial_status: 'paid',
      total_price: '100.00',
      refunds: [
        { transactions: [{ kind: 'refund', status: 'pending', amount: '25.00' }] },
      ],
    })
    expect(facts.refundState).toBe('partial')
    expect(
      planCommissionReconciliation({
        current: { status: 'pending', collectibleAt: new Date() },
        facts,
        servedAmount: 100,
        zeroPayment: false,
      })
    ).toMatchObject({ action: 'review', reason: 'shopify_order_partially_refunded' })
  })
})

describe('fee state safety', () => {
  it('creates no collectible fee for an unpaid order', () => {
    const result = plan({ financial_status: 'pending', total_price: '80.00' })
    expect(result.status).toBe(COMMISSION_AWAITING_PAYMENT_STATUS)
    expect(
      isCommissionCollectible({ status: result.status, paymentRef: null, collectibleAt: null })
    ).toBe(false)
  })

  it.each([
    [{ financial_status: 'pending', cancelled_at: '2026-09-17T10:00:00Z', total_price: '80.00' }, 'shopify_order_cancelled'],
    [{ financial_status: 'refunded', total_price: '80.00' }, 'shopify_order_fully_refunded'],
    [{ financial_status: 'voided', total_price: '80.00' }, 'shopify_payment_voided'],
  ] as const)('voids an uncollected terminal order (%s)', (order, reason) => {
    expect(
      plan(order, { status: 'pending', paymentRef: null, collectibleAt: new Date() })
    ).toMatchObject({ action: 'void', status: 'void', reason })
  })

  it('leaves a partial refund amount unchanged and quarantines it for review', () => {
    expect(
      plan(
        { financial_status: 'partially_refunded', total_price: '80.00' },
        { status: 'pending', paymentRef: null, collectibleAt: new Date() }
      )
    ).toEqual({
      action: 'review',
      status: 'pending',
      reason: 'shopify_order_partially_refunded',
    })
  })

  it.each(['paid', 'charging', 'checkout_reserved']) (
    'never reopens or releases %s without provider reconciliation',
    (status) => {
      const result = plan(
        { financial_status: 'refunded', total_price: '80.00' },
        { status, paymentRef: 'provider_ref', collectibleAt: new Date() }
      )
      expect(result).toMatchObject({ action: 'review', status })
    }
  )

  it('replans a failed void as review when a provider claims the row concurrently', () => {
    const facts = extractShopifyCommissionFacts({
      financial_status: 'refunded',
      total_price: '80.00',
    })
    expect(
      planCommissionReconciliation({
        current: { status: 'pending', paymentRef: null, collectibleAt: new Date() },
        facts,
        servedAmount: 80,
        zeroPayment: false,
      })
    ).toMatchObject({ action: 'void' })

    expect(
      planCommissionReconciliation({
        current: {
          status: 'charging',
          paymentRef: 'claim_won_race',
          collectibleAt: new Date(),
        },
        facts,
        servedAmount: 80,
        zeroPayment: false,
      })
    ).toMatchObject({
      action: 'review',
      status: 'charging',
      reason: 'shopify_order_fully_refunded_provider_reconciliation_required',
    })
  })

  it('fails closed for legacy pending rows without eligibility evidence', () => {
    expect(
      isCommissionCollectible({ status: 'pending', paymentRef: null, collectibleAt: null })
    ).toBe(false)
    expect(
      isCommissionCollectible({
        status: 'pending',
        paymentRef: null,
        collectibleAt: new Date(),
        reviewRequiredAt: new Date(),
      })
    ).toBe(false)
  })

  it('does not reopen a void cancellation when an older paid event arrives late', () => {
    expect(
      plan(
        { financial_status: 'paid', total_price: '80.00' },
        {
          status: 'void',
          paymentRef: null,
          collectibleAt: null,
          shopifyCancelledAt: new Date('2026-09-17T10:00:00Z'),
        }
      )
    ).toEqual({ action: 'preserve', status: 'void' })
  })

  it('selects only an evidenced, unclaimed, review-free pending fee', () => {
    expect(
      isCommissionCollectible({
        status: 'pending',
        paymentRef: null,
        collectibleAt: new Date(),
        reviewRequiredAt: null,
      })
    ).toBe(true)
  })
})
