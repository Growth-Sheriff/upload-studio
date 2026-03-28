import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { isStripeConfigured } from '~/lib/stripe.server'
import { applySuccessfulStripeCheckout } from '~/lib/stripeCheckout.server'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  if (!isStripeConfigured()) {
    return json({ error: 'Stripe is not configured' }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

  if (!sessionId) {
    return json({ error: 'Stripe session ID is required' }, { status: 400 })
  }

  try {
    const result = await applySuccessfulStripeCheckout(sessionId, 'confirm')

    return json({
      success: true,
      paymentIntentId: result.paymentIntentId,
      markedCount: result.markedCount,
      amount: result.amount / 100,
      shopDomain: result.shopDomain,
      alreadyProcessed: result.alreadyProcessed,
    })
  } catch (error) {
    console.error('[Stripe] Confirm payment error:', error)
    return json(
      { error: error instanceof Error ? error.message : 'Stripe payment confirmation failed' },
      { status: 500 }
    )
  }
}
