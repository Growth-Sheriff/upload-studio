import { describe, expect, it } from 'vitest'
import { getCorsHeaders } from './cors.server'

describe('storefront CORS', () => {
  it('allows an exact Shopify storefront origin', () => {
    const headers = getCorsHeaders(
      new Request('https://app.example/api', {
        headers: { Origin: 'https://merchant.myshopify.com' },
      })
    ) as Record<string, string>
    expect(headers['Access-Control-Allow-Origin']).toBe('https://merchant.myshopify.com')
  })

  it('does not reflect an arbitrary HTTPS origin or suffix spoof', () => {
    for (const origin of [
      'https://evil.example',
      'https://merchant.myshopify.com.evil.example',
    ]) {
      const headers = getCorsHeaders(
        new Request('https://app.example/api', { headers: { Origin: origin } })
      ) as Record<string, string>
      expect(headers['Access-Control-Allow-Origin']).toBe('')
    }
  })
})
