import { prisma } from './prisma.server'
import { requireTenantShopId } from './tenantContext.server'
import { assertJobActive } from './jobBudget.server'

/** A queued identifier never overrides current ownership or a privacy stop. */
export async function assertUploadsProcessable(uploadIds: string[]): Promise<void> {
  assertJobActive()
  const ids = [...new Set(uploadIds)]
  if (!ids.length) throw new Error('Processing requires at least one upload')
  const count = await prisma.upload.count({ where: { shopId: requireTenantShopId(), id: { in: ids }, privacyRedactedAt: null } })
  if (count !== ids.length) throw new Error('Upload is missing, belongs to another shop, or is awaiting privacy erasure')
}
