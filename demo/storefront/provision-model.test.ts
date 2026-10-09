import { describe, expect, it } from 'vitest'
import inventory from './inventory.json'
import { assertDemoShop, productInput, assertOwnedProduct, collectionInput, appSetupPlan, ownership, parseCliResult, assertStagedUrl, normalizePageHtml } from './provision-model.mjs'

describe('dedicated review-demo provisioning', () => {
  it('refuses existing shops and a non-development or non-USD target', () => {
    expect(() => assertDemoShop('gang-sheet-editor-dev.myshopify.com')).toThrow()
    expect(() => assertDemoShop('auto-gang-sheet-demo.myshopify.com', { myshopifyDomain: 'auto-gang-sheet-demo.myshopify.com', currencyCode: 'USD', plan: { partnerDevelopment: false } })).toThrow()
    expect(() => assertDemoShop('auto-gang-sheet-demo.myshopify.com', { myshopifyDomain: 'auto-gang-sheet-demo.myshopify.com', currencyCode: 'EUR', plan: { partnerDevelopment: true } })).toThrow()
  })

  it('keeps variant prices and the measured rate separate without an inch-carrier or layout product', () => {
    const variant = productInput(inventory.products[0], inventory)
    expect(variant.variants.map(item => item.price)).toEqual(['6.00', '12.00', '18.00', '30.00', '40.00', '60.00', '120.00'])
    const measured = productInput(inventory.products[1], inventory)
    expect(measured.productOptions).toEqual([{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }])
    expect(measured.variants).toHaveLength(1)
    expect(measured.variants[0].price).toBe('0.30')
    expect(appSetupPlan('auto-gang-sheet-demo.myshopify.com', [{ id: 'gid://shopify/Product/1', handle: inventory.products[1].handle }], inventory)[0].fields).toMatchObject({ publicPricingMode: 'measured_length', pricePerInch: 0.3, maxPrintableWidthIn: 22.5, maxPrintableLengthIn: 240, fitToleranceIn: 0.02 })
  })

  it('does not overwrite changed prices and keeps measured products out of catalog cards', () => {
    const product = inventory.products[0]
    const input = productInput(product, inventory)
    const actual = { ...input, metafield: ownership(product), variants: { nodes: product.variants.map((variant, index) => ({ ...variant, id: String(index) })), pageInfo: { hasNextPage: false } } }
    expect(() => assertOwnedProduct(actual, product, inventory)).not.toThrow()
    actual.variants.nodes[0].price = '0.01'
    expect(() => assertOwnedProduct(actual, product, inventory)).toThrow('Refusing to overwrite')
    const products = inventory.products.map((item, index) => ({ handle: item.handle, id: `gid://shopify/Product/${index + 1}` }))
    expect(collectionInput(inventory.collection, products).sources[0].source.inclusion.selections.map(item => item.productId)).toEqual(['gid://shopify/Product/1', 'gid://shopify/Product/4', 'gid://shopify/Product/5', 'gid://shopify/Product/6'])
  })

  it('parses the official CLI progress envelope and rejects unrelated upload destinations', () => {
    expect(parseCliResult('{"type":"progress","status":"started"}\n{\n "shop": { "id": "1" }\n}\n')).toEqual({ shop: { id: '1' } })
    expect(() => assertStagedUrl('https://evil.example/file')).toThrow()
    expect(() => assertStagedUrl('http://storage.googleapis.com/file')).toThrow()
    expect(() => assertStagedUrl('https://private:secret@storage.googleapis.com/file')).toThrow()
    expect(normalizePageHtml('<ul>\n<li><a href="/safe">Sheet</a></li>\n</ul>')).toBe(normalizePageHtml("<ul><li><a href='/safe'>Sheet</a></li></ul>"))
    expect(normalizePageHtml('<p>Whole sheets</p>')).not.toBe(normalizePageHtml('<p>Nested logos</p>'))
  })
})
