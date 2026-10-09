import { randomUUID } from 'node:crypto'
import { Session } from '@shopify/shopify-api'
import { describe, expect, it } from 'vitest'
import { createTenantPrismaClient } from './prisma.server'
import { PrismaSessionStorage } from './prismaSessionStorage.server'

const url = process.env.PUBLIC_TENANCY_TEST_DATABASE_URL
describe.skipIf(!url)('durable multishop session database integration', () => {
  it('survives adapter/pool recreation and revokes one shop without deleting another', async () => {
    const target = new URL(url!)
    if (!/^\/public[_a-z]*_test$/.test(target.pathname) || (target.searchParams.get('schema') && target.searchParams.get('schema') !== 'public')) throw new Error('Session fixture requires an isolated public_*_test database and public schema')
    const marker = randomUUID().replace(/-/g, '')
    const sessions = [0, 1, 2].map(index => {
      const shop = `session-${index}-${marker}.myshopify.com`
      const session = new Session({ id: `offline_${shop}`, shop, state: marker, isOnline: false })
      session.accessToken = `test-token-${index}`
      session.scope = 'read_products,read_orders'
      session.expires = new Date(Date.now() + 3600_000)
      Object.assign(session, { refreshToken: `test-refresh-${index}`, refreshTokenExpires: new Date(Date.now() + 7200_000) })
      return session
    })
    const first = createTenantPrismaClient({ datasources: { db: { url } } })
    let second: ReturnType<typeof createTenantPrismaClient> | undefined
    try {
      const beforeRestart = new PrismaSessionStorage(first)
      await Promise.all(sessions.map(session => beforeRestart.storeSession(session)))
      await first.$disconnect()
      second = createTenantPrismaClient({ datasources: { db: { url } } })
      const afterRestart = new PrismaSessionStorage(second)
      for (const [index, session] of sessions.entries()) {
        const restored = await afterRestart.loadSession(session.id)
        expect(restored?.shop).toBe(session.shop)
        expect(restored?.accessToken).toBe(`test-token-${index}`)
        expect(restored?.expires).toEqual(session.expires)
        expect((restored as any)?.refreshToken).toBe(`test-refresh-${index}`)
        expect((await afterRestart.findSessionsByShop(session.shop)).map(row => row.id)).toEqual([session.id])
      }
      await afterRestart.deleteSessions([sessions[0].id])
      expect(await afterRestart.loadSession(sessions[0].id)).toBeUndefined()
      expect((await afterRestart.loadSession(sessions[1].id))?.accessToken).toBe('test-token-1')
      await afterRestart.deleteSession(sessions[2].id)
      expect(await afterRestart.findSessionsByShop(sessions[2].shop)).toEqual([])
    } finally {
      const cleanup = second ?? first
      await cleanup.session.deleteMany({ where: { id: { in: sessions.map(session => session.id) } } })
      await Promise.all([first.$disconnect(), second?.$disconnect()])
    }
  }, 30_000)
})
