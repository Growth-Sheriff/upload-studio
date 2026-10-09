import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTenantPrismaClient } from './prisma.server'
import { withTenantContext } from './tenantContext.server'

const url = process.env.PUBLIC_TENANCY_TEST_DATABASE_URL
/** Never fall back to DATABASE_URL: this fixture writes only to an explicitly
 * named isolated test database, never a live tenant schema or public shop. */
describe.skipIf(!url)('three-shop PostgreSQL isolation integration', () => {
  it('cannot read, change or attach another shop record', async () => {
    const target = new URL(url!)
    if (!target.pathname.endsWith('_public_test') || (target.searchParams.get('schema') && target.searchParams.get('schema') !== 'public')) throw new Error('Isolation fixture requires a dedicated *_public_test database')
    const client = createTenantPrismaClient({ datasources: { db: { url } } })
    const shops: string[] = []
    const uploads: string[] = []
    const marker = randomUUID().replace(/-/g, '')
    try {
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
    } finally {
      for (const shopId of shops) await withTenantContext(shopId, () => client.shop.delete({ where: { id: shopId } })).catch(() => undefined)
      await client.$disconnect()
    }
  }, 30_000)
})
