import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  BILLING_CRON_JOB_NAME,
  BILLING_CRON_QUEUE_NAME,
  BILLING_CRON_REPEAT_PATTERN,
} from '~/lib/billingQueues';
import { runTenantAutoCharge } from '~/lib/billingRunner.server';

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
      // Every container has its own Redis database, so this job exists once per
      // tenant. It must bill only its own tenant: fanning out to all tenants
      // ran each shop once per container and charged dtfprinthouse 10 times
      // on 2026-09-15.
      console.log(`[BillingScheduler] Daily auto-charge starting (job ${job.id})`);
      const summary = await runTenantAutoCharge();
      const outcomes = summary.results.map((r) => ({ shop: r.shop, status: r.outcome.status }));
      console.log('[BillingScheduler] Result:', JSON.stringify(outcomes));
      return { total: summary.total, outcomes };
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`[BillingScheduler] Worker job ${job?.id} failed:`, err);
  });

  console.log(
    `[BillingScheduler] Initialized (pattern="${BILLING_CRON_REPEAT_PATTERN}" tz=Europe/Berlin, this tenant only)`
  );
}
