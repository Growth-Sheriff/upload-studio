import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('merchant storefront proxy configuration', () => {
  it('accepts a renamed local app proxy but never sends file/account data to an external URL', () => {
    const liquid = readFileSync('extensions/theme-extension/snippets/app-proxy-config.liquid', 'utf8')
    const code = liquid.split('<script>')[1].split('</script>')[0].replace('{{ ul_proxy_path | json }}', '"/apps/my-print-shop"')
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
})
