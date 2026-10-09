import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { BILLING_CRON_JOB_NAME, BILLING_CRON_QUEUE_NAME, BILLING_CRON_REPEAT_PATTERN, BILLING_SHOP_QUEUE_NAME } from '~/lib/billingQueues'
import { runShopUsageBilling } from '~/lib/billingRunner.server'
import prisma from '~/lib/prisma.server'
import { publicRedisUrl } from '~/lib/publicRedis.server'

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
    let cursor: string | undefined
    let scheduled = 0
    for (;;) {
      const shops = await prisma.shop.findMany({ where: { uninstalledAt: null, erasureStartedAt: null, billingStatus: { notIn: ['erasing', 'uninstalled'] }, OR: [{ billing: { status: { in: ['active', 'pending'] } } }, { commissions: { some: { status: 'charging' } } }] }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
      if (!shops.length) break
      await shopQueue.addBulk(shops.map((shop) => ({ name: BILLING_CRON_JOB_NAME, data: { shopId: shop.id }, opts: { jobId: `usage-${shop.id}-${tick}`, attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 1000, removeOnFail: 1000 } })))
      scheduled += shops.length
      cursor = shops[shops.length - 1].id
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
