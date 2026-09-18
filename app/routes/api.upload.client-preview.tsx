import type { ActionFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { isFastRasterUpload } from '~/lib/fastRaster'
import { parseWebpInfo } from '~/lib/preflight.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { writeStoredObject } from '~/lib/storage.server'
import { buildThumbnailStorageKey } from '~/lib/uploadQueues'
import { buildThumbnailUrl, storageConfigForShop } from '~/lib/uploadUrls.server'
import { authenticate } from '~/shopify.server'

const MAX_CLIENT_PREVIEW_BYTES = 4 * 1024 * 1024

async function readBoundedBody(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Preview body is empty')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_CLIENT_PREVIEW_BYTES) throw new Error('Preview is too large')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  await authenticate.public.appProxy(request)
  const rateLimitResponse = await rateLimitGuard(getIdentifier(request, 'customer'), 'preflight')
  if (rateLimitResponse) return rateLimitResponse

  const url = new URL(request.url)
  const shopDomain = String(url.searchParams.get('shop') || '').trim()
  const uploadId = String(url.searchParams.get('uploadId') || '').trim()
  const itemId = String(url.searchParams.get('itemId') || '').trim()
  if (!shopDomain || !uploadId || !itemId) {
    return corsJson({ error: 'Missing preview identity' }, request, { status: 400 })
  }
  if (!/^image\/webp(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    return corsJson({ error: 'Preview must be WebP' }, request, { status: 415 })
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) return corsJson({ error: 'Shop not found' }, request, { status: 404 })

  const item = await prisma.uploadItem.findFirst({
    where: {
      id: itemId,
      uploadId,
      upload: {
        shopId: shop.id,
        status: { in: ['draft', 'completing', 'uploaded', 'processing', 'ready', 'pending_approval'] },
      },
    },
    select: {
      id: true,
      storageKey: true,
      previewKey: true,
      originalName: true,
      mimeType: true,
    },
  })
  if (!item) return corsJson({ error: 'Upload item not found' }, request, { status: 404 })
  if (!isFastRasterUpload(item)) {
    return corsJson({ error: 'Client previews are only accepted for PNG/JPEG uploads' }, request, {
      status: 415,
    })
  }

  let data: Buffer
  try {
    data = await readBoundedBody(request)
  } catch (error) {
    return corsJson(
      { error: error instanceof Error ? error.message : 'Invalid preview body' },
      request,
      { status: 413 }
    )
  }
  const info = parseWebpInfo(data)
  if (!info || !(info.width > 0) || !(info.height > 0) || Math.max(info.width, info.height) > 1024) {
    return corsJson({ error: 'Invalid client preview' }, request, { status: 422 })
  }

  const thumbnailKey = buildThumbnailStorageKey(item.storageKey, false)
  const storageConfig = storageConfigForShop(shop)
  await writeStoredObject(storageConfig, thumbnailKey, data, 'image/webp')
  await prisma.uploadItem.updateMany({
    where: { id: item.id, uploadId, upload: { shopId: shop.id } },
    data: {
      thumbnailKey,
      previewKey: item.previewKey || item.storageKey,
    },
  })

  return corsJson(
    {
      success: true,
      thumbnailKey,
      thumbnailUrl: buildThumbnailUrl(storageConfig, thumbnailKey),
    },
    request
  )
}
