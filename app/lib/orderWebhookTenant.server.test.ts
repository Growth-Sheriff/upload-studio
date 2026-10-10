import { createHmac } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from './prisma.server'
import { getTenantShopId, TenantIsolationError, withTenantContext, withTenantRequest } from './tenantContext.server'

const snapshot = vi.hoisted(() => vi.fn())
vi.mock('~/lib/shopifyOrderSnapshot.server', () => ({ fetchShopifyOrderSnapshot: snapshot }))
import { action as created } from '../routes/webhooks.orders-create'
import { action as paid } from '../routes/webhooks.orders-paid'
import { action as updated } from '../routes/webhooks.orders-updated'
import { action as cancelled } from '../routes/webhooks.orders-cancelled'
import { action as fulfilled } from '../routes/webhooks.orders-fulfilled'
import { action as refunded } from '../routes/webhooks.refunds-create'

const owner = { id: 'webhook-shop-a', shopDomain: 'webhook-shop-a.myshopify.com', accessToken: 'not-a-provider-token', billingStatus: 'active', erasureStartedAt: null }
const order = { id: 42, financial_status: 'paid', currency: 'USD', total_price: '200.00', line_items: [], refunds: [] }
const adapters = [created, paid, updated, cancelled, fulfilled, refunded]
let transport: Array<{ model?: string; action: string; shopId: string | null }> = []

// Keep the production Prisma middleware and real reconciler intact. Only the
// final database transport is replaced; no database/provider is contacted.
prisma.$use(async params => {
  transport.push({ model: params.model, action: params.action, shopId: getTenantShopId() })
  if (params.model === 'Shop' && params.action === 'findUnique') {
    const where = params.args?.where
    return (!where?.id || where.id === owner.id) && (!where?.shopDomain || where.shopDomain === owner.shopDomain) ? owner : null
  }
  if (params.action === 'findMany') return []
  if (params.model === 'Commission' && params.action === 'findUnique') return null
  if (params.action === 'updateMany') return { count: 0 }
  if (params.model === 'AuditLog' && params.action === 'create') return params.args.data
  if (params.model === 'AuditLog' && params.action === 'upsert') return params.args.create
  throw new Error(`Unexpected test database transport: ${params.model}.${params.action}`)
})

function args(action: (typeof adapters)[number], valid = true) {
  const body = JSON.stringify(action === refunded ? { id: 17, order_id: 42 } : order)
  return { request: new Request('https://public-test.example/webhooks/orders', {
    method: 'POST', headers: { 'x-shopify-shop-domain': owner.shopDomain,
      'x-shopify-hmac-sha256': valid ? createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(body).digest('base64') : 'invalid' }, body,
  }), params: {}, context: {} }
}

describe('signed order adapters retain strict tenant isolation', () => {
  beforeEach(() => {
    transport = []
    vi.stubEnv('SHOPIFY_API_SECRET', 'test-order-webhook-secret')
    snapshot.mockReset().mockImplementation(async () => {
      expect(getTenantShopId()).toBe(owner.id)
      return { ...order, refunds: [] }
    })
  })
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect() })

  it('binds all six verified routes before the real reconciler and route audit queries', async () => {
    for (const action of adapters) {
      const response = await withTenantRequest(() => action(args(action)))
      expect(response.status).toBe(200)
    }
    const reads = transport.filter(call => call.model === 'ProductConfig')
    expect(reads).toHaveLength(6)
    expect(reads.every(call => call.shopId === owner.id)).toBe(true)
    expect(transport.filter(call => call.model === 'AuditLog').every(call => call.shopId === owner.id)).toBe(true)
    // An unserved order is never converted into a fee by these empty fixtures.
    expect(transport.some(call => call.model === 'Commission' && call.action === 'create')).toBe(false)
  })

  it('rejects invalid HMAC before shop lookup, tenant binding or reconciliation', async () => {
    for (const action of adapters) {
      await withTenantRequest(async () => {
        expect((await action(args(action, false))).status).toBe(401)
        expect(getTenantShopId()).toBeNull()
      })
    }
    expect(transport).toEqual([])
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('keeps the actual guard closed to unbound and foreign-owner queries', async () => {
    await expect(withTenantRequest(() => prisma.productConfig.findMany({ where: { shopId: owner.id } }))).rejects.toBeInstanceOf(TenantIsolationError)
    await expect(withTenantContext('webhook-shop-b', () => prisma.productConfig.findMany({ where: { shopId: owner.id } }))).rejects.toBeInstanceOf(TenantIsolationError)
    await withTenantContext('webhook-shop-b', async () => {
      expect((await created(args(created))).status).toBe(200) // foreign installation is undiscoverable
      expect(getTenantShopId()).toBe('webhook-shop-b')
    })
    expect(transport.some(call => call.model === 'ProductConfig')).toBe(false)
  })

  it('keeps refund snapshot failure quarantine and audit inside the verified shop', async () => {
    snapshot.mockRejectedValueOnce(new Error('Read-only test snapshot unavailable'))
    const response = await withTenantRequest(() => refunded(args(refunded)))
    expect(response.status).toBe(200)
    const quarantine = transport.filter(call => ['Commission', 'AuditLog'].includes(call.model || ''))
    expect(quarantine).toHaveLength(3)
    expect(quarantine.every(call => call.shopId === owner.id)).toBe(true)
  })
})
