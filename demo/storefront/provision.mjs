import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  API_VERSION, OWNER_NAMESPACE, OWNER_KEY, assertDemoShop, productInput, assertOwnedProduct,
  collectionInput, appSetupPlan, signature, parseCliResult, assertStagedUrl, normalizePageHtml,
} from './provision-model.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({ options: { shop: { type: 'string' }, apply: { type: 'boolean', default: false }, 'cli-entry': { type: 'string' } } })
assertDemoShop(values.shop)
const inventory = JSON.parse(await readFile(join(directory, 'inventory.json'), 'utf8'))
const pages = JSON.parse(await readFile(join(directory, 'pages.json'), 'utf8')).pages
const cli = values['cli-entry'] || (process.platform === 'win32' && process.env.APPDATA ? join(process.env.APPDATA, 'npm/node_modules/@shopify/cli/bin/run.js') : null)
if (!cli) throw new Error('Provide --cli-entry for the installed official Shopify CLI that supports store execute. No app command is used.')
await stat(cli)

async function execute(query, variables = {}, mutation = false) {
  if (mutation && !values.apply) throw new Error('Mutations require --apply.')
  const args = [cli, 'store', 'execute', '--store', values.shop, '--version', API_VERSION, '--query', query, '--variables', JSON.stringify(variables), '--no-input', '--json']
  if (mutation) args.push('--allow-mutations')
  const output = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHOPIFY_CLI_NO_ANALYTICS: '1' } })
    let stdout = ''
    // Never echo CLI stderr: auth errors may contain sensitive account or request context.
    child.stderr.resume()
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2_000_000) child.kill() })
    const timeout = setTimeout(() => child.kill(), 60_000)
    child.on('error', () => { clearTimeout(timeout); reject(new Error('Official Shopify CLI could not start.')) })
    child.on('close', code => {
      clearTimeout(timeout)
      if (code !== 0) reject(new Error(`Official store execute failed (${code ?? 'timeout'}). Check demo-only stored authorization and API permissions; no automatic mutation retry was attempted.`))
      else accept(stdout)
    })
  })
  const result = parseCliResult(output)
  if (!result || result.errors?.length) throw new Error('Shopify returned GraphQL errors. Stop and inspect the exact demo-only operation; do not retry an unknown mutation blindly.')
  return result.data || result
}

function check(payload, name) {
  if (!payload || payload.userErrors?.length) {
    const codes = payload?.userErrors?.map(error => error.code || error.field?.join('.') || 'validation').join(', ')
    throw new Error(`${name} rejected by Shopify (${codes || 'missing result'}); no record is assumed successful.`)
  }
  return payload
}

const productFields = `id handle title vendor status templateSuffix metafield(namespace: "${OWNER_NAMESPACE}", key: "${OWNER_KEY}") { value } variants(first: 50) { nodes { id title price sku } pageInfo { hasNextPage } } media(first: 10) { nodes { id status alt } }`
const identity = await execute(`query DemoProvisionPreflight($products: String!, $pages: String!, $collection: String!) {
  shop { id myshopifyDomain currencyCode plan { partnerDevelopment } }
  publications(first: 50) { nodes { id channels(first: 10) { nodes { handle } } } pageInfo { hasNextPage } }
  products(first: 50, query: $products) { nodes { ${productFields} } pageInfo { hasNextPage } }
  pages(first: 50, query: $pages) { nodes { id handle title body templateSuffix isPublished } pageInfo { hasNextPage } }
  collections(first: 10, query: $collection) { nodes { id handle title metafield(namespace: "${OWNER_NAMESPACE}", key: "${OWNER_KEY}") { value } products(first: 50) { nodes { id handle } pageInfo { hasNextPage } } } pageInfo { hasNextPage } }
}`, {
  products: inventory.products.map(product => `handle:${product.handle}`).join(' OR '),
  pages: pages.map(page => `handle:${page.handle}`).join(' OR '), collection: `handle:${inventory.collection.handle}`,
})
assertDemoShop(values.shop, identity.shop)
if (['products', 'pages', 'collections', 'publications'].some(key => identity[key].pageInfo.hasNextPage)) throw new Error('Preflight results are truncated; no write was attempted.')
const publications = identity.publications.nodes.filter(publication => publication.channels.nodes.some(channel => channel.handle === 'online_store'))
if (publications.length !== 1) throw new Error('Exactly one verified Online Store publication is required.')
const publicationId = publications[0].id

// Validate every collision before creating anything; this is not an updater.
for (const product of inventory.products) {
  const existing = identity.products.nodes.find(item => item.handle === product.handle)
  if (existing) assertOwnedProduct(existing, product, inventory)
  const image = await stat(resolve(directory, '../assets', product.imageAsset))
  if (!image.isFile() || image.size > 5_000_000) throw new Error(`Missing or oversized demo illustration ${product.imageAsset}.`)
}
for (const page of pages) {
  const existing = identity.pages.nodes.find(item => item.handle === page.handle)
  if (existing && (existing.title !== page.title || normalizePageHtml(existing.body) !== normalizePageHtml(page.bodyHtml) || (existing.templateSuffix || '') !== page.templateSuffix || !existing.isPublished)) {
    throw new Error(`Refusing to overwrite conflicting page ${page.handle}.`)
  }
}
const existingCollection = identity.collections.nodes.find(item => item.handle === inventory.collection.handle)
if (existingCollection && (existingCollection.title !== inventory.collection.title || existingCollection.metafield?.value !== signature(inventory.collection))) {
  throw new Error('Refusing to overwrite a conflicting demo collection.')
}

if (!values.apply) {
  console.log(JSON.stringify({ mode: 'read-only plan', shop: identity.shop, publicationId, createProducts: inventory.products.filter(product => !identity.products.nodes.some(item => item.handle === product.handle)).map(product => product.handle), createPages: pages.filter(page => !identity.pages.nodes.some(item => item.handle === page.handle)).map(page => page.handle), createCollection: !existingCollection, appConfig: 'Actual product IDs are emitted after --apply; app installation and merchant billing approval are separate.' }, null, 2))
  process.exit(0)
}

async function stageImage(product) {
  const bytes = await readFile(resolve(directory, '../assets', product.imageAsset))
  const result = await execute(`mutation DemoStageImage($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`, { input: [{ filename: product.imageAsset, mimeType: 'image/jpeg', fileSize: String(bytes.length), httpMethod: 'POST', resource: 'IMAGE' }] }, true)
  const staged = check(result.stagedUploadsCreate, 'Image staging').stagedTargets[0]
  if (!staged) throw new Error('Shopify returned no image staging target.')
  assertStagedUrl(staged.url)
  assertStagedUrl(staged.resourceUrl)
  const form = new FormData()
  for (const parameter of staged.parameters) form.append(parameter.name, parameter.value)
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), product.imageAsset)
  const response = await fetch(staged.url, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Demo image upload failed with HTTP ${response.status}; signed upload parameters were not logged.`)
  await response.arrayBuffer()
  return staged.resourceUrl
}

async function publish(id) {
  const result = await execute('mutation DemoPublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }', { id, input: [{ publicationId }] }, true)
  check(result.publishablePublish, 'Online Store publication')
}

const products = []
for (const product of inventory.products) {
  let actual = identity.products.nodes.find(item => item.handle === product.handle)
  if (!actual) {
    const source = await stageImage(product)
    const result = await execute(`mutation DemoCreateProduct($input: ProductSetInput!) { productSet(input: $input, synchronous: true) { product { ${productFields} } userErrors { code field message } } }`, { input: productInput(product, inventory, source) }, true)
    actual = check(result.productSet, `Product ${product.handle}`).product
    if (!actual) throw new Error(`Product ${product.handle} has no confirmed ID. Stop and resolve by exact handle before rerunning.`)
    assertOwnedProduct(actual, product, inventory)
  }
  await publish(actual.id)
  products.push(actual)
  console.error(`Confirmed demo product: ${product.handle}`)
}

const createdPages = []
for (const page of pages) {
  let actual = identity.pages.nodes.find(item => item.handle === page.handle)
  if (!actual) {
    const result = await execute('mutation DemoCreatePage($page: PageCreateInput!) { pageCreate(page: $page) { page { id handle title body templateSuffix isPublished } userErrors { code field message } } }', { page: { handle: page.handle, title: page.title, body: page.bodyHtml, templateSuffix: page.templateSuffix, isPublished: true } }, true)
    actual = check(result.pageCreate, `Page ${page.handle}`).page
    if (!actual || actual.handle !== page.handle) throw new Error('Page create did not confirm the expected handle; stop before rerunning.')
  }
  createdPages.push({ id: actual.id, handle: actual.handle })
  console.error(`Confirmed demo page: ${page.handle}`)
}

let collection = existingCollection
if (!collection) {
  const result = await execute('mutation DemoCreateCatalog($collection: CollectionCreateInput!) { collectionCreate(collection: $collection) { collection { id handle title products(first: 50) { nodes { id handle } pageInfo { hasNextPage } } } userErrors { field message } } }', { collection: collectionInput(inventory.collection, products) }, true)
  collection = check(result.collectionCreate, 'Demo catalog').collection
  if (!collection || collection.handle !== inventory.collection.handle) throw new Error('Demo catalog did not confirm the expected handle.')
}
const expectedHandles = inventory.collection.productHandles.slice().sort()
if (collection.products.pageInfo.hasNextPage || JSON.stringify(collection.products.nodes.map(product => product.handle).sort()) !== JSON.stringify(expectedHandles)) throw new Error('Demo catalog membership is not exactly the four variant-priced products; stop rather than showing a per-inch rate as a sheet price.')
await publish(collection.id)

console.log(JSON.stringify({ mode: 'applied to dedicated development shop only', at: new Date().toISOString(), apiVersion: API_VERSION, shop: identity.shop, publicationId, products, pages: createdPages, collection: { id: collection.id, handle: collection.handle, productHandles: expectedHandles }, appSetup: appSetupPlan(values.shop, products, inventory), proofLimit: 'Product creation and publication only. This is NOT proof of installed app blocks, measurement, checkout, order webhooks or app billing.' }, null, 2))
