import { describe, expect, it } from 'vitest'
import {
  buildVolumeProgramPayload,
  deriveCustomerPricingModel,
  getPricingPolicy,
  normalizeVolumeProgram,
  pickVolumeTier,
  resolveCustomerPricingModelState,
  resolveEffectivePricing,
} from './customerPricingModel.server'
import { normalizeCustomerPricingSettings, DTF_PRINTHOUSE_SHOP_DOMAIN } from './customerPricing.server'

const ALPHA = 'alphaprintcenter.myshopify.com'
const OTHER = 'example-shop.myshopify.com'

// Shapes mirror what the two legacy tenants have stored (no real customer data).
const alphaSettings = {
  alphaProDiscount: {
    enabled: true,
    version: 2,
    unit: 'linear_inches',
    products: [
      { gid: 'gid://shopify/Product/7453184196656', productId: 'gid://shopify/Product/7453184196656', title: 'DTF Gang Sheets Pro' },
      { gid: 'gid://shopify/Product/7453211164720', productId: 'gid://shopify/Product/7453211164720', title: 'UV Gang Sheets Pro' },
    ],
    tiers: [
      { min_qty: 1, max_qty: 249, price_per_inch: 0.28, label: '1+ inches' },
      { min_qty: 250, max_qty: 499, price_per_inch: 0.22, label: '250+ inches', popular: true },
      { min_qty: 500, max_qty: null, price_per_inch: 0.2, label: '500+ inches' },
    ],
    eligibleCustomers: [
      { customerId: '7354421346352', email: 'returning@example.com', name: 'Returning Customer', totalInches: 7007 },
    ],
  },
}

const dtfSettings = {
  customerPricing: {
    version: 2,
    enabled: true,
    businessPricePerInch: 0.2,
    statuses: [
      { id: 'business', key: 'business', label: 'Business', type: 'business', active: true, pricePerInch: 0.25,
        productRules: [{ id: 'r1', productId: 'gid://shopify/Product/1', productLabel: 'Gang sheet', active: true, pricingMode: 'variant_length', pricePerInch: 0.25 }] },
      { id: 'vip', key: 'vip', label: 'VIP', type: 'vip', active: true, pricePerInch: 0.2,
        productRules: [{ id: 'r2', productId: 'gid://shopify/Product/1', productLabel: 'Gang sheet', active: true, pricingMode: 'measured_length', pricePerInch: 0.2 }] },
    ],
    assignments: [{ customerId: '42', customerEmail: 'vip@example.com', statusKey: 'vip', active: true, productOverrides: [] }],
  },
}

describe('model derivation keeps legacy tenants on their engine', () => {
  it('alpha stays on volume tiers with a standard-cart program', () => {
    const state = resolveCustomerPricingModelState(ALPHA, alphaSettings)
    expect(state.model).toBe('volume_tiers')
    expect(state.explicit).toBe(false)
    expect(state.volumeTiersEnabled).toBe(true)
    expect(state.statusRatesEnabled).toBe(false)
    expect(normalizeVolumeProgram(alphaSettings, ALPHA).checkoutMode).toBe('standard_cart')
  })

  it('dtfprinthouse stays on status rates with the full-page policy', () => {
    const state = resolveCustomerPricingModelState(DTF_PRINTHOUSE_SHOP_DOMAIN, dtfSettings)
    expect(state.model).toBe('status_rates')
    expect(state.policy).toEqual({
      measurementBasis: 'full_page',
      sheetSelection: 'block_default',
      fitToleranceIn: 0.5,
      maxSheetWidthIn: 22.5,
      artboardMarginIn: 0,
      imageMarginIn: 0,
    })
  })

  it('a fresh shop is off with the default policy', () => {
    expect(deriveCustomerPricingModel(OTHER, {})).toBe('off')
    expect(getPricingPolicy(OTHER, {}).measurementBasis).toBe('artwork_bounds')
    expect(getPricingPolicy(OTHER, {}).maxSheetWidthIn).toBe(22)
  })

  it('an explicit model wins over derivation', () => {
    const settings = { ...alphaSettings, customerPricing: { model: 'both', priority: 'volume_first' } }
    const state = resolveCustomerPricingModelState(ALPHA, settings)
    expect(state.model).toBe('both')
    expect(state.priority).toBe('volume_first')
    expect(state.explicit).toBe(true)
  })

  it('normalised status settings round-trip model, priority and policy', () => {
    const normalized = normalizeCustomerPricingSettings({
      customerPricing: { model: 'status_rates', priority: 'status_first', policy: { fitToleranceIn: 0.25 }, tagRules: [{ tag: 'Wholesale', statusKey: 'business' }] },
    })
    expect(normalized.model).toBe('status_rates')
    expect(normalized.policy).toEqual({ fitToleranceIn: 0.25 })
    expect(normalized.tagRules).toEqual([{ tag: 'wholesale', statusKey: 'business' }])
  })
})

describe('volume program', () => {
  it('picks the tier by billable inches', () => {
    const tiers = normalizeVolumeProgram(alphaSettings, ALPHA).tiers
    expect(pickVolumeTier(tiers, 100)?.price_per_inch).toBe(0.28)
    expect(pickVolumeTier(tiers, 250)?.price_per_inch).toBe(0.22)
    expect(pickVolumeTier(tiers, 9999)?.price_per_inch).toBe(0.2)
  })

  it('payload keeps unknown keys and the storage shape', () => {
    const program = normalizeVolumeProgram(alphaSettings, ALPHA)
    const payload = buildVolumeProgramPayload(program, { ...alphaSettings.alphaProDiscount, legacyNote: 'keep me' })
    expect(payload.legacyNote).toBe('keep me')
    expect(payload.unit).toBe('linear_inches')
    expect((payload.products as Array<{ gid: string }>)[0].gid).toBe('gid://shopify/Product/7453184196656')
    expect((payload.eligibleCustomers as Array<{ customerId: string }>)[0].customerId).toBe('7354421346352')
  })
})

describe('effective pricing', () => {
  it('alpha returning customer gets the offer but no computed checkout price (standard cart)', () => {
    const result = resolveEffectivePricing({
      shopDomain: ALPHA,
      rawSettings: alphaSettings,
      customerId: '7354421346352',
      productId: '7453184196656',
    })
    expect(result.source).toBe('none')
    expect(result.volumeOffer?.checkoutMode).toBe('standard_cart')
    expect(result.volumeTiers.length).toBe(3)
    expect(result.context.hasCustomPricing).toBe(false)
  })

  it('volume tiers with custom checkout produce a measured-length context at the right tier', () => {
    const settings = {
      customerPricing: { model: 'volume_tiers' },
      alphaProDiscount: { ...alphaSettings.alphaProDiscount, checkoutMode: 'custom_checkout' },
    }
    const result = resolveEffectivePricing({
      shopDomain: OTHER,
      rawSettings: settings,
      customerId: '7354421346352',
      productId: '7453184196656',
      billableInches: 300,
    })
    expect(result.source).toBe('volume_tiers')
    expect(result.context.customerType).toBe('vip')
    expect(result.context.pricingMode).toBe('measured_length')
    expect(result.context.pricePerInch).toBe(0.22)
    expect(result.context.statusLabel).toBe('Returning customer pricing')
  })

  it('dtfprinthouse VIP assignment still resolves through status rates', () => {
    const result = resolveEffectivePricing({
      shopDomain: DTF_PRINTHOUSE_SHOP_DOMAIN,
      rawSettings: dtfSettings,
      customerId: '42',
      productId: 'gid://shopify/Product/1',
    })
    expect(result.source).toBe('status_rates')
    expect(result.context.customerType).toBe('vip')
    expect(result.context.pricePerInch).toBe(0.2)
  })

  it('status first wins when both apply; volume first flips it', () => {
    const settings = {
      customerPricing: { ...dtfSettings.customerPricing, model: 'both', priority: 'status_first' },
      alphaProDiscount: {
        ...alphaSettings.alphaProDiscount,
        checkoutMode: 'custom_checkout',
        products: [{ productId: 'gid://shopify/Product/1', title: 'Gang sheet' }],
        eligibleCustomers: [{ customerId: '42', email: 'vip@example.com', name: 'VIP' }],
      },
    }
    const statusFirst = resolveEffectivePricing({ shopDomain: OTHER, rawSettings: settings, customerId: '42', productId: 'gid://shopify/Product/1', billableInches: 600 })
    expect(statusFirst.source).toBe('status_rates')
    const volumeFirst = resolveEffectivePricing({
      shopDomain: OTHER,
      rawSettings: { ...settings, customerPricing: { ...settings.customerPricing, priority: 'volume_first' } },
      customerId: '42',
      productId: 'gid://shopify/Product/1',
      billableInches: 600,
    })
    expect(volumeFirst.source).toBe('volume_tiers')
    expect(volumeFirst.context.pricePerInch).toBe(0.2)
  })

  it('tag rules grant a status without an assignment', () => {
    const settings = {
      customerPricing: { ...dtfSettings.customerPricing, model: 'status_rates', tagRules: [{ tag: 'wholesale', statusKey: 'business' }] },
    }
    const result = resolveEffectivePricing({
      shopDomain: OTHER,
      rawSettings: settings,
      customerId: '999',
      customerTags: ['Wholesale'],
      productId: 'gid://shopify/Product/1',
    })
    expect(result.source).toBe('status_rates')
    expect(result.context.customerType).toBe('business')
    expect(result.context.pricePerInch).toBe(0.25)
  })

  it('model off disables status rates even with assignments', () => {
    const settings = { customerPricing: { ...dtfSettings.customerPricing, model: 'off' } }
    const result = resolveEffectivePricing({ shopDomain: OTHER, rawSettings: settings, customerId: '42', productId: 'gid://shopify/Product/1' })
    expect(result.source).toBe('none')
    expect(result.context.hasCustomPricing).toBe(false)
  })
})
