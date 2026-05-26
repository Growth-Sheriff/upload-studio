import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import type Stripe from 'stripe';
import { verifyWebhookEvent } from '~/lib/stripe.server';
import { TENANT_SLUGS, getTenantInternalUrl, type TenantSlug } from '~/lib/tenants.server';
import { dispatchEvent } from '~/lib/stripeWebhookHandlers.server';

const INTERNAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET || '';
const FAN_OUT_TIMEOUT_MS = 8_000;

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

  const fanOut = await fanOutToTenants(event);
  const matched = fanOut.results.filter((r) => r.matched).map((r) => r.slug);
  const failures = fanOut.results.filter((r) => r.error).map((r) => ({ slug: r.slug, error: r.error }));

  console.log(
    `[Stripe Webhook] ${event.type} ${event.id}: matched=[${matched.join(',') || 'none'}] failures=${failures.length}`
  );

  return json({
    received: true,
    mode: 'fanout',
    matched,
    failures,
  });
}

type FanOutResult = { slug: TenantSlug; matched?: boolean; detail?: string; error?: string };

async function fanOutToTenants(event: Stripe.Event): Promise<{ results: FanOutResult[] }> {
  const payload = JSON.stringify(event);
  const settled = await Promise.allSettled(
    TENANT_SLUGS.map(async (slug): Promise<FanOutResult> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FAN_OUT_TIMEOUT_MS);
      try {
        const res = await fetch(getTenantInternalUrl(slug, '/api/webhooks/stripe-internal'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: payload,
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { matched?: boolean; detail?: string };
        return { slug, matched: !!data.matched, detail: data.detail };
      } catch (err) {
        return { slug, error: err instanceof Error ? err.message : 'unknown' };
      } finally {
        clearTimeout(timeout);
      }
    })
  );
  const results = settled.map((s, i) =>
    s.status === 'fulfilled' ? s.value : { slug: TENANT_SLUGS[i], error: String(s.reason) }
  );
  return { results };
}
