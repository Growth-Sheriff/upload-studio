import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { triggerUploadReceived } from '~/lib/flow.server'
import { isFastRasterUpload } from '~/lib/fastRaster'
import prisma from '~/lib/prisma.server'
import {
  getMeasurePreflightJobOptions,
  getPreviewRenderJobOptions,
  MEASURE_PREFLIGHT_JOB_OPTIONS,
  MEASURE_PREFLIGHT_QUEUE_NAME,
  PREVIEW_RENDER_JOB_OPTIONS,
  PREVIEW_RENDER_QUEUE_NAME,
} from '~/lib/uploadQueues'
import { getUploadQueueRecoveryPlan } from '~/lib/uploadQueueRecovery'
import { ensureStoredRasterHeaderMeasurement } from '~/lib/storedRasterHeader.server'
import { deriveUploadItemLifecycle } from '~/lib/uploadLifecycle.server'
import {
  buildFileUrl,
  buildThumbnailUrl,
  storageConfigForShop,
} from '~/lib/uploadUrls.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { uploadLogger } from '~/lib/uploadLogger.server'
import { authenticate } from '~/shopify.server'





let redisConnection: Redis | null = null

const getRedisConnection = (): Redis => {
  if (!redisConnection) {
    redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableReadyCheck: true,
      retryStrategy: (times: number) =>
        times <= 2 ? Math.min(times * 100, 500) : null,
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY'
        if (err.message.includes(targetError)) {

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
      redisConnection = null
    })
  }
  return redisConnection
}

async function addPreviewJob(
  queue: Queue,
  payload: { uploadId: string; shopId: string; itemId: string; storageKey: string }
) {
  return queue.add('preview-render', payload, getPreviewRenderJobOptions(payload.itemId))
}

async function addMeasureJob(
  queue: Queue,
  payload: { uploadId: string; shopId: string; itemId: string; storageKey: string }
) {
  return queue.add('measure-preflight', payload, getMeasurePreflightJobOptions(payload.itemId))
}

function completionItemPayload(
  item: {
    id: string
    storageKey: string
    originalName: string | null
    mimeType: string | null
    fileSize: number | null
    preflightStatus: string
    preflightResult: unknown
    thumbnailKey: string | null
    previewKey: string | null
  },
  storageConfig: ReturnType<typeof storageConfigForShop>
) {
  const lifecycle = deriveUploadItemLifecycle(item)
  const metadata = lifecycle.metadata
  return {
    itemId: item.id,
    originalName: item.originalName,
    mimeType: item.mimeType,
    fileSize: item.fileSize,
    preflightStatus: item.preflightStatus,
    preflightResult: item.preflightResult,
    measurementStatus: lifecycle.measurementStatus,
    previewStatus: lifecycle.previewStatus,
    orderabilityStatus: lifecycle.orderabilityStatus,
    widthPx: metadata?.widthPx || 0,
    heightPx: metadata?.heightPx || 0,
    documentDpi: metadata?.documentDpi || 0,
    effectiveDpi: metadata?.effectiveDpi || 0,
    sizingSource: metadata?.sizingSource || null,
    widthIn: metadata?.widthIn || 0,
    heightIn: metadata?.heightIn || 0,
    measurementMode: metadata?.measurementMode || null,
    metadata,
    problems: lifecycle.problems,
    warnings: lifecycle.warnings,
    errors: lifecycle.errors,
    capabilities: {
      canAddToCart: lifecycle.canAddToCart,
      canResolveProduct: lifecycle.canResolveProduct,
      hasPreview: lifecycle.hasPreview,
    },
    thumbnailUrl: buildThumbnailUrl(storageConfig, item.thumbnailKey),
    originalUrl: buildFileUrl(storageConfig, item.storageKey),
  }
}



export async function action({ request }: ActionFunctionArgs) {

  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  await authenticate.public.appProxy(request)
  const signedUrl = new URL(request.url)
  const signedShopDomain = String(signedUrl.searchParams.get('shop') || '').trim()


  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'preflight')
  if (rateLimitResponse) return rateLimitResponse

  let body: any
  try {
    body = await request.json()
  } catch {
    return corsJson({ error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const { uploadId, items } = body
  const shopDomain = signedShopDomain

  if (!shopDomain) {
    return corsJson({ error: 'Missing required field: shopDomain' }, request, { status: 400 })
  }

  if (!uploadId) {
    return corsJson({ error: 'Missing required field: uploadId' }, request, { status: 400 })
  }



  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return corsJson({ error: 'Shop not found' }, request, { status: 404 })
  }


  const shopSettings = (shop.settings as Record<string, any>) || {}
  const autoApprove = shopSettings.autoApprove !== false


  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    include: { items: true },
  })

  if (!upload) {
    return corsJson({ error: 'Upload not found' }, request, { status: 404 })
  }

  const resumableStatuses = new Set(['draft', 'uploaded', 'processing'])
  const measuredButMissingPreview =
    (upload.status === 'ready' || upload.status === 'pending_approval') &&
    upload.items.some((item) => !item.thumbnailKey)
  if (!resumableStatuses.has(upload.status) && !measuredButMissingPreview) {
    return corsJson({ error: 'Upload already completed' }, request, { status: 400 })
  }

  try {





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

    // Claim and finalize the first completion in one transaction. Competing
    // requests wait on the upload row, then become read-only repair passes.
    // This prevents a replay from changing the object after a deterministic
    // queue job has already captured its payload.
    const firstCompletion = await prisma.$transaction(async (tx) => {
      const transition = await tx.upload.updateMany({
        where: { id: uploadId, shopId: shop.id, status: 'draft' },
        data: { status: 'completing' },
      })
      if (transition.count !== 1) return false

      if (items && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
        const updateData: Record<string, unknown> = {
          location: item.location || 'front',
          transform: item.transform || null,
        }


        if (item.uploadDurationMs && typeof item.uploadDurationMs === 'number') {
          updateData.uploadDurationMs = Math.round(item.uploadDurationMs)
        }


        const provider = item.storageProvider || 'local'


        console.log(`[Upload Complete] Provider selected: ${provider}`)







        const existingItem = await tx.uploadItem.findFirst({
          where: { id: item.itemId, uploadId },
          select: { storageKey: true },
        })

        const currentStorageKey = existingItem?.storageKey || ''


        const currentPrefix = currentStorageKey.split(':')[0]
        const hasProviderPrefix = ['bunny', 'r2', 'local', 'shopify'].includes(currentPrefix)



        const providerMismatch = hasProviderPrefix && currentPrefix !== provider

        if (providerMismatch) {

          const pathWithoutPrefix = currentStorageKey.replace(/^(bunny|r2|local|shopify):/, '')
          updateData.storageKey = `${provider}:${pathWithoutPrefix}`
          console.log(`[Upload Complete] FALLBACK DETECTED: Changed from ${currentPrefix}: to ${provider}: - storageKey updated`)
        } else if (!hasProviderPrefix && item.fileUrl && provider === 'bunny') {

          updateData.storageKey = `bunny:${item.fileUrl.replace(/^https?:\/\/[^/]+\//, '')}`
          console.log(`[Upload Complete] LEGACY FIX: Added bunny: prefix to storageKey`)
        } else if (!hasProviderPrefix && item.fileUrl && provider === 'r2') {

          updateData.storageKey = `r2:${item.fileUrl.replace(/^https?:\/\/[^/]+\//, '')}`
          console.log(`[Upload Complete] LEGACY FIX: Added r2: prefix to storageKey`)
        } else if (!hasProviderPrefix && provider === 'local') {

          const pathWithoutPrefix = currentStorageKey
          updateData.storageKey = `local:${pathWithoutPrefix}`
          console.log(`[Upload Complete] LEGACY FIX: Added local: prefix to storageKey`)
        } else if (!hasProviderPrefix && item.fileId && provider === 'shopify') {
          updateData.storageKey = `shopify:${item.fileId}`
          console.log(`[Upload Complete] LEGACY FIX: Added shopify: prefix`)
        } else {
          console.log(`[Upload Complete] storageKey OK, provider matches: ${currentStorageKey.substring(0, 60)}`)
        }

        await tx.uploadItem.updateMany({
          where: { id: item.itemId, uploadId },
          data: updateData,
        })
      }
      }

      await tx.upload.updateMany({
        where: { id: uploadId, shopId: shop.id, status: 'completing' },
        data: { status: 'uploaded' },
      })
      return true
    })

    if (firstCompletion && items && Array.isArray(items)) {
      for (const item of items) {
        await uploadLogger
          .completeCalled(
            `complete_${uploadId}`,
            uploadId,
            (item.storageProvider || 'local') as any,
            item.fileUrl || 'local'
          )
          .catch((error) =>
            console.warn('[Upload Complete] Completion log failed after commit:', error)
          )
      }
    }

    // These are one-time completion effects. Run them immediately after the
    // atomic transition so a later Redis failure cannot consume the only
    // opportunity to record them.
    if (firstCompletion) {
      await triggerUploadReceived(shop.id, shop.shopDomain, {
        id: uploadId,
        mode: upload.mode,
        productId: upload.productId,
        variantId: upload.variantId,
        customerId: upload.customerId,
        customerEmail: upload.customerEmail,
        items: upload.items.map((i: { location: string }) => ({ location: i.location })),
      }).catch((error) =>
        console.warn('[Upload Complete] Upload-received flow failed after commit:', error)
      )
    }

    if (firstCompletion && upload.visitorId) {
      try {
        await prisma.visitor.updateMany({
          where: { id: upload.visitorId, shopId: shop.id },
          data: {
            totalUploads: { increment: 1 },
            lastSeenAt: new Date(),
          },
        })

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
        console.warn('[Upload Complete] Failed to update visitor metrics:', visitorErr)
      }
    }



    let updatedItems = await prisma.uploadItem.findMany({
      where: { uploadId, upload: { shopId: shop.id } },
      select: {
        id: true,
        storageKey: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        thumbnailKey: true,
        previewKey: true,
        preflightStatus: true,
        preflightResult: true,
      },
    })

    const reportedItems = Array.isArray(items) ? items : []
    for (let index = 0; index < updatedItems.length; index += 1) {
      const uploadItem = updatedItems[index]
      if (!getUploadQueueRecoveryPlan(uploadItem).headerValidate) continue
      const reported = reportedItems.find((candidate: any) => candidate?.itemId === uploadItem.id)
      const validated = await ensureStoredRasterHeaderMeasurement({
        uploadId,
        shopId: shop.id,
        itemId: uploadItem.id,
        clientProbe:
          reported?.headerProbe && typeof reported.headerProbe === 'object'
            ? reported.headerProbe
            : null,
        force: firstCompletion,
      })
      if (validated.item) updatedItems[index] = validated.item as typeof uploadItem
    }

    let dispatchDeferred = false
    let measureQueue: Queue | null = null
    let previewQueue: Queue | null = null
    try {
      const plans = updatedItems.map((item) => ({ item, plan: getUploadQueueRecoveryPlan(item) }))
      if (plans.some(({ plan }) => plan.measure || plan.preview)) {
        const connection = getRedisConnection()
        if (plans.some(({ plan }) => plan.measure)) {
          measureQueue = new Queue(MEASURE_PREFLIGHT_QUEUE_NAME, {
            connection,
            defaultJobOptions: MEASURE_PREFLIGHT_JOB_OPTIONS,
          })
        }
        if (plans.some(({ plan }) => plan.preview)) {
          previewQueue = new Queue(PREVIEW_RENDER_QUEUE_NAME, {
            connection,
            defaultJobOptions: PREVIEW_RENDER_JOB_OPTIONS,
          })
        }

        for (const { item: uploadItem, plan } of plans) {
          const payload = {
            uploadId,
            shopId: shop.id,
            itemId: uploadItem.id,
            storageKey: uploadItem.storageKey,
          }
          // Deterministic ids preserve the bounded retry budget on replay.
          if (plan.preview && previewQueue) await addPreviewJob(previewQueue, payload)
          if (plan.measure && measureQueue) await addMeasureJob(measureQueue, payload)
        }
      }
    } catch (dispatchError) {
      dispatchDeferred = true
      console.error(
        '[Upload Complete] Queue dispatch failed after DB commit; reconciler will retry:',
        dispatchError
      )
    } finally {
      await Promise.allSettled(
        [measureQueue?.close(), previewQueue?.close()].filter(
          (close): close is Promise<void> => Boolean(close)
        )
      )
    }

    updatedItems = await prisma.uploadItem.findMany({
      where: { uploadId, upload: { shopId: shop.id } },
      select: {
        id: true,
        storageKey: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        thumbnailKey: true,
        previewKey: true,
        preflightStatus: true,
        preflightResult: true,
      },
    })
    const currentUpload = await prisma.upload.findFirst({
      where: { id: uploadId, shopId: shop.id },
      select: { status: true },
    })
    const fastPath =
      updatedItems.length > 0 && updatedItems.every((uploadItem) => isFastRasterUpload(uploadItem))
    const storageConfig = storageConfigForShop(shop)
    const responseItems = updatedItems.map((uploadItem) =>
      completionItemPayload(uploadItem, storageConfig)
    )
    return corsJson(
      {
        success: true,
        uploadId,
        status: currentUpload?.status || 'processing',
        fastPath,
        items: responseItems,
        item: responseItems[0] || null,
        recoveryPending: dispatchDeferred,
        message: dispatchDeferred
          ? 'Upload complete. Processing will start automatically when the queue reconnects.'
          : fastPath
            ? 'Upload complete. Stored header measurement is ready.'
            : 'Upload complete. Measurement and preview jobs started.',
      },
      request,
      dispatchDeferred ? { status: 202 } : undefined
    )
  } catch (error) {
    console.error('[Upload Complete] Error:', error)
    return corsJson({ error: 'Failed to complete upload' }, request, { status: 500 })
  }
}


export async function loader({ request }: LoaderFunctionArgs) {

  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  await authenticate.public.appProxy(request)

  const url = new URL(request.url)
  const uploadId = url.searchParams.get('uploadId')
  const shopDomain = url.searchParams.get('shop')

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
