import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { BILLING_CRON_JOB_NAME, BILLING_CRON_QUEUE_NAME, BILLING_CRON_REPEAT_PATTERN, BILLING_SHOP_QUEUE_NAME } from '~/lib/billingQueues'
import { runShopUsageBilling } from '~/lib/billingRunner.server'
import { publicRedisUrl } from '~/lib/publicRedis.server'
import { enqueueBillingShopPage } from '~/lib/billingQueueProducer.server'

let initialized = false
/** One shared Redis schedule; per-order database leases and provider keys are
 * still mandatory when several workers or a cron request execute together. */
export function initBillingScheduler() {
  if (initialized || process.env.NODE_ENV === 'test') return
  if (!process.env.REDIS_URL) throw new Error('Public usage billing requires REDIS_URL')
  initialized = true
  const connection = new IORedis(publicRedisUrl(), { maxRetriesPerRequest: null })
  const queue = new Queue(BILLING_CRON_QUEUE_NAME, { connection })
  const shopQueue = new Queue(BILLING_SHOP_QUEUE_NAME, { connection })
  void queue.add(BILLING_CRON_JOB_NAME, {}, { repeat: { pattern: BILLING_CRON_REPEAT_PATTERN }, jobId: 'public-usage-billing-v1', removeOnComplete: 100, removeOnFail: 100 }).catch((error) => console.error('[UsageBilling] schedule:', error))
  const worker = new Worker(BILLING_CRON_QUEUE_NAME, async () => {
    const tick = Math.floor(Date.now() / 300000)
    let cursor: string | null = null
    let scheduled = 0
    for (;;) {
      const page = await enqueueBillingShopPage({ after: cursor || undefined, tick }, shopQueue)
      scheduled += page.scheduled
      cursor = page.nextCursor
      if (!cursor) break
    }
    return { scheduled }
  }, { connection, concurrency: 1 })
  const shopWorker = new Worker(BILLING_SHOP_QUEUE_NAME, async (job) => {
    if (!job.data.shopId) throw new Error('Usage job lacks authenticated shop identity')
    return runShopUsageBilling(job.data.shopId)
  }, { connection, concurrency: 4 })
  worker.on('failed', (job, error) => console.error('[UsageBilling]', job?.id, error))
  shopWorker.on('failed', (job, error) => console.error('[ShopUsageBilling]', job?.data.shopId, error))
}
