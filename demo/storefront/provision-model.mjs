import { createHash } from 'node:crypto'

export const API_VERSION = '2026-10'
export const DEMO_SHOPS = Object.freeze([
  'auto-gang-sheet-demo.myshopify.com',
  'auto-gang-sheet-isolation-two.myshopify.com',
  'auto-gang-sheet-isolation-three.myshopify.com',
])
export const OWNER_NAMESPACE = 'auto_gang_sheet_demo'
export const OWNER_KEY = 'manifest'

export function assertDemoShop(domain, actual) {
  if (!DEMO_SHOPS.includes(domain)) throw new Error('This tool only supports the three dedicated public-app development shops.')
  if (actual && (actual.myshopifyDomain !== domain || actual.plan?.partnerDevelopment !== true || actual.currencyCode !== 'USD')) {
    throw new Error('Verified Shopify domain, development-shop status and USD currency must all match before proceeding.')
  }
}

export function signature(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function ownership(value) {
  return { namespace: OWNER_NAMESPACE, key: OWNER_KEY, type: 'single_line_text_field', value: signature(value) }
}

export function productInput(product, inventory, sourceUrl) {
  const options = product.variants || [{ title: 'Default Title', price: product.defaultVariantPrice, sku: product.sku }]
  const optionName = product.optionName || 'Title'
  return {
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: inventory.vendor,
    productType: product.kind,
    templateSuffix: product.templateSuffix,
    status: 'ACTIVE',
    tags: ['auto-gang-sheet-demo', 'test-orders-only'],
    metafields: [ownership(product)],
    productOptions: [{ name: optionName, position: 1, values: options.map(variant => ({ name: variant.title })) }],
    variants: options.map(variant => ({
      optionValues: [{ optionName, name: variant.title }],
      price: variant.price,
      taxable: inventory.physicalProductDefaults.taxable,
      inventoryPolicy: 'CONTINUE',
      inventoryItem: { sku: variant.sku, tracked: inventory.physicalProductDefaults.inventoryTracked, requiresShipping: inventory.physicalProductDefaults.requiresShipping },
    })),
    ...(sourceUrl ? { files: [{ originalSource: sourceUrl, filename: product.imageAsset, alt: product.imageAlt, contentType: 'IMAGE' }] } : {}),
  }
}

export function assertOwnedProduct(actual, product, inventory) {
  const expected = productInput(product, inventory)
  const variants = actual.variants.nodes
  if (actual.metafield?.value !== signature(product) || actual.vendor !== inventory.vendor || actual.handle !== product.handle ||
      actual.title !== product.title || actual.templateSuffix !== product.templateSuffix || actual.status !== 'ACTIVE' ||
      actual.variants.pageInfo?.hasNextPage || variants.length !== expected.variants.length ||
      variants.some((variant, index) => variant.title !== expected.productOptions[0].values[index].name ||
        Number(variant.price) !== Number(expected.variants[index].price) || variant.sku !== expected.variants[index].inventoryItem.sku)) {
    throw new Error(`Refusing to overwrite conflicting product ${product.handle}. Inspect the existing demo record explicitly.`)
  }
}

export function collectionInput(collection, products) {
  const ids = collection.productHandles.map(handle => {
    const found = products.find(product => product.handle === handle)
    if (!found?.id) throw new Error(`Catalog product is missing: ${handle}`)
    return found.id
  })
  return {
    title: collection.title,
    handle: collection.handle,
    descriptionHtml: '<p>Finished-sheet examples. Illustrative demo prices; test orders only, no physical fulfillment.</p>',
    sortOrder: 'MANUAL',
    metafields: [ownership(collection)],
    sources: [{ source: { title: collection.title, targetType: 'PRODUCTS', inclusion: { selections: ids.map(productId => ({ productId })) } } }],
  }
}

export function appSetupPlan(domain, products, inventory) {
  assertDemoShop(domain)
  return products.map(product => {
    const record = inventory.products.find(candidate => candidate.handle === product.handle)
    if (!record || !/^gid:\/\/shopify\/Product\/\d+$/.test(product.id)) throw new Error('An actual Shopify product ID is required for app configuration.')
    const settings = record.appConfig.builderConfig
    return {
      shop: domain,
      handle: product.handle,
      method: 'POST',
      route: '/app/setup',
      fields: {
        productId: product.id,
        publicPricingMode: settings.publicPricingMode,
        maxPrintableWidthIn: settings.maxPrintableWidthIn,
        maxPrintableLengthIn: settings.maxPrintableLengthIn,
        fitToleranceIn: settings.fitToleranceIn,
        pricePerInch: settings.pricePerInch || 0,
      },
      advancedConfig: record.appConfig,
    }
  })
}

export function parseCliResult(stdout) {
  // Official store execute emits progress NDJSON before its final pretty-printed JSON.
  const lines = stdout.split(/\r?\n/).filter(line => {
    try { return JSON.parse(line).type !== 'progress' } catch { return true }
  })
  return JSON.parse(lines.join('\n').trim())
}

export function normalizePageHtml(value) {
  // Shopify serializes HTML with quoted attributes and newlines between list items.
  // Preserve visible text and all attribute values; ignore only that round-trip formatting.
  return value.trim().replace(/>\s+</g, '><').replace(/(\s[\w:-]+)='([^']*)'/g, '$1="$2"')
}

export function assertStagedUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !(
    url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com') ||
    url.hostname === 'shopify-staged-uploads.storage.googleapis.com' || url.hostname.endsWith('.shopify.com') ||
    url.hostname.endsWith('.shopifycdn.com') || url.hostname.endsWith('.amazonaws.com')
  )) throw new Error('Shopify returned an unexpected staged-upload destination; no file was sent.')
  return url
}
