import { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { assertTenantWriteAllowed, scopeTenantOperation, validateTenantRelations } from './tenantGuard.server'

declare global { var __prisma: PrismaClient | undefined }
export { TenantIsolationError } from './tenantContext.server'

export function createTenantPrismaClient(options: Prisma.PrismaClientOptions = {}): PrismaClient {
  const client = new PrismaClient({ ...options, log: ['error'] })
  client.$use(async (params, next) => {
    scopeTenantOperation(params)
    await assertTenantWriteAllowed(client, params)
    await validateTenantRelations(client, params)
    return next(params)
  })
  return client
}

// One public-app pool and database; no env switch can weaken tenant isolation.
export const prisma = globalThis.__prisma ?? createTenantPrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma
export default prisma
