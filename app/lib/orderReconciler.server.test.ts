import { describe, expect, it } from 'vitest'
import {
  deriveUploadStatusTransition,
  extractOrderFacts,
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
