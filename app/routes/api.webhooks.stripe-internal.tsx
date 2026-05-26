import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import crypto from 'crypto';
import type Stripe from 'stripe';
import { dispatchEvent } from '~/lib/stripeWebhookHandlers.server';

const INTERNAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET || '';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }
  if (!INTERNAL_SECRET) {
    console.error('[Stripe Internal] INTERNAL_WEBHOOK_SECRET not configured');
    return json({ error: 'Internal secret not configured' }, { status: 500 });
  }

  const provided = request.headers.get('x-internal-secret') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: Stripe.Event;
  try {
    event = (await request.json()) as Stripe.Event;
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!event?.type || !event?.id) {
    return json({ error: 'Malformed event' }, { status: 400 });
  }

  try {
    const result = await dispatchEvent(event);
    return json({ received: true, matched: result.matched, detail: result.detail });
  } catch (err) {
    console.error(`[Stripe Internal] processing failed for ${event.type} ${event.id}:`, err);
    return json({ received: true, error: 'processing_failed' }, { status: 500 });
  }
}
