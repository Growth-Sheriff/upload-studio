// Shared sheet-variant resolution — the single implementation behind
// /api/upload/resolve-product (server-measured uploads) and
// /api/upload/resolve-preview (client-probed dimensions shown before the
// upload finishes). One resolver, two callers: the provisional answer the
// customer sees instantly is computed by exactly the same code that produces
// the authoritative answer after measurement.

import { shopifyGraphQL } from '~/lib/shopify.server'
import { getPricingPolicy } from '~/lib/customerPricingModel.server'
import {
  resolveSheetVariant,
  type BuilderResolveConfig,
  type ProductOptionDef,
  type ProductVariantDef,
} from '~/lib/dtfSheetResolver.server'
import {
  applyFullCanvasMeasurementMetadata,
  type UploadLifecycleMetadata,
} from '~/lib/uploadLifecycle.server'
import {
  applyMainProductMeasurementPolicy,
  getMainProductRollWidth,
  getMainProductSheetSizes,
  MAIN_PRODUCT_MEASUREMENT_POLICY,
  shouldUseMainProductMeasurementPolicy,
} from '~/lib/mainProductMeasurement.server'
import { applyAlphaProBuilderDefaults, buildAlphaProCustomerOffer } from '~/lib/alphaProDiscounts'

const PRODUCT_VARIANTS_QUERY = `
  query ResolveProductVariants($id: ID!) {
    product(id: $id) {
      id
      title
      options {
        name
        values
      }
      variants(first: 100) {
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
      }
    }
  }
`

export const DEFAULT_RESOLVE_CONFIG = {
  artboardMarginIn: 0,
  imageMarginIn: 0,
  maxWidthIn: 22,
}

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

function findUnitVariant(
  variants: ProductVariantDef[],
  selectedVariantId?: string | null
): ProductVariantDef | null {
  const availableVariants = variants.filter(
    (variant) => variant.available !== false && variant.availableForSale !== false
  )
  const pool = availableVariants.length ? availableVariants : variants
  if (!pool.length) return null

  const selected = selectedVariantId
    ? pool.find((variant) => String(variant.id) === String(selectedVariantId))
    : null
  if (selected) return selected

  const inchUnit = pool.find((variant) => {
    const haystack = [
      variant.title,
      variant.option1,
      variant.option2,
      variant.option3,
      ...(variant.options || []),
      ...(variant.selectedOptions || []).map((option) => option.value),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, '')

    return /22["']?x1|22["']?×1|\(22["']?x1\)/.test(haystack)
  })

  return inchUnit || pool[0]
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

function resolveLinearInchVariant({
  dimensions,
  quantity,
  variants,
  selectedVariantId,
}: {
  dimensions: UploadDimensions
  quantity: number
  variants: ProductVariantDef[]
  selectedVariantId?: string | null
}) {
  const variant = findUnitVariant(variants, selectedVariantId)
  if (!variant) return null

  const pageWidthIn = Math.min(dimensions.widthIn, dimensions.heightIn)
  const pageLengthIn = Math.max(dimensions.widthIn, dimensions.heightIn)
  const requestedQuantity = Math.max(1, Math.floor(quantity))
  const billableLengthIn = Number((pageLengthIn * requestedQuantity).toFixed(2))
  const cartQuantity = Math.max(1, Math.ceil(billableLengthIn))
  const unitPrice = normalizeVariantPriceToDollars(variant.price)

  return {
    selectedVariantId: variant.id,
    selectedVariantTitle: variant.title || 'Measured inch unit',
    selectedSheetLabel: `${cartQuantity} billable inches`,
    designsPerSheet: 1,
    sheetsNeeded: cartQuantity,
    requestedQuantity,
    widthIn: dimensions.widthIn,
    heightIn: dimensions.heightIn,
    pageWidthIn,
    pageLengthIn,
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
  const productData = await shopifyGraphQL<ProductQueryResponse>(shopDomain, accessToken, PRODUCT_VARIANTS_QUERY, {
    id: productId,
  })
  const mapped = mapProductResolveData(productData)
  if (productData.product) {
    productResolveCache.set(cacheKey, mapped)
    pruneProductResolveCache(now)
  }
  return mapped
}

export interface ResolveForMetadataInput {
  shopDomain: string
  shop: { id: string; accessToken: string; settings: unknown }
  productIdRaw: string | number
  builderConfig: Record<string, unknown> | null
  rawMetadata: UploadLifecycleMetadata | null
  quantity: number
  selectedVariantId: string | null
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
  measurementPolicy?: string | null
  rollWidthIn?: number | string | null
  maxUploadWidth?: number | string | null
}

export type EffectiveResolveConfig = BuilderResolveConfig & {
  maxWidthIn: number
  fitToleranceIn: number
  pricingMode?: string
  volumeDiscountTierUnit?: string
}

export type ResolveForMetadataResult =
  | { kind: 'product_not_found' }
  | { kind: 'not_ready' }
  | { kind: 'no_fit'; dimensions: UploadDimensions; config: EffectiveResolveConfig }
  | {
      kind: 'ok'
      dimensions: UploadDimensions
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
  const policy = getPricingPolicy(shopDomain, shop.settings)
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
  const shopMaxWidthLimit = policy.maxSheetWidthIn
  const useMainPolicy = shouldUseMainProductMeasurementPolicy(input.measurementPolicy)
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
    artboardMarginIn: DEFAULT_RESOLVE_CONFIG.artboardMarginIn,
    imageMarginIn: DEFAULT_RESOLVE_CONFIG.imageMarginIn,
    fitToleranceIn: policy.fitToleranceIn,
    selectionStrategy:
      policy.sheetSelection !== 'block_default'
        ? policy.sheetSelection
        : useMainPolicy
          ? 'smallest_fitting_sheet'
          : null,
    maxWidthIn: Math.max(
      parsePositiveNumber(input.maxUploadWidth) || 0,
      parsePositiveNumber(rawBuilderConfig.maxWidthIn) || 0,
      shopMaxWidthLimit || 0,
      DEFAULT_RESOLVE_CONFIG.maxWidthIn
    ),
  }

  const optionDefs = productResolveData.optionDefs
  const variants = productResolveData.variants

  const resolvedMetadata = useMainPolicy
    ? applyMainProductMeasurementPolicy(input.rawMetadata, {
        measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
        rollWidthIn: getMainProductRollWidth(input.rollWidthIn),
        sheetSizes: getMainProductSheetSizes(variants),
      })
    : policy.measurementBasis === 'full_page'
      ? applyFullCanvasMeasurementMetadata(input.rawMetadata)
      : input.rawMetadata
  const dimensions = metadataToUploadDimensions(resolvedMetadata)
  if (!dimensions) return { kind: 'not_ready' }

  const quantity = Math.max(1, Math.floor(input.quantity || 1))

  if (isLinearInchBuilderConfig(rawBuilderConfig)) {
    const linear = resolveLinearInchVariant({
      dimensions,
      quantity,
      variants,
      selectedVariantId: input.selectedVariantId,
    })
    if (linear) {
      return {
        kind: 'ok',
        dimensions,
        resolution: linear,
        config: { ...effectiveConfig, pricingMode: 'linear_inches', volumeDiscountTierUnit: 'linear_inches' },
        pricingMode: 'linear_inches',
      }
    }
  }

  const resolution = resolveSheetVariant({
    widthIn: dimensions.widthIn,
    heightIn: dimensions.heightIn,
    quantity,
    variants,
    optionDefs,
    selectedVariantId: input.selectedVariantId,
    config: effectiveConfig,
  })
  if (!resolution) return { kind: 'no_fit', dimensions, config: effectiveConfig }

  return { kind: 'ok', dimensions, resolution: resolution as unknown as Record<string, unknown>, config: effectiveConfig, pricingMode: 'sheet' }
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
    if (shortEdgeIn <= rollWidthIn + 0.5) {
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
