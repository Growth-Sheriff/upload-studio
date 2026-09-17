// Shared sheet-variant resolution — the single implementation behind
// /api/upload/resolve-product (server-measured uploads) and
// /api/upload/resolve-preview (client-probed dimensions shown before the
// upload finishes). One resolver, two callers: the provisional answer the
// customer sees instantly is computed by exactly the same code that produces
// the authoritative answer after measurement.

import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  getPrintableWidthFailure,
  resolveSheetVariant,
  variantIdsEqual,
  type BuilderResolveConfig,
  type PrintableWidthFailure,
  type ProductOptionDef,
  type ProductVariantDef,
} from '~/lib/dtfSheetResolver.server'
import {
  applyMeasurementBasisMetadata,
  type UploadLifecycleMetadata,
} from '~/lib/uploadLifecycle.server'
import {
  applyMainProductMeasurementPolicy,
  getMainProductRollWidth,
  getMainProductSheetSizes,
  MAIN_PRODUCT_MEASUREMENT_POLICY,
  shouldUseMainProductMeasurementPolicy,
} from '~/lib/mainProductMeasurement.server'
import { applyAlphaProBuilderDefaults, buildAlphaProCustomerOffer } from '~/lib/alphaProDiscounts.server'
import { collectShopifyConnectionPages } from '~/lib/shopifyVariantPagination.server'

const PRODUCT_VARIANTS_QUERY = `
  query ResolveProductVariants($id: ID!, $after: String) {
    product(id: $id) {
      id
      title
      options {
        name
        values
      }
      variants(first: 250, after: $after) {
        edges {
          node {
            id
            legacyResourceId
            title
            price
            availableForSale
            selectedOptions {
              name
              value
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`

interface ProductQueryResponse {
  product: {
    id: string
    title: string
    options: Array<{ name: string; values: string[] }>
    variants: {
      edges: Array<{
        node: {
          id: string
          legacyResourceId?: string | number | null
          title: string
          price: string
          availableForSale: boolean
          selectedOptions: Array<{ name: string; value: string }>
        }
      }>
      pageInfo: {
        hasNextPage: boolean
        endCursor: string | null
      }
    }
  } | null
}

interface ProductResolveData {
  productData: ProductQueryResponse
  optionDefs: ProductOptionDef[]
  variants: ProductVariantDef[]
  cachedAt: number
}

const PRODUCT_RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000
const PRODUCT_RESOLVE_CACHE_MAX_SIZE = 250
const productResolveCache = new Map<string, ProductResolveData>()
const productResolveInFlight = new Map<string, Promise<ProductResolveData>>()

export function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function normalizeProductId(productId: string | number): string {
  const asString = String(productId)
  return asString.startsWith('gid://') ? asString : `gid://shopify/Product/${asString}`
}

export type UploadDimensions = NonNullable<ReturnType<typeof metadataToUploadDimensions>>

export function metadataToUploadDimensions(metadata: UploadLifecycleMetadata | null) {
  if (!metadata || !(metadata.widthPx > 0) || !(metadata.heightPx > 0)) return null

  return {
    widthPx: metadata.widthPx,
    heightPx: metadata.heightPx,
    dpi: metadata.dpi,
    documentDpi: metadata.documentDpi,
    documentDpiSource: metadata.documentDpiSource,
    trimmedWidthPx: metadata.trimmedWidthPx,
    trimmedHeightPx: metadata.trimmedHeightPx,
    trimmedOffsetXPx: metadata.trimmedOffsetXPx,
    trimmedOffsetYPx: metadata.trimmedOffsetYPx,
    measurementWidthPx: metadata.measurementWidthPx,
    measurementHeightPx: metadata.measurementHeightPx,
    effectiveDpi: metadata.effectiveDpi,
    sizingSource: metadata.sizingSource,
    measurementMode: metadata.measurementMode || 'full',
    widthIn: metadata.widthIn,
    heightIn: metadata.heightIn,
  }
}

function isLinearInchBuilderConfig(builderConfig: Record<string, unknown>): boolean {
  const discount = builderConfig.alphaProDiscount
  if (discount && typeof discount === 'object') {
    const raw = discount as Record<string, unknown>
    if (raw.enabled === false) return false
    return String(raw.unit || raw.tierUnit || '').trim() === 'linear_inches'
  }
  if (String(builderConfig.volumeDiscountTierUnit || '').trim() === 'linear_inches') return true
  return false
}

function parseVariantDimensionPair(value: unknown): [number, number] | null {
  const cleaned = String(value || '')
    .replace(/["'\u2032\u2033]/g, '')
    .replace(/\binch(es)?\b/gi, '')
    .trim()
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:x|\u00d7|by)\s*(\d+(?:\.\d+)?)/i)
  if (!match) return null
  const first = Number(match[1])
  const second = Number(match[2])
  return first > 0 && second > 0 ? [first, second] : null
}

function isLinearInchCarrier(variant: ProductVariantDef): boolean {
  const combinedValues = [
    variant.title,
    ...(variant.options || []),
    ...(variant.selectedOptions || []).map((option) => option.value),
  ]
  for (const value of combinedValues) {
    const pair = parseVariantDimensionPair(value)
    if (pair && Math.abs(Math.min(...pair) - 1) <= 0.001 && Math.max(...pair) > 1) {
      return true
    }
  }

  const dimensions = (variant.selectedOptions || [])
    .filter((option) => /width|height|length/i.test(option.name))
    .map((option) => Number(String(option.value).replace(/[^\d.]/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)
  return (
    dimensions.length >= 2 &&
    Math.abs(Math.min(...dimensions) - 1) <= 0.001 &&
    Math.max(...dimensions) > 1
  )
}

function getServiceSelections(variant: ProductVariantDef | null): Array<{ name: string; value: string }> {
  if (!variant) return []
  return (variant.selectedOptions || []).filter((option) => {
    if (parseVariantDimensionPair(option.value)) return false
    const dimensionName = /^(?:size|sheet(?:\s+size)?|width|height|length|dimensions?)$/i.test(
      option.name.trim()
    )
    const numericValue = Number(String(option.value).replace(/[^\d.]/g, ''))
    return !(dimensionName && Number.isFinite(numericValue) && numericValue > 0)
  })
}

function findUnitVariant(
  variants: ProductVariantDef[],
  selectedVariantId?: string | null
): ProductVariantDef | null {
  const availableVariants = variants.filter(
    (variant) => variant.available !== false && variant.availableForSale !== false
  )
  const pool = availableVariants
  if (!pool.length) return null

  // Read service choices from the complete variant list. A saved page-size
  // variant can become unavailable while its matching one-inch carrier is
  // still sellable; dropping the saved finish/material here would silently
  // switch price and service.
  const selected = selectedVariantId
    ? variants.find((variant) => variantIdsEqual(variant.id, selectedVariantId))
    : null
  const selectedAvailable = selected
    ? pool.find((variant) => variantIdsEqual(variant.id, selected.id))
    : null
  if (selectedAvailable && isLinearInchCarrier(selectedAvailable)) return selectedAvailable

  const inchUnits = pool.filter(isLinearInchCarrier)
  if (!inchUnits.length) return null

  const selectedServices = getServiceSelections(selected || null)
  if (selectedServices.length) {
    const matchingServiceUnit = inchUnits.find((variant) => {
      const options = variant.selectedOptions || []
      return selectedServices.every((selection) =>
        options.some(
          (option) =>
            option.name.toLowerCase() === selection.name.toLowerCase() &&
            option.value.toLowerCase() === selection.value.toLowerCase()
        )
      )
    })
    if (matchingServiceUnit) return matchingServiceUnit
    return null
  }

  return inchUnits[0]
}

function normalizeVariantPriceToDollars(rawPrice: string | number | null | undefined): number {
  if (rawPrice == null || rawPrice === '') return 0
  if (typeof rawPrice === 'string') {
    const parsed = Number(rawPrice)
    if (Number.isFinite(parsed)) return parsed
    const asInt = parseInt(rawPrice, 10)
    return Number.isFinite(asInt) ? asInt / 100 : 0
  }
  const numeric = Number(rawPrice)
  return Number.isFinite(numeric) ? numeric / 100 : 0
}

export function resolveLinearInchVariant({
  dimensions,
  quantity,
  variants,
  selectedVariantId,
  printableWidthIn,
}: {
  dimensions: UploadDimensions
  quantity: number
  variants: ProductVariantDef[]
  selectedVariantId?: string | null
  printableWidthIn?: number | null
}) {
  const variant = findUnitVariant(variants, selectedVariantId)
  if (!variant) return null

  const pageWidthIn = Math.min(dimensions.widthIn, dimensions.heightIn)
  const pageLengthIn = Math.max(dimensions.widthIn, dimensions.heightIn)
  const configuredCrossRollWidth = Number(printableWidthIn)
  const usableCrossRollWidth =
    Number.isFinite(configuredCrossRollWidth) && configuredCrossRollWidth > 0
      ? configuredCrossRollWidth
      : null
  if (
    usableCrossRollWidth != null &&
    (usableCrossRollWidth <= 0 || pageWidthIn > usableCrossRollWidth)
  ) {
    return null
  }
  const requestedQuantity = Math.max(1, Math.floor(quantity))
  const billableLengthIn = Number((pageLengthIn * requestedQuantity).toFixed(2))
  const cartQuantity = Math.max(1, Math.ceil(billableLengthIn))
  const unitPrice = normalizeVariantPriceToDollars(variant.price)

  return {
    selectedVariantId: variant.id,
    selectedVariantTitle: variant.title || 'Measured inch unit',
    selectedSheetLabel: `${cartQuantity} billable inches`,
    designsPerSheet: 1,
    // Shopify quantity is an integer-inch billing carrier. It is not a count
    // of physical sheets; production prints one measured sheet per copy.
    sheetsNeeded: requestedQuantity,
    requestedQuantity,
    widthIn: dimensions.widthIn,
    heightIn: dimensions.heightIn,
    pageWidthIn,
    pageLengthIn,
    placedWidthIn: pageWidthIn,
    placedHeightIn: pageLengthIn,
    billableLengthIn,
    cartQuantity,
    pricingMode: 'linear_inches',
    unitPrice,
    pricePerInch: unitPrice,
    estimatedTotal: Number((cartQuantity * unitPrice).toFixed(2)),
  }
}

function mapProductResolveData(productData: ProductQueryResponse): ProductResolveData {
  const product = productData.product
  const optionDefs: ProductOptionDef[] = (product?.options || []).map((option) => ({
    name: option.name || '',
    values: Array.isArray(option.values) ? option.values.map((value) => String(value || '')) : [],
  }))

  const variants: ProductVariantDef[] = (product?.variants.edges || []).map((edge) => {
    const node = edge.node
    const legacyId =
      node.legacyResourceId != null && node.legacyResourceId !== ''
        ? String(node.legacyResourceId)
        : String(node.id || '').split('/').pop() || String(node.id || '')
    return {
      id: legacyId,
      title: node.title || '',
      price: node.price,
      available: node.availableForSale !== false,
      availableForSale: node.availableForSale !== false,
      selectedOptions: Array.isArray(node.selectedOptions)
        ? node.selectedOptions.map((option) => ({
            name: option.name || '',
            value: option.value || '',
          }))
        : [],
      options: Array.isArray(node.selectedOptions)
        ? node.selectedOptions.map((option) => option.value || '')
        : [],
      option1: node.selectedOptions?.[0]?.value || null,
      option2: node.selectedOptions?.[1]?.value || null,
      option3: node.selectedOptions?.[2]?.value || null,
    }
  })

  return { productData, optionDefs, variants, cachedAt: Date.now() }
}

function pruneProductResolveCache(now = Date.now()) {
  for (const [key, value] of productResolveCache) {
    if (now - value.cachedAt > PRODUCT_RESOLVE_CACHE_TTL_MS) productResolveCache.delete(key)
  }
  while (productResolveCache.size > PRODUCT_RESOLVE_CACHE_MAX_SIZE) {
    const oldestKey = productResolveCache.keys().next().value
    if (!oldestKey) break
    productResolveCache.delete(oldestKey)
  }
}

export async function getProductResolveData(
  shopDomain: string,
  accessToken: string,
  productId: string
): Promise<ProductResolveData> {
  const now = Date.now()
  const cacheKey = `${shopDomain}:${productId}`
  const cached = productResolveCache.get(cacheKey)
  if (cached && now - cached.cachedAt <= PRODUCT_RESOLVE_CACHE_TTL_MS && cached.productData.product) {
    return cached
  }
  const inFlight = productResolveInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const request = (async () => {
    const paginated = await collectShopifyConnectionPages({
      fetchPage: (after) =>
        shopifyGraphQL<ProductQueryResponse>(
          shopDomain,
          accessToken,
          PRODUCT_VARIANTS_QUERY,
          { id: productId, after }
        ),
      getConnection: (page) => page.product?.variants,
    })
    const productData =
      paginated.firstPage.product && paginated.connection
        ? {
            ...paginated.firstPage,
            product: {
              ...paginated.firstPage.product,
              variants: paginated.connection,
            },
          }
        : paginated.firstPage
    const mapped = mapProductResolveData(productData)
    if (productData.product) {
      productResolveCache.set(cacheKey, mapped)
      pruneProductResolveCache(now)
    }
    return mapped
  })()
  productResolveInFlight.set(cacheKey, request)
  try {
    return await request
  } finally {
    productResolveInFlight.delete(cacheKey)
  }
}

export interface ResolveForMetadataInput {
  shopDomain: string
  shop: { id: string; accessToken: string; settings: unknown }
  productIdRaw: string | number
  builderConfig: Record<string, unknown> | null
  rawMetadata: UploadLifecycleMetadata | null
  quantity: number
  selectedVariantId: string | null
  /** Manual/reorder surfaces choose a commercial variant themselves. When
   * true, fit is validated against that exact variant instead of silently
   * substituting a different one. */
  lockSelectedVariant?: boolean
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
  measurementPolicy?: string | null
  measurementBasis?: 'full_page' | 'artwork_bounds' | null
  rollWidthIn?: number | string | null
}

export type EffectiveResolveConfig = BuilderResolveConfig & {
  rollWidthIn: number
  pricingMode?: string
  volumeDiscountTierUnit?: string
}

export type ResolveForMetadataResult =
  | { kind: 'product_not_found' }
  | { kind: 'not_ready' }
  | {
      kind: 'no_fit'
      dimensions: UploadDimensions
      canonicalMetadata: UploadLifecycleMetadata
      config: EffectiveResolveConfig
      failure: PrintableWidthFailure | null
    }
  | {
      kind: 'ok'
      dimensions: UploadDimensions
      canonicalMetadata: UploadLifecycleMetadata
      resolution: Record<string, unknown>
      config: EffectiveResolveConfig
      pricingMode: 'sheet' | 'linear_inches'
    }

/** Apply the shop/product measurement policy and resolve the sheet variant.
 *  Identical math for server-measured and client-probed metadata. */
export async function resolveForMetadata(input: ResolveForMetadataInput): Promise<ResolveForMetadataResult> {
  const { shopDomain, shop } = input
  const productId = normalizeProductId(input.productIdRaw)
  const productResolveData = await getProductResolveData(shopDomain, shop.accessToken, productId)
  if (!productResolveData.productData.product) return { kind: 'product_not_found' }

  const baseBuilderConfig = (input.builderConfig || {}) as Record<string, unknown>
  const measurementBasis = 'full_page'
  const appliedBuilderConfig = applyAlphaProBuilderDefaults(shopDomain, productId, baseBuilderConfig, shop.settings)
  const customerOffer = buildAlphaProCustomerOffer({
    shopDomain,
    productId,
    settings: shop.settings,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
  })
  const rawBuilderConfig = (customerOffer
    ? { ...appliedBuilderConfig, customerOffer }
    : appliedBuilderConfig) as Record<string, unknown>
  const useMainPolicy = shouldUseMainProductMeasurementPolicy(input.measurementPolicy)
  // The visible per-product printable roll width is the only physical fit
  // limit. Legacy policy caps, design limits, margins and request hints are
  // retained only as stored compatibility data and never affect price or fit.
  const printableWidthIn = getMainProductRollWidth(input.rollWidthIn)
  const effectiveConfig: EffectiveResolveConfig = {
    sheetOptionName:
      typeof rawBuilderConfig.sheetOptionName === 'string' ? rawBuilderConfig.sheetOptionName : null,
    widthOptionName:
      typeof rawBuilderConfig.widthOptionName === 'string' ? rawBuilderConfig.widthOptionName : null,
    heightOptionName:
      typeof rawBuilderConfig.heightOptionName === 'string' ? rawBuilderConfig.heightOptionName : null,
    modalOptionNames: Array.isArray(rawBuilderConfig.modalOptionNames)
      ? rawBuilderConfig.modalOptionNames.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    printableWidthIn,
    rollWidthIn: printableWidthIn,
  }

  const optionDefs = productResolveData.optionDefs
  const variants = productResolveData.variants

  const resolvedMetadata = useMainPolicy
    ? applyMainProductMeasurementPolicy(input.rawMetadata, {
        measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
        rollWidthIn: getMainProductRollWidth(input.rollWidthIn),
        sheetSizes: getMainProductSheetSizes(variants),
      })
    : applyMeasurementBasisMetadata(input.rawMetadata, measurementBasis)
  if (!resolvedMetadata) return { kind: 'not_ready' }
  const dimensions = metadataToUploadDimensions(resolvedMetadata)
  if (!dimensions) return { kind: 'not_ready' }

  const quantity = Math.max(1, Math.floor(input.quantity || 1))

  if (isLinearInchBuilderConfig(rawBuilderConfig)) {
    const linear = resolveLinearInchVariant({
      dimensions,
      quantity,
      variants,
      selectedVariantId: input.selectedVariantId,
      printableWidthIn: effectiveConfig.printableWidthIn,
    })
    if (!linear) {
      return {
        kind: 'no_fit',
        dimensions,
        canonicalMetadata: resolvedMetadata,
        config: effectiveConfig,
        failure: getPrintableWidthFailure({
          widthIn: dimensions.widthIn,
          heightIn: dimensions.heightIn,
          config: {
            printableWidthIn: effectiveConfig.printableWidthIn,
          },
        }),
      }
    }
    return {
      kind: 'ok',
      dimensions,
      canonicalMetadata: resolvedMetadata,
      resolution: linear,
      config: { ...effectiveConfig, pricingMode: 'linear_inches', volumeDiscountTierUnit: 'linear_inches' },
      pricingMode: 'linear_inches',
    }
  }

  const sheetVariants = input.lockSelectedVariant
    ? variants.filter((variant) => variantIdsEqual(variant.id, input.selectedVariantId))
    : variants
  const resolution = resolveSheetVariant({
    widthIn: dimensions.widthIn,
    heightIn: dimensions.heightIn,
    quantity,
    variants: sheetVariants,
    optionDefs,
    selectedVariantId: input.selectedVariantId,
    config: effectiveConfig,
  })
  if (!resolution) {
    return {
      kind: 'no_fit',
      dimensions,
      canonicalMetadata: resolvedMetadata,
      config: effectiveConfig,
      failure: getPrintableWidthFailure({
        widthIn: dimensions.widthIn,
        heightIn: dimensions.heightIn,
        config: effectiveConfig,
      }),
    }
  }

  return {
    kind: 'ok',
    dimensions,
    canonicalMetadata: resolvedMetadata,
    resolution: resolution as unknown as Record<string, unknown>,
    config: effectiveConfig,
    pricingMode: 'sheet',
  }
}

const ADOBE_DEFAULT_DPI = 72

/** Metadata shape for dimensions the browser probed from file headers.
 *  Mirrors the server's no-DPI rule (uploadLifecycle.resolveBestDimensions):
 *  embedded DPI wins; otherwise Adobe's 72 DPI when the short edge fits the
 *  roll; otherwise inches stay 0 and the measurement policy anchors to the
 *  roll width — so the estimate lands on the same numbers the server will. */
export function metadataFromProbe(probe: {
  widthPx: number
  heightPx: number
  dpi?: number | null
  dpiSource?: string | null
  rollWidthIn?: number | null
}): UploadLifecycleMetadata {
  const widthPx = Math.max(0, Math.round(Number(probe.widthPx) || 0))
  const heightPx = Math.max(0, Math.round(Number(probe.heightPx) || 0))
  const documentDpi = Math.max(0, Number(probe.dpi) || 0)
  const rollWidthIn = Number(probe.rollWidthIn) > 0 ? Number(probe.rollWidthIn) : 22

  let dpi = documentDpi
  let sizingSource = 'document_dpi'
  if (!(dpi > 0)) {
    const shortEdgeIn = Math.min(widthPx, heightPx) / ADOBE_DEFAULT_DPI
    if (shortEdgeIn <= rollWidthIn) {
      dpi = ADOBE_DEFAULT_DPI
      sizingSource = 'adobe_default_dpi'
    } else {
      sizingSource = 'client_probe'
    }
  }

  return {
    widthPx,
    heightPx,
    dpi,
    documentDpi: documentDpi || undefined,
    documentDpiSource: documentDpi > 0 ? probe.dpiSource || null : null,
    trimmedWidthPx: widthPx,
    trimmedHeightPx: heightPx,
    trimmedOffsetXPx: 0,
    trimmedOffsetYPx: 0,
    measurementWidthPx: widthPx,
    measurementHeightPx: heightPx,
    effectiveDpi: dpi,
    sizingSource,
    widthIn: dpi > 0 ? Number((widthPx / dpi).toFixed(2)) : 0,
    heightIn: dpi > 0 ? Number((heightPx / dpi).toFixed(2)) : 0,
    measurementMode: 'full',
  } as UploadLifecycleMetadata
}
