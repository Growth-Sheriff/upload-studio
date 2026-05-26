import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { completeR2Multipart, getStorageConfig } from '~/lib/storage.server'

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  return corsJson({ method: 'POST', description: 'Complete a multipart upload after all parts are uploaded' }, request)
}

interface PartInput {
  partNumber: number
  etag: string
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

  const { shopDomain, uploadId: appUploadId, key, multipartUploadId, parts } = body as {
    shopDomain?: string
    uploadId?: string
    key?: string
    multipartUploadId?: string
    parts?: PartInput[]
  }

  if (!shopDomain || !key || !multipartUploadId) {
    return corsJson(
      { error: 'Missing required fields: shopDomain, key, multipartUploadId' },
      request,
      { status: 400 }
    )
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    return corsJson({ error: 'parts array is required and non-empty' }, request, { status: 400 })
  }
  for (const p of parts) {
    if (typeof p.partNumber !== 'number' || !p.etag) {
      return corsJson({ error: 'Each part needs { partNumber, etag }' }, request, { status: 400 })
    }
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) return corsJson({ error: 'Shop not found' }, request, { status: 404 })

  // Validate the app uploadId belongs to this shop (defense in depth)
  if (appUploadId) {
    const upload = await prisma.upload.findFirst({
      where: { id: appUploadId, shopId: shop.id },
      select: { id: true },
    })
    if (!upload) {
      return corsJson({ error: 'Upload not found in this shop' }, request, { status: 404 })
    }
  }

  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })

  const result = await completeR2Multipart(storageConfig, key, multipartUploadId, parts)
  if (!result.ok) {
    console.error(`[Multipart Complete] R2 complete failed for ${key}:`, result.error)
    return corsJson({ error: result.error || 'multipart_complete_failed' }, request, { status: 500 })
  }

  console.log(
    `[Multipart Complete] OK shop=${shopDomain} key=${key} parts=${parts.length} location=${result.location?.slice(0, 80)}`
  )
  return corsJson({ success: true, location: result.location }, request)
}
