import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enterTenantContext, requireTenantShopId, withTenantRequest } from '~/lib/tenantContext.server'

const mocks = vi.hoisted(() => ({ webhook: vi.fn(), findShop: vi.fn(), findConfig: vi.fn(), deleteConfig: vi.fn() }))
vi.mock('~/shopify.server', () => ({ authenticate: { webhook: mocks.webhook } }))
vi.mock('~/lib/prisma.server', () => ({ default: { shop: { findUnique: mocks.findShop }, productConfig: { findFirst: mocks.findConfig, deleteMany: mocks.deleteConfig } } }))
vi.mock('~/lib/compatibilityTwin.server', () => ({ syncTwinPrices: vi.fn() }))
import { action as update } from '../routes/webhooks.products-update'
import { action as remove } from '../routes/webhooks.products-delete'

describe('verified product webhooks bind tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.webhook.mockImplementation(async () => { await Promise.resolve(); enterTenantContext('shop-a'); return { shop: 'shop-a.myshopify.com', payload: { id: 123 } } })
    mocks.findShop.mockResolvedValue({ id: 'shop-a' })
    mocks.findConfig.mockImplementation(async () => { expect(requireTenantShopId()).toBe('shop-a'); return null })
    mocks.deleteConfig.mockImplementation(async () => { expect(requireTenantShopId()).toBe('shop-a'); return { count: 0 } })
  })
  it('uses the shared authenticator before update and delete queries', async () => {
    for (const action of [update, remove]) {
      const response = await withTenantRequest(() => action({ request: new Request('https://app.example/webhooks/products', { method: 'POST' }), params: {}, context: {} }))
      expect(response.status).toBe(200)
    }
    expect(mocks.webhook).toHaveBeenCalledTimes(2)
    expect(mocks.deleteConfig.mock.calls[0][0].where.productId.in).toEqual(['123', 'gid://shopify/Product/123'])
  })
  it('does not query shop data when shared HMAC authentication rejects', async () => {
    mocks.webhook.mockRejectedValue(new Response(null, { status: 401 }))
    await expect(withTenantRequest(() => update({ request: new Request('https://app.example/webhooks/products', { method: 'POST' }), params: {}, context: {} }))).rejects.toMatchObject({ status: 401 })
    expect(mocks.findShop).not.toHaveBeenCalled()
  })
})
