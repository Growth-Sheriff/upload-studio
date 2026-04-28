import { describe, expect, it } from 'vitest'
import {
  applyCustomerPricingDefaultsForShop,
  DTF_PRINTHOUSE_SHOP_DOMAIN,
  normalizeCustomerPricingSettings,
  resolveCustomerPricingContext,
} from './customerPricing.server'

describe('customer pricing product rules', () => {
  it('does not inject DTF Print House product rules from hardcoded product IDs', () => {
    const settings = applyCustomerPricingDefaultsForShop(DTF_PRINTHOUSE_SHOP_DOMAIN, {})

    const business = settings.statuses.find((status) => status.key === 'business')
    const vip = settings.statuses.find((status) => status.key === 'vip')

    expect(business?.productRules).toEqual([])
    expect(vip?.productRules).toEqual([])
  })

  it('does not enable custom pricing for an assigned customer without a matching product rule', () => {
    const settings = normalizeCustomerPricingSettings({
      customerPricing: {
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
            productRules: [],
          },
        ],
        assignments: [
          {
            customerId: '123',
            statusKey: 'business',
            active: true,
          },
        ],
      },
    })

    const context = resolveCustomerPricingContext(
      settings,
      '123',
      'gid://shopify/Product/111'
    )

    expect(context.isStatusAssigned).toBe(true)
    expect(context.hasCustomPricing).toBe(false)
    expect(context.pricingMode).toBe('standard_variant')
    expect(context.pricePerInch).toBeNull()
  })

  it('uses only the saved matching product rule for custom pricing', () => {
    const settings = normalizeCustomerPricingSettings({
      customerPricing: {
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
                id: 'business_111',
                productId: 'gid://shopify/Product/111',
                productLabel: 'Configured Product',
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
          },
        ],
      },
    })

    const matchingContext = resolveCustomerPricingContext(
      settings,
      '123',
      'gid://shopify/Product/111'
    )
    const nonMatchingContext = resolveCustomerPricingContext(
      settings,
      '123',
      'gid://shopify/Product/222'
    )

    expect(matchingContext.hasCustomPricing).toBe(true)
    expect(matchingContext.pricePerInch).toBe(0.6)
    expect(matchingContext.productRule?.productLabel).toBe('Configured Product')
    expect(nonMatchingContext.hasCustomPricing).toBe(false)
    expect(nonMatchingContext.pricePerInch).toBeNull()
  })
})
