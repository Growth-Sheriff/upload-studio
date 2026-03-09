import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { triggerUploadReceived } from '~/lib/flow.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { uploadLogger } from '~/lib/uploadLogger.server'

// ============================================================================
// FAZ 0 - API-001: Singleton Redis Connection
// Prevents connection leak by reusing a single connection across all requests
// ============================================================================
let redisConnection: Redis | null = null

const getRedisConnection = (): Redis => {
  if (!redisConnection) {
    redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY'
        if (err.message.includes(targetError)) {
          // Only reconnect on READONLY errors (failover scenario)
          return true
        }
        return false
      },
    })

    redisConnection.on('error', (err: Error) => {
      console.error('[Redis] Connection error:', err.message)
    })

    redisConnection.on('connect', () => {
      console.log('[Redis] Connected successfully')
    })

    redisConnection.on('close', () => {
      console.warn('[Redis] Connection closed')
      redisConnection = null // Allow reconnection on next request
    })
  }
  return redisConnection
}

// POST /api/upload/complete
// Request: { shopDomain, uploadId, items: [{ itemId, location, transform? }] }
export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  // Rate limiting
  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'preflight')
  if (rateLimitResponse) return rateLimitResponse

  let body: any
  try {
    body = await request.json()
  } catch {
    return corsJson({ error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const { shopDomain, uploadId, items } = body

  if (!shopDomain) {
    return corsJson({ error: 'Missing required field: shopDomain' }, request, { status: 400 })
  }

  if (!uploadId) {
    return corsJson({ error: 'Missing required field: uploadId' }, request, { status: 400 })
  }

  // items is optional for quick mode - will use existing items from intent

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return corsJson({ error: 'Shop not found' }, request, { status: 404 })
  }

  // Get shop settings for auto-approve feature
  const shopSettings = (shop.settings as Record<string, any>) || {}
  const autoApprove = shopSettings.autoApprove !== false // Default to true

  // Verify upload belongs to shop
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    include: { items: true },
  })

  if (!upload) {
    return corsJson({ error: 'Upload not found' }, request, { status: 404 })
  }

  if (upload.status !== 'draft') {
    return corsJson({ error: 'Upload already completed' }, request, { status: 400 })
  }

  try {
    // ========================================================================
    // 0-BYTE FILE PROTECTION (SERVER-SIDE)
    // Verify at least one item has a non-zero fileSize before accepting
    // This prevents empty/corrupt files from entering the system
    // ========================================================================
    if (items && Array.isArray(items) && items.length > 0) {
      const hasZeroByteFile = items.some(
        (item: any) => item.fileSize !== undefined && item.fileSize <= 0
      )
      if (hasZeroByteFile) {
        console.error(`[Upload Complete] REJECTED: 0-byte file detected in upload ${uploadId}`)
        return corsJson(
          {
            error: 'The selected file is empty (0 bytes). File size must be greater than 0 bytes. Please select a valid file and try again.',
            code: 'ZERO_BYTE_FILE',
          },
          request,
          { status: 422 }
        )
      }
    }

    // Update upload status to "uploaded" - preflight worker will handle the rest
    // autoApprove is read from shop.settings by the preflight worker
    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: 'uploaded',
      },
    })

    // Update items with location, transform, and fileUrl (for CDN uploads)
    // If items array is provided, use it; otherwise skip item updates (quick mode)
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const updateData: Record<string, unknown> = {
          location: item.location || 'front',
          transform: item.transform || null,
        }

        // Upload duration in milliseconds (from client)
        if (item.uploadDurationMs && typeof item.uploadDurationMs === 'number') {
          updateData.uploadDurationMs = Math.round(item.uploadDurationMs)
        }

        // MULTI-STORAGE: Handle different storage providers
        const provider = item.storageProvider || 'local'
        
        // Log the complete call with actual provider info
        await uploadLogger.completeCalled(
          `complete_${uploadId}`,
          uploadId,
          provider as any,
          item.fileUrl || 'local'
        )
        
        console.log(`[Upload Complete] Provider: ${provider}, FileUrl: ${item.fileUrl?.substring(0, 80) || 'N/A'}`)

        // CRITICAL DATABASE-LEVEL FIX:
        // storageKey is now set at INTENT time with correct provider prefix (e.g., "bunny:...")
        // This ensures preflight worker ALWAYS has the correct key from the start
        // 
        // FALLBACK HANDLING: If client used a different provider than intent (fallback scenario),
        // we MUST update the storageKey to reflect the ACTUAL storage location
        const existingItem = await prisma.uploadItem.findFirst({
          where: { id: item.itemId, uploadId },
          select: { storageKey: true },
        })
        
        const currentStorageKey = existingItem?.storageKey || ''
        
        // Extract current prefix and check if it matches the actual provider
        const currentPrefix = currentStorageKey.split(':')[0]
        const hasProviderPrefix = ['bunny', 'r2', 'local', 'shopify'].includes(currentPrefix)
        
        // CRITICAL: Check if provider CHANGED (fallback scenario)
        // If intent was bunny but client uploaded to r2, we MUST update the key
        const providerMismatch = hasProviderPrefix && currentPrefix !== provider
        
        if (providerMismatch) {
          // FALLBACK DETECTED: Provider changed, update storageKey to reflect actual location
          const pathWithoutPrefix = currentStorageKey.replace(/^(bunny|r2|local|shopify):/, '')
          updateData.storageKey = `${provider}:${pathWithoutPrefix}`
          console.log(`[Upload Complete] FALLBACK DETECTED: Changed from ${currentPrefix}: to ${provider}: - storageKey updated`)
        } else if (!hasProviderPrefix && item.fileUrl && provider === 'bunny') {
          // Legacy: No prefix, add bunny prefix
          updateData.storageKey = `bunny:${item.fileUrl.replace(/^https?:\/\/[^/]+\//, '')}`
          console.log(`[Upload Complete] LEGACY FIX: Added bunny: prefix to storageKey`)
        } else if (!hasProviderPrefix && item.fileUrl && provider === 'r2') {
          // Legacy: No prefix, add r2 prefix
          updateData.storageKey = `r2:${item.fileUrl.replace(/^https?:\/\/[^/]+\//, '')}`
          console.log(`[Upload Complete] LEGACY FIX: Added r2: prefix to storageKey`)
        } else if (!hasProviderPrefix && provider === 'local') {
          // Legacy: No prefix, add local prefix
          const pathWithoutPrefix = currentStorageKey
          updateData.storageKey = `local:${pathWithoutPrefix}`
          console.log(`[Upload Complete] LEGACY FIX: Added local: prefix to storageKey`)
        } else if (!hasProviderPrefix && item.fileId && provider === 'shopify') {
          updateData.storageKey = `shopify:${item.fileId}`
          console.log(`[Upload Complete] LEGACY FIX: Added shopify: prefix`)
        } else {
          console.log(`[Upload Complete] storageKey OK, provider matches: ${currentStorageKey.substring(0, 60)}`)
        }

        await prisma.uploadItem.updateMany({
          where: { id: item.itemId, uploadId },
          data: updateData,
        })
      }
    }

    // Enqueue preflight job for each item
    // FAZ 0 - API-001: Use singleton connection (don't create new connection per request)
    const connection = getRedisConnection()
    const preflightQueue = new Queue('preflight', { connection })

    // CRITICAL: Re-fetch items from DB to get UPDATED storageKey values
    // The upload.items contains STALE data from before the update loop above
    // This was causing 404 errors because items updated with bunny: prefix
    // weren't being used - instead old storageKey without prefix was sent to preflight
    const updatedItems = await prisma.uploadItem.findMany({
      where: { uploadId },
      select: { id: true, storageKey: true },
    })

    console.log(`[Upload Complete] Queueing ${updatedItems.length} items for preflight`)

    for (const uploadItem of updatedItems) {
      console.log(`[Upload Complete] Preflight queue: itemId=${uploadItem.id}, storageKey=${uploadItem.storageKey?.substring(0, 60)}`)
      
      await preflightQueue.add('preflight', {
        uploadId,
        shopId: shop.id,
        itemId: uploadItem.id,
        storageKey: uploadItem.storageKey,
      })
    }

    // FAZ 0 - API-001: DON'T close singleton connection - it's reused across requests
    // await connection.quit(); // REMOVED - causes connection churn

    // Trigger Flow event
    await triggerUploadReceived(shop.id, shop.shopDomain, {
      id: uploadId,
      mode: upload.mode,
      productId: upload.productId,
      variantId: upload.variantId,
      customerId: upload.customerId,
      customerEmail: upload.customerEmail,
      items: upload.items.map((i: { location: string }) => ({ location: i.location })),
    })

    // 📊 Update visitor and session metrics if linked
    if (upload.visitorId) {
      try {
        // Increment visitor's total uploads (scoped to shop)
        await prisma.visitor.updateMany({
          where: { id: upload.visitorId, shopId: shop.id },
          data: {
            totalUploads: { increment: 1 },
            lastSeenAt: new Date(),
          },
        })

        // Increment session's uploads count if session exists (scoped to shop)
        if (upload.sessionId) {
          await prisma.visitorSession.updateMany({
            where: { id: upload.sessionId, shopId: shop.id },
            data: {
              uploadsInSession: { increment: 1 },
              lastActivityAt: new Date(),
            },
          })
        }

        console.log(`[Upload Complete] Updated visitor ${upload.visitorId} metrics`)
      } catch (visitorErr) {
        // Non-blocking: visitor tracking is optional
        console.warn('[Upload Complete] Failed to update visitor metrics:', visitorErr)
      }
    }

    return corsJson(
      {
        success: true,
        uploadId,
        status: 'processing',
        message: 'Upload complete. Preflight checks started.',
      },
      request
    )
  } catch (error) {
    console.error('[Upload Complete] Error:', error)
    return corsJson({ error: 'Failed to complete upload' }, request, { status: 500 })
  }
}

// GET /api/upload/complete?uploadId=xxx&shopDomain=xxx (get upload status)
export async function loader({ request }: LoaderFunctionArgs) {
  // Handle CORS preflight - loader handles GET but action handles OPTIONS
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  const url = new URL(request.url)
  const uploadId = url.searchParams.get('uploadId')
  const shopDomain = url.searchParams.get('shopDomain')

  if (!shopDomain) {
    return corsJson({ error: 'Missing shopDomain' }, request, { status: 400 })
  }

  if (!uploadId) {
    return corsJson({ error: 'Missing uploadId' }, request, { status: 400 })
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return corsJson({ error: 'Shop not found' }, request, { status: 404 })
  }

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    include: {
      items: {
        select: {
          id: true,
          location: true,
          preflightStatus: true,
          preflightResult: true,
          thumbnailKey: true,
          previewKey: true,
        },
      },
    },
  })

  if (!upload) {
    return corsJson({ error: 'Upload not found' }, request, { status: 404 })
  }

  return corsJson(
    {
      uploadId: upload.id,
      status: upload.status,
      mode: upload.mode,
      preflightSummary: upload.preflightSummary,
      items: upload.items,
      createdAt: upload.createdAt,
      updatedAt: upload.updatedAt,
    },
    request
  )
}
