import type { ActionFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { normalizeCustomerId } from '~/lib/customerPricing.server'
import {
  deriveUploadItemLifecycle,
  getStoredMeasurementBasis,
} from '~/lib/uploadLifecycle.server'
import {
  getRuntimeMeasurementBasis,
} from '~/lib/customerPricingModel.server'
import {
  MAIN_PRODUCT_MEASUREMENT_POLICY,
  resolveServerMainProductRollWidth,
} from '~/lib/mainProductMeasurement.server'
import { persistMainProductMeasurementProjection } from '~/lib/mainProductMeasurementPersistence.server'
import {
  parsePositiveNumber,
  resolveForMetadata,
} from '~/lib/sheetResolution.server'
import {
  shopifyProductIdCandidates,
  shopifyProductIdsEqual,
} from '~/lib/shopifyProductIdentity'
import { selectProductConfigForIdentity } from '~/lib/productConfigIdentity.server'
import { authenticate } from '~/shopify.server'

// Authoritative resolution for a server-measured upload. The resolver itself
// lives in app/lib/sheetResolution.server.ts and is shared with
// /api/upload/resolve-preview (client-probed dimensions).

interface ResolveRequestBody {
  shopDomain?: string
  productId?: string | number
  uploadId?: string
  quantity?: number | string
  selectedVariantId?: string | number | null
  measurementPolicy?: string | null
  rollWidthIn?: number | string | null
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  await authenticate.public.appProxy(request)
  const requestUrl = new URL(request.url)
  const signedShopDomain = String(requestUrl.searchParams.get('shop') || '').trim()
  const signedCustomerId = normalizeCustomerId(
    requestUrl.searchParams.get('logged_in_customer_id')
  )

  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = (await request.json()) as ResolveRequestBody
    const shopDomain = signedShopDomain
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
      select: { id: true, accessToken: true, settings: true },
    })
    if (!shop?.accessToken) {
      return corsJson({ error: 'Shop not found' }, request, { status: 404 })
    }

    const [upload, productConfigs] = await Promise.all([
      prisma.upload.findFirst({
        where: { id: uploadId, shopId: shop.id },
        select: {
          id: true,
          productId: true,
          customerId: true,
          items: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, originalName: true, preflightStatus: true, preflightResult: true },
          },
        },
      }),
      prisma.productConfig.findMany({
        where: {
          shopId: shop.id,
          productId: { in: shopifyProductIdCandidates(productIdRaw) },
        },
        select: { productId: true, builderConfig: true },
      }),
    ])

    if (!upload) {
      return corsJson({ error: 'Upload not found' }, request, { status: 404 })
    }
    const uploadCustomerId = normalizeCustomerId(upload.customerId)
    if (uploadCustomerId && uploadCustomerId !== signedCustomerId) {
      return corsJson({ error: 'Upload does not belong to this customer' }, request, {
        status: 403,
      })
    }
    if (upload.productId && !shopifyProductIdsEqual(upload.productId, productIdRaw)) {
      return corsJson({ error: 'Upload does not belong to this product' }, request, { status: 400 })
    }

    const firstItem = upload.items[0]
    const lifecycle = firstItem
      ? deriveUploadItemLifecycle({
          preflightStatus: firstItem.preflightStatus,
          preflightResult: firstItem.preflightResult,
        })
      : null

    const productConfig = selectProductConfigForIdentity({
      rows: productConfigs,
      productId: productIdRaw,
      shopId: shop.id,
      source: 'api.upload.resolve-product',
    })
    const builderConfig = (productConfig?.builderConfig || null) as Record<string, unknown> | null
    const configuredRollWidth = resolveServerMainProductRollWidth(builderConfig)
    const result = await resolveForMetadata({
      shopDomain,
      shop,
      productIdRaw,
      builderConfig,
      rawMetadata: lifecycle?.metadata || null,
      quantity,
      selectedVariantId,
      customerId: signedCustomerId,
      measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
      measurementBasis: getStoredMeasurementBasis(
        firstItem?.preflightResult,
        getRuntimeMeasurementBasis(shopDomain, shop.settings)
      ),
      rollWidthIn: configuredRollWidth,
    })

    if (result.kind === 'product_not_found') {
      return corsJson({ error: 'Product not found' }, request, { status: 404 })
    }
    if (result.kind === 'not_ready') {
      return corsJson(
        { error: 'Upload metadata is not ready yet. Please retry in a moment.' },
        request,
        { status: 409 }
      )
    }
    await persistMainProductMeasurementProjection(
      firstItem.id,
      result.canonicalMetadata,
      configuredRollWidth
    )
    const uploadPayload = { uploadId, fileName: firstItem?.originalName || '', ...result.dimensions }
    if (result.kind === 'no_fit') {
      return corsJson(
        {
          error:
            result.failure?.message ||
            'No product variant can fit this upload with the available sheet sizes.',
          failure: result.failure,
          upload: uploadPayload,
          config: result.config,
        },
        request,
        { status: 422 }
      )
    }

    return corsJson(
      { success: true, upload: uploadPayload, resolution: result.resolution, config: result.config },
      request
    )
  } catch (error) {
    console.error('[Upload Resolve Product] Error:', error)
    return corsJson({ error: 'Failed to resolve product variant' }, request, { status: 500 })
  }
}
