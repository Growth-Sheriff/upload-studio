import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { triggerUploadReceived } from '~/lib/flow.server'
import prisma from '~/lib/prisma.server'
import {
  MEASURE_PREFLIGHT_QUEUE_NAME,
  PREVIEW_RENDER_QUEUE_NAME,
} from '~/lib/uploadQueues'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { uploadLogger } from '~/lib/uploadLogger.server'





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



export async function action({ request }: ActionFunctionArgs) {

  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }


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

  if (upload.status !== 'draft') {
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



    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: 'uploaded',
      },
    })



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


        await uploadLogger.completeCalled(
          `complete_${uploadId}`,
          uploadId,
          provider as any,
          item.fileUrl || 'local'
        )

        console.log(`[Upload Complete] Provider: ${provider}, FileUrl: ${item.fileUrl?.substring(0, 80) || 'N/A'}`)







        const existingItem = await prisma.uploadItem.findFirst({
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

        await prisma.uploadItem.updateMany({
          where: { id: item.itemId, uploadId },
          data: updateData,
        })
      }
    }



    const connection = getRedisConnection()
    const measureQueue = new Queue(MEASURE_PREFLIGHT_QUEUE_NAME, { connection })
    const previewQueue = new Queue(PREVIEW_RENDER_QUEUE_NAME, { connection })





    const updatedItems = await prisma.uploadItem.findMany({
      where: { uploadId },
      select: { id: true, storageKey: true },
    })

    console.log(
      `[Upload Complete] Queueing ${updatedItems.length} items for measurement + preview`
    )

    for (const uploadItem of updatedItems) {
      console.log(
        `[Upload Complete] Measure queue: itemId=${uploadItem.id}, storageKey=${uploadItem.storageKey?.substring(0, 60)}`
      )

      const payload = {
        uploadId,
        shopId: shop.id,
        itemId: uploadItem.id,
        storageKey: uploadItem.storageKey,
      }

      await measureQueue.add('measure-preflight', payload, {
        priority: 1,
      })
      await previewQueue.add('preview-render', payload, {
        priority: 20,
        delay: 1500,
      })
    }





    await triggerUploadReceived(shop.id, shop.shopDomain, {
      id: uploadId,
      mode: upload.mode,
      productId: upload.productId,
      variantId: upload.variantId,
      customerId: upload.customerId,
      customerEmail: upload.customerEmail,
      items: upload.items.map((i: { location: string }) => ({ location: i.location })),
    })


    if (upload.visitorId) {
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

    return corsJson(
      {
        success: true,
        uploadId,
        status: 'processing',
        message: 'Upload complete. Measurement and preview jobs started.',
      },
      request
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
