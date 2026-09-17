import { describe, expect, it } from 'vitest'
import { customerPricingRuleValidationMessage } from './customerPricingValidation'

describe('customerPricingRuleValidationMessage', () => {
  it('rejects an active measured-price rule without a rate', () => {
    expect(
      customerPricingRuleValidationMessage([
        {
          key: 'business',
          label: 'Business',
          type: 'business',
          active: true,
          productRules: [
            {
              productId: 'gid://shopify/Product/1',
              productLabel: 'Gang Sheet',
              active: true,
              pricingMode: 'measured_length',
              pricePerInch: 0,
            },
          ],
        },
      ])
    ).toBe('Business / Gang Sheet needs a price per inch above zero.')
  })

  it('accepts an explicit localized rate and preserves inactive legacy rows', () => {
    expect(
      customerPricingRuleValidationMessage([
        {
          type: 'vip',
          active: true,
          productRules: [
            { active: true, pricingMode: 'variant_length', pricePerInch: '0,27' },
            { active: false, pricingMode: 'measured_length', pricePerInch: 0 },
          ],
        },
      ])
    ).toBeNull()
  })

  it('does not require a rate for a standard-variant carrier', () => {
    expect(
      customerPricingRuleValidationMessage([
        {
          type: 'business',
          active: true,
          productRules: [
            { active: true, pricingMode: 'standard_variant', pricePerInch: 0 },
          ],
        },
      ])
    ).toBeNull()
  })
})
