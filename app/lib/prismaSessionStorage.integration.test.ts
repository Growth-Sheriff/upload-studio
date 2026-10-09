import { randomUUID } from 'node:crypto'
import { Session } from '@shopify/shopify-api'
import { describe, expect, it } from 'vitest'
import { createTenantPrismaClient } from './prisma.server'
import { PrismaSessionStorage } from './prismaSessionStorage.server'
import { persistVerifiedShopInstallation } from './publicAuthPersistence.server'

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
  it('reinstall fences pending and claimed purges but never reopens a marked shop', async () => {
    const target = new URL(url!)
    if (!/^\/public[_a-z]*_test$/.test(target.pathname) || (target.searchParams.get('schema') && target.searchParams.get('schema') !== 'public')) throw new Error('Session fixture requires an isolated public_*_test database and public schema')
    const database = createTenantPrismaClient({ datasources: { db: { url } } })
    const domain = `reinstall-${randomUUID()}.myshopify.com`
    const previousInstall = new Date(Date.now() - 86400000)
    let shopId: string | undefined
    try {
      const shop = await database.shop.create({ data: { shopDomain: domain, accessToken: '', billingStatus: 'uninstalled', installedAt: previousInstall, uninstalledAt: new Date(), settings: { uninstalledAt: 'old', keep: true } } })
      shopId = shop.id
      for (const status of ['pending', 'processing']) await database.complianceRequest.create({ data: { shopDomain: domain, topic: 'uninstall/erase', eventId: status, payload: {}, status, leaseToken: status === 'processing' ? 'stale-owner' : null, leaseUntil: new Date(Date.now() + 60000) } })
      await persistVerifiedShopInstallation(database, { shop: domain, accessToken: 'replacement' })
      const installed = await database.shop.findUniqueOrThrow({ where: { id: shop.id } })
      expect(installed).toMatchObject({ accessToken: 'replacement', billingStatus: 'inactive', uninstalledAt: null, settings: { keep: true } })
      expect(installed.installedAt.getTime()).toBeGreaterThan(previousInstall.getTime())
      expect((await database.complianceRequest.findMany({ where: { shopDomain: domain } })).map(row => [row.status, row.leaseToken, row.leaseUntil])).toEqual([['cancelled', null, null], ['cancelled', null, null]])
      await database.shop.update({ where: { id: shop.id }, data: { erasureStartedAt: new Date(), billingStatus: 'erasing', accessToken: '' } })
      await database.complianceRequest.create({ data: { shopDomain: domain, topic: 'uninstall/erase', eventId: 'started', payload: {}, status: 'pending' } })
      await expect(persistVerifiedShopInstallation(database, { shop: domain, accessToken: 'must-not-persist' })).rejects.toThrow('erasure')
      expect((await database.shop.findUniqueOrThrow({ where: { id: shop.id } })).accessToken).toBe('')
      expect((await database.complianceRequest.findFirstOrThrow({ where: { shopDomain: domain, eventId: 'started' } })).status).toBe('pending')
    } finally {
      await database.complianceRequest.deleteMany({ where: { shopDomain: domain } })
      if (shopId) await database.shop.deleteMany({ where: { id: shopId } })
      await database.$disconnect()
    }
  }, 30_000)
  it('does not restore tokens or cancel erasure when privacy wins after the auth read', async () => {
    const target = new URL(url!)
    if (!/^\/public[_a-z]*_test$/.test(target.pathname) || (target.searchParams.get('schema') && target.searchParams.get('schema') !== 'public')) throw new Error('Session fixture requires an isolated public_*_test database and public schema')
    const database = createTenantPrismaClient({ datasources: { db: { url } } })
    const shops: string[] = []
    const domains: string[] = []
    const sessions: string[] = []
    try {
      for (const mode of ['session', 'install'] as const) {
        const domain = `auth-race-${mode}-${randomUUID()}.myshopify.com`
        domains.push(domain)
        const shop = await database.shop.create({ data: { shopDomain: domain, accessToken: 'old', billingStatus: 'inactive' } })
        shops.push(shop.id)
        await database.complianceRequest.create({ data: { shopDomain: domain, topic: 'uninstall/erase', eventId: mode, payload: {}, status: 'pending' } })
        const session = new Session({ id: `offline_${domain}`, shop: domain, state: 'test', isOnline: false })
        session.accessToken = 'late-secret'; sessions.push(session.id)
        let markReady!: () => void, releaseMark!: () => void, readReady!: () => void
        const marked = new Promise<void>(resolve => { markReady = resolve })
        const released = new Promise<void>(resolve => { releaseMark = resolve })
        const read = new Promise<void>(resolve => { readReady = resolve })
        // A real PostgreSQL row lock holds privacy's marker uncommitted while
        // the auth transaction observes the old value. No timing sleep needed.
        const privacy = database.$transaction(async tx => {
          await tx.shop.update({ where: { id: shop.id }, data: { erasureStartedAt: new Date(), billingStatus: 'erasing', accessToken: '' } })
          markReady(); await released
          await tx.session.deleteMany({ where: { shop: domain } })
        })
        await marked
        const observed = new Proxy(database, { get(target, property) {
          if (property !== '$transaction') return Reflect.get(target, property)
          return (run: any, options: any) => target.$transaction(tx => run(new Proxy(tx, { get(transaction, key) {
            if (key !== 'shop') return Reflect.get(transaction, key)
            return new Proxy(transaction.shop, { get(delegate, method) {
              if (method !== 'findUnique') return Reflect.get(delegate, method)
              return async (args: any) => { const row = await delegate.findUnique(args); readReady(); return row }
            } })
          } })), options)
        } })
        const outcome = mode === 'session'
          ? new PrismaSessionStorage(observed).storeSession(session).then(value => ({ stored: value }))
          : persistVerifiedShopInstallation(observed, session).then(() => ({ stored: true }), error => ({ error }))
        try { await read } finally { releaseMark() }
        await privacy
        const result: any = await outcome
        if (mode === 'session') expect(result.stored).toBe(false)
        else expect(result.error?.message).toContain('erasure')
        expect((await database.shop.findUniqueOrThrow({ where: { id: shop.id } })).accessToken).toBe('')
        expect(await new PrismaSessionStorage(database).loadSession(session.id)).toBeUndefined()
        expect(await database.session.findUnique({ where: { id: session.id } })).toBeNull()
        expect((await database.complianceRequest.findFirstOrThrow({ where: { shopDomain: domain, eventId: mode } })).status).toBe('pending')
      }
    } finally {
      await database.session.deleteMany({ where: { id: { in: sessions } } })
      await database.complianceRequest.deleteMany({ where: { shopDomain: { in: domains } } })
      await database.shop.deleteMany({ where: { id: { in: shops } } })
      await database.$disconnect()
    }
  }, 30_000)
})
