import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { runTenantAutoCharge } from '~/lib/billingRunner.server';

// Called every 6 hours by workers/commission.worker.ts. It used to carry its
// own copy of the charge logic with no lock; it now runs the single guarded
// implementation (atomic claim + idempotency key) shared with the daily
// scheduler, so the two paths can never bill the same fees twice.
const CRON_SECRET = process.env.CRON_SECRET;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }
  if (!CRON_SECRET) {
    console.error('[Auto-Charge] CRON_SECRET env variable is not set');
    return json({ error: 'Server misconfiguration' }, { status: 500 });
  }
  if (request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = await runTenantAutoCharge();
  const results = summary.results.map((r) => {
    const outcome = r.outcome;
    if (outcome.status === 'charged') return { shop: r.shop, status: 'charged' as const, amount: outcome.amount };
    if (outcome.status === 'below_threshold') return { shop: r.shop, status: 'below_threshold' as const, amount: outcome.amount };
    if (outcome.status === 'skipped') return { shop: r.shop, status: 'skipped' as const, error: outcome.reason };
    return { shop: r.shop, status: 'error' as const, error: outcome.reason };
  });
  const charged = results.filter((r) => r.status === 'charged').length;
  console.log(`[AutoCharge] Done: ${charged}/${summary.total} shops charged`);

  return json({ success: true, total: summary.total, charged, results });
}
