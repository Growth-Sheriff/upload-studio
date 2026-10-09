import { Queue } from 'bullmq'
import Redis from 'ioredis'
import prisma from '~/lib/prisma.server'
import { BILLING_CRON_JOB_NAME, BILLING_SHOP_QUEUE_NAME } from '~/lib/billingQueues'
import { publicRedisUrl } from '~/lib/publicRedis.server'

type ShopQueue = Pick<Queue, 'addBulk'>
const PAGE_SIZE = 100

/** The scheduler and owner trigger enqueue the same logical shop turn. HTTP
 * never contacts Shopify or waits for order-fee collection to finish. */
export async function enqueueBillingShopPage(input: { after?: string; tick?: number } = {}, suppliedQueue?: ShopQueue): Promise<{ scheduled: number; nextCursor: string | null }> {
  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null, erasureStartedAt: null, billingStatus: { notIn: ['erasing', 'uninstalled'] }, OR: [{ billing: { status: { in: ['active', 'pending'] } } }, { commissions: { some: { status: 'charging' } } }], ...(input.after ? { id: { gt: input.after } } : {}) },
    select: { id: true }, orderBy: { id: 'asc' }, take: PAGE_SIZE + 1,
  })
  const batch = shops.slice(0, PAGE_SIZE)
  if (!batch.length) return { scheduled: 0, nextCursor: null }
  const tick = input.tick ?? Math.floor(Date.now() / 300000)
  let redis: Redis | undefined
  let queue = suppliedQueue
  if (!queue) {
    // Fail quickly for an owner HTTP trigger when Redis is unavailable. Worker
    // producers instead reuse their durable BullMQ connection.
    redis = new Redis(publicRedisUrl(), { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 5000, retryStrategy: () => null })
    queue = new Queue(BILLING_SHOP_QUEUE_NAME, { connection: redis })
  }
  try {
    await queue.addBulk(batch.map(shop => ({ name: BILLING_CRON_JOB_NAME, data: { shopId: shop.id }, opts: { jobId: `usage-${shop.id}-${tick}`, attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 1000, removeOnFail: 1000 } })))
    return { scheduled: batch.length, nextCursor: shops.length > PAGE_SIZE ? batch[batch.length - 1].id : null }
  } finally {
    if (redis) {
      await (queue as Queue).close().catch(() => {})
      redis.disconnect()
    }
  }
}
