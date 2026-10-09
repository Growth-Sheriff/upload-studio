import { randomUUID } from 'node:crypto'
import { Session } from '@shopify/shopify-api'
import { describe, expect, it, vi } from 'vitest'
import prisma from './prisma.server'
import { PrismaSessionStorage } from './prismaSessionStorage.server'
import { withTenantContext } from './tenantContext.server'
import { shopifyGraphQL } from './shopify.server'

const url = process.env.PUBLIC_TENANCY_TEST_DATABASE_URL
describe.skipIf(!url)('public offline token refresh integration', () => {
  it('refreshes an expired durable token before a background query without an admin visit', async () => {
    if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/public_app_test\?schema=public$/.test(url!) || process.env.DATABASE_URL !== url) throw new Error('Token fixture requires the exact disposable default public_app_test database')
    const shopDomain = `refresh-${randomUUID()}.myshopify.com`
    const shop = await prisma.shop.create({ data: { shopDomain, accessToken: 'stale-shop-cache', storageProvider: 'local' } })
    const session = new Session({ id: `offline_${shopDomain}`, shop: shopDomain, state: '', isOnline: false })
    session.accessToken = 'expired-access'; session.scope = 'read_products'
    session.expires = new Date(Date.now() - 60_000); session.refreshToken = 'stored-refresh'
    session.refreshTokenExpires = new Date(Date.now() + 86400_000)
    const adapter = new PrismaSessionStorage(prisma, { requireExpiringOfflineTokens: true })
    const sequence: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const target = String(input)
      if (target === `https://${shopDomain}/admin/oauth/access_token`) {
        expect(JSON.parse(String(options?.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'stored-refresh' })
        sequence.push('refresh')
        return new Response(JSON.stringify({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, refresh_token_expires_in: 86400, scope: 'read_products' }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (target === `https://${shopDomain}/admin/api/2026-10/graphql.json`) {
        expect(new Headers(options?.headers).get('X-Shopify-Access-Token')).toBe('fresh-access')
        sequence.push('query')
        return new Response(JSON.stringify({ data: { shop: { id: 'fixture-shop' } } }), { headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error('Unexpected network request in token fixture')
    })
    try {
      await adapter.storeSession(session)
      vi.stubGlobal('fetch', fetch)
      const result = await withTenantContext(shop.id, () => shopifyGraphQL(shopDomain, 'must-not-use-caller-token', 'query { shop { id } }'))
      expect(result).toEqual({ shop: { id: 'fixture-shop' } })
      expect(sequence).toEqual(['refresh', 'query'])
      const stored = await adapter.loadSession(session.id)
      expect(stored?.accessToken).toBe('fresh-access')
      expect(stored?.refreshToken).toBe('fresh-refresh')
      expect(stored?.expires?.getTime()).toBeGreaterThan(Date.now())
      expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).accessToken).toBe('fresh-access')
    } finally {
      vi.unstubAllGlobals()
      await prisma.session.deleteMany({ where: { id: session.id } })
      await prisma.shop.deleteMany({ where: { id: shop.id } })
    }
  }, 30_000)
})
