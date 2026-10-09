import { Session } from '@shopify/shopify-api'
import { describe, expect, it, vi } from 'vitest'
import { PrismaSessionStorage } from './prismaSessionStorage.server'

describe('public expiring offline authorization', () => {
  it('does not reuse or persist a non-expiring offline token', async () => {
    const database: any = { session: { findUnique: vi.fn(async () => ({ isOnline: false, expires: null, refreshToken: null })) }, $transaction: vi.fn() }
    const adapter = new PrismaSessionStorage(database, { requireExpiringOfflineTokens: true })
    const session = new Session({ id: 'offline_shop.myshopify.com', shop: 'shop.myshopify.com', state: '', isOnline: false })
    session.accessToken = 'rejected-permanent-token'
    expect(await adapter.loadSession(session.id)).toBeUndefined()
    expect(await adapter.storeSession(session)).toBe(false)
    expect(database.$transaction).not.toHaveBeenCalled()
  })

  it('atomically stores a refreshed pair and updates the legacy shop token mirror', async () => {
    const shop = { id: 'shop-a', billingStatus: 'inactive', erasureStartedAt: null, updatedAt: new Date() }
    const transaction = { shop: { findUnique: vi.fn(async () => shop), updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })) }, session: { upsert: vi.fn(async (_args: unknown) => undefined) } }
    const database: any = { $transaction: vi.fn(async run => run(transaction)) }
    const adapter = new PrismaSessionStorage(database, { requireExpiringOfflineTokens: true })
    const session = new Session({ id: 'offline_shop.myshopify.com', shop: 'shop.myshopify.com', state: '', isOnline: false })
    session.accessToken = 'new-access'; session.expires = new Date(Date.now() + 3600_000)
    session.refreshToken = 'new-refresh'; session.refreshTokenExpires = new Date(Date.now() + 86400_000)
    expect(await adapter.storeSession(session)).toBe(true)
    expect(transaction.shop.updateMany.mock.calls[0][0]).toMatchObject({ where: { erasureStartedAt: null }, data: { accessToken: 'new-access' } })
    expect(transaction.session.upsert.mock.calls[0][0]).toMatchObject({ create: { accessToken: 'new-access', refreshToken: 'new-refresh', expires: session.expires, refreshTokenExpires: session.refreshTokenExpires } })
  })
})
