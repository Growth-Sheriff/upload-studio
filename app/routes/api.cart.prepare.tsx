// POST /api/cart/prepare — server-built cart line properties for uploads.
//
// The storefront widget must not invent line properties: it sends the upload
// ids it wants to add to the cart and receives the canonical property set
// back. This keeps the cart a *reference carrier* (two visible links plus a
// transitional hidden id) while every fact lives in the DB and is served by
// the /i/<uploadId> identity page.
//
// Request:  { shopDomain, uploadIds: string[], lines?: [{ uploadId, copies, designsPerSheet, sheetsNeeded, variantId, sheetLabel }] }
// Response: { success, items: [{ uploadId, orderable, properties, fileName, thumbnailUrl }] }
//
// `lines` carries the customer's nesting request (copies of the design) so it
// is persisted on the upload and written as a customer-visible `Copies` line
// property — the print shop must know how many to gang on each sheet.

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { deriveUploadItemLifecycle } from '~/lib/uploadLifecycle.server'
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

  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  let body: { shopDomain?: string; uploadIds?: unknown; lines?: unknown }
  try {
    body = await request.json()
  } catch {
    return corsJson({ success: false, error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const shopDomain = String(body.shopDomain || '').trim()
  const uploadIds = Array.isArray(body.uploadIds)
    ? body.uploadIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(id))
    : []

  const toInt = (value: unknown, min: number, max: number): number | null => {
    const n = Math.floor(Number(value))
    return Number.isFinite(n) && n >= min && n <= max ? n : null
  }
  const lineByUpload = new Map<
    string,
    { copies: number; designsPerSheet: number | null; sheetsNeeded: number | null; variantId: string | null; sheetLabel: string | null }
  >()
  if (Array.isArray(body.lines)) {
    for (const raw of body.lines as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') continue
      const uploadId = typeof raw.uploadId === 'string' ? raw.uploadId : ''
      if (!uploadIds.includes(uploadId)) continue
      lineByUpload.set(uploadId, {
        copies: toInt(raw.copies, 1, 999) ?? 1,
        designsPerSheet: toInt(raw.designsPerSheet, 1, 100000),
        sheetsNeeded: toInt(raw.sheetsNeeded, 1, 100000),
        variantId: raw.variantId != null && /^\d{1,20}$/.test(String(raw.variantId)) ? String(raw.variantId) : null,
        sheetLabel: typeof raw.sheetLabel === 'string' ? raw.sheetLabel.slice(0, 80) : null,
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
    },
  })
  const byId = new Map(uploads.map((u) => [u.id, u]))
  const storageConfig = storageConfigForShop(shop)

  // Persist the nesting request before building properties, so the order
  // line, the identity page and the merchant admin all read the same numbers.
  await Promise.all(
    Array.from(lineByUpload.entries())
      .filter(([uploadId]) => byId.has(uploadId))
      .map(([uploadId, line]) =>
        prisma.upload.update({
          where: { id: uploadId },
          data: {
            requestedCopies: line.copies,
            designsPerSheet: line.designsPerSheet,
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
    const lifecycles = upload.items.map((item) =>
      deriveUploadItemLifecycle({
        preflightStatus: item.preflightStatus,
        preflightResult: item.preflightResult,
        thumbnailKey: item.thumbnailKey,
      })
    )
    const orderable = lifecycles.length > 0 && lifecycles.every((l) => l.canAddToCart)

    const identityUrl = buildIdentityUrl(upload.id)
    const fileUrl = firstItem ? buildFileUrl(storageConfig, firstItem.storageKey) : null

    // Exactly three customer-visible line properties (merchant decision,
    // 2026-09): the print-ready file, the Sheet Identity page that only this
    // app writes and can resolve, and the measured DPI. Everything else the
    // shop needs (copies, sheet, sizes) lives on the identity page.
    const dpi = lifecycles
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
      properties,
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
