import { describe, expect, it } from 'vitest'
import {
  DTF_PRINTHOUSE_SHOP_DOMAIN,
  DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
  DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
  applyCustomerPricingDefaultsForShop,
  normalizeProductId,
  resolveCustomerPricingContext,
  type CustomerPricingSettings,
} from './customerPricing.server'

describe('customer pricing product rules', () => {
  it('normalizes only Shopify product IDs', () => {
    expect(normalizeProductId('7717339562142')).toBe(DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID)
    expect(normalizeProductId(DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID)).toBe(
      DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID
    )
    expect(normalizeProductId('gid://shopify/ProductVariant/123')).toBeNull()
    expect(normalizeProductId('upload-uv-dtf-transfer')).toBeNull()
    expect(normalizeProductId('*')).toBeNull()
  })

  it('uses the active status product rule for a matching assigned customer', () => {
    const settings = applyCustomerPricingDefaultsForShop(DTF_PRINTHOUSE_SHOP_DOMAIN, {
      customerPricing: {
        enabled: true,
        statuses: [
          {
            key: 'business',
            label: 'Business',
            type: 'business',
            active: true,
            pricePerInch: 0.2,
            productRules: [
              {
                id: 'business_uv_upload',
                productId: DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
                productLabel: 'Upload UV DTF Gang Sheet',
                active: true,
                pricingMode: 'variant_length',
                pricePerInch: 0.6,
              },
            ],
          },
        ],
        assignments: [
          {
            customerId: '123',
            statusKey: 'business',
            active: true,
            productOverrides: [],
          },
        ],
      },
    })

    const context = resolveCustomerPricingContext(settings, '123', '7717339562142', null)

    expect(context.hasCustomPricing).toBe(true)
    expect(context.pricingMode).toBe('variant_length')
    expect(context.pricePerInch).toBe(0.6)
    expect(context.productRule?.productId).toBe(DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID)
  })

  it('does not let a customer override activate pricing without a status product rule', () => {
    const settings: CustomerPricingSettings = {
      version: 2,
      enabled: true,
      businessPricePerInch: 0.2,
      statuses: [
        {
          id: 'business',
          key: 'business',
          label: 'Business',
          type: 'business',
          active: true,
          pricePerInch: 0.2,
          productRules: [
            {
              id: 'business_dtf_upload',
              productId: DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
              productLabel: 'Upload DTF Gang Sheet',
              active: true,
              pricingMode: 'variant_length',
              pricePerInch: 0.2,
            },
          ],
        },
      ],
      assignments: [
        {
          customerId: '123',
          statusKey: 'business',
          active: true,
          pricePerInchOverride: 0.6,
          productOverrides: [
            {
              productId: DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
              pricePerInch: 0.6,
            },
          ],
        },
      ],
    }

    const context = resolveCustomerPricingContext(
      settings,
      '123',
      DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
      null
    )

    expect(context.isStatusAssigned).toBe(true)
    expect(context.hasCustomPricing).toBe(false)
    expect(context.pricingMode).toBe('standard_variant')
    expect(context.pricePerInch).toBeNull()
  })

  it('merges DTF Print House defaults by normalized product ID', () => {
    const settings = applyCustomerPricingDefaultsForShop(DTF_PRINTHOUSE_SHOP_DOMAIN, {
      customerPricing: {
        enabled: true,
        statuses: [
          {
            key: 'business',
            label: 'Business',
            type: 'business',
            active: true,
            pricePerInch: 0.2,
            productRules: [
              {
                id: 'legacy_numeric_dtf',
                productId: '7605186560158',
                productLabel: 'Legacy DTF',
                active: true,
                pricingMode: 'variant_length',
                pricePerInch: 0.25,
              },
            ],
          },
        ],
        assignments: [],
      },
    })

    const business = settings.statuses.find((status) => status.key === 'business')
    const dtfRules = business?.productRules.filter(
      (rule) => rule.productId === DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID
    )

    expect(dtfRules).toHaveLength(1)
    expect(dtfRules?.[0]?.pricePerInch).toBe(0.25)
    expect(
      business?.productRules.some((rule) => rule.productId === DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID)
    ).toBe(true)
  })
})
