import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { nanoid } from 'nanoid'
import { checkUploadAllowed, MAX_FILE_SIZE_MB } from '~/lib/billing.server'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import {
  buildStorageKey,
  buildStorageKeyWithPrefix,
  getR2MultipartInit,
  getStorageConfig,
  getUploadSignedUrl,
  isR2FallbackAvailable,
  MULTIPART_THRESHOLD_BYTES,
  type R2MultipartInitResult,
  type UploadUrlResult,
} from '~/lib/storage.server'
import { uploadLogger } from '~/lib/uploadLogger.server'


export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }
  return corsJson(
    {
      method: 'POST',
      description: 'Upload Intent API - Get signed upload URL',
      modes: ['quick', 'full', 'bulk'],
    },
    request
  )
}




export async function action({ request }: ActionFunctionArgs) {

  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }


  let body: any
  try {
    const contentType = request.headers.get('content-type') || ''


    if (contentType.includes('application/json')) {
      body = await request.json()
    } else if (contentType.includes('form')) {
      const formData = await request.formData()
      body = Object.fromEntries(formData)
    } else {

      const text = await request.text()
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          console.error('[Upload Intent] Failed to parse body:', text.substring(0, 200))
          return corsJson({ error: 'Invalid JSON body' }, request, { status: 400 })
        }
      } else {
        return corsJson({ error: 'Empty request body' }, request, { status: 400 })
      }
    }
  } catch (e) {
    console.error('[Upload Intent] Body parse error:', e)
    return corsJson({ error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const {
    shopDomain,
    productId,
    variantId,
    mode,
    contentType,
    fileName,
    fileSize,
    customerId,
    customerEmail,
    visitorId,
    sessionId,
  } = body

  // Optional transport hints from the storefront probe.
  const fingerprint =
    typeof body.fingerprint === 'string' && /^v1-\d+-[a-f0-9]{64}$/.test(body.fingerprint)
      ? body.fingerprint
      : null
  const partSizeHintMb = Number(body.partSizeMb)
  const partSizeOverride =
    Number.isFinite(partSizeHintMb) && partSizeHintMb >= 5 && partSizeHintMb <= 64
      ? Math.round(partSizeHintMb) * 1024 * 1024
      : undefined


  if (!shopDomain) {
    return corsJson({ error: 'Missing required field: shopDomain' }, request, { status: 400 })
  }

  if (!mode || !contentType || !fileName) {
    return corsJson({ error: 'Missing required fields: mode, contentType, fileName' }, request, {
      status: 400,
    })
  }


  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'uploadIntent')
  if (rateLimitResponse) {
    return rateLimitResponse
  }


  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return corsJson({ error: 'Shop not found' }, request, { status: 404 })
  }


  if (!['dtf', '3d_designer', 'classic', 'quick', 'builder'].includes(mode)) {
    return corsJson({ error: 'Invalid mode' }, request, { status: 400 })
  }


  const fileSizeMB = fileSize ? fileSize / (1024 * 1024) : 0
  const billingCheck = await checkUploadAllowed(shop.id, mode, fileSizeMB)

  if (!billingCheck.allowed) {
    return corsJson(
      {
        error: billingCheck.error,
        code: 'BILLING_LIMIT',
      },
      request,
      { status: 403 }
    )
  }


  const allowedTypes = [

    'image/png',
    'image/jpeg',
    'image/webp',
    'image/tiff',
    'image/x-tiff',

    'image/vnd.adobe.photoshop',
    'application/vnd.adobe.photoshop',
    'application/x-photoshop',
    'image/x-psd',
    'application/photoshop',
    'application/psd',

    'image/svg+xml',
    'application/pdf',
    'application/postscript',
    'application/illustrator',
    'application/vnd.adobe.illustrator',
    'application/eps',
    'application/x-eps',
    'image/x-eps',

    'application/octet-stream',
  ]


  const allowedExtensions = [
    'png',
    'jpg',
    'jpeg',
    'webp',
    'tiff',
    'tif',
    'psd',
    'svg',
    'pdf',
    'ai',
    'eps',
  ]


  if (!allowedTypes.includes(contentType)) {
    return corsJson({ error: 'Unsupported file type' }, request, { status: 400 })
  }


  if (contentType === 'application/octet-stream') {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    if (!allowedExtensions.includes(ext)) {
      return corsJson(
        {
          error: `Unsupported file extension: .${ext}. Allowed: ${allowedExtensions.join(', ')}`,
          code: 'INVALID_EXTENSION',
        },
        request,
        { status: 400 }
      )
    }
  }


  if (fileSize && fileSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return corsJson(
      {
        error: `File too large. Maximum size: ${MAX_FILE_SIZE_MB}MB`,
        code: 'FILE_TOO_LARGE',
        maxSizeMB: MAX_FILE_SIZE_MB,
      },
      request,
      { status: 413 }
    )
  }


  // Instant re-upload: the same file (content fingerprint) from the same
  // customer/visitor that already measured fine is reused — zero bytes sent.
  // Guests without any identity never dedupe (no cross-customer reuse).
  if (fingerprint && (customerId || visitorId)) {
    const existing = await prisma.upload.findFirst({
      where: {
        shopId: shop.id,
        productId: productId ? String(productId) : null,
        status: { notIn: ['archived', 'blocked'] },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
        ...(customerId ? { customerId: String(customerId) } : { visitorId: String(visitorId) }),
        items: {
          some: {
            fingerprint,
            preflightStatus: { in: ['ok', 'warning'] },
            NOT: { storageKey: '' },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, items: { select: { id: true, fingerprint: true }, orderBy: { createdAt: 'asc' } } },
    })
    if (existing) {
      const item = existing.items.find((i) => i.fingerprint === fingerprint) || existing.items[0]
      console.log(`[Upload Intent] Dedupe hit: fingerprint reuse -> upload ${existing.id} (shop ${shopDomain})`)
      return corsJson(
        {
          deduplicated: true,
          uploadId: existing.id,
          itemId: item?.id || null,
          fileName,
          fileSize,
          mimeType: contentType,
        },
        request
      )
    }
  }

  const uploadId = nanoid(12)
  const itemId = nanoid(8)


  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })

  console.log(`[Upload Intent] Shop: ${shopDomain}, Storage: ${storageConfig.provider}`)


  const key = buildStorageKey(shopDomain, uploadId, itemId, fileName)



  const storageKeyWithPrefix = buildStorageKeyWithPrefix(
    storageConfig.provider,
    shopDomain,
    uploadId,
    itemId,
    fileName
  )

  try {


    let validVisitorId = visitorId || null
    let validSessionId = sessionId || null

    if (visitorId) {
      const visitorExists = await prisma.visitor.findFirst({
        where: { id: visitorId, shopId: shop.id },
        select: { id: true },
      })
      if (!visitorExists) {
        console.warn(`[Upload Intent] visitorId ${visitorId} not found for shop ${shop.id} - ignoring`)
        validVisitorId = null
        validSessionId = null
      }
    }

    if (validVisitorId && sessionId) {
      const sessionExists = await prisma.visitorSession.findFirst({
        where: { id: sessionId, shopId: shop.id },
        select: { id: true },
      })
      if (!sessionExists) {
        console.warn(`[Upload Intent] sessionId ${sessionId} not found for shop ${shop.id} - ignoring`)
        validSessionId = null
      }
    }


    const upload = await prisma.upload.create({
      data: {
        id: uploadId,
        shopId: shop.id,
        productId,
        variantId,
        mode,
        status: 'draft',
        customerId: customerId || null,
        customerEmail: customerEmail || null,
        visitorId: validVisitorId,
        sessionId: validSessionId,
      },
    })


    if (validVisitorId) {
      console.log(
        `[Upload Intent] Upload ${uploadId} linked to visitor ${validVisitorId}, session ${validSessionId || 'N/A'}`
      )
    }




    await prisma.uploadItem.create({
      data: {
        id: itemId,
        uploadId: upload.id,
        location: 'front', // default, will be updated later
        storageKey: storageKeyWithPrefix, // WITH prefix for unambiguous provider resolution
        originalName: fileName,
        mimeType: contentType,
        fileSize: fileSize || null,
        fingerprint,
        preflightStatus: 'pending',
      },
    })


    const uploadResult: UploadUrlResult = await getUploadSignedUrl(storageConfig, key, contentType)


    if (uploadResult.fallbackUrls) {
      console.log('[Upload Intent] Fallback URLs generated:', {
        r2: !!uploadResult.fallbackUrls.r2,
        local: !!uploadResult.fallbackUrls.local,
      })
    }


    let multipart: R2MultipartInitResult | null = null
    if (
      fileSize &&
      fileSize >= MULTIPART_THRESHOLD_BYTES &&
      isR2FallbackAvailable()
    ) {
      try {
        multipart = await getR2MultipartInit(storageConfig, key, contentType, fileSize, partSizeOverride)
        if (multipart) {
          console.log(
            `[Upload Intent] Multipart enabled: ${multipart.totalParts} parts of ${Math.round(multipart.partSize / 1024 / 1024)}MB (uploadId=${multipart.uploadId.slice(0, 16)}...)`
          )
        }
      } catch (multipartError) {
        console.warn('[Upload Intent] Multipart init failed, falling back to single-shot:', multipartError)
      }
    }


    await uploadLogger.intentCreated(uploadId, {
      shopId: shop.id,
      shopDomain,
      fileName,
      fileSize,
      contentType,
      provider: uploadResult.provider as any,
      metadata: {
        mode,
        productId,
        variantId,
        hasR2Fallback: !!uploadResult.fallbackUrls?.r2,
        hasLocalFallback: !!uploadResult.fallbackUrls?.local,
        visitorId,
        sessionId,
      },
    })

    return corsJson(
      {
        uploadId,
        itemId,
        uploadUrl: uploadResult.url,
        key: uploadResult.key,
        publicUrl: uploadResult.publicUrl,
        fileName,
        fileSize,
        mimeType: contentType,
        expiresIn: 3600, // 1 hour for large files
        storageProvider: uploadResult.provider,
        uploadMethod: uploadResult.method,
        uploadHeaders: uploadResult.headers || {},

        fallbackUrls: uploadResult.fallbackUrls || {},
        retryConfig: uploadResult.retryConfig || { maxRetries: 3, retryDelayMs: 2000 },
        multipart: multipart || undefined,
      },
      request
    )
  } catch (error) {
    console.error('[Upload Intent] Error:', error)


    await uploadLogger.uploadFailed('intent_error', 'unknown', {
      code: 'INTENT_CREATION_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: { shopDomain, fileName },
    })

    return corsJson({ error: 'Failed to create upload intent' }, request, { status: 500 })
  }
}
