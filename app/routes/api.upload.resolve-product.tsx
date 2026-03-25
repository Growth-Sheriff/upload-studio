import type { ActionFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  resolveSheetPricing,
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
  widthIn?: number | string | null
  heightIn?: number | string | null
  selectedVariantId?: string | number | null
  selectedSheetKey?: string | null
  serviceOptionValues?: Record<string, string | number | boolean | null> | null
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

function normalizeProductId(productId: string | number): string {
  const asString = String(productId)
  return asString.startsWith('gid://') ? asString : `gid://shopify/Product/${asString}`
}

function extractUploadDimensions(preflightResult: unknown) {
  const result = (preflightResult || {}) as Record<string, unknown>
  const checks = Array.isArray(result.checks) ? (result.checks as Array<Record<string, unknown>>) : []

  let widthPx = 0
  let heightPx = 0
  let dpi = 0

  for (const check of checks) {
    if (check.name === 'dimensions' && check.details) {
      const details = check.details as Record<string, number>
      widthPx = Number(details.width || 0)
      heightPx = Number(details.height || 0)
    }
    if (check.name === 'dpi' && typeof check.value === 'number') {
      dpi = Number(check.value || 0)
    }
  }

  if (!(widthPx > 0) || !(heightPx > 0) || !(dpi > 0)) {
    return null
  }

  return {
    widthPx,
    heightPx,
    dpi,
    widthIn: Number((widthPx / dpi).toFixed(2)),
    heightIn: Number((heightPx / dpi).toFixed(2)),
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
    const selectedSheetKey = body.selectedSheetKey != null ? String(body.selectedSheetKey) : null

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

    const requestedWidthIn = parsePositiveNumber(body.widthIn) || dimensions.widthIn
    const requestedHeightIn = parsePositiveNumber(body.heightIn) || dimensions.heightIn
    const serviceOptionValues =
      body.serviceOptionValues && typeof body.serviceOptionValues === 'object'
        ? Object.entries(body.serviceOptionValues).reduce<Record<string, string>>((acc, [key, value]) => {
            const optionName = String(key || '').trim()
            const optionValue = String(value || '').trim()
            if (optionName && optionValue) acc[optionName] = optionValue
            return acc
          }, {})
        : null

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

    if (requestedWidthIn > effectiveConfig.maxWidthIn + 0.001) {
      return corsJson(
        {
          error: `This file is too wide for this product. Maximum supported width is ${Math.round(
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

    const sheetPricing = resolveSheetPricing({
      widthIn: requestedWidthIn,
      heightIn: requestedHeightIn,
      quantity,
      variants,
      optionDefs,
      selectedVariantId,
      selectedSheetKey,
      serviceOptionValues,
      config: effectiveConfig,
    })
    const resolution = resolveSheetVariant({
      widthIn: requestedWidthIn,
      heightIn: requestedHeightIn,
      quantity,
      variants,
      optionDefs,
      selectedVariantId,
      selectedSheetKey,
      serviceOptionValues,
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
          sheetPricing,
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
        sheetPricing,
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
