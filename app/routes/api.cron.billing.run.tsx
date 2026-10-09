import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { timingSafeEqual } from 'node:crypto';
import { enqueueBillingShopPage } from '~/lib/billingQueueProducer.server';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }
  const expected = Buffer.from(process.env.PUBLIC_OPERATIONS_TOKEN || '');
  const supplied = Buffer.from((request.headers.get('Authorization') || '').replace(/^Bearer /, ''));
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response('Not found', { status: 404 });
  const after = new URL(request.url).searchParams.get('after') || undefined;
  if (after && !/^[a-zA-Z0-9_-]{1,128}$/.test(after)) return json({ error: 'Invalid pagination cursor' }, { status: 400 });
  try {
    const page = await enqueueBillingShopPage({ after });
    // Scheduled means submitted using the existing five-minute job identity,
    // not fees recorded or new jobs created (duplicate turns are deduplicated).
    return json({ success: true, ...page }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch { return json({ error: 'Billing queue unavailable; retry the same page' }, { status: 503 }); }
}
