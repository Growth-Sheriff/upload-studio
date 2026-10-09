import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('merchant storefront proxy configuration', () => {
  it('accepts a renamed local app proxy but never sends file/account data to an external URL', () => {
    const liquid = readFileSync('extensions/theme-extension/snippets/app-proxy-config.liquid', 'utf8')
    const code = liquid.split('<script>')[1].split('</script>')[0].replace('{{ ul_proxy_path | json }}', '"/apps/my-print-shop"')
      .replace('{{ shop.currency | json }}', '"CAD"')
    const window: { UL_API_BASE?: string; ULResolveProxyBase?: (value: string) => string } = {}
    vm.runInNewContext(code, { window })
    expect(window.UL_API_BASE).toBe('/apps/my-print-shop')
    expect(window.ULResolveProxyBase?.('/apps/my-print-shop/')).toBe('/apps/my-print-shop')
    expect(window.ULResolveProxyBase?.('https://elsewhere.example/files')).toBe('/apps/customizer')
    expect(window.ULResolveProxyBase?.('//elsewhere.example/files')).toBe('/apps/customizer')
    expect(window.ULResolveProxyBase?.('/apps/name/../other')).toBe('/apps/customizer')
  })

  it('offers the proxy field on every upload block and the cart embed, with valid JSON schemas and no synthetic reviews', () => {
    for (const file of readdirSync('extensions/theme-extension/blocks').filter(file => file.endsWith('.liquid'))) {
      const source = readFileSync(`extensions/theme-extension/blocks/${file}`, 'utf8')
      const schema = JSON.parse(source.split('{% schema %}')[1].split('{% endschema %}')[0])
      expect(source, file).not.toMatch(/modulo: 200|fake_reviews_count|show_reviews/)
      if (source.includes('/api/') || source.includes('data-api-base') || ['dtf-transfer.liquid', 'cart-upload-display.liquid'].includes(file)) {
        expect(schema.settings.some((field: { id: string }) => field.id === 'app_proxy_path'), file).toBe(true)
        expect(source, file).toContain("render 'app-proxy-config'")
      }
    }
  })

  it('never presents the Mod2 unit rate or a stale quote as the payable sheet total', () => {
    const source = readFileSync('extensions/theme-extension/assets/custom-price-upload-mod2.js', 'utf8')
    const money = source.match(/    function formatMoneyValue[\s\S]*?\n    }\n/)?.[0]
    const headline = source.match(/    function getPriceHeadlineText[\s\S]*?\n    }\n/)?.[0]
    expect(money).toBeTruthy()
    expect(headline).toBeTruthy()
    const render = vm.runInNewContext(`${money}\n${headline}\ngetPriceHeadlineText`, { Intl }) as (
      pricing: Record<string, unknown>, customPricingActive: boolean,
    ) => string
    const rate = { source: 'app_proxy', statusKey: 'product_rate', pricePerInch: 0.30, currency: 'USD', quoteStatus: 'idle' }
    expect(render({ source: 'pending' }, false)).toBe('Upload for a measured quote')
    expect(render(rate, true)).toBe('$0.30 / billable inch · quote pending')
    expect(render({ ...rate, quoteStatus: 'loading', quoteTotal: 21.60 }, true)).toBe('$0.30 / billable inch · quote pending')
    expect(render({ ...rate, quoteStatus: 'ready', quoteTotal: 21.60 }, true)).toBe('Total: $21.60')
    expect(render({ ...rate, source: 'fallback', quoteTotal: 21.60 }, false)).toBe('Pricing unavailable · reload to retry')

    const liquid = readFileSync('extensions/theme-extension/blocks/custom-price-upload-mod2.liquid', 'utf8')
    expect(liquid).not.toMatch(/ul-main-(?:product|buybox)-price[^\n]*product\.price/)
    expect(liquid).not.toMatch(/Works with Any Design|In Stock\./)
    const pro = readFileSync('extensions/theme-extension/assets/main-product-upload-pro.js', 'utf8')
    expect(pro).toContain(' per measured inch')
    expect(pro).toContain('Calculating exact quote')
  })
})
