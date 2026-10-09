import { Prisma, type PrismaClient } from '@prisma/client'
import { getTenantShopId, TenantIsolationError } from './tenantContext.server'

/** OAuth/bootstrap and privacy both mutate control-plane rows. Retry only
 * database serialization/unique conflicts; a privacy stop is never retried. */
export async function withSerializableAuthPersistence<T>(database: PrismaClient, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await database.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) }
    catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error
    }
  }
}

export async function persistVerifiedShopInstallation(database: PrismaClient, session: { shop: string; accessToken?: string }): Promise<void> {
  await withSerializableAuthPersistence(database, async tx => {
    const existing = await tx.shop.findUnique({ where: { shopDomain: session.shop }, select: { id: true, billingStatus: true, settings: true, erasureStartedAt: true } })
    if (existing?.erasureStartedAt || existing?.billingStatus === 'erasing') throw new Error('Shop erasure is already in progress; install again after completion')
    if (!existing && getTenantShopId()) throw new TenantIsolationError('installation shop differs from the authenticated shop')
    if (existing) {
      const reactivating = existing.billingStatus === 'uninstalled'
      const settings = reactivating && existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
        ? Object.fromEntries(Object.entries(existing.settings).filter(([key]) => key !== 'uninstalledAt')) as Prisma.InputJsonObject
        : undefined
      // A row lock and marker predicate close the check-then-upsert window.
      // If privacy deletes the existing row, never recreate it by upsert.
      const changed = await tx.shop.updateMany({
        where: { id: existing.id, shopDomain: session.shop, erasureStartedAt: null, billingStatus: { not: 'erasing' } },
        data: { accessToken: session.accessToken || '', installedAt: new Date(), ...(reactivating ? { billingStatus: 'inactive', uninstalledAt: null, ...(settings ? { settings } : {}) } : {}) },
      })
      if (changed.count !== 1) throw new Error('Shop installation changed while authenticating')
    } else {
      await tx.shop.create({ data: { shopDomain: session.shop, accessToken: session.accessToken || '', plan: 'usage', billingStatus: 'inactive', storageProvider: 'r2', settings: {} } })
    }
    await tx.complianceRequest.updateMany({
      where: { shopDomain: session.shop, topic: 'uninstall/erase', status: { in: ['pending', 'processing'] } },
      data: { status: 'cancelled', payload: Prisma.DbNull, completedAt: new Date(), leaseToken: null, leaseUntil: null },
    })
  })
}
