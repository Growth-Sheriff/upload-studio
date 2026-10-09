import { beforeEach, describe, expect, it, vi } from 'vitest'
import { action } from '~/routes/app.customer-pricing'
import prisma from '~/lib/prisma.server'

vi.mock('~/shopify.server', () => ({ authenticate: { admin: vi.fn(async () => ({ session: { shop: 'example.myshopify.com' } })) } }))
vi.mock('~/lib/prisma.server', () => ({ default: {
  shop: { findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() },
} }))

const settings = {
  unrelated: { keep: true },
  customerPricing: { model: 'both', priority: 'volume_first', enabled: true,
    policy: { measurementBasis: 'full_page' }, customKey: 'keep',
    statuses: [{ id: 'vip', key: 'vip', label: 'VIP', type: 'vip', active: true, pricePerInch: 0.2,
      productRules: [{ id: 'r1', productId: '1', pricingMode: 'measured_length', active: true, pricePerInch: 0.17 }] }],
    assignments: [{ customerId: '42', customerEmail: 'old@example.com', customerName: 'Old Name',
      statusKey: 'vip', active: true, productOverrides: [{ productId: '1', pricePerInch: 0.16 }] }],
  },
  alphaProDiscount: { enabled: true, version: 3, products: [{ productId: '1', title: 'My gang sheet' }],
    tiers: [{ min_qty: 1, max_qty: null, price_per_inch: 0.19 }], eligibleCustomers: [{ customerId: '42' }],
    billingBasis: 'variant_length', checkoutMode: 'custom_checkout', untouched: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: 'shop-a', shopDomain: 'example.myshopify.com', settings } as never)
})

async function post(values: Record<string, string>) {
  const request = new Request('https://app.example/app/customer-pricing', { method: 'POST', body: new URLSearchParams(values) })
  return action({ request, context: {}, params: {} })
}

describe('public customer pricing editor', () => {
  it('keeps existing prices, measurement policy and volume configuration on an ID assignment edit', async () => {
    const response = await post({ intent: 'assignment', customerId: 'gid://shopify/Customer/42', status: 'vip' })
    expect(response.status).toBe(200)
    const saved = vi.mocked(prisma.shop.update).mock.calls[0][0].data.settings as Record<string, any>
    expect(saved.unrelated).toEqual(settings.unrelated)
    expect(saved.alphaProDiscount).toEqual(settings.alphaProDiscount)
    expect(saved.customerPricing.policy).toEqual(settings.customerPricing.policy)
    expect(saved.customerPricing.customKey).toBe('keep')
    expect(saved.customerPricing.statuses.find((entry: any) => entry.key === 'vip').productRules[0].pricePerInch).toBe(0.17)
    expect(saved.customerPricing.assignments[0].productOverrides[0].pricePerInch).toBe(0.16)
    expect(saved.customerPricing.assignments[0]).not.toHaveProperty('customerEmail')
    expect(saved.customerPricing.assignments[0]).not.toHaveProperty('customerName')
    expect(prisma.auditLog.create).toHaveBeenCalledOnce()
  })

  it('does not accept contact details as assignment identity or arbitrary text as a product ID', async () => {
    expect((await post({ intent: 'assignment', customerId: 'alice@example.com', status: 'vip' })).status).toBe(400)
    expect((await post({ intent: 'rule', productId: 'Gang Sheet', status: 'vip', rate: '0.17' })).status).toBe(400)
    expect(prisma.shop.update).not.toHaveBeenCalled()
  })

  it('cannot save ambiguous overlapping volume rates', async () => {
    const response = await post({ intent: 'volume', tiers: '1,250,0.2\n250,,0.1', months: '3', minInches: '1000' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Volume tier ranges must not overlap.' })
    expect(prisma.shop.update).not.toHaveBeenCalled()
  })
})
