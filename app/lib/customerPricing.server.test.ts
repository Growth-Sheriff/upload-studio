import { describe, expect, it } from 'vitest'
import {
  applyCustomerPricingDefaultsForShop,
  calculateMeasuredLengthQuote,
  calculateVariantLengthQuote,
  deriveVariantBasedLimits,
  DTF_PRINTHOUSE_SHOP_DOMAIN,
  matchesTrustedUploadOwner,
  normalizeCustomerPricingSettings,
  parseSheetSizeFromTitle,
  resolveCustomerPricingContext,
  validateMeasuredCrossRollFit,
} from './customerPricing.server'

describe('measured-length roll fit', () => {
  it('uses requested copies as both billable lengths and production sheets', () => {
    const quote = calculateMeasuredLengthQuote(
      {
        widthPx: 6600,
        heightPx: 7200,
        measurementWidthPx: 6600,
        measurementHeightPx: 7200,
        widthIn: 22,
        heightIn: 24,
        dpi: 300,
        effectiveDpi: 300,
        sizingSource: 'document_dpi',
        measurementMode: 'full',
      },
      0.2,
      5
    )

    expect(quote.billableLengthIn).toBe(120)
    expect(quote.totalPrice).toBe(24)
    expect(quote.sheetsNeeded).toBe(5)
  })

  it('enforces the configured physical roll instead of a wider variant limit', () => {
    const result = validateMeasuredCrossRollFit({
      measurement: { widthIn: 21, heightIn: 24 },
      rollWidthIn: 20,
      maxDesignWidthIn: 22,
    })
    expect(result.ok).toBe(false)
    expect(result.crossRollLimitIn).toBe(20)
  })

  it('surfaces rotation and bounded fit tolerance for production', () => {
    const result = validateMeasuredCrossRollFit({
      measurement: { widthIn: 24, heightIn: 20.1 },
      rollWidthIn: 20,
      fitToleranceIn: 0.125,
    })
    expect(result.ok).toBe(true)
    expect(result.rotationApplied).toBe(true)
    expect(result.toleranceApplied).toBe(true)
    expect(result.productionNote).toContain('Rotate artwork 90°')
    expect(result.productionNote).toContain('Fit tolerance applied')
  })
})

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

describe('trusted upload ownership', () => {
  it('requires an existing stored customer id to match the signed customer', () => {
    expect(
      matchesTrustedUploadOwner({
        loggedInCustomerId: '123',
        trustedCustomerEmail: 'buyer@example.com',
        uploadCustomerId: 'gid://shopify/Customer/123',
        uploadCustomerEmail: 'buyer@example.com',
      })
    ).toBe(true)
    expect(
      matchesTrustedUploadOwner({
        loggedInCustomerId: '123',
        trustedCustomerEmail: 'shared@example.com',
        uploadCustomerId: '456',
        uploadCustomerEmail: 'shared@example.com',
      })
    ).toBe(false)
  })

  it('uses the trusted Shopify email only for legacy uploads without a customer id', () => {
    expect(
      matchesTrustedUploadOwner({
        loggedInCustomerId: '123',
        trustedCustomerEmail: 'Buyer@Example.com',
        uploadCustomerEmail: ' buyer@example.com ',
      })
    ).toBe(true)
    expect(
      matchesTrustedUploadOwner({
        loggedInCustomerId: null,
        trustedCustomerEmail: 'buyer@example.com',
        uploadCustomerEmail: 'buyer@example.com',
      })
    ).toBe(false)
  })
})

describe('parseSheetSizeFromTitle', () => {
  it('parses composite Shopify variant titles', () => {
    expect(parseSheetSizeFromTitle('22 x 12 / Matte')).toEqual({
      widthIn: 22,
      lengthIn: 12,
    })
    expect(parseSheetSizeFromTitle('22 by 60 / Gloss')).toEqual({
      widthIn: 22,
      lengthIn: 60,
    })
  })

  it('bills the same physical long edge regardless of title orientation', () => {
    const measurement = {
      widthPx: 6600,
      heightPx: 72000,
      measurementWidthPx: 6600,
      measurementHeightPx: 72000,
      widthIn: 22,
      heightIn: 240,
      dpi: 300,
      documentDpi: 300,
      documentDpiSource: 'png_phys',
      effectiveDpi: 300,
      sizingSource: 'document_dpi',
      measurementMode: 'full',
    }

    const normal = calculateVariantLengthQuote({
      measurement,
      pricePerInch: 0.2,
      variantTitle: '22 x 240',
      sheetsNeeded: 1,
    })
    const reversed = calculateVariantLengthQuote({
      measurement,
      pricePerInch: 0.2,
      variantTitle: '240 x 22',
      sheetsNeeded: 1,
    })

    expect(normal?.billableLengthIn).toBe(240)
    expect(reversed?.billableLengthIn).toBe(240)
    expect(reversed?.totalPrice).toBe(normal?.totalPrice)
  })

  it('derives the same physical limits from reversed sheet titles', () => {
    expect(deriveVariantBasedLimits(['12 x 22', '24 x 22', '240 x 22'])).toEqual({
      maxWidthIn: 22,
      maxHeightIn: 240,
      minWidthIn: 1,
      minHeightIn: 1,
    })
  })
})
