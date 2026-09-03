// POST /api/upload/multipart-resume — continue an interrupted R2 multipart
// upload. The browser keeps {uploadId, itemId, key, multipartUploadId,
// partSize, totalParts} per file fingerprint; after a refresh, network drop
// or tab close it asks which parts R2 already holds and gets fresh presigned
// URLs for the rest. Nothing is re-uploaded that already landed.

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import {
  getStorageConfig,
  listR2MultipartParts,
  presignR2MultipartParts,
} from '~/lib/storage.server'

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  return corsJson({ method: 'POST', description: 'Resume an interrupted multipart upload' }, request)
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'uploadIntent')
  if (rateLimitResponse) return rateLimitResponse

  let body: any
  try {
    body = await request.json()
  } catch {
    return corsJson({ error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const shopDomain = String(body.shopDomain || '').trim()
  const uploadId = String(body.uploadId || '').trim()
  const key = String(body.key || '').trim()
  const multipartUploadId = String(body.multipartUploadId || '').trim()
  const totalParts = Math.floor(Number(body.totalParts) || 0)

  if (!shopDomain || !uploadId || !key || !multipartUploadId || totalParts < 1 || totalParts > 10_000) {
    return corsJson(
      { error: 'Missing required fields: shopDomain, uploadId, key, multipartUploadId, totalParts' },
      request,
      { status: 400 }
    )
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) return corsJson({ error: 'Shop not found' }, request, { status: 404 })

  // The upload must belong to this shop, still be a draft, and the key must
  // be the one we issued for it — a client cannot resume into someone else's
  // object.
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    select: { id: true, status: true, items: { select: { storageKey: true } } },
  })
  if (!upload) return corsJson({ error: 'Upload not found' }, request, { status: 404 })
  const ownsKey = upload.items.some((item) => item.storageKey === `r2:${key}` || item.storageKey === key)
  if (!ownsKey) return corsJson({ error: 'Key does not belong to this upload' }, request, { status: 403 })
  if (upload.status !== 'draft') {
    return corsJson({ error: 'Upload already finalized', status: upload.status }, request, { status: 409 })
  }

  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })

  const listed = await listR2MultipartParts(storageConfig, key, multipartUploadId)
  if (!listed.ok) {
    // Upload id expired/aborted on R2 — the client must start over.
    return corsJson({ error: listed.error || 'multipart_not_found', code: 'MULTIPART_GONE' }, request, { status: 410 })
  }

  const have = new Set(listed.parts.map((p) => p.partNumber))
  const missing: number[] = []
  for (let n = 1; n <= totalParts; n++) if (!have.has(n)) missing.push(n)
  const presigned = await presignR2MultipartParts(storageConfig, key, multipartUploadId, missing)

  console.log(
    `[Multipart Resume] shop=${shopDomain} upload=${uploadId} have=${have.size}/${totalParts} missing=${missing.length}`
  )

  return corsJson(
    {
      success: true,
      uploadedParts: listed.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      parts: presigned,
      completeUrl: `${process.env.SHOPIFY_APP_URL || ''}/api/upload/multipart-complete`,
      abortUrl: `${process.env.SHOPIFY_APP_URL || ''}/api/upload/multipart-abort`,
    },
    request
  )
}
