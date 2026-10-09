import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRecentBillableInches, resolveEffectivePricingForShop } from './customerPricingRuntime.server'
import prisma from '~/lib/prisma.server'

vi.mock('~/lib/prisma.server', () => ({ default: {
  upload: { findMany: vi.fn() }, paidSheetVolume: { aggregate: vi.fn(async () => ({ _sum: { paidBillableInches: null } })) },
  productConfig: { findMany: vi.fn(async () => []) },
} }))

const settings = {
  customerPricing: {
    model: 'status_rates', enabled: true, businessPricePerInch: 0.2,
    statuses: [{ id: 'vip', key: 'vip', label: 'VIP', type: 'vip', active: true,
      pricePerInch: 0.2, productRules: [{ id: 'r1', productId: 'gid://shopify/Product/1',
        productLabel: 'Gang sheet', active: true, pricingMode: 'measured_length', pricePerInch: 0.2 }] }],
    assignments: [{ customerId: '42', customerEmail: 'old@example.com', customerName: 'Old Name',
      statusKey: 'vip', active: true, productOverrides: [] }],
  },
}
const shop = { id: 'shop-a', shopDomain: 'example.myshopify.com', settings }

afterEach(() => vi.restoreAllMocks())

describe('public pricing identity', () => {
  it('sums durable paid order-line facts without loading or truncating upload measurements', async () => {
    vi.mocked(prisma.paidSheetVolume.aggregate).mockResolvedValueOnce({ _sum: { paidBillableInches: 72 } } as any)
    expect(await loadRecentBillableInches(shop, '42', 3)).toBe(72)
    expect(prisma.paidSheetVolume.aggregate).toHaveBeenCalledWith({
      where: { shopId: shop.id, paidAt: { gte: expect.any(Date) },
        paidCustomerId: '42' }, _sum: { paidBillableInches: true },
    })
    expect(prisma.upload.findMany).not.toHaveBeenCalled()
  })
  it('uses an explicitly configured product base rate for a guest, with no account or carrier variant', async () => {
    const result = await resolveEffectivePricingForShop({ shop, customerId: null, productId: '1',
      builderConfig: { publicPricingMode: 'measured_length', pricePerInch: 0.3 } })
    expect(result.source).toBe('product_rate')
    expect(result.context).toMatchObject({ customerType: 'guest', pricingMode: 'measured_length',
      hasCustomPricing: true, pricePerInch: 0.3, customerId: null })
  })

  it('never invents a product rate or overrides an assigned account rate', async () => {
    const guest = await resolveEffectivePricingForShop({ shop, customerId: null, productId: '1',
      builderConfig: { publicPricingMode: 'measured_length' } })
    expect(guest.context.hasCustomPricing).toBe(false)
    const assigned = await resolveEffectivePricingForShop({ shop, customerId: '42', productId: '1',
      builderConfig: { publicPricingMode: 'measured_length', pricePerInch: 0.3 } })
    expect(assigned.source).toBe('status_rates')
    expect(assigned.context.pricePerInch).toBe(0.2)
  })
  it('uses the signed ID assignment without calling a customer profile API', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call'))
    const result = await resolveEffectivePricingForShop({ shop, customerId: '42', productId: '1' })
    expect(result.context.hasCustomPricing).toBe(true)
    expect(result.context.pricePerInch).toBe(0.2)
    expect(result.context.assignment).not.toHaveProperty('customerEmail')
    expect(result.context.assignment).not.toHaveProperty('customerName')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores client contact fields and cannot unlock another account by email', async () => {
    const result = await resolveEffectivePricingForShop({
      shop, customerId: null, customerEmail: 'old@example.com', customerName: 'Old Name', productId: '1',
    })
    expect(result.context.hasCustomPricing).toBe(false)
    expect(result.context.assignment).toBeNull()
  })

  it('preserves ID-based volume eligibility without emitting contact-derived copy', async () => {
    const result = await resolveEffectivePricingForShop({
      shop: { ...shop, settings: {
        customerPricing: { model: 'volume_tiers' },
        alphaProDiscount: { enabled: true, checkoutMode: 'custom_checkout', products: [{ productId: '1' }],
          tiers: [{ min_qty: 1, max_qty: null, price_per_inch: 0.25 }],
          eligibleCustomers: [{ customerId: '42', name: 'Old Name', email: 'old@example.com' }] },
      } }, customerId: '42', productId: '1', billableInches: 60,
    })
    expect(result.volumeOffer?.customerName).toBe('')
    expect(JSON.stringify(result)).not.toContain('old@example.com')
    expect(JSON.stringify(result)).not.toContain('Old Name')
  })
})
