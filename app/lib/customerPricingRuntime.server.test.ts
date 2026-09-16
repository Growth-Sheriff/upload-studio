import { describe, expect, it } from 'vitest'
import { trustedCustomerProfileFromQuery } from './customerPricingRuntime.server'

describe('trustedCustomerProfileFromQuery', () => {
  it('reads the GraphQL data object returned by shopifyGraphQL', () => {
    expect(
      trustedCustomerProfileFromQuery('123', {
        customer: {
          id: 'gid://shopify/Customer/123',
          tags: [' VIP ', 'Business'],
          email: ' Buyer@Example.com ',
          displayName: 'Buyer Name',
        },
      })
    ).toEqual({
      customerId: '123',
      tags: ['vip', 'business'],
      email: 'buyer@example.com',
      name: 'Buyer Name',
    })
  })

  it('fails closed when Shopify does not return the customer', () => {
    expect(trustedCustomerProfileFromQuery('123', {})).toBeNull()
  })
})
