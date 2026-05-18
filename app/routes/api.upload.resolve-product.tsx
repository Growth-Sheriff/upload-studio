import type { ActionFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  getMaxWidthLimitForShop,
  isDtfPrintHouseShop,
  parseSheetSizeFromTitle,
} from '~/lib/customerPricing.server'
import {
  resolveSheetVariant,
  type BuilderResolveConfig,
  type ProductOptionDef,
  type ProductVariantDef,
} from '~/lib/dtfSheetResolver.server'
import {
  applyFullCanvasMeasurementMetadata,
  computeDocumentDpiInches,
  computeRollWidthAnchoredInches,
  deriveUploadItemLifecycle,
  type RollWidthSheetSize,
  type UploadLifecycleMetadata,
} from '~/lib/uploadLifecycle.server'

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

const MAIN_PRODUCT_MEASUREMENT_POLICY = 'main_product_roll_width'
const DEFAULT_MAIN_PRODUCT_ROLL_WIDTH_IN = 22

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

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function normalizeProductId(productId: string | number): string {
  const asString = String(productId)
  return asString.startsWith('gid://') ? asString : `gid://shopify/Product/${asString}`
}

function shouldUseMainProductRollPolicy(body: ResolveRequestBody): boolean {
  return String(body.measurementPolicy || '').trim() === MAIN_PRODUCT_MEASUREMENT_POLICY
}

function getMainProductRollWidth(value: unknown): number {
  return parsePositiveNumber(value) || DEFAULT_MAIN_PRODUCT_ROLL_WIDTH_IN
}

function applyMainProductRollMeasurement(
  metadata: UploadLifecycleMetadata | null,
  rollWidthIn: number,
  sheetSizes: RollWidthSheetSize[] = []
): UploadLifecycleMetadata | null {
  if (!metadata) return null

  const measurementWidthPx = metadata.widthPx > 0 ? metadata.widthPx : metadata.measurementWidthPx
  const measurementHeightPx = metadata.heightPx > 0 ? metadata.heightPx : metadata.measurementHeightPx
  const documentDpi =
    parsePositiveNumber(metadata.documentDpi) ||
    (metadata.documentDpiSource ? parsePositiveNumber(metadata.dpi) : null)
  const documentSized = computeDocumentDpiInches(
    measurementWidthPx,
    measurementHeightPx,
    documentDpi || undefined
  )

  if (documentSized && documentDpi) {
    return {
      ...metadata,
      dpi: documentDpi,
      documentDpi,
      documentDpiSource: metadata.documentDpiSource || 'document_dpi',
      measurementWidthPx,
      measurementHeightPx,
      effectiveDpi: documentSized.effectiveDpi,
      sizingSource: 'main_product_document_dpi',
      sheetWidthIn: rollWidthIn,
      sheetLengthIn: undefined,
      widthIn: documentSized.widthIn,
      heightIn: documentSized.heightIn,
      measurementMode: 'full',
    }
  }

  const anchored = computeRollWidthAnchoredInches(
    measurementWidthPx,
    measurementHeightPx,
    rollWidthIn,
    sheetSizes
  )

  return {
    ...metadata,
    measurementWidthPx,
    measurementHeightPx,
    effectiveDpi: anchored.effectiveDpi,
    sizingSource: MAIN_PRODUCT_MEASUREMENT_POLICY,
    sheetWidthIn: anchored.sheetWidthIn,
    sheetLengthIn: anchored.sheetLengthIn,
    widthIn: anchored.widthIn,
    heightIn: anchored.heightIn,
    measurementMode: 'full',
  }
}

function getMainProductSheetSizes(variants: ProductVariantDef[]): RollWidthSheetSize[] {
  const seen = new Set<string>()
  const sizes: RollWidthSheetSize[] = []

  for (const variant of variants) {
    const values = [
      variant.title,
      variant.option1,
      variant.option2,
      variant.option3,
      ...(variant.options || []),
      ...(variant.selectedOptions || []).map((option) => option.value),
    ]

    for (const value of values) {
      const parsed = parseSheetSizeFromTitle(value)
      if (!parsed) continue
      const key = `${parsed.widthIn}x${parsed.lengthIn}`
      if (seen.has(key)) continue
      seen.add(key)
      sizes.push({ widthIn: parsed.widthIn, heightIn: parsed.lengthIn })
    }
  }

  return sizes
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

    const [upload, productConfig, productData] = await Promise.all([
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
      shopifyGraphQL<ProductQueryResponse>(shopDomain, shop.accessToken, PRODUCT_VARIANTS_QUERY, {
        id: productId,
      }),
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
      maxWidthIn: Math.max(
        parsePositiveNumber(body.maxUploadWidth) || 0,
        parsePositiveNumber(rawBuilderConfig.maxWidthIn) || 0,
        shopMaxWidthLimit || 0,
        DEFAULT_CONFIG.maxWidthIn
      ),
    }

    if (!productData.product) {
      return corsJson({ error: 'Product not found' }, request, { status: 404 })
    }

    const optionDefs: ProductOptionDef[] = (productData.product.options || []).map((option) => ({
      name: option.name || '',
      values: Array.isArray(option.values) ? option.values.map((value) => String(value || '')) : [],
    }))

    const variants: ProductVariantDef[] = (productData.product.variants.edges || []).map((edge) => {
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

    const resolvedMetadata = shouldUseMainProductRollPolicy(body)
      ? applyMainProductRollMeasurement(
          rawMetadata,
          getMainProductRollWidth(body.rollWidthIn),
          getMainProductSheetSizes(variants)
        )
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
