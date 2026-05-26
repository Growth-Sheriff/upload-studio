import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { runTenantAutoCharge } from '~/lib/billingRunner.server';

const CRON_SECRET = process.env.CRON_SECRET;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }
  if (!CRON_SECRET) {
    console.error('[Billing Cron] CRON_SECRET not configured');
    return json({ error: 'Server misconfiguration' }, { status: 500 });
  }
  if (request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = await runTenantAutoCharge();
  const counts = summary.results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome.status] = (acc[r.outcome.status] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `[Billing Cron] Done: ${summary.total} shops considered, breakdown=${JSON.stringify(counts)}`
  );
  return json({ success: true, total: summary.total, counts, results: summary.results });
}
