import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateUploadCapabilityToken } from './storage.server'
import { getTenantShopId, withTenantContext, withTenantRequest } from './tenantContext.server'
import { authorizeUploadStorageCapability } from './uploadStorageCapability.server'

const shopLookup = vi.hoisted(() => vi.fn())
vi.mock('./prisma.server', () => ({ default: { shop: { findUnique: shopLookup } } }))
const key = 'one_myshopify_com/dev/upload_id/item_id/file.png'
const tokenFor = (objectKey = key) => withTenantContext('shop_one', () =>
  generateUploadCapabilityToken('local', objectKey, 1234, Date.now() + 60_000))

beforeEach(() => {
  shopLookup.mockReset()
  shopLookup.mockImplementation(async () => {
    expect(getTenantShopId()).toBe('shop_one')
    return { shopDomain: 'one.myshopify.com', erasureStartedAt: null, billingStatus: 'pending' }
  })
})

describe('direct upload tenant authorization', () => {
  it('binds the issued owner before the database query, without a proxy shop parameter', async () => {
    const token = tokenFor()
    await withTenantRequest(async () => {
      expect(await authorizeUploadStorageCapability('local', key, 1234, token)).toBe(true)
      expect(getTenantShopId()).toBe('shop_one')
      expect(shopLookup).toHaveBeenCalledWith({ where: { id: 'shop_one' },
        select: { shopDomain: true, erasureStartedAt: true, billingStatus: true } })
    })
  })

  it('rejects tampering before discovery or owner access', async () => {
    const token = tokenFor()
    await withTenantRequest(async () => {
      expect(await authorizeUploadStorageCapability('local', key, 1235, token)).toBe(false)
      expect(await authorizeUploadStorageCapability('local', key, 1234, token.replace('shop_one', 'shop_two'))).toBe(false)
      expect(getTenantShopId()).toBeNull()
      expect(shopLookup).not.toHaveBeenCalled()
    })
  })

  it('does not authorize an issued key outside its persisted shop prefix or a traversal', async () => {
    for (const objectKey of ['two_myshopify_com/dev/upload_id/item_id/file.png',
      'one_myshopify_com/dev/../item_id/file.png']) {
      const token = tokenFor(objectKey)
      await withTenantRequest(async () => {
        expect(await authorizeUploadStorageCapability('local', objectKey, 1234, token)).toBe(false)
      })
    }
  })

  it('closes storage writes when the shop is being erased', async () => {
    shopLookup.mockResolvedValue({ shopDomain: 'one.myshopify.com', erasureStartedAt: new Date(), billingStatus: 'erasing' })
    const token = tokenFor()
    await withTenantRequest(async () => {
      expect(await authorizeUploadStorageCapability('local', key, 1234, token)).toBe(false)
    })
  })
})
