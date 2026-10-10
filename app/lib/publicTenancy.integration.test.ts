import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { createTenantPrismaClient } from './prisma.server'
import { withTenantContext } from './tenantContext.server'
import { dashboardNonGhostUploads } from '../routes/app._index'
import { queueOrderLabel } from '../routes/app.queue'

vi.mock('~/shopify.server', () => ({ authenticate: { admin: vi.fn() } }))

describe('merchant order identification', () => {
  it('shows the stored Shopify order name, never a fabricated number from an opaque ID', () => {
    expect(queueOrderLabel({ orderName: '#1001', orderId: '18946622095581' })).toBe('#1001')
    expect(queueOrderLabel({ orderName: '#1002', orderId: '18946639954141' })).toBe('#1002')
    expect(queueOrderLabel({ orderName: ' ', orderId: '18946622095581' })).toBe('Order ID 18946622095581')
    expect(queueOrderLabel({})).toBe('—')
  })
})

const url = process.env.PUBLIC_TENANCY_TEST_DATABASE_URL
/** Never fall back to DATABASE_URL: this fixture writes only to an explicitly
 * named isolated test database, never a live tenant schema or public shop. */
describe.skipIf(!url)('three-shop PostgreSQL isolation integration', () => {
  it('dashboard includes ordinary null/missing JSON facts but excludes actual missing-file ghosts and foreign shops', async () => {
    const target = new URL(url!)
    if (!/^\/public[_a-z]*_test$/.test(target.pathname) || (target.searchParams.get('schema') && target.searchParams.get('schema') !== 'public')) throw new Error('Isolation fixture requires a dedicated public_*_test database')
    const client = createTenantPrismaClient({ datasources: { db: { url } } })
    const shops: string[] = []
    const marker = randomUUID().replace(/-/g, '')
    try {
      for (let i = 0; i < 2; i++) {
        const shop = await client.shop.create({ data: { shopDomain: `dashboard-${i}-${marker}.myshopify.com`, accessToken: 'test-only', storageProvider: 'local' } })
        shops.push(shop.id)
      }
      await withTenantContext(shops[0], async () => {
        for (const preflightSummary of [Prisma.DbNull, Prisma.JsonNull, {}, { measured: true }, { errorType: null }, { errorType: 'decode_error' }]) {
          await client.upload.create({ data: { shopId: shops[0], mode: 'dtf', status: 'needs_review', orderId: '1001', preflightSummary } })
        }
        await client.upload.create({ data: { shopId: shops[0], mode: 'dtf', status: 'needs_review', orderId: 'ghost-order', preflightSummary: { errorType: 'missing_upload' } } })
      })
      await withTenantContext(shops[1], () => client.upload.create({ data: { shopId: shops[1], mode: 'dtf', status: 'needs_review', orderId: 'foreign-order' } }))
      await withTenantContext(shops[0], async () => {
        const where = { shopId: shops[0], ...dashboardNonGhostUploads }
        expect(await client.upload.count({ where })).toBe(6)
        expect(await client.upload.count({ where: { ...where, status: 'needs_review' } })).toBe(6)
        const orders = await client.upload.findMany({ where: { ...where, orderId: { not: null } }, select: { orderId: true }, distinct: ['orderId'] })
        expect(orders).toEqual([{ orderId: '1001' }])
      })
    } finally {
      for (const shopId of shops) await withTenantContext(shopId, () => client.shop.delete({ where: { id: shopId } })).catch(() => undefined)
      await client.$disconnect()
    }
  }, 30_000)

  it('cannot read, change or attach another shop record', async () => {
    const target = new URL(url!)
    if (!/^\/public[_a-z]*_test$/.test(target.pathname) || (target.searchParams.get('schema') && target.searchParams.get('schema') !== 'public')) throw new Error('Isolation fixture requires a dedicated public_*_test database')
    const client = createTenantPrismaClient({ datasources: { db: { url } } })
    const shops: string[] = []
    const uploads: string[] = []
    const marker = randomUUID().replace(/-/g, '')
    try {
      expect(await client.$queryRaw`SELECT 1`).toHaveLength(1)
      for (let i = 0; i < 3; i++) {
        const shop = await client.shop.create({ data: { shopDomain: `isolation-${i}-${marker}.myshopify.com`, accessToken: 'test-only', storageProvider: 'local' } })
        shops.push(shop.id)
        const upload = await withTenantContext(shop.id, () => client.upload.create({ data: { shopId: shop.id, mode: 'dtf', status: 'draft' } }))
        uploads.push(upload.id)
      }
      await Promise.all(shops.map((shopId, index) => withTenantContext(shopId, async () => {
        expect((await client.upload.findMany()).map(row => row.id)).toEqual([uploads[index]])
        const foreign = uploads[(index + 1) % 3]
        expect(await client.upload.findUnique({ where: { id: foreign } })).toBeNull()
        await expect(client.upload.update({ where: { id: foreign }, data: { status: 'ready' } })).rejects.toThrow()
        await expect(client.uploadItem.create({ data: { uploadId: foreign, location: 'front', storageKey: 'local:test' } })).rejects.toThrow('foreign')
        await expect(client.upload.findMany({ where: { shopId: shops[(index + 1) % 3] } })).rejects.toThrow('differs')
        expect((await client.upload.findUnique({ where: { id: uploads[index] } }))?.status).toBe('draft')
      })))
      await withTenantContext(shops[0], () => client.shop.update({ where: { id: shops[0] }, data: { billingStatus: 'erasing' } }))
      await expect(withTenantContext(shops[0], () => client.upload.update({ where: { id: uploads[0] }, data: { status: 'ready' } }))).rejects.toThrow('writes are closed')
    } finally {
      for (const shopId of shops) await withTenantContext(shopId, () => client.shop.delete({ where: { id: shopId } })).catch(() => undefined)
      await client.$disconnect()
    }
  }, 30_000)
})
