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
    const rateFormatter = source.match(/    function formatRateValue[\s\S]*?\n    }\n/)?.[0]
    const headline = source.match(/    function getPriceHeadlineText[\s\S]*?\n    }\n/)?.[0]
    expect(money).toBeTruthy()
    expect(rateFormatter).toBeTruthy()
    expect(headline).toBeTruthy()
    const render = vm.runInNewContext(`${money}\n${rateFormatter}\n${headline}\ngetPriceHeadlineText`, { Intl }) as (
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

  it('preserves fractional-cent unit rates without changing currency-rounded totals', () => {
    for (const [file, rateName, moneyName, indent, locale] of [
      ['custom-price-upload-mod2.js', 'formatRateValue', 'formatMoneyValue', '    ', 'en-US'],
      ['main-product-upload-pro.js', 'formatRate', 'formatMoney', '  ', undefined],
      ['dtf-uv-gang-sheet-upload.js', 'formatRate', 'formatMoney', '  ', 'en-US'],
      ['main-product-upload-app.js', 'formatRate', 'formatMoney', '  ', 'en-US'],
    ] as const) {
      const source = readFileSync(`extensions/theme-extension/assets/${file}`, 'utf8')
      const rateSource = source.match(new RegExp(`${indent}function ${rateName}[\\s\\S]*?\\n${indent}}\\n`))?.[0]
      const moneySource = source.match(new RegExp(`${indent}function ${moneyName}[\\s\\S]*?\\n${indent}}\\n`))?.[0]
      expect(rateSource, file).toBeTruthy()
      expect(moneySource, file).toBeTruthy()
      const rate = vm.runInNewContext(`${rateSource}\n${rateName}`, { Intl }) as (value: number, currency: string) => string
      const money = vm.runInNewContext(`${moneySource}\n${moneyName}`, { Intl }) as (value: number, currency: string) => string
      const precise = (value: number, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 20 }).format(value)
      expect(rate(0.285, 'USD'), file).toBe(precise(0.285, 'USD'))
      expect(rate(0.000025, 'USD'), file).toBe(precise(0.000025, 'USD'))
      expect(rate(0.30, 'USD'), file).toBe(new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(0.30))
      expect(rate(0.285, 'JPY'), file).toBe(precise(0.285, 'JPY'))
      expect(rate(30, 'JPY'), file).toBe(new Intl.NumberFormat(locale, { style: 'currency', currency: 'JPY' }).format(30))
      expect(money(22.80, 'USD'), file).toBe(new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(22.80))
      expect(money(0.285, 'USD'), file).toBe(new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(0.285))
    }
  })

  it('renders the Pro preview hooks required by the shared finished-sheet renderer', () => {
    const source = readFileSync('extensions/theme-extension/assets/main-product-upload-pro.js', 'utf8')
    const escape = source.match(/  function escapeAttr[\s\S]*?\n  }\n/)?.[0]
    const markup = source.match(/  function ensureMarkup[\s\S]*?\n  }\n/)?.[0]
    expect(escape).toBeTruthy()
    expect(markup).toBeTruthy()
    const render = vm.runInNewContext(`${escape}\n${markup}\nensureMarkup`) as (root: unknown) => void
    const attributes = new Map<string, string>()
    const root = {
      innerHTML: '',
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    }
    render(root)
    const variant = readFileSync('extensions/theme-extension/blocks/main-product-upload-app.liquid', 'utf8')
    for (const hook of ['sheet-plane', 'art', 'art-label', 'art-dim-w', 'art-dim-h', 'sheet-cut']) {
      expect(root.innerHTML, `Pro data-ump-${hook}`).toContain(`data-ump-${hook}`)
      expect(variant, `variant data-ump-${hook}`).toContain(`data-ump-${hook}`)
    }
    // The shared stylesheet hides this placeholder only once a tile is drawn.
    expect(root.innerHTML).toContain('class="ump__art-empty" data-ump-art-label')
    expect(root.innerHTML).toContain('data-ump-art-dim-w hidden')
    expect(root.innerHTML).toContain('data-ump-art-dim-h hidden')
    expect(root.innerHTML).toContain('data-ump-sheet-cut hidden')
  })
})
