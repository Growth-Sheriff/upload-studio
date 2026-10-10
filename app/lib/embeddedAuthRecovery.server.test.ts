import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), shop: vi.fn(), enterTenant: vi.fn(), approval: vi.fn(), login: vi.fn() }))
vi.mock('@shopify/shopify-app-remix/server', async importOriginal => ({
  ...await importOriginal<typeof import('@shopify/shopify-app-remix/server')>(),
  shopifyApp: () => ({ authenticate: { admin: mocks.admin, webhook: vi.fn(), public: { appProxy: vi.fn() } }, login: mocks.login }),
}))
vi.mock('~/lib/prisma.server', () => ({ default: { shop: { findUnique: mocks.shop, findUniqueOrThrow: mocks.shop } } }))
vi.mock('~/lib/tenantContext.server', () => ({ enterTenantContext: mocks.enterTenant }))
vi.mock('~/lib/shopifyBilling.server', () => ({ requestShopifyBillingApproval: mocks.approval, syncShopifyBilling: vi.fn() }))
import { authenticate } from '../shopify.server'
import { action as billingAction } from '../routes/app.billing'
import { action as loginAction, loader as loginLoader } from '../routes/auth.login'
import { recoveryAppPath, shopifyAdminReopenUrl } from './embeddedAuthRecovery'

const apiKey = '8822c01b1f0be2280240cfab7d4e9a79'
describe('embedded authentication recovery', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shop.mockResolvedValue({ id: 'shop-a', billingStatus: 'inactive', erasureStartedAt: null })
    mocks.admin.mockResolvedValue({ session: { shop: 'fixture.myshopify.com' }, admin: {} })
    mocks.login.mockResolvedValue({})
  })

  it('keeps missing-token XHR unauthenticated and requests one Shopify retry without touching tenant data', async () => {
    const request = new Request('https://app.example/app/billing?shop=other.myshopify.com', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    const response = await authenticate.admin(request).catch(error => error as Response)
    if (!(response instanceof Response)) throw new Error('Missing token unexpectedly authenticated')
    expect(response.status).toBe(401)
    expect(response.headers.get('X-Shopify-Retry-Invalid-Session-Request')).toBe('1')
    expect(response.headers.get('Location')).toBeNull()
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.shop).not.toHaveBeenCalled()
    expect(mocks.enterTenant).not.toHaveBeenCalled()
  })

  it('leaves bearer verification, verified-shop binding and SDK document bounce unchanged', async () => {
    const request = new Request('https://app.example/app/billing?shop=other.myshopify.com', { headers: { Authorization: 'Bearer test-only' } })
    await authenticate.admin(request)
    expect(mocks.admin).toHaveBeenCalledWith(request)
    expect(mocks.shop).toHaveBeenCalledWith(expect.objectContaining({ where: { shopDomain: 'fixture.myshopify.com' } }))
    expect(mocks.enterTenant).toHaveBeenCalledWith('shop-a')
    const expired = new Response(null, { status: 401, headers: { 'X-Shopify-Retry-Invalid-Session-Request': '1' } })
    mocks.admin.mockRejectedValueOnce(expired)
    await expect(authenticate.admin(request)).rejects.toBe(expired)
    const bounce = new Response(null, { status: 302, headers: { Location: '/auth/session-token-bounce?test=1' } })
    mocks.admin.mockRejectedValueOnce(bounce)
    await expect(authenticate.admin(new Request('https://app.example/app/billing'))).rejects.toBe(bounce)
  })

  it('preserves only a local page and a domain navigation hint when the SDK requires login', async () => {
    mocks.admin.mockRejectedValueOnce(new Response(null, { status: 302, headers: { Location: '/auth/login' } }))
    const response = await authenticate.admin(new Request('https://app.example/app/billing?shop=fixture.myshopify.com&id_token=must-not-carry')).catch(error => error as Response)
    if (!(response instanceof Response)) throw new Error('Missing document context unexpectedly authenticated')
    const location = new URL(response.headers.get('Location')!, 'https://app.example')
    expect(location.pathname).toBe('/auth/login')
    expect(Object.fromEntries(location.searchParams)).toEqual({ returnTo: '/app/billing', recoveryShop: 'fixture.myshopify.com' })
    expect(mocks.shop).not.toHaveBeenCalled()
    const data = await loginLoader({ request: new Request(location), params: {}, context: {} })
    expect(data).toMatchObject({ recoveryShop: 'fixture.myshopify.com', returnTo: '/app/billing' })
  })

  it('never invents a shop or permits an external destination for recovery', async () => {
    expect(shopifyAdminReopenUrl(null, apiKey, '/app/billing')).toBeNull()
    expect(shopifyAdminReopenUrl('fixture.myshopify.com.attacker.test', apiKey)).toBeNull()
    expect(shopifyAdminReopenUrl('fixture.myshopify.com', apiKey, '//attacker.test')).toBe(`https://admin.shopify.com/store/fixture/apps/${apiKey}/app`)
    expect(recoveryAppPath('/app/billing?id_token=must-not-carry&host=stale')).toBe('/app/billing')
    for (const error of ['MISSING_SHOP', 'INVALID_SHOP']) {
      mocks.login.mockResolvedValueOnce({ shop: error })
      const result = await loginAction({ request: new Request('https://app.example/auth/login', { method: 'POST' }), params: {}, context: {} })
      expect(result.errors).toHaveProperty('shop')
    }
    const source = readFileSync('app/routes/auth.login.tsx', 'utf8')
    expect(source).toContain('Reconnect to Shopify')
    expect(source).not.toContain('Session Expired')
    expect(source).not.toContain('top.location.reload')
  })

  it('returns billing approval to Shopify admin even when a SPA request has no host or an attacker supplies one', async () => {
    vi.stubEnv('SHOPIFY_API_KEY', apiKey)
    mocks.approval.mockResolvedValue('https://fixture.myshopify.com/approve')
    for (const query of ['', '?host=attacker.test']) {
      const request = new Request(`https://app.example/app/billing${query}`, { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: new URLSearchParams({ _action: 'approve_billing', capUsd: '50' }) })
      const response = await billingAction({ request, params: {}, context: {} })
      expect(await response.json()).toEqual({ approvalUrl: 'https://fixture.myshopify.com/approve', error: null })
      expect(mocks.approval).toHaveBeenLastCalledWith('shop-a', {}, 50, `https://admin.shopify.com/store/fixture/apps/${apiKey}/app/billing`)
    }
  })
})
