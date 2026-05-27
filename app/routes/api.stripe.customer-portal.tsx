import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { authenticate } from '~/shopify.server'
import { getStripeClient, isStripeConfigured, resolveAppUrlForShop } from '~/lib/stripe.server'

const PORTAL_CONFIGURATION =
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID || undefined

export async function loader({ request }: LoaderFunctionArgs) {
  return action({ request } as ActionFunctionArgs)
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  if (!isStripeConfigured()) {
    return json({ error: 'Stripe is not configured' }, { status: 500 })
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) return json({ error: 'Shop not found' }, { status: 404 })
  if (!shop.stripeCustomerId) {
    return json(
      { error: 'No saved payment method yet. Use "Pay with Stripe" first to save a card.' },
      { status: 400 }
    )
  }

  const appUrl = resolveAppUrlForShop(shopDomain)
  const returnUrl = `${appUrl}/app/billing?portal_return=1`

  try {
    const stripe = getStripeClient()
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: shop.stripeCustomerId,
      return_url: returnUrl,
      ...(PORTAL_CONFIGURATION ? { configuration: PORTAL_CONFIGURATION } : {}),
    })

    // For GET (loader) hits we 302 directly; for POST we return JSON with url.
    if (request.method === 'GET') {
      return redirect(portalSession.url)
    }
    return json({ url: portalSession.url })
  } catch (err) {
    console.error('[CustomerPortal] Failed to create portal session:', err)
    return json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to open Stripe customer portal',
      },
      { status: 500 }
    )
  }
}
