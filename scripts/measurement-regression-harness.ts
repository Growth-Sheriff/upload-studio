import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import type {
  ProductOptionDef,
  ProductVariantDef,
} from '../app/lib/dtfSheetResolver.server'
import type { UploadLifecycleMetadata } from '../app/lib/uploadLifecycle.server'
type JsonRecord = Record<string, unknown>
type SheetTuple = [string, number, number, string, string]

interface SheetProductFixture {
  tenant: string
  shopDomain: string
  productId: string
  title: string
  dimensionMode: 'combined' | 'split'
  sheetOptionName?: string
  widthOptionName?: string
  heightOptionName?: string
  builderConfig: JsonRecord
  shopSettings?: JsonRecord
  sheets: SheetTuple[]
}

interface LinearProductFixture {
  tenant: string
  shopDomain: string
  productId: string
  title: string
  pricingMode: 'measured_length'
  pricePerInch: number
  builderConfig: JsonRecord
  shopSettings?: JsonRecord
  volumeTiers: Array<[number, number | null, number]>
  carrier: {
    variantId: string
    title: string
    price: string
  }
}

interface CaseFixture {
  caseId: string
  uploadId: string
  productKey: string
  quantity: number
  storedQuantity?: number
  quantitySource?: string
  measurementBasis: 'full_page' | 'artwork_bounds'
  measurementPolicy?: string | null
  rollWidthIn?: number | null
  metadata: JsonRecord
  expectedClassification: 'same' | 'intended_fix' | 'approved_correction' | 'regression'
  expectedChangedFields: OutputField[]
  expected?: {
    previous: Partial<VersionOutput>
    current: Partial<VersionOutput>
  }
  explanation: string
}

interface FixtureFile {
  schemaVersion: number
  capturedAt: string
  baselineCommit: string
  evidence: JsonRecord
  products: Record<string, SheetProductFixture | LinearProductFixture>
  cases: CaseFixture[]
}

interface VersionOutput {
  widthIn: number | null
  heightIn: number | null
  effectiveDpi: number | null
  chosenVariant: string | null
  designsPerSheet: number | null
  sheetsNeeded: number | null
  finalPrice: number | null
  billableLengthIn: number | null
  pricePerInch: number | null
  chosenTier: string | null
  placementMode: string | null
  rotationApplied: boolean | null
  productionNote: string | null
}

const OUTPUT_FIELDS = [
  'widthIn',
  'heightIn',
  'effectiveDpi',
  'chosenVariant',
  'designsPerSheet',
  'sheetsNeeded',
  'finalPrice',
  'billableLengthIn',
  'pricePerInch',
  'chosenTier',
  'placementMode',
  'rotationApplied',
  'productionNote',
] as const
type OutputField = (typeof OUTPUT_FIELDS)[number]

interface SheetResolutionModule {
  resolveForMetadata: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

interface UploadLifecycleModule {
  deriveUploadItemLifecycle: (item: {
    preflightStatus: string
    preflightResult: unknown
  }) => { metadata: UploadLifecycleMetadata | null }
}

interface MainProductMeasurementModule {
  getMainProductRollWidth: (value: unknown) => number
  resolveServerMainProductRollWidth?: (builderConfig: JsonRecord | null | undefined) => number
}

interface LegacyCustomerPricingModule {
  calculateMeasuredLengthQuote: (
    measurement: UploadLifecycleMetadata,
    pricePerInch: number
  ) => { billableLengthIn: number; pricePerInch: number; totalPrice: number }
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const fixturePath = resolve(scriptDir, 'measurement-regression-fixtures.json')
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureFile
if (fixtures.schemaVersion !== 2) {
  throw new Error(`Unsupported fixture schema ${fixtures.schemaVersion}; expected 2`)
}
const nativeRequire = createRequire(import.meta.url)

type SourceReader = (path: string) => string

function normalizeModulePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function createTypeScriptModuleLoader(input: {
  readSource: SourceReader
  overrides?: Record<string, unknown>
}) {
  const cache = new Map<string, { exports: unknown }>()

  function resolveLocalModule(specifier: string, parentPath: string): string | null {
    const base = specifier.startsWith('~/')
      ? `app/${specifier.slice(2)}`
      : specifier.startsWith('.')
        ? posix.normalize(posix.join(posix.dirname(parentPath), specifier))
        : null
    if (!base) return null

    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
      .map(normalizeModulePath)
    for (const candidate of candidates) {
      try {
        input.readSource(candidate)
        return candidate
      } catch {
        // Try the next TypeScript resolution candidate.
      }
    }
    throw new Error(`Cannot resolve ${specifier} from ${parentPath}`)
  }

  function load<T>(path: string): T {
    const normalizedPath = normalizeModulePath(path)
    const cached = cache.get(normalizedPath)
    if (cached) return cached.exports as T

    const source = input.readSource(normalizedPath)
    const transpiled = ts.transpileModule(source, {
      fileName: normalizedPath,
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
    const module = { exports: {} as unknown }
    cache.set(normalizedPath, module)
    const localRequire = (specifier: string) => {
      if (Object.prototype.hasOwnProperty.call(input.overrides || {}, specifier)) {
        return input.overrides?.[specifier]
      }
      const localPath = resolveLocalModule(specifier, normalizedPath)
      return localPath ? load(localPath) : nativeRequire(specifier)
    }
    const evaluate = new Function(
      'module',
      'exports',
      'require',
      '__filename',
      '__dirname',
      transpiled
    )
    evaluate(module, module.exports, localRequire, normalizedPath, posix.dirname(normalizedPath))
    return module.exports as T
  }

  return {
    load,
    loadedPaths: () => Array.from(cache.keys()).sort(),
  }
}

function isLinearProduct(
  product: SheetProductFixture | LinearProductFixture
): product is LinearProductFixture {
  return 'pricingMode' in product && product.pricingMode === 'measured_length'
}

function buildProductMatrix(product: SheetProductFixture): {
  optionDefs: ProductOptionDef[]
  variants: ProductVariantDef[]
} {
  if (product.dimensionMode === 'combined') {
    const optionName = product.sheetOptionName || 'Size'
    return {
      optionDefs: [{ name: optionName, values: product.sheets.map((sheet) => sheet[3]) }],
      variants: product.sheets.map(([id, , , title, price]) => ({
        id,
        title,
        price,
        available: true,
        availableForSale: true,
        option1: title,
        options: [title],
        selectedOptions: [{ name: optionName, value: title }],
      })),
    }
  }

  const widthName = product.widthOptionName || 'Width'
  const heightName = product.heightOptionName || 'Height'
  const widthValue = (width: number) => `${width}\"`
  const heightValue = (height: number) => `${height}\"`
  return {
    optionDefs: [
      { name: widthName, values: [...new Set(product.sheets.map((sheet) => widthValue(sheet[1])))] },
      { name: heightName, values: product.sheets.map((sheet) => heightValue(sheet[2])) },
    ],
    variants: product.sheets.map(([id, width, height, title, price]) => ({
      id,
      title,
      price,
      available: true,
      availableForSale: true,
      option1: widthValue(width),
      option2: heightValue(height),
      options: [widthValue(width), heightValue(height)],
      selectedOptions: [
        { name: widthName, value: widthValue(width) },
        { name: heightName, value: heightValue(height) },
      ],
    })),
  }
}

function buildLinearProductMatrix(product: LinearProductFixture): {
  optionDefs: ProductOptionDef[]
  variants: ProductVariantDef[]
} {
  return {
    optionDefs: [{ name: 'Size', values: [product.carrier.title] }],
    variants: [
      {
        id: product.carrier.variantId,
        title: product.carrier.title,
        price: product.carrier.price,
        available: true,
        availableForSale: true,
        option1: product.carrier.title,
        options: [product.carrier.title],
        selectedOptions: [{ name: 'Size', value: product.carrier.title }],
      },
    ],
  }
}

function buildGraphqlProduct(product: SheetProductFixture | LinearProductFixture) {
  const matrix = isLinearProduct(product) ? buildLinearProductMatrix(product) : buildProductMatrix(product)
  return {
    id: product.productId,
    title: product.title,
    options: matrix.optionDefs,
    variants: {
      edges: matrix.variants.map((variant) => ({
        node: {
          id: `gid://shopify/ProductVariant/${variant.id}`,
          legacyResourceId: variant.id,
          title: variant.title,
          price: String(variant.price ?? '0'),
          availableForSale: variant.availableForSale !== false,
          selectedOptions: variant.selectedOptions || [],
        },
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  }
}

const productsById = new Map<string, SheetProductFixture | LinearProductFixture>()
for (const product of Object.values(fixtures.products)) {
  productsById.set(product.productId, product)
  productsById.set(product.productId.split('/').pop() || product.productId, product)
}

async function fixtureShopifyGraphql(
  _shopDomain: string,
  _accessToken: string,
  _query: string,
  variables: Record<string, unknown>
) {
  const requested = String(variables?.id || '')
  const product = productsById.get(requested) || productsById.get(requested.split('/').pop() || '')
  return { product: product ? buildGraphqlProduct(product) : null }
}

function memoizeSourceReader(reader: SourceReader): SourceReader {
  const found = new Map<string, string>()
  const missing = new Set<string>()
  return (path) => {
    if (found.has(path)) return found.get(path) as string
    if (missing.has(path)) throw new Error(`Missing source: ${path}`)
    try {
      const source = reader(path)
      found.set(path, source)
      return source
    } catch (error) {
      missing.add(path)
      throw error
    }
  }
}

const previousSource = memoizeSourceReader((path) =>
  execFileSync('git', ['show', `${fixtures.baselineCommit}:${path}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
)
const currentSource = memoizeSourceReader((path) =>
  readFileSync(resolve(repoRoot, ...normalizeModulePath(path).split('/')), 'utf8')
)
const loaderOverrides = {
  '~/lib/shopify.server': { shopifyGraphQL: fixtureShopifyGraphql },
}
const previousLoader = createTypeScriptModuleLoader({
  readSource: previousSource,
  overrides: loaderOverrides,
})
const currentLoader = createTypeScriptModuleLoader({
  readSource: currentSource,
  overrides: loaderOverrides,
})
const previousSheetResolution = previousLoader.load<SheetResolutionModule>(
  'app/lib/sheetResolution.server.ts'
)
const currentSheetResolution = currentLoader.load<SheetResolutionModule>(
  'app/lib/sheetResolution.server.ts'
)
const previousUploadLifecycle = previousLoader.load<UploadLifecycleModule>(
  'app/lib/uploadLifecycle.server.ts'
)
const currentUploadLifecycle = currentLoader.load<UploadLifecycleModule>(
  'app/lib/uploadLifecycle.server.ts'
)
const previousMainProductMeasurement = previousLoader.load<MainProductMeasurementModule>(
  'app/lib/mainProductMeasurement.server.ts'
)
const currentMainProductMeasurement = currentLoader.load<MainProductMeasurementModule>(
  'app/lib/mainProductMeasurement.server.ts'
)
const previousCustomerPricing = previousLoader.load<LegacyCustomerPricingModule>(
  'app/lib/customerPricing.server.ts'
)
const currentCustomerPricing = currentLoader.load<{
  calculateMeasuredLengthQuote: (
    measurement: UploadLifecycleMetadata,
    pricePerInch: number,
    requestedQuantity?: number
  ) => { billableLengthIn: number; pricePerInch: number; totalPrice: number; sheetsNeeded?: number }
}>('app/lib/customerPricing.server.ts')

interface ResolvedVersion {
  dimensions: UploadLifecycleMetadata
  resolution: JsonRecord | null
}

async function resolveVersion(
  version: 'previous' | 'current',
  module: SheetResolutionModule,
  lifecycleModule: UploadLifecycleModule,
  product: SheetProductFixture | LinearProductFixture,
  testCase: CaseFixture
): Promise<ResolvedVersion> {
  const requestedMeasurementPolicy = testCase.measurementPolicy ?? 'main_product_roll_width'
  let rollWidthIn = testCase.rollWidthIn ?? 22
  let maxUploadWidth: number | null = rollWidthIn
  if (version === 'previous') {
    rollWidthIn = previousMainProductMeasurement.getMainProductRollWidth(rollWidthIn)
  } else if (currentMainProductMeasurement.resolveServerMainProductRollWidth) {
    rollWidthIn = currentMainProductMeasurement.resolveServerMainProductRollWidth(
      product.builderConfig
    )
    maxUploadWidth = rollWidthIn
  }
  // Both real resolve-product routes normalize the stored preflight payload
  // through their own revision's lifecycle parser before sheet resolution.
  // Comparing raw fixture JSON directly would invent DPI differences that no
  // customer-facing route actually observed.
  const lifecycle = lifecycleModule.deriveUploadItemLifecycle({
    preflightStatus: 'ok',
    preflightResult: { metadata: testCase.metadata },
  })
  if (!lifecycle.metadata) {
    throw new Error(`${testCase.caseId}: lifecycle metadata is missing`)
  }

  const result = await module.resolveForMetadata({
    shopDomain: product.shopDomain,
    shop: {
      id: `fixture-${product.tenant}`,
      accessToken: 'fixture-read-only',
      settings: product.shopSettings || {},
    },
    productIdRaw: product.productId,
    builderConfig: product.builderConfig,
    rawMetadata: lifecycle.metadata,
    quantity: testCase.quantity,
    selectedVariantId: null,
    measurementPolicy: requestedMeasurementPolicy,
    measurementBasis: testCase.measurementBasis,
    rollWidthIn,
    maxUploadWidth,
  })
  const kind = String(result.kind || '')
  if (kind === 'not_ready' || kind === 'product_not_found') {
    throw new Error(`${testCase.caseId}: ${kind}`)
  }
  const dimensions = result.dimensions as UploadLifecycleMetadata | undefined
  if (!dimensions) throw new Error(`${testCase.caseId}: resolved dimensions are missing`)
  return {
    dimensions,
    resolution: kind === 'ok' && result.resolution && typeof result.resolution === 'object'
      ? (result.resolution as JsonRecord)
      : null,
  }
}

function dollars(value: number): number {
  return Number(value.toFixed(2))
}

function selectedRetailTotal(
  resolution: JsonRecord | null,
  variants: ProductVariantDef[]
): number | null {
  if (!resolution) return null
  const variant = variants.find(
    (candidate) => String(candidate.id) === String(resolution.selectedVariantId || '')
  )
  if (!variant) throw new Error(`Selected variant ${resolution.selectedVariantId} is absent from fixture`)
  return dollars(Number(variant.price) * Number(resolution.sheetsNeeded || 0))
}

function sheetOutput(
  measurement: UploadLifecycleMetadata,
  resolution: JsonRecord | null,
  variants: ProductVariantDef[]
): VersionOutput {
  return {
    widthIn: measurement.widthIn,
    heightIn: measurement.heightIn,
    effectiveDpi: measurement.effectiveDpi,
    chosenVariant: resolution ? String(resolution.selectedVariantTitle || '') || null : null,
    designsPerSheet: resolution ? Number(resolution.designsPerSheet) || null : null,
    sheetsNeeded: resolution ? Number(resolution.sheetsNeeded) || null : null,
    finalPrice: selectedRetailTotal(resolution, variants),
    billableLengthIn: null,
    pricePerInch: null,
    chosenTier: null,
    placementMode: resolution ? String(resolution.placementMode || '') || null : null,
    rotationApplied:
      resolution && typeof resolution.rotationApplied === 'boolean'
        ? resolution.rotationApplied
        : null,
    productionNote: resolution ? String(resolution.productionNote || '') || null : null,
  }
}

function resolveVolumeTier(product: LinearProductFixture, billableLengthIn: number) {
  const tuple =
    product.volumeTiers.find(
      ([min, max]) => billableLengthIn >= min && (max == null || billableLengthIn <= max)
    ) || product.volumeTiers[0]
  if (!tuple) {
    return { rate: product.pricePerInch, label: `base @ $${product.pricePerInch.toFixed(2)}` }
  }
  const [min, max, rate] = tuple
  return {
    rate,
    label: `${min}-${max == null ? '∞' : max} @ $${rate.toFixed(2)}`,
  }
}

function linearOutput(
  version: 'previous' | 'current',
  product: LinearProductFixture,
  measurement: UploadLifecycleMetadata,
  resolution: JsonRecord | null,
  quantity: number
): VersionOutput {
  const expectedBillableLength = Number(
    (Math.max(measurement.widthIn, measurement.heightIn) * quantity).toFixed(2)
  )
  const tier = resolveVolumeTier(product, expectedBillableLength)
  if (version === 'previous') {
    const quote = previousCustomerPricing.calculateMeasuredLengthQuote(
      measurement,
      tier.rate
    )
    // d8470f5 applied quantity in the authoritative checkout caller immediately
    // after this helper returned. Model that caller as well as the helper; a
    // helper-only comparison would invent a historical undercharge that did
    // not occur on api.vip.quote/api.vip.checkout.
    const billableLength = Number((quote.billableLengthIn * quantity).toFixed(2))
    const finalPrice = dollars(billableLength * quote.pricePerInch)
    return {
      widthIn: measurement.widthIn,
      heightIn: measurement.heightIn,
      effectiveDpi: measurement.effectiveDpi,
      chosenVariant: resolution ? String(resolution.selectedVariantTitle || product.carrier.title) : null,
      designsPerSheet: resolution ? Number(resolution.designsPerSheet) || null : null,
      // This field deliberately comes from resolve-product. d8470f5 exposed
      // integer Shopify carrier inches here; current code exposes physical copies.
      sheetsNeeded: resolution ? Number(resolution.sheetsNeeded) || null : null,
      finalPrice,
      billableLengthIn: billableLength,
      pricePerInch: quote.pricePerInch,
      chosenTier: tier.label,
      placementMode: resolution ? String(resolution.placementMode || '') || null : null,
      rotationApplied:
        resolution && typeof resolution.rotationApplied === 'boolean'
          ? resolution.rotationApplied
          : null,
      productionNote: resolution ? String(resolution.productionNote || '') || null : null,
    }
  }

  const quote = currentCustomerPricing.calculateMeasuredLengthQuote(
    measurement,
    tier.rate,
    quantity
  )
  return {
    widthIn: measurement.widthIn,
    heightIn: measurement.heightIn,
    effectiveDpi: measurement.effectiveDpi,
    chosenVariant: resolution ? String(resolution.selectedVariantTitle || product.carrier.title) : null,
    designsPerSheet: resolution ? Number(resolution.designsPerSheet) || null : null,
    sheetsNeeded: resolution ? Number(resolution.sheetsNeeded) || null : quote.sheetsNeeded || null,
    finalPrice: quote.totalPrice,
    billableLengthIn: quote.billableLengthIn,
    pricePerInch: quote.pricePerInch,
    chosenTier: tier.label,
    placementMode: resolution ? String(resolution.placementMode || '') || null : null,
    rotationApplied:
      resolution && typeof resolution.rotationApplied === 'boolean'
        ? resolution.rotationApplied
        : null,
    productionNote: resolution ? String(resolution.productionNote || '') || null : null,
  }
}

function valuesEqual(left: VersionOutput[OutputField], right: VersionOutput[OutputField]) {
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) < 0.000001
  }
  return left === right
}

function changedFields(previous: VersionOutput, current: VersionOutput): OutputField[] {
  return OUTPUT_FIELDS.filter((field) => !valuesEqual(previous[field], current[field]))
}

function formatValue(field: OutputField, value: VersionOutput[OutputField]): string {
  if (value == null) {
    return ['chosenVariant', 'designsPerSheet', 'sheetsNeeded', 'finalPrice'].includes(field)
      ? 'NO FIT'
      : '—'
  }
  if (field === 'finalPrice') return `$${Number(value).toFixed(2)}`
  if (field === 'pricePerInch') return `$${Number(value).toFixed(4)}`
  if (typeof value === 'number') return Number(value.toFixed(4)).toString()
  return String(value).replaceAll('|', '\\|')
}

function goldenMismatches(
  actual: VersionOutput,
  expected: Partial<VersionOutput> | undefined
): string[] {
  if (!expected) return ['missing expected output']
  const missing = OUTPUT_FIELDS
    .filter((field) => !Object.prototype.hasOwnProperty.call(expected, field))
    .map((field) => `missing:${field}`)
  const mismatched = OUTPUT_FIELDS
    .filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(expected, field) &&
        !valuesEqual(actual[field], expected[field] as VersionOutput[OutputField])
    )
  return [...missing, ...mismatched]
}

const rows = await Promise.all(fixtures.cases.map(async (testCase) => {
  const product = fixtures.products[testCase.productKey]
  if (!product) throw new Error(`${testCase.caseId}: unknown product ${testCase.productKey}`)
  const [previousResolved, currentResolved] = await Promise.all([
    resolveVersion(
      'previous',
      previousSheetResolution,
      previousUploadLifecycle,
      product,
      testCase
    ),
    resolveVersion(
      'current',
      currentSheetResolution,
      currentUploadLifecycle,
      product,
      testCase
    ),
  ])

  let previous: VersionOutput
  let current: VersionOutput
  if (isLinearProduct(product)) {
    previous = linearOutput(
      'previous',
      product,
      previousResolved.dimensions,
      previousResolved.resolution,
      testCase.quantity
    )
    current = linearOutput(
      'current',
      product,
      currentResolved.dimensions,
      currentResolved.resolution,
      testCase.quantity
    )
  } else {
    const { variants } = buildProductMatrix(product)
    previous = sheetOutput(previousResolved.dimensions, previousResolved.resolution, variants)
    current = sheetOutput(currentResolved.dimensions, currentResolved.resolution, variants)
  }

  const actualChangedFields = changedFields(previous, current)
  const expectedFields = [...testCase.expectedChangedFields].sort().join(',')
  const actualFields = [...actualChangedFields].sort().join(',')
  const classificationMatches =
    testCase.expectedClassification === 'same'
      ? actualChangedFields.length === 0
      : actualChangedFields.length > 0
  const previousGoldenMismatches = goldenMismatches(previous, testCase.expected?.previous)
  const currentGoldenMismatches = goldenMismatches(current, testCase.expected?.current)
  const expectationMatches =
    expectedFields === actualFields &&
    classificationMatches &&
    previousGoldenMismatches.length === 0 &&
    currentGoldenMismatches.length === 0
  return {
    testCase,
    product,
    previous,
    current,
    actualChangedFields,
    previousGoldenMismatches,
    currentGoldenMismatches,
    expectationMatches,
  }
}))

const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
}).trim()
const baselineCommit = execFileSync('git', ['rev-parse', fixtures.baselineCommit], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
}).trim()
const relevantSourcePaths = Array.from(
  new Set([
    ...currentLoader.loadedPaths(),
    'package.json',
    'pnpm-lock.yaml',
    'scripts/measurement-regression-fixtures.json',
    'scripts/measurement-regression-harness.ts',
  ])
).sort()
const worktreeHash = createHash('sha256')
for (const path of relevantSourcePaths) {
  worktreeHash.update(path)
  worktreeHash.update('\0')
  worktreeHash.update(readFileSync(resolve(repoRoot, ...path.split('/'))))
  worktreeHash.update('\0')
}
const currentSourceHash = worktreeHash.digest('hex').slice(0, 16)
const relevantStatus = execFileSync('git', ['status', '--porcelain', '--', ...relevantSourcePaths], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
}).trim()
const currentRevision = `${currentCommit}${relevantStatus ? '+working-tree' : ''} source-sha256:${currentSourceHash}`
const unexpectedRows = rows.filter((row) => !row.expectationMatches)
const regressionRows = rows.filter(
  (row) => row.testCase.expectedClassification === 'regression'
)
const failOnRegression = process.argv.includes('--fail-on-regression')

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        fixtureSchemaVersion: fixtures.schemaVersion,
        fixtureCapturedAt: fixtures.capturedAt,
        baselineCommit,
        currentRevision,
        comparisonIntegrity: unexpectedRows.length ? 'fail' : 'pass',
        knownRegressionCount: regressionRows.length,
        releaseGate: regressionRows.length ? 'owner_approval_required' : 'clear',
        rows: rows.map(({ product, ...row }) => ({
          ...row,
          product: { tenant: product.tenant, productId: product.productId, title: product.title },
        })),
      },
      null,
      2
    )
  )
} else {
  console.log('# Measurement regression output')
  console.log('')
  console.log(`Fixture captured: ${fixtures.capturedAt}`)
  console.log(`Previous code: ${baselineCommit}`)
  console.log(`Current code: ${currentRevision}`)
  console.log('Sheet final price is variant retail price × sheets; measured-length final price is this upload\'s tier quote. The per-order fee cap is outside this resolver harness.')
  console.log('Measured-length tier labels come from the captured live tier fixture; this harness does not test customer eligibility, multi-upload aggregation, or the hosted-checkout fee.')
  console.log('For baseline measured-length rows, sheets needed is the resolve-product carrier quantity; the explanation records the separate customer/production copy behavior.')
  console.log(`Comparison integrity: ${unexpectedRows.length ? 'FAIL' : 'PASS'}; known regressions: ${regressionRows.length} (${regressionRows.length ? 'owner approval required' : 'none'}).`)
  console.log('')
  console.log('| Case | Version | widthIn | heightIn | effectiveDpi | chosen variant | designs/sheet | sheets needed | final price |')
  console.log('|---|---|---:|---:|---:|---|---:|---:|---:|')
  for (const row of rows) {
    for (const [version, output] of [
      ['previous', row.previous],
      ['current', row.current],
    ] as const) {
      console.log(
        `| ${row.testCase.caseId} | ${version} | ${formatValue('widthIn', output.widthIn)} | ${formatValue('heightIn', output.heightIn)} | ${formatValue('effectiveDpi', output.effectiveDpi)} | ${formatValue('chosenVariant', output.chosenVariant)} | ${formatValue('designsPerSheet', output.designsPerSheet)} | ${formatValue('sheetsNeeded', output.sheetsNeeded)} | ${formatValue('finalPrice', output.finalPrice)} |`
      )
    }
  }
  console.log('')
  console.log('## Pricing and production details')
  console.log('')
  console.log('| Case | Version | billable inches | rate | tier | placement | rotated | production note |')
  console.log('|---|---|---:|---:|---|---|---|---|')
  for (const row of rows) {
    for (const [version, output] of [
      ['previous', row.previous],
      ['current', row.current],
    ] as const) {
      console.log(
        `| ${row.testCase.caseId} | ${version} | ${formatValue('billableLengthIn', output.billableLengthIn)} | ${formatValue('pricePerInch', output.pricePerInch)} | ${formatValue('chosenTier', output.chosenTier)} | ${formatValue('placementMode', output.placementMode)} | ${formatValue('rotationApplied', output.rotationApplied)} | ${formatValue('productionNote', output.productionNote)} |`
      )
    }
  }
  console.log('')
  console.log('## Difference classification')
  console.log('')
  console.log('| Case | Changed fields | Classification | Explanation | Fixture check |')
  console.log('|---|---|---|---|---|')
  for (const row of rows) {
    const fields = row.actualChangedFields.length ? row.actualChangedFields.join(', ') : 'none'
    const goldenDetails = [
      row.previousGoldenMismatches.length
        ? `previous: ${row.previousGoldenMismatches.join(', ')}`
        : '',
      row.currentGoldenMismatches.length
        ? `current: ${row.currentGoldenMismatches.join(', ')}`
        : '',
    ].filter(Boolean).join('; ')
    console.log(
      `| ${row.testCase.caseId} | ${fields} | ${row.testCase.expectedClassification} | ${row.testCase.explanation.replaceAll('|', '\\|')} | ${row.expectationMatches ? 'PASS' : `UNEXPECTED (${goldenDetails || 'field/classification mismatch'})`} |`
    )
  }
}

if (unexpectedRows.length) {
  process.exitCode = 1
} else if (failOnRegression && regressionRows.length) {
  process.exitCode = 2
}
