import { describe, expect, it } from 'vitest'
import {
  applyCustomerPricingDefaultsForShop,
  calculateMeasuredLengthQuote,
  calculateVariantLengthQuote,
  DTF_PRINTHOUSE_SHOP_DOMAIN,
  matchesTrustedUploadOwner,
  normalizeCustomerPricingSettings,
  parseSheetSizeFromTitle,
  resolveCustomerPricingContext,
  validateMeasuredFinishedSheetFit,
} from './customerPricing.server'

describe('measured-length finished-sheet fit', () => {
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

  it('multiplies the displayed per-sheet length across 500 complete copies', () => {
    const quote = calculateMeasuredLengthQuote(
      {
        widthPx: 0,
        heightPx: 0,
        measurementWidthPx: 0,
        measurementHeightPx: 0,
        widthIn: 22,
        heightIn: 237.994,
        dpi: 300,
        effectiveDpi: 300,
        sizingSource: 'document_dpi',
        measurementMode: 'full',
      },
      0.2,
      500
    )

    expect(quote.pageLengthIn).toBe(237.99)
    expect(quote.billableLengthIn).toBe(118995)
    expect(quote.sheetsNeeded).toBe(500)
  })

  it('fails closed instead of inventing a per-inch rate', () => {
    const measurement = {
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
    }

    expect(() => calculateMeasuredLengthQuote(measurement, 0, 1)).toThrow(
      'A positive configured price per inch is required'
    )
    expect(() =>
      calculateVariantLengthQuote({
        measurement,
        pricePerInch: Number.NaN,
        variantTitle: '22 x 24',
        sheetsNeeded: 1,
      })
    ).toThrow('A positive configured price per inch is required')
  })

  it('enforces the merchant-entered maximum printable width and length', () => {
    const result = validateMeasuredFinishedSheetFit({
      measurement: { widthIn: 21, heightIn: 24 },
      maxPrintableWidthIn: 20,
      maxPrintableLengthIn: 240,
      fitToleranceIn: 0.02,
    })
    expect(result.ok).toBe(false)
    expect(result.maxPrintableWidthIn).toBe(20)
  })

  it('reports material width overflow with both the measured and configured values', () => {
    const result = validateMeasuredFinishedSheetFit({
      measurement: { widthIn: 24, heightIn: 20.1 },
      maxPrintableWidthIn: 20,
      maxPrintableLengthIn: 240,
      fitToleranceIn: 0.02,
    })
    expect(result.ok).toBe(false)
    expect(result.maxPrintableWidthIn).toBe(20)
    expect(result.placedWidthIn).toBe(20.1)
    expect(result.reason).toBe(
      'Your file is 20.1 inches wide; maximum printable width is 20 inches.'
    )
  })

  it('accepts export-rounding overflow but rejects a materially overlong custom sheet', () => {
    const limits = {
      maxPrintableWidthIn: 22.5,
      maxPrintableLengthIn: 240,
      fitToleranceIn: 0.02,
    }

    expect(
      validateMeasuredFinishedSheetFit({
        measurement: { widthIn: 22.503, heightIn: 240.019 },
        ...limits,
      }).ok
    ).toBe(true)

    const tooLong = validateMeasuredFinishedSheetFit({
      measurement: { widthIn: 22, heightIn: 240.03 },
      ...limits,
    })
    expect(tooLong.ok).toBe(false)
    expect(tooLong.code).toBe('LENGTH_TOO_LARGE')
    expect(tooLong.reason).toContain('240.03')
    expect(tooLong.reason).toContain('240')
  })
})

describe('customer pricing product rules', () => {
  it('leaves new pricing profiles unconfigured instead of inventing a rate', () => {
    const settings = normalizeCustomerPricingSettings({})

    expect(settings.businessPricePerInch).toBe(0)
    expect(settings.statuses).toEqual([])
    expect(applyCustomerPricingDefaultsForShop('new-shop.myshopify.com', {}).businessPricePerInch).toBe(0)
  })

  it('preserves an explicitly stored legacy fallback rate', () => {
    const settings = normalizeCustomerPricingSettings({
      customerPricing: {
        businessPricePerInch: 0.27,
        statuses: [
          {
            id: 'business',
            key: 'business',
            label: 'Business',
            type: 'business',
            productRules: [
              {
                id: 'legacy-rule',
                productId: 'gid://shopify/Product/111',
                pricingMode: 'measured_length',
              },
            ],
          },
        ],
      },
    })

    expect(settings.businessPricePerInch).toBe(0.27)
    expect(settings.statuses[0]?.pricePerInch).toBe(0.27)
    expect(settings.statuses[0]?.productRules[0]?.pricePerInch).toBe(0.27)
  })

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

  it('bills the merchant-authored second dimension as commercial variant length', () => {
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
    expect(reversed?.billableLengthIn).toBe(22)
    expect(reversed?.totalPrice).toBe(4.4)
  })
})
