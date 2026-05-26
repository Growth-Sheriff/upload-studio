import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  BILLING_CRON_JOB_NAME,
  BILLING_CRON_QUEUE_NAME,
  BILLING_CRON_REPEAT_PATTERN,
} from '~/lib/billingQueues';
import { TENANT_SLUGS, getTenantInternalUrl, type TenantSlug } from '~/lib/tenants.server';

let initialized = false;

/**
 * Initializes BullMQ-based daily auto-charge scheduler.
 *
 * Safe to enable on ALL tenant containers (CRON_RUNNER=true everywhere):
 * - The repeatable job is keyed by a fixed jobId, so BullMQ deduplicates registration in Redis.
 * - Workers from multiple containers compete for jobs; exactly one wins per scheduled tick.
 * - In the worst case (race / double-fire), runShopAutoCharge respects per-shop retryNextAt and skips
 *   duplicate work, so financial state cannot be corrupted.
 */
export function initBillingScheduler() {
  if (initialized) return;
  if (process.env.CRON_RUNNER !== 'true') return;
  if (process.env.NODE_ENV === 'test') return;
  initialized = true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[BillingScheduler] CRON_SECRET not set — scheduler disabled');
    return;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const queue = new Queue(BILLING_CRON_QUEUE_NAME, { connection });

  // Ensure a single repeatable job exists (idempotent on restart)
  queue
    .add(
      BILLING_CRON_JOB_NAME,
      { source: 'scheduler' },
      {
        repeat: { pattern: BILLING_CRON_REPEAT_PATTERN, tz: 'Europe/Berlin' },
        jobId: `${BILLING_CRON_JOB_NAME}-repeat-v1`,
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    )
    .catch((err: unknown) => {
      console.error('[BillingScheduler] Failed to register repeatable job:', err);
    });

  // Worker processes the daily fanout
  const worker = new Worker(
    BILLING_CRON_QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== BILLING_CRON_JOB_NAME) return;
      console.log(`[BillingScheduler] Daily fanout starting (job ${job.id})`);
      const results = await Promise.allSettled(
        TENANT_SLUGS.map((slug) => fireTenantCron(slug, cronSecret))
      );
      const summary = results.map((r, i) => ({
        slug: TENANT_SLUGS[i],
        ok: r.status === 'fulfilled' && r.value.ok,
        status: r.status === 'fulfilled' ? r.value.status : 'rejected',
        error: r.status === 'rejected' ? String(r.reason) : undefined,
      }));
      console.log('[BillingScheduler] Fanout result:', JSON.stringify(summary));
      return summary;
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`[BillingScheduler] Worker job ${job?.id} failed:`, err);
  });

  console.log(
    `[BillingScheduler] Initialized (pattern="${BILLING_CRON_REPEAT_PATTERN}" tz=Europe/Berlin, ${TENANT_SLUGS.length} tenants)`
  );
}

async function fireTenantCron(slug: TenantSlug, secret: string) {
  const url = getTenantInternalUrl(slug, '/api/cron/billing/run');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-cron-secret': secret, 'content-type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}
