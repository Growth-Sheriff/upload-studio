import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { nanoid } from 'nanoid'
import { checkUploadAllowed } from '~/lib/billing.server'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import {
  buildStorageKey,
  buildStorageKeyWithPrefix,
  getStorageConfig,
  getUploadSignedUrl,
  type UploadUrlResult,
} from '~/lib/storage.server'
import { uploadLogger } from '~/lib/uploadLogger.server'

// Plan limits - Updated for 1GB standard, 1453MB pro
const PLAN_LIMITS = {
  free: { maxSizeMB: 1024, uploadsPerMonth: 100 }, // Free: 1GB (1024MB)
  starter: { maxSizeMB: 1024, uploadsPerMonth: 10000 }, // Starter: 1GB (1024MB), 10K/ay
  pro: { maxSizeMB: 1453, uploadsPerMonth: -1 }, // Pro: 1453MB unlimited
  enterprise: { maxSizeMB: 1453, uploadsPerMonth: -1 }, // Enterprise: 1453MB unlimited
}

// GET handler - returns API info
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

// POST /api/upload/intent
// Request: { shopDomain, productId?, variantId?, mode, contentType, fileName }
// Response: { uploadId, itemId, uploadUrl, key, expiresIn }
export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  // Parse request body first to get shopDomain
  let body: any
  try {
    const contentType = request.headers.get('content-type') || ''

    // App Proxy may send as form data or have empty body
    if (contentType.includes('application/json')) {
      body = await request.json()
    } else if (contentType.includes('form')) {
      const formData = await request.formData()
      body = Object.fromEntries(formData)
    } else {
      // Try JSON first, fallback to empty
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

  // Validate required fields
  if (!shopDomain) {
    return corsJson({ error: 'Missing required field: shopDomain' }, request, { status: 400 })
  }

  if (!mode || !contentType || !fileName) {
    return corsJson({ error: 'Missing required fields: mode, contentType, fileName' }, request, {
      status: 400,
    })
  }

  // Rate limit check (10/min per customer)
  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'uploadIntent')
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  // Get shop from database
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return corsJson({ error: 'Shop not found' }, request, { status: 404 })
  }

  // Validate mode
  if (!['dtf', '3d_designer', 'classic', 'quick', 'builder'].includes(mode)) {
    return corsJson({ error: 'Invalid mode' }, request, { status: 400 })
  }

  // Check billing / plan limits
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

  // Validate content type - Support all major image formats
  const allowedTypes = [
    // 🟢 Raster - Temel
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/tiff', // TIFF support
    // 🟢 Profesyonel Raster
    'image/vnd.adobe.photoshop', // PSD
    'application/x-photoshop', // PSD alternative
    'image/x-psd', // PSD alternative
    'application/photoshop', // PSD alternative
    'application/psd', // PSD alternative
    // 🟡 Vektör
    'image/svg+xml',
    'application/pdf',
    'application/postscript', // AI/EPS
    'application/illustrator', // AI
    // 🟠 Fallback for unknown MIME types (check extension)
    'application/octet-stream',
  ]

  // Allowed file extensions for octet-stream fallback
  const allowedExtensions = [
    'png',
    'jpg',
    'jpeg',
    'webp',
    'tiff',
    'tif', // Raster
    'psd', // Photoshop
    'svg',
    'pdf',
    'ai',
    'eps', // Vector
  ]

  // Check MIME type first
  if (!allowedTypes.includes(contentType)) {
    return corsJson({ error: 'Unsupported file type' }, request, { status: 400 })
  }

  // For octet-stream, validate by extension
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

  // Check plan limits
  const planKey = shop.plan as keyof typeof PLAN_LIMITS
  const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.free

  // Check file size
  if (fileSize && fileSize > limits.maxSizeMB * 1024 * 1024) {
    return corsJson(
      {
        error: `File too large. Max size for ${shop.plan} plan: ${limits.maxSizeMB}MB`,
        code: 'FILE_TOO_LARGE',
        maxSizeMB: limits.maxSizeMB,
      },
      request,
      { status: 413 }
    )
  }

  // Check monthly upload limit
  if (limits.uploadsPerMonth > 0) {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const monthlyUploads = await prisma.upload.count({
      where: {
        shopId: shop.id,
        createdAt: { gte: startOfMonth },
      },
    })

    if (monthlyUploads >= limits.uploadsPerMonth) {
      return corsJson(
        {
          error: `Monthly upload limit reached (${limits.uploadsPerMonth})`,
          code: 'LIMIT_REACHED',
          limit: limits.uploadsPerMonth,
          used: monthlyUploads,
        },
        request,
        { status: 429 }
      )
    }
  }

  // Generate IDs
  const uploadId = nanoid(12)
  const itemId = nanoid(8)

  // MULTI-STORAGE: Get config from shop settings
  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })

  console.log(`[Upload Intent] Shop: ${shopDomain}, Storage: ${storageConfig.provider}`)

  // Build storage key (raw path without prefix - used for signed URL)
  const key = buildStorageKey(shopDomain, uploadId, itemId, fileName)
  
  // Build storage key WITH provider prefix (stored in DB - used by preflight worker)
  // CRITICAL: This ensures preflight always knows which provider to use
  const storageKeyWithPrefix = buildStorageKeyWithPrefix(
    storageConfig.provider,
    shopDomain,
    uploadId,
    itemId,
    fileName
  )

  try {
    // Validate visitor/session belong to shop if provided
    // Invalid IDs are silently ignored to avoid blocking the upload flow
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

    // Create upload record with visitor tracking
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

    // Log visitor tracking if present
    if (validVisitorId) {
      console.log(
        `[Upload Intent] Upload ${uploadId} linked to visitor ${validVisitorId}, session ${validSessionId || 'N/A'}`
      )
    }

    // Create upload item record
    // CRITICAL: storageKey includes provider prefix (e.g., "bunny:shop/prod/...")
    // This is the canonical format - preflight worker uses this directly
    await prisma.uploadItem.create({
      data: {
        id: itemId,
        uploadId: upload.id,
        location: 'front', // default, will be updated later
        storageKey: storageKeyWithPrefix, // WITH prefix for unambiguous provider resolution
        originalName: fileName,
        mimeType: contentType,
        fileSize: fileSize || null,
        preflightStatus: 'pending',
      },
    })

    // Generate signed upload URL (provider-aware) with fallback URLs
    const uploadResult: UploadUrlResult = await getUploadSignedUrl(storageConfig, key, contentType)

    // Log fallback availability
    if (uploadResult.fallbackUrls) {
      console.log('[Upload Intent] Fallback URLs generated:', {
        r2: !!uploadResult.fallbackUrls.r2,
        local: !!uploadResult.fallbackUrls.local,
      })
    }

    // Log intent creation
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
        // BULLETPROOF v3.0: Include fallback URLs and retry config
        fallbackUrls: uploadResult.fallbackUrls || {},
        retryConfig: uploadResult.retryConfig || { maxRetries: 3, retryDelayMs: 2000 },
      },
      request
    )
  } catch (error) {
    console.error('[Upload Intent] Error:', error)
    
    // Log intent creation failure
    await uploadLogger.uploadFailed('intent_error', 'unknown', {
      code: 'INTENT_CREATION_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: { shopDomain, fileName },
    })
    
    return corsJson({ error: 'Failed to create upload intent' }, request, { status: 500 })
  }
}
