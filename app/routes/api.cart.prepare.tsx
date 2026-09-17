// POST /api/cart/prepare — server-built cart line properties for uploads.
//
// The storefront widget must not invent line properties: it sends the upload
// ids it wants to add to the cart and receives the canonical property set
// back. This keeps the cart a reference carrier with exactly three properties
// while every production fact lives in the DB and is served by the
// /i/<uploadId> identity page.
//
// Request:  { uploadIds: string[], lines?: [{ uploadId, copies,
//             selectedVariantId?, lockSelectedVariant? }] }
// Response: { success, items: [{ uploadId, orderable, properties, fileName, thumbnailUrl }] }
//
// Automatic upload blocks let the server choose the shortest fitting variant.
// Manual/reorder blocks can lock their selected variant so the server validates
// that exact commercial choice instead of silently changing it.

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import {
  deriveUploadItemLifecycle,
  getStoredMeasurementBasis,
} from '~/lib/uploadLifecycle.server'
import {
  MAIN_PRODUCT_MEASUREMENT_POLICY,
  resolveServerMainProductRollWidth,
} from '~/lib/mainProductMeasurement.server'
import { persistMainProductMeasurementProjection } from '~/lib/mainProductMeasurementPersistence.server'
import {
  getRuntimeMeasurementBasis,
} from '~/lib/customerPricingModel.server'
import { normalizeCustomerId } from '~/lib/customerPricing.server'
import { hasUploadOrderHistory } from '~/lib/uploadQuantitySemantics'
import { resolveForMetadata } from '~/lib/sheetResolution.server'
import { shopifyProductIdCandidates } from '~/lib/shopifyProductIdentity'
import { selectProductConfigForIdentity } from '~/lib/productConfigIdentity.server'
import { authenticate } from '~/shopify.server'
import {
  DPI_PROPERTY,
  PRINT_READY_PROPERTY,
  SHEET_IDENTITY_PROPERTY,
} from '~/lib/orderMatching.server'
import {
  buildFileUrl,
  buildIdentityUrl,
  buildThumbnailUrl,
  storageConfigForShop,
} from '~/lib/uploadUrls.server'

const MAX_UPLOADS_PER_REQUEST = 20

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }
  if (request.method !== 'POST') {
    return corsJson({ success: false, error: 'Method not allowed' }, request, { status: 405 })
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

  let body: { shopDomain?: string; uploadIds?: unknown; lines?: unknown }
  try {
    body = await request.json()
  } catch {
    return corsJson({ success: false, error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const shopDomain = signedShopDomain
  const uploadIds = Array.isArray(body.uploadIds)
    ? body.uploadIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(id))
    : []

  const toInt = (value: unknown, min: number, max: number): number | null => {
    const n = Math.floor(Number(value))
    return Number.isFinite(n) && n >= min && n <= max ? n : null
  }
  const lineByUpload = new Map<
    string,
    { copies: number; selectedVariantId: string | null; lockSelectedVariant: boolean }
  >()
  if (Array.isArray(body.lines)) {
    for (const raw of body.lines as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') continue
      const uploadId = typeof raw.uploadId === 'string' ? raw.uploadId : ''
      if (!uploadIds.includes(uploadId)) continue
      lineByUpload.set(uploadId, {
        copies: toInt(raw.copies, 1, 999) ?? 1,
        selectedVariantId:
          typeof (raw.selectedVariantId ?? raw.variantId) === 'string' &&
          String(raw.selectedVariantId ?? raw.variantId).length <= 200
            ? String(raw.selectedVariantId ?? raw.variantId).trim() || null
            : null,
        lockSelectedVariant: raw.lockSelectedVariant === true,
      })
    }
  }

  if (!shopDomain) {
    return corsJson({ success: false, error: 'shopDomain is required' }, request, { status: 400 })
  }
  if (!uploadIds.length || uploadIds.length > MAX_UPLOADS_PER_REQUEST) {
    return corsJson(
      { success: false, error: `uploadIds must contain 1-${MAX_UPLOADS_PER_REQUEST} ids` },
      request,
      { status: 400 }
    )
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) {
    return corsJson({ success: false, error: 'Shop not found' }, request, { status: 404 })
  }

  const uploads = await prisma.upload.findMany({
    where: { id: { in: uploadIds }, shopId: shop.id },
    include: {
      items: {
        select: {
          id: true,
          originalName: true,
          storageKey: true,
          thumbnailKey: true,
          preflightStatus: true,
          preflightResult: true,
        },
      },
      ordersLink: {
        select: { id: true },
        take: 1,
      },
    },
  })
  const byId = new Map(uploads.map((u) => [u.id, u]))
  const storageConfig = storageConfigForShop(shop)
  const lifecycleByUploadId = new Map(
    uploads.map((upload) => {
      const lifecycles = upload.items.map((item) =>
        deriveUploadItemLifecycle({
          preflightStatus: item.preflightStatus,
          preflightResult: item.preflightResult,
          thumbnailKey: item.thumbnailKey,
        })
      )
      return [
        upload.id,
        {
          lifecycles,
          orderable: lifecycles.length > 0 && lifecycles.every((lifecycle) => lifecycle.canAddToCart),
        },
      ] as const
    })
  )

  const canonicalLineByUpload = new Map<
    string,
    {
      copies: number
      sheetsNeeded: number | null
      cartQuantity: number | null
      variantId: string | null
      variantTitle: string | null
      sheetLabel: string | null
      dpi: number | null
    }
  >()
  const preparationErrorByUpload = new Map<string, string>()

  await Promise.all(
    uploads.map(async (upload) => {
      const requestedLine = lineByUpload.get(upload.id)
      const lifecycleState = lifecycleByUploadId.get(upload.id)
      const firstItem = upload.items[0]
      const firstLifecycle = lifecycleState?.lifecycles[0]
      if (!lifecycleState?.orderable || !firstItem || !firstLifecycle?.metadata) return
      if (hasUploadOrderHistory(upload)) {
        lifecycleByUploadId.set(upload.id, { ...lifecycleState, orderable: false })
        preparationErrorByUpload.set(
          upload.id,
          'Upload this file again before ordering so the previous order record stays unchanged.'
        )
        return
      }
      const uploadCustomerId = normalizeCustomerId(upload.customerId)
      if (uploadCustomerId && uploadCustomerId !== signedCustomerId) {
        lifecycleByUploadId.set(upload.id, { ...lifecycleState, orderable: false })
        preparationErrorByUpload.set(upload.id, 'This upload does not belong to the logged-in customer.')
        return
      }
      // Listing blocks only need the canonical three reference properties.
      // Main-product lines also send copies and require a server resolution.
      if (!requestedLine) return
      if (!upload.productId || !shop.accessToken) {
        lifecycleByUploadId.set(upload.id, { ...lifecycleState, orderable: false })
        preparationErrorByUpload.set(upload.id, 'This upload is missing its product configuration.')
        return
      }
      if (requestedLine.lockSelectedVariant && !requestedLine.selectedVariantId) {
        lifecycleByUploadId.set(upload.id, { ...lifecycleState, orderable: false })
        preparationErrorByUpload.set(upload.id, 'Select a valid product variant before adding this upload.')
        return
      }

      const rawProductId = String(upload.productId)
      const productConfigs = await prisma.productConfig.findMany({
        where: {
          shopId: shop.id,
          productId: { in: shopifyProductIdCandidates(rawProductId) },
        },
        select: { productId: true, builderConfig: true },
      })
      const productConfig = selectProductConfigForIdentity({
        rows: productConfigs,
        productId: rawProductId,
        shopId: shop.id,
        source: 'api.cart.prepare',
      })
      const builderConfig =
        productConfig?.builderConfig && typeof productConfig.builderConfig === 'object'
          ? (productConfig.builderConfig as Record<string, unknown>)
          : null
      // Supplying a main-product cart line selects this server endpoint's
      // full-page policy. Neither policy nor physical roll width is accepted
      // from the request body.
      const measurementPolicy = MAIN_PRODUCT_MEASUREMENT_POLICY
      const configuredRollWidth = resolveServerMainProductRollWidth(builderConfig)

      const resolved = await resolveForMetadata({
        shopDomain,
        shop: {
          id: shop.id,
          accessToken: shop.accessToken,
          settings: shop.settings,
        },
        productIdRaw: rawProductId,
        builderConfig,
        rawMetadata: firstLifecycle.metadata,
        quantity: requestedLine.copies,
        selectedVariantId: requestedLine.selectedVariantId || upload.variantId,
        lockSelectedVariant: requestedLine.lockSelectedVariant,
        customerId: signedCustomerId,
        measurementPolicy,
        measurementBasis: getStoredMeasurementBasis(
          firstItem.preflightResult,
          getRuntimeMeasurementBasis(shopDomain, shop.settings)
        ),
        rollWidthIn: configuredRollWidth,
      })

      if (resolved.kind !== 'ok') {
        if (resolved.kind === 'no_fit') {
          await persistMainProductMeasurementProjection(
            firstItem.id,
            resolved.canonicalMetadata,
            configuredRollWidth
          )
        }
        lifecycleByUploadId.set(upload.id, { ...lifecycleState, orderable: false })
        preparationErrorByUpload.set(
          upload.id,
          resolved.kind === 'no_fit'
            ? resolved.failure?.message || 'This design does not fit any available sheet.'
            : resolved.kind === 'product_not_found'
              ? 'The configured product could not be found.'
              : 'Upload measurement is not ready for cart yet.'
        )
        return
      }

      await persistMainProductMeasurementProjection(
        firstItem.id,
        resolved.canonicalMetadata,
        configuredRollWidth
      )

      const resolution = resolved.resolution
      const selectedVariantRaw = String(resolution.selectedVariantId || '').trim()
      const variantId = selectedVariantRaw.match(/(\d+)$/)?.[1] || selectedVariantRaw || null
      const baseLabel = String(
        resolution.selectedSheetLabel || resolution.selectedVariantTitle || ''
      ).trim()
      const variantTitle = String(resolution.selectedVariantTitle || '').trim() || null
      const carrierQuantity = Math.max(
        1,
        Math.floor(
          Number(
            resolved.pricingMode === 'linear_inches'
              ? resolution.cartQuantity
              : requestedLine.copies
          ) || requestedLine.copies
        )
      )
      canonicalLineByUpload.set(upload.id, {
        copies: requestedLine.copies,
        sheetsNeeded: requestedLine.copies,
        cartQuantity: carrierQuantity,
        variantId,
        variantTitle,
        sheetLabel: baseLabel.slice(0, 200) || null,
        dpi:
          Number(
            resolved.canonicalMetadata.effectiveDpi ||
              resolved.canonicalMetadata.documentDpi ||
              resolved.canonicalMetadata.dpi ||
              0
          ) || null,
      })
    })
  )

  // Persist production facts only after the server measurement says the
  // upload can be ordered. Orientation is normalized measurement data, not a
  // production instruction.
  await Promise.all(
    Array.from(canonicalLineByUpload.entries())
      .filter(([uploadId]) => lifecycleByUploadId.get(uploadId)?.orderable === true)
      .map(([uploadId, line]) =>
        prisma.upload.update({
          where: { id: uploadId },
          data: {
            quantitySemantics: 'whole_sheet',
            requestedCopies: line.copies,
            // Compatibility column: one uploaded file is always one sheet.
            designsPerSheet: 1,
            sheetsNeeded: line.sheetsNeeded,
            cartVariantId: line.variantId,
            cartSheetLabel: line.sheetLabel,
          },
        })
      )
  )

  const items = uploadIds.map((uploadId) => {
    const upload = byId.get(uploadId)
    if (!upload) {
      return { uploadId, found: false as const, orderable: false, properties: null }
    }

    const firstItem = upload.items[0]
    const lifecycleState = lifecycleByUploadId.get(uploadId)
    const lifecycles = lifecycleState?.lifecycles || []
    const orderable = lifecycleState?.orderable === true
    const cartInstruction = canonicalLineByUpload.get(uploadId) || null

    const identityUrl = buildIdentityUrl(upload.id)
    const fileUrl = firstItem ? buildFileUrl(storageConfig, firstItem.storageKey) : null

    // Exactly three customer-visible line properties (merchant decision,
    // 2026-09): the print-ready file, the Sheet Identity page that only this
    // app writes and can resolve, and the measured DPI. Everything else the
    // shop needs (copies, sheet, sizes) lives on the identity page.
    const dpi =
      cartInstruction?.dpi ||
      lifecycles
        .map((l) => Number(l.metadata?.effectiveDpi || l.metadata?.documentDpi || l.metadata?.dpi || 0))
        .find((n) => n > 0)
    const properties: Record<string, string> = {
      [PRINT_READY_PROPERTY]: fileUrl || identityUrl,
      [SHEET_IDENTITY_PROPERTY]: identityUrl,
      [DPI_PROPERTY]: dpi ? String(Math.round(dpi)) : 'n/a',
    }

    return {
      uploadId,
      found: true as const,
      orderable,
      properties: orderable ? properties : null,
      cartInstruction: orderable ? cartInstruction : null,
      error:
        orderable
          ? null
          : preparationErrorByUpload.get(uploadId) ||
            lifecycles.flatMap((lifecycle) => lifecycle.errors)[0] ||
            'Upload measurement is not ready for cart yet.',
      fileName: firstItem?.originalName || null,
      thumbnailUrl: firstItem ? buildThumbnailUrl(storageConfig, firstItem.thumbnailKey) : null,
      identityUrl,
    }
  })

  const missing = items.filter((i) => !i.found).map((i) => i.uploadId)
  if (missing.length) {
    console.warn(`[Cart Prepare] Unknown uploads for ${shopDomain}: ${missing.join(', ')}`)
  }

  return corsJson({ success: true, items }, request)
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }
  return corsJson({ success: false, error: 'POST only' }, request, { status: 405 })
}
