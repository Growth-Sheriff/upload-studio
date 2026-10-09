import { AsyncLocalStorage } from 'node:async_hooks'

interface TenantContext { shopId: string | null; tenantSql: boolean }
const context = new AsyncLocalStorage<TenantContext>()

/** PrismaPromise is lazy. Assimilate it while still inside the store instead
 * of letting a caller await it after run() has restored the outer context. */
function settleInsideContext<T>(run: () => T): T {
  const value = run()
  return value && typeof (value as any).then === 'function' ? Promise.resolve(value) as T : value
}

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(`Tenant isolation violation: ${message}`)
    this.name = 'TenantIsolationError'
  }
}

/** Establish before Remix dispatches loaders. Authentication binds this
 * request's store; enterWith inside an awaited helper cannot bind its caller. */
export function withTenantRequest<T>(run: () => T): T {
  return context.run({ shopId: null, tenantSql: false }, () => settleInsideContext(run))
}

export function enterTenantContext(shopId: string): void {
  if (!shopId?.trim()) throw new TenantIsolationError('empty shop identity')
  const current = context.getStore()
  if (!current) throw new TenantIsolationError('request boundary is missing')
  if (current.shopId && current.shopId !== shopId) throw new TenantIsolationError('attempt to change the authenticated shop')
  current.shopId = shopId
}

export function withTenantContext<T>(shopId: string, run: () => T): T {
  if (!shopId?.trim()) throw new TenantIsolationError('empty shop identity')
  const existing = context.getStore()
  if (existing?.shopId && existing.shopId !== shopId) throw new TenantIsolationError('attempt to cross an existing shop context')
  return context.run({ shopId, tenantSql: false }, () => settleInsideContext(run))
}

export function requireTenantShopId(): string {
  const shopId = context.getStore()?.shopId
  if (!shopId) throw new TenantIsolationError('authenticated shop context is required')
  return shopId
}

export function getTenantShopId(): string | null { return context.getStore()?.shopId ?? null }

/** Only reviewed SQL with an explicit owner predicate may use this escape. */
export function withTenantSql<T>(run: (shopId: string) => T): T {
  const shopId = requireTenantShopId()
  return context.run({ shopId, tenantSql: true }, () => settleInsideContext(() => run(shopId)))
}

export function isTenantSqlAuthorized(): boolean { return context.getStore()?.tenantSql === true }
