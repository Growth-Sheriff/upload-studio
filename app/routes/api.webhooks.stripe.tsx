import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import type Stripe from 'stripe';
import { verifyWebhookEvent } from '~/lib/stripe.server';
import { fanOutToTenants } from '~/lib/stripeWebhookFanout.server';
import { dispatchEvent } from '~/lib/stripeWebhookHandlers.server';

const INTERNAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET || '';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = verifyWebhookEvent(body, signature);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return json({ error: 'Invalid signature' }, { status: 401 });
  }

  console.log(`[Stripe Webhook] Verified: ${event.type} (${event.id})`);

  if (!INTERNAL_SECRET) {
    console.warn('[Stripe Webhook] INTERNAL_WEBHOOK_SECRET not set, processing locally only');
    const result = await dispatchEvent(event);
    return json({ received: true, mode: 'local', matched: result.matched, detail: result.detail });
  }

  const fanOut = await fanOutToTenants(event, INTERNAL_SECRET);
  const matched = fanOut.results.filter((r) => r.matched).map((r) => r.slug);
  const failures = fanOut.results.filter((r) => r.error).map((r) => ({ slug: r.slug, error: r.error }));

  console.log(
    `[Stripe Webhook] ${event.type} ${event.id}: matched=[${matched.join(',') || 'none'}] failures=${failures.length}`
  );

  return json(
    {
      received: failures.length === 0,
      mode: 'fanout',
      matched,
      failures,
    },
    { status: failures.length === 0 ? 200 : 503 }
  );
}
