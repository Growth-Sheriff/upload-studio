// POST /api/cart/prepare — server-built cart line properties for uploads.
//
// The storefront widget must not invent line properties: it sends the upload
// ids it wants to add to the cart and receives the canonical property set
// back. This keeps the cart a *reference carrier* (two visible links plus a
// transitional hidden id) while every fact lives in the DB and is served by
// the /i/<uploadId> identity page.
//
// Request:  { shopDomain, uploadIds: string[] }
// Response: { success, items: [{ uploadId, orderable, properties, fileName, thumbnailUrl }] }

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { deriveUploadItemLifecycle } from '~/lib/uploadLifecycle.server'
import {
  FILE_PROPERTY,
  IDENTITY_PROPERTY,
  LEGACY_ID_PROPERTY,
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

  let body: { shopDomain?: string; uploadIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return corsJson({ success: false, error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const shopDomain = String(body.shopDomain || '').trim()
  const uploadIds = Array.isArray(body.uploadIds)
    ? body.uploadIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(id))
    : []

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

    // All carriers are underscore-prefixed: hidden from the customer's
    // cart/checkout summary (GSB pattern), visible to merchants in order
    // admin. `_Print Ready File` doubles as DripApps checkout-rule compat:
    // its "No gang sheet uploaded" validation looks for that key on shared
    // gang-sheet products; a priced line with a non-dripapps URL matches
    // none of its other scanners (zero-price poll, dripappsserver rewrite).
    const properties: Record<string, string> = {
      // Customer-visible (Shopify renders non-underscore properties in cart,
      // checkout and order confirmation; universal theme snippets shorten
      // URL values to a clickable filename link).
      'Uploaded File': fileUrl || identityUrl,
      // Hidden carriers (underscore = never shown to the customer).
      [FILE_PROPERTY]: fileUrl || identityUrl,
      [IDENTITY_PROPERTY]: identityUrl,
      '_Print Ready File': fileUrl || identityUrl,
      // Transition carrier: webhook's primary key until all readers migrate.
      [LEGACY_ID_PROPERTY]: upload.id,
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
