import { describe, expect, it, vi } from 'vitest'
import {
  calculateServedOrderAmount,
  deriveUploadStatusTransition,
  extractOrderFacts,
  findUnresolvedRefundSnapshotReviewReason,
  isGhostUploadItems,
  quarantineCommissionForVerifiedRefundSnapshotFailure,
  verifyShopifyWebhookHmac,
} from './orderReconciler.server'
import crypto from 'crypto'

describe('extractOrderFacts', () => {
  it('reads paid from financial_status (paid and partially_paid)', () => {
    expect(extractOrderFacts({ financial_status: 'paid' }).paid).toBe(true)
    expect(extractOrderFacts({ financial_status: 'partially_paid' }).paid).toBe(true)
    expect(extractOrderFacts({ financial_status: 'pending' }).paid).toBe(false)
    expect(extractOrderFacts({}).paid).toBe(false)
  })

  it('reads cancelled and fulfilled', () => {
    expect(extractOrderFacts({ cancelled_at: '2026-08-28T10:00:00Z' }).cancelled).toBe(true)
    expect(extractOrderFacts({ cancelled_at: null }).cancelled).toBe(false)
    expect(extractOrderFacts({ fulfillment_status: 'fulfilled' }).fulfilled).toBe(true)
    expect(extractOrderFacts({ fulfillment_status: 'partial' }).fulfilled).toBe(false)
  })
})

describe('calculateServedOrderAmount', () => {
  const order = {
    line_items: [
      {
        id: 1,
        price: '30.00',
        quantity: 1,
        discount_allocations: [{ amount: '30.00' }],
      },
      { id: 2, price: '100.00', quantity: 1, discount_allocations: [] },
    ],
    subtotal_price: '100.00',
    total_price: '100.00',
  }

  it('keeps a fully discounted attributable app line at zero', () => {
    expect(calculateServedOrderAmount(order, ['1'])).toBe(0)
  })

  it('fails closed instead of using the whole-order subtotal without exact attribution', () => {
    expect(calculateServedOrderAmount(order, [])).toBeNull()
    expect(calculateServedOrderAmount(order, ['missing-line'])).toBeNull()
  })
})

describe('served upload evidence', () => {
  it('treats both zero-item and empty-storage uploads as unserved ghosts', () => {
    expect(isGhostUploadItems([])).toBe(true)
    expect(isGhostUploadItems([{ storageKey: '' }])).toBe(true)
    expect(isGhostUploadItems([{ storageKey: null }, { storageKey: '   ' }])).toBe(true)
    expect(isGhostUploadItems([{ storageKey: 'r2:shop/upload/file.png' }])).toBe(false)
  })
})

describe('verified refund fallback', () => {
  it('quarantines the existing fee without changing amount, status, claim, or guessed refund state', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const auditUpsert = vi.fn().mockResolvedValue({})
    const store = {
      commission: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'commission-1',
          status: 'checkout_reserved',
          paymentRef: 'hco_stripe_1',
          reviewRequiredAt: null,
        }),
        updateMany,
      },
      auditLog: { upsert: auditUpsert },
    }

    await expect(
      quarantineCommissionForVerifiedRefundSnapshotFailure(
        {
          shopId: 'shop-1',
          orderId: '123',
          refundId: 'refund-1',
          snapshotError: 'Shopify order snapshot fetch failed with HTTP 503',
        },
        store
      )
    ).resolves.toEqual({ commissionFound: true, reviewFlagAdded: true })

    const data = updateMany.mock.calls[0][0].data
    expect(data).toMatchObject({
      reviewReason: 'shopify_refund_snapshot_unavailable',
    })
    expect(data.reviewRequiredAt).toBeInstanceOf(Date)
    expect(data).not.toHaveProperty('status')
    expect(data).not.toHaveProperty('paymentRef')
    expect(data).not.toHaveProperty('commissionAmount')
    expect(data).not.toHaveProperty('shopifyRefundStatus')
    expect(auditUpsert).toHaveBeenCalledOnce()
  })

  it('persists a deferred guard when the commission row does not exist yet', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const auditUpsert = vi.fn().mockResolvedValue({})
    const store = {
      commission: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
      },
      auditLog: { upsert: auditUpsert },
    }

    await expect(
      quarantineCommissionForVerifiedRefundSnapshotFailure(
        {
          shopId: 'shop-1',
          orderId: '456',
          refundId: 'refund-2',
          snapshotError: 'Shopify unavailable',
        },
        store
      )
    ).resolves.toEqual({ commissionFound: false, reviewFlagAdded: false })

    expect(auditUpsert.mock.calls[0][0].create.action).toBe(
      'commission_refund_snapshot_review_deferred'
    )
    expect(updateMany.mock.calls[0][0].where).toEqual({
      shopId: 'shop-1',
      orderId: '456',
      reviewRequiredAt: null,
    })
  })

  it('turns an unresolved deferred refund audit into a later review guard', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      metadata: { reason: 'shopify_refund_snapshot_unavailable' },
    })

    await expect(
      findUnresolvedRefundSnapshotReviewReason(
        { shopId: 'shop-1', orderId: '456' },
        { auditLog: { findFirst } }
      )
    ).resolves.toBe('shopify_refund_snapshot_unavailable')

    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      shopId: 'shop-1',
      resourceId: '456',
      action: 'commission_refund_snapshot_review_deferred',
    })
  })
})

describe('deriveUploadStatusTransition (status lattice)', () => {
  const facts = (over: Partial<ReturnType<typeof extractOrderFacts>>) => ({
    paid: false,
    cancelled: false,
    fulfilled: false,
    ...over,
  })

  it('cancellation archives everything except archived/shipped', () => {
    expect(deriveUploadStatusTransition('needs_review', facts({ cancelled: true }))).toBe('archived')
    expect(deriveUploadStatusTransition('approved', facts({ cancelled: true }))).toBe('archived')
    expect(deriveUploadStatusTransition('printed', facts({ cancelled: true }))).toBe('archived')
    expect(deriveUploadStatusTransition('shipped', facts({ cancelled: true }))).toBeNull()
    expect(deriveUploadStatusTransition('archived', facts({ cancelled: true }))).toBeNull()
    // cancelled wins over paid (cancel-after-payment)
    expect(
      deriveUploadStatusTransition('approved', facts({ cancelled: true, paid: true }))
    ).toBe('archived')
  })

  it('fulfillment only advances printed to shipped', () => {
    expect(deriveUploadStatusTransition('printed', facts({ fulfilled: true }))).toBe('shipped')
    expect(deriveUploadStatusTransition('printed', facts({ fulfilled: true, paid: true }))).toBe(
      'shipped'
    )
    expect(deriveUploadStatusTransition('shipped', facts({ fulfilled: true }))).toBeNull()
  })

  it('payment approves without downgrading merchant progress', () => {
    expect(deriveUploadStatusTransition('needs_review', facts({ paid: true }))).toBe('approved')
    expect(deriveUploadStatusTransition('ready', facts({ paid: true }))).toBe('approved')
    // historical behavior: payment unblocks
    expect(deriveUploadStatusTransition('blocked', facts({ paid: true }))).toBe('approved')
    // never backwards
    expect(deriveUploadStatusTransition('approved', facts({ paid: true }))).toBeNull()
    expect(deriveUploadStatusTransition('printed', facts({ paid: true }))).toBeNull()
    expect(deriveUploadStatusTransition('shipped', facts({ paid: true }))).toBeNull()
  })

  it('never approves a missing-file ghost when payment arrives', () => {
    expect(
      deriveUploadStatusTransition('blocked', facts({ paid: true }), { isGhost: true })
    ).toBeNull()
    expect(
      deriveUploadStatusTransition('blocked', facts({ paid: true, cancelled: true }), {
        isGhost: true,
      })
    ).toBe('archived')
  })

  it('link-time (unpaid order) moves fresh uploads to needs_review only', () => {
    expect(deriveUploadStatusTransition('ready', facts({}))).toBe('needs_review')
    expect(deriveUploadStatusTransition('draft', facts({}))).toBe('needs_review')
    expect(deriveUploadStatusTransition('needs_review', facts({}))).toBeNull()
    expect(deriveUploadStatusTransition('blocked', facts({}))).toBeNull()
    // a late/retried create payload can never downgrade paid/printed work
    expect(deriveUploadStatusTransition('approved', facts({}))).toBeNull()
    expect(deriveUploadStatusTransition('printed', facts({}))).toBeNull()
    expect(deriveUploadStatusTransition('shipped', facts({}))).toBeNull()
    expect(deriveUploadStatusTransition('archived', facts({}))).toBeNull()
  })
})

describe('verifyShopifyWebhookHmac', () => {
  const secret = 'shh-secret'
  const body = '{"id":123}'
  const valid = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

  it('accepts a valid signature and rejects everything else', () => {
    expect(verifyShopifyWebhookHmac(body, valid, secret)).toBe(true)
    expect(verifyShopifyWebhookHmac(body, valid, 'wrong-secret')).toBe(false)
    expect(verifyShopifyWebhookHmac(body + 'x', valid, secret)).toBe(false)
    expect(verifyShopifyWebhookHmac(body, 'short', secret)).toBe(false) // length mismatch must not throw
    expect(verifyShopifyWebhookHmac(body, null, secret)).toBe(false)
    expect(verifyShopifyWebhookHmac(body, valid, '')).toBe(false)
  })
})
