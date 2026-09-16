import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TENANT_SLUGS } from './tenants.server'
import { fanOutToTenants } from './stripeWebhookFanout.server'

const event = { id: 'evt_test', type: 'checkout.session.completed' } as Stripe.Event

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Stripe webhook tenant fan-out', () => {
  it('treats a non-2xx tenant response as a delivery failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'processing_failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    const { results } = await fanOutToTenants(event, 'test-secret')

    expect(results).toHaveLength(TENANT_SLUGS.length)
    expect(results.every((result) => result.error === 'HTTP 500: processing_failed')).toBe(true)
  })

  it('preserves successful matched tenant responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ matched: true, detail: 'settled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    const { results } = await fanOutToTenants(event, 'test-secret')

    expect(results.every((result) => result.matched && result.detail === 'settled')).toBe(true)
    expect(results.some((result) => result.error)).toBe(false)
  })
})
