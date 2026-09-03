// POST /api/upload/resolve-preview — provisional sheet + price for dimensions
// the browser probed from the file header, returned in one round trip so the
// customer sees size, sheet and price the moment the file is dropped. Uses
// the exact resolver the authoritative /resolve-product uses; the server
// measurement reconciles once the upload lands.

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { getMainProductRollWidth } from '~/lib/mainProductMeasurement.server'
import {
  metadataFromProbe,
  normalizeProductId,
  parsePositiveNumber,
  resolveForMetadata,
} from '~/lib/sheetResolution.server'

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  return corsJson({ method: 'POST', description: 'Provisional sheet resolution from probed dimensions' }, request)
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = await request.json()
    const shopDomain = String(body.shopDomain || '').trim()
    const productIdRaw = body.productId
    const widthPx = parsePositiveNumber(body.widthPx)
    const heightPx = parsePositiveNumber(body.heightPx)
    const dpi = parsePositiveNumber(body.dpi)
    const quantity = Math.max(1, Math.floor(parsePositiveNumber(body.quantity) || 1))
    const selectedVariantId = body.selectedVariantId != null ? String(body.selectedVariantId) : null

    if (!shopDomain) return corsJson({ error: 'Missing shopDomain' }, request, { status: 400 })
    if (productIdRaw == null || productIdRaw === '') {
      return corsJson({ error: 'Missing productId' }, request, { status: 400 })
    }
    if (!widthPx || !heightPx) {
      return corsJson({ error: 'Missing widthPx/heightPx' }, request, { status: 400 })
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, accessToken: true, settings: true },
    })
    if (!shop?.accessToken) return corsJson({ error: 'Shop not found' }, request, { status: 404 })

    const productId = normalizeProductId(productIdRaw)
    const productConfig = await prisma.productConfig.findFirst({
      where: { shopId: shop.id, OR: [{ productId: String(productIdRaw) }, { productId }] },
      select: { builderConfig: true },
    })

    const result = await resolveForMetadata({
      shopDomain,
      shop,
      productIdRaw,
      builderConfig: (productConfig?.builderConfig || null) as Record<string, unknown> | null,
      rawMetadata: metadataFromProbe({
        widthPx,
        heightPx,
        dpi,
        dpiSource: typeof body.dpiSource === 'string' ? body.dpiSource : null,
        rollWidthIn: getMainProductRollWidth(body.rollWidthIn),
      }),
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
      return corsJson({ error: 'Dimensions could not be interpreted' }, request, { status: 422 })
    }
    if (result.kind === 'no_fit') {
      return corsJson(
        {
          error: 'No product variant can fit this file with the current quantity and available sheet sizes.',
          provisional: true,
          dimensions: result.dimensions,
          config: result.config,
        },
        request,
        { status: 422 }
      )
    }

    return corsJson(
      { success: true, provisional: true, dimensions: result.dimensions, resolution: result.resolution, config: result.config },
      request
    )
  } catch (error) {
    console.error('[Upload Resolve Preview] Error:', error)
    return corsJson({ error: 'Failed to resolve preview' }, request, { status: 500 })
  }
}
