import type { ActionFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { deriveUploadItemLifecycle } from '~/lib/uploadLifecycle.server'
import {
  normalizeProductId,
  parsePositiveNumber,
  resolveForMetadata,
} from '~/lib/sheetResolution.server'

// Authoritative resolution for a server-measured upload. The resolver itself
// lives in app/lib/sheetResolution.server.ts and is shared with
// /api/upload/resolve-preview (client-probed dimensions).

interface ResolveRequestBody {
  shopDomain?: string
  productId?: string | number
  uploadId?: string
  quantity?: number | string
  selectedVariantId?: string | number | null
  maxUploadWidth?: number | string | null
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
      select: { id: true, accessToken: true, settings: true },
    })
    if (!shop?.accessToken) {
      return corsJson({ error: 'Shop not found' }, request, { status: 404 })
    }

    const productId = normalizeProductId(productIdRaw)

    const [upload, productConfig] = await Promise.all([
      prisma.upload.findFirst({
        where: { id: uploadId, shopId: shop.id },
        select: {
          id: true,
          productId: true,
          items: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, originalName: true, preflightStatus: true, preflightResult: true },
          },
        },
      }),
      prisma.productConfig.findFirst({
        where: { shopId: shop.id, OR: [{ productId: String(productIdRaw) }, { productId }] },
        select: { builderConfig: true },
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

    const result = await resolveForMetadata({
      shopDomain,
      shop,
      productIdRaw,
      builderConfig: (productConfig?.builderConfig || null) as Record<string, unknown> | null,
      rawMetadata: lifecycle?.metadata || null,
      quantity,
      selectedVariantId,
      customerId: body.customerId,
      customerEmail: body.customerEmail,
      customerName: body.customerName,
      measurementPolicy: body.measurementPolicy,
      rollWidthIn: body.rollWidthIn,
      maxUploadWidth: body.maxUploadWidth,
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
    const uploadPayload = { uploadId, fileName: firstItem?.originalName || '', ...result.dimensions }
    if (result.kind === 'no_fit') {
      return corsJson(
        {
          error: 'No product variant can fit this upload with the current quantity and available sheet sizes.',
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
