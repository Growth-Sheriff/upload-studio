import { DelayedError, type Job } from 'bullmq'
import type Redis from 'ioredis'
import { withTenantContext } from '../app/lib/tenantContext.server'
import { withJobBudget } from '../app/lib/jobBudget.server'
import { acquireShopWorkerLease, ShopWorkerBusyError, SHOP_WORKER_RETRY_MS } from '../app/lib/shopWorkerLease.server'
import { prisma } from '../app/lib/prisma.server'
import { assertUploadsProcessable } from '../app/lib/publicProcessing.server'

export const MAX_PUBLIC_WORKER_BUDGET_MS = 15 * 60_000

export async function withShopUploadJob<T>(redis: Pick<Redis, 'eval' | 'zrem'>, job: Job<{ shopId: string; uploadId?: string; exportId?: string }>, budgetMs: number, run: () => Promise<T>): Promise<T> {
  budgetMs = Math.min(MAX_PUBLIC_WORKER_BUDGET_MS, budgetMs)
  return withTenantContext(job.data.shopId, async () => {
    let release: (() => Promise<void>) | undefined
    try {
      release = await acquireShopWorkerLease(redis, job.data.shopId, budgetMs)
    } catch (error) {
      if (!(error instanceof ShopWorkerBusyError)) throw error
      await job.moveToDelayed(Date.now() + SHOP_WORKER_RETRY_MS, job.token)
      throw new DelayedError()
    }
    try {
      const shop = await prisma.shop.findUnique({ where: { id: job.data.shopId }, select: { billingStatus: true, erasureStartedAt: true } })
      if (!shop || shop.erasureStartedAt || ['erasing', 'uninstalled'].includes(shop.billingStatus)) throw new Error('Shop no longer accepts file processing')
      return await withJobBudget(budgetMs, async () => {
        if (job.data.uploadId) await assertUploadsProcessable([job.data.uploadId])
        else if (job.data.exportId) {
          const exportJob = await prisma.exportJob.findUnique({ where: { id: job.data.exportId }, select: { uploadIds: true } })
          if (!exportJob) throw new Error('Export does not belong to this shop')
          await assertUploadsProcessable(exportJob.uploadIds)
        } else throw new Error('Processing job is missing its upload or export identity')
        return run()
      })
    }
    finally { await release().catch(error => console.error('[Worker] Lease release failed', error)) }
  })
}
