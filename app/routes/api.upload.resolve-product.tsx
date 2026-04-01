import type { ActionFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  resolveSheetVariant,
  type BuilderResolveConfig,
  type ProductOptionDef,
  type ProductVariantDef,
} from '~/lib/dtfSheetResolver.server'

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
  artboardMarginIn: 0.125,
  imageMarginIn: 0.125,
  maxWidthIn: 21.75,
}

interface ResolveRequestBody {
  shopDomain?: string
  productId?: string | number
  uploadId?: string
  quantity?: number | string
  selectedVariantId?: string | number | null
  artboardMarginIn?: number | string | null
  imageMarginIn?: number | string | null
  maxUploadWidth?: number | string | null
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

function formatPrintableWidth(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) < 0.001) return String(rounded)
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function normalizeProductId(productId: string | number): string {
  const asString = String(productId)
  return asString.startsWith('gid://') ? asString : `gid://shopify/Product/${asString}`
}

function extractUploadDimensions(preflightResult: unknown) {
  const result = (preflightResult || {}) as Record<string, unknown>
  const metadata =
    result.metadata && typeof result.metadata === 'object'
      ? (result.metadata as Record<string, unknown>)
      : null
  const checks = Array.isArray(result.checks) ? (result.checks as Array<Record<string, unknown>>) : []

  let widthPx = 0
  let heightPx = 0
  let dpi = 0
  let trimmedWidthPx = 0
  let trimmedHeightPx = 0
  let measurementWidthPx = 0
  let measurementHeightPx = 0
  let effectiveDpi = 300
  let measurementMode = 'full'
  let widthIn = 0
  let heightIn = 0

  if (metadata) {
    widthPx = Number(metadata.widthPx || 0)
    heightPx = Number(metadata.heightPx || 0)
    dpi = Number(metadata.dpi || 0)
    trimmedWidthPx = Number(metadata.trimmedWidthPx || 0)
    trimmedHeightPx = Number(metadata.trimmedHeightPx || 0)
    measurementWidthPx = Number(metadata.measurementWidthPx || 0)
    measurementHeightPx = Number(metadata.measurementHeightPx || 0)
    effectiveDpi = Number(metadata.effectiveDpi || effectiveDpi || 300)
    widthIn = Number(metadata.widthIn || 0)
    heightIn = Number(metadata.heightIn || 0)
    measurementMode =
      typeof metadata.measurementMode === 'string' && metadata.measurementMode
        ? String(metadata.measurementMode)
        : measurementMode
  }

  for (const check of checks) {
    if (check.name === 'dimensions' && check.details) {
      const details = check.details as Record<string, unknown>
      widthPx = Number(details.width || 0)
      heightPx = Number(details.height || 0)
      trimmedWidthPx = Number(details.trimmedWidth || 0)
      trimmedHeightPx = Number(details.trimmedHeight || 0)
      measurementWidthPx = Number(details.measurementWidth || 0)
      measurementHeightPx = Number(details.measurementHeight || 0)
      effectiveDpi = Number(details.effectiveDpi || effectiveDpi || 300)
      widthIn = Number(details.widthIn || 0)
      heightIn = Number(details.heightIn || 0)
      measurementMode =
        typeof details.measurementMode === 'string' && details.measurementMode
          ? String(details.measurementMode)
          : measurementMode
    }
    if (check.name === 'dpi' && typeof check.value === 'number') {
      dpi = Number(check.value || 0)
    }
  }

  if (!(widthPx > 0) || !(heightPx > 0)) {
    return null
  }

  if (!(measurementWidthPx > 0) || !(measurementHeightPx > 0)) {
    measurementWidthPx = widthPx
    measurementHeightPx = heightPx
  }
  if (!(widthIn > 0) || !(heightIn > 0) || !(effectiveDpi > 0)) {
    effectiveDpi = effectiveDpi > 0 ? effectiveDpi : 300
    widthIn = Number((measurementWidthPx / effectiveDpi).toFixed(2))
    heightIn = Number((measurementHeightPx / effectiveDpi).toFixed(2))
  }

  return {
    widthPx,
    heightPx,
    dpi,
    trimmedWidthPx,
    trimmedHeightPx,
    measurementWidthPx,
    measurementHeightPx,
    effectiveDpi,
    measurementMode,
    widthIn,
    heightIn,
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
    const dimensions = firstItem ? extractUploadDimensions(firstItem.preflightResult) : null
    if (!dimensions) {
      return corsJson(
        { error: 'Upload metadata is not ready yet. Please retry in a moment.' },
        request,
        { status: 409 }
      )
    }

    const rawBuilderConfig = (productConfig?.builderConfig || {}) as Record<string, unknown>
    const effectiveConfig: BuilderResolveConfig & { maxWidthIn: number } = {
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
      artboardMarginIn:
        parsePositiveNumber(body.artboardMarginIn) ||
        parsePositiveNumber(rawBuilderConfig.artboardMarginIn) ||
        DEFAULT_CONFIG.artboardMarginIn,
      imageMarginIn:
        parsePositiveNumber(body.imageMarginIn) ||
        parsePositiveNumber(rawBuilderConfig.imageMarginIn) ||
        DEFAULT_CONFIG.imageMarginIn,
      maxWidthIn:
        parsePositiveNumber(body.maxUploadWidth) ||
        parsePositiveNumber(rawBuilderConfig.maxWidthIn) ||
        DEFAULT_CONFIG.maxWidthIn,
    }

    if (dimensions.widthIn > effectiveConfig.maxWidthIn + 0.001) {
      return corsJson(
        {
          error: `This file is too wide for this product. Maximum printable width is ${formatPrintableWidth(
            effectiveConfig.maxWidthIn
          )}".`,
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
          error: 'No product variant can fit this upload with the current quantity and margin rules.',
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
