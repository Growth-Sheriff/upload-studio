import { describe, expect, it } from 'vitest'
import {
  buildPayPalAutoChargeRequestId,
  getCompletedPayPalCaptureDetails,
  getPayPalCheckoutOrderDetails,
  getPayPalRefundCaptureId,
  type PayPalCaptureResponse,
  type PayPalWebhookEvent,
} from './paypal.server'

function refundEvent(overrides: Partial<PayPalWebhookEvent> = {}): PayPalWebhookEvent {
  return {
    id: 'WH-REFUND-1',
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource_type: 'refund',
    resource: {
      id: 'REFUND-1',
      status: 'COMPLETED',
      supplementary_data: {
        related_ids: { capture_id: 'CAPTURE-1' },
      },
    },
    create_time: '2026-09-16T00:00:00Z',
    event_version: '1.0',
    ...overrides,
  }
}

describe('getPayPalRefundCaptureId', () => {
  it('uses the original capture id rather than the refund resource id', () => {
    expect(getPayPalRefundCaptureId(refundEvent())).toBe('CAPTURE-1')
  })

  it('does not mistake an unrelated refund id for a capture id', () => {
    expect(
      getPayPalRefundCaptureId(
        refundEvent({
          resource: { id: 'REFUND-ONLY', status: 'COMPLETED' },
        })
      )
    ).toBeNull()
  })
})

describe('buildPayPalAutoChargeRequestId', () => {
  it('is stable for every retry of the same logical provider operation', () => {
    expect(buildPayPalAutoChargeRequestId('logical-attempt-1', 'create')).toBe(
      'auto-create-logical-attempt-1'
    )
    expect(buildPayPalAutoChargeRequestId('logical-attempt-1', 'capture')).toBe(
      'auto-capture-logical-attempt-1'
    )
  })
})

function completedOrder(): PayPalCaptureResponse {
  return {
    id: 'ORDER-1',
    status: 'COMPLETED',
    purchase_units: [
      {
        reference_id: 'merchant.myshopify.com',
        custom_id: 'hco_paypal_1',
        amount: { currency_code: 'USD', value: '6.25' },
        payments: {
          captures: [
            {
              id: 'CAPTURE-1',
              status: 'COMPLETED',
              amount: { currency_code: 'USD', value: '6.25' },
            },
          ],
        },
      },
    ],
  }
}

describe('PayPal hosted checkout identity', () => {
  it('extracts the provider-bound reservation and exact capture', () => {
    expect(getPayPalCheckoutOrderDetails(completedOrder())).toEqual({
      customId: 'hco_paypal_1',
      shopReference: 'merchant.myshopify.com',
      amount: '6.25',
      currency: 'USD',
    })
    expect(getCompletedPayPalCaptureDetails(completedOrder())).toEqual({
      captureId: 'CAPTURE-1',
      amount: '6.25',
      currency: 'USD',
    })
  })

  it('rejects a multi-capture response instead of silently using the first', () => {
    const order = completedOrder()
    order.purchase_units[0].payments!.captures.push({
      id: 'CAPTURE-2',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '6.25' },
    })
    expect(() => getCompletedPayPalCaptureDetails(order)).toThrow(
      /exactly one completed capture/i
    )
  })

  it('rejects an order without a provider-bound reservation id', () => {
    const order = completedOrder()
    delete order.purchase_units[0].custom_id
    expect(() => getPayPalCheckoutOrderDetails(order)).toThrow(/reservation/i)
  })
})
