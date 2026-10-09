import prisma from './prisma.server'
import { requireTenantShopId, TenantIsolationError } from './tenantContext.server'

/** Cached Shop.accessToken is not a credential source: public offline tokens
 * expire. Refresh the durable session even when no merchant opens the app. */
export async function freshShopifyAccessToken(shopDomain: string): Promise<string> {
  const shopId = requireTenantShopId()
  const owner = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopDomain: true, uninstalledAt: true, erasureStartedAt: true } })
  if (!owner || owner.shopDomain !== shopDomain) throw new TenantIsolationError('Shopify credential belongs to another shop')
  if (owner.uninstalledAt || owner.erasureStartedAt) throw new Error('Shop installation inactive')
  const { unauthenticated } = await import('~/shopify.server')
  const { session } = await unauthenticated.admin(shopDomain)
  if (session.shop !== shopDomain || session.isOnline || !session.expires || !session.refreshToken || !session.accessToken || session.isExpired()) throw new Error('Expiring offline Shopify authorization required; reopen the app in Shopify admin')
  // Refresh awaited a provider response; privacy may have won meanwhile.
  const current = await prisma.shop.findUnique({ where: { id: shopId }, select: { uninstalledAt: true, erasureStartedAt: true } })
  if (!current || current.uninstalledAt || current.erasureStartedAt) throw new Error('Shop installation inactive')
  return session.accessToken
}
