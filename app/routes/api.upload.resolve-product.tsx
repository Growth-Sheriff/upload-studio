import type { ActionFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  getMaxWidthLimitForShop,
  isDtfPrintHouseShop,
} from '~/lib/customerPricing.server'
import {
  resolveSheetVariant,
  type BuilderResolveConfig,
  type ProductOptionDef,
  type ProductVariantDef,
} from '~/lib/dtfSheetResolver.server'
import {
  applyFullCanvasMeasurementMetadata,
  deriveUploadItemLifecycle,
  type UploadLifecycleMetadata,
} from '~/lib/uploadLifecycle.server'
import {
  applyMainProductMeasurementPolicy,
  getMainProductRollWidth,
  getMainProductSheetSizes,
  MAIN_PRODUCT_MEASUREMENT_POLICY,
  shouldUseMainProductMeasurementPolicy,
} from '~/lib/mainProductMeasurement.server'

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

const DEFAULT_CONFIG = {
  artboardMarginIn: 0,
  imageMarginIn: 0,
  maxWidthIn: 22,
}

interface ResolveRequestBody {
  shopDomain?: string
  productId?: string | number
  uploadId?: string
  quantity?: number | string
  selectedVariantId?: string | number | null
  maxUploadWidth?: number | string | null
  measurementPolicy?: string | null
  rollWidthIn?: number | string | null
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

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function normalizeProductId(productId: string | number): string {
  const asString = String(productId)
  return asString.startsWith('gid://') ? asString : `gid://shopify/Product/${asString}`
}

function metadataToUploadDimensions(metadata: UploadLifecycleMetadata | null) {
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
  dimensions: NonNullable<ReturnType<typeof metadataToUploadDimensions>>
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

  return {
    productData,
    optionDefs,
    variants,
    cachedAt: Date.now(),
  }
}

function getProductResolveCacheKey(shopDomain: string, productId: string): string {
  return `${shopDomain}:${productId}`
}

function pruneProductResolveCache(now = Date.now()) {
  for (const [key, value] of productResolveCache) {
    if (now - value.cachedAt > PRODUCT_RESOLVE_CACHE_TTL_MS) {
      productResolveCache.delete(key)
    }
  }

  while (productResolveCache.size > PRODUCT_RESOLVE_CACHE_MAX_SIZE) {
    const oldestKey = productResolveCache.keys().next().value
    if (!oldestKey) break
    productResolveCache.delete(oldestKey)
  }
}

async function getProductResolveData(
  shopDomain: string,
  accessToken: string,
  productId: string
): Promise<ProductResolveData> {
  const now = Date.now()
  const cacheKey = getProductResolveCacheKey(shopDomain, productId)
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

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = (await request.json()) as ResolveRequestBody
    const shopDomain = String(body.shopDomain || '').trim()
    const uploadId = String(body.uploadId || '').trim()
    const productIdRaw = body.productId
    const quantity = Math.max(1, Math.floor(parsePositiveNumber(body.quantity) || 1))
    const selectedVariantId = body.selectedVariantId != null ? String(body.selectedVariantId) : null

    if (!shopDomain) {
      return corsJson({ error: 'Missing shopDomain' }, request, { status: 400 })
    }
    if (!uploadId) {
      return corsJson({ error: 'Missing uploadId' }, request, { status: 400 })
    }
    if (productIdRaw == null || productIdRaw === '') {
      return corsJson({ error: 'Missing productId' }, request, { status: 400 })
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
        accessToken: true,
      },
    })

    if (!shop?.accessToken) {
      return corsJson({ error: 'Shop not found' }, request, { status: 404 })
    }

    const productId = normalizeProductId(productIdRaw)

    const [upload, productConfig, productResolveData] = await Promise.all([
      prisma.upload.findFirst({
        where: {
          id: uploadId,
          shopId: shop.id,
        },
        select: {
          id: true,
          productId: true,
          items: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              originalName: true,
              preflightStatus: true,
              preflightResult: true,
            },
          },
        },
      }),
      prisma.productConfig.findFirst({
        where: {
          shopId: shop.id,
          OR: [{ productId: String(productIdRaw) }, { productId }],
        },
        select: {
          builderConfig: true,
        },
      }),
      getProductResolveData(shopDomain, shop.accessToken, productId),
    ])

    if (!upload) {
      return corsJson({ error: 'Upload not found' }, request, { status: 404 })
    }
    if (
      upload.productId &&
      String(upload.productId) !== String(productIdRaw) &&
      String(upload.productId) !== productId
    ) {
      return corsJson({ error: 'Upload does not belong to this product' }, request, { status: 400 })
    }

    const firstItem = upload.items[0]
    const lifecycle = firstItem
      ? deriveUploadItemLifecycle({
          preflightStatus: firstItem.preflightStatus,
          preflightResult: firstItem.preflightResult,
        })
      : null
    const rawMetadata = lifecycle?.metadata || null

    const rawBuilderConfig = (productConfig?.builderConfig || {}) as Record<string, unknown>
    const shopMaxWidthLimit = getMaxWidthLimitForShop(shopDomain)
    const effectiveConfig: BuilderResolveConfig & { maxWidthIn: number; fitToleranceIn: number } = {
      sheetOptionName:
        typeof rawBuilderConfig.sheetOptionName === 'string' ? rawBuilderConfig.sheetOptionName : null,
      widthOptionName:
        typeof rawBuilderConfig.widthOptionName === 'string' ? rawBuilderConfig.widthOptionName : null,
      heightOptionName:
        typeof rawBuilderConfig.heightOptionName === 'string' ? rawBuilderConfig.heightOptionName : null,
      modalOptionNames: Array.isArray(rawBuilderConfig.modalOptionNames)
        ? rawBuilderConfig.modalOptionNames
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : [],
      artboardMarginIn: DEFAULT_CONFIG.artboardMarginIn,
      imageMarginIn: DEFAULT_CONFIG.imageMarginIn,
      fitToleranceIn: isDtfPrintHouseShop(shopDomain) ? 0.5 : 0,
      selectionStrategy: shouldUseMainProductMeasurementPolicy(body.measurementPolicy)
        ? 'smallest_fitting_sheet'
        : null,
      maxWidthIn: Math.max(
        parsePositiveNumber(body.maxUploadWidth) || 0,
        parsePositiveNumber(rawBuilderConfig.maxWidthIn) || 0,
        shopMaxWidthLimit || 0,
        DEFAULT_CONFIG.maxWidthIn
      ),
    }

    if (!productResolveData.productData.product) {
      return corsJson({ error: 'Product not found' }, request, { status: 404 })
    }

    const optionDefs = productResolveData.optionDefs
    const variants = productResolveData.variants

    const resolvedMetadata = shouldUseMainProductMeasurementPolicy(body.measurementPolicy)
      ? applyMainProductMeasurementPolicy(rawMetadata, {
          measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
          rollWidthIn: getMainProductRollWidth(body.rollWidthIn),
          sheetSizes: getMainProductSheetSizes(variants),
        })
      : isDtfPrintHouseShop(shopDomain)
        ? applyFullCanvasMeasurementMetadata(rawMetadata)
        : rawMetadata
    const dimensions = metadataToUploadDimensions(resolvedMetadata)
    if (!dimensions) {
      return corsJson(
        { error: 'Upload metadata is not ready yet. Please retry in a moment.' },
        request,
        { status: 409 }
      )
    }

    const linearInchResolution = isLinearInchBuilderConfig(rawBuilderConfig)
      ? resolveLinearInchVariant({
          dimensions,
          quantity,
          variants,
          selectedVariantId,
        })
      : null

    if (linearInchResolution) {
      return corsJson(
        {
          success: true,
          upload: {
            uploadId,
            fileName: firstItem?.originalName || '',
            ...dimensions,
          },
          resolution: linearInchResolution,
          config: {
            ...effectiveConfig,
            pricingMode: 'linear_inches',
            volumeDiscountTierUnit: 'linear_inches',
          },
        },
        request
      )
    }

    const resolution = resolveSheetVariant({
      widthIn: dimensions.widthIn,
      heightIn: dimensions.heightIn,
      quantity,
      variants,
      optionDefs,
      selectedVariantId,
      config: effectiveConfig,
    })

    if (!resolution) {
      return corsJson(
        {
          error: 'No product variant can fit this upload with the current quantity and available sheet sizes.',
          upload: {
            uploadId,
            fileName: firstItem?.originalName || '',
            ...dimensions,
          },
          config: effectiveConfig,
        },
        request,
        { status: 422 }
      )
    }

    return corsJson(
      {
        success: true,
        upload: {
          uploadId,
          fileName: firstItem?.originalName || '',
          ...dimensions,
        },
        resolution,
        config: effectiveConfig,
      },
      request
    )
  } catch (error) {
    console.error('[Upload Resolve Product] Error:', error)
    return corsJson({ error: 'Failed to resolve product variant' }, request, { status: 500 })
  }
}
