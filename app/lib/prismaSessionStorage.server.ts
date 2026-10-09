import { Session } from '@shopify/shopify-api'
import type { PrismaClient } from '@prisma/client'
import { withSerializableAuthPersistence } from './publicAuthPersistence.server'
import { getTenantShopId, TenantIsolationError } from './tenantContext.server'

/** Durable multishop SessionStorage without a Redis tenant-index limit. */
export class PrismaSessionStorage {
  constructor(private readonly database: PrismaClient) {}
  async storeSession(session: Session): Promise<boolean> {
    const online = session.onlineAccessInfo?.associated_user
    const extended = session as Session & { refreshToken?: string; refreshTokenExpires?: Date }
    const data = {
      shop: session.shop, state: session.state, isOnline: session.isOnline,
      scope: session.scope ?? null, expires: session.expires ?? null, accessToken: session.accessToken ?? null,
      userId: online?.id ? BigInt(online.id) : null,
      firstName: online?.first_name ?? null, lastName: online?.last_name ?? null,
      email: online?.email ?? null, accountOwner: online?.account_owner ?? false,
      locale: online?.locale ?? null, collaborator: online?.collaborator ?? false,
      emailVerified: online?.email_verified ?? false,
      refreshToken: extended.refreshToken ?? null, refreshTokenExpires: extended.refreshTokenExpires ?? null,
    }
    return withSerializableAuthPersistence(this.database, async tx => {
      const shop = await tx.shop.findUnique({ where: { shopDomain: session.shop }, select: { id: true, billingStatus: true, erasureStartedAt: true, updatedAt: true } })
      if (!shop && getTenantShopId()) throw new TenantIsolationError('session shop differs from the authenticated shop')
      if (shop?.erasureStartedAt || shop?.billingStatus === 'erasing') return false
      if (shop) {
        // Acquire the Shop row lock until the token write commits. Privacy
        // cannot mark/delete sessions between this gate and token persistence.
        const locked = await tx.shop.updateMany({ where: { id: shop.id, erasureStartedAt: null, billingStatus: { not: 'erasing' } }, data: { updatedAt: shop.updatedAt } })
        if (locked.count !== 1) return false
      }
      await tx.session.upsert({ where: { id: session.id }, update: data, create: { id: session.id, ...data } })
      return true
    })
  }
  async loadSession(id: string): Promise<Session | undefined> {
    const row = await this.database.session.findUnique({ where: { id } })
    if (!row) return undefined
    const shop = await this.database.shop.findUnique({ where: { shopDomain: row.shop }, select: { id: true, billingStatus: true, erasureStartedAt: true } })
    if ((!shop && getTenantShopId()) || shop?.erasureStartedAt || ['erasing', 'uninstalled'].includes(shop?.billingStatus || '')) return undefined
    const session = new Session({ id: row.id, shop: row.shop, state: row.state, isOnline: row.isOnline })
    session.scope = row.scope ?? undefined; session.expires = row.expires ?? undefined; session.accessToken = row.accessToken ?? undefined
    if (row.userId) session.onlineAccessInfo = {
      expires_in: Math.max(0, Math.floor(((row.expires?.getTime() ?? Date.now()) - Date.now()) / 1000)),
      associated_user_scope: row.scope || '',
      associated_user: { id: Number(row.userId), first_name: row.firstName || '', last_name: row.lastName || '',
        email: row.email || '', account_owner: row.accountOwner, locale: row.locale || '',
        collaborator: row.collaborator ?? false, email_verified: row.emailVerified ?? false },
    }
    Object.assign(session, { refreshToken: row.refreshToken ?? undefined, refreshTokenExpires: row.refreshTokenExpires ?? undefined })
    return session
  }
  async deleteSession(id: string): Promise<boolean> { await this.database.session.deleteMany({ where: { id } }); return true }
  async deleteSessions(ids: string[]): Promise<boolean> { await this.database.session.deleteMany({ where: { id: { in: ids } } }); return true }
  async findSessionsByShop(shop: string): Promise<Session[]> {
    const rows = await this.database.session.findMany({ where: { shop }, select: { id: true } })
    const sessions = await Promise.all(rows.map(row => this.loadSession(row.id)))
    return sessions.filter((session): session is Session => Boolean(session))
  }
}
