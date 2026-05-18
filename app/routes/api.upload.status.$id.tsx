import type { LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { isDtfPrintHouseShop } from '~/lib/customerPricing.server'
import {
  generateLocalFileToken,
  getStorageConfig,
  getThumbnailUrl,
  isBunnyUrl,
} from '~/lib/storage.server'
import {
  applyFullCanvasMeasurementMetadata,
  deriveUploadClientStatus,
  deriveUploadItemLifecycle,
  deriveUploadOrderabilityStatus,
} from '~/lib/uploadLifecycle.server'


const FILE_QUERY = `
  query getFile($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        image {
          url
          originalSrc
        }
        fileStatus
      }
      ... on GenericFile {
        url
        fileStatus
      }
    }
  }
`


async function resolveShopifyFileUrl(
  fileId: string,
  shopDomain: string,
  accessToken: string
): Promise<string | null> {
  try {
    const response = await fetch(`https://${shopDomain}/admin/api/2025-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: FILE_QUERY,
        variables: { id: fileId },
      }),
    })

    const result = await response.json()
    const node = result.data?.node

    if (!node) return null


    if (node.image?.url) return node.image.url
    if (node.image?.originalSrc) return node.image.originalSrc

    if (node.url) return node.url

    return null
  } catch (error) {
    console.error('[Shopify File Resolve] Error:', error)
    return null
  }
}


export async function loader({ request, params }: LoaderFunctionArgs) {

  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }


  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shopDomain')

  if (!shopDomain) {
    return corsJson({ error: 'Missing shopDomain' }, request, { status: 400 })
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return corsJson({ error: 'Shop not found' }, request, { status: 404 })
  }

  const uploadId = params.id
  if (!uploadId) {
    return corsJson({ error: 'Missing uploadId' }, request, { status: 400 })
  }

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    include: {
      items: {
        select: {
          id: true,
          location: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          storageKey: true,
          preflightStatus: true,
          preflightResult: true,
          thumbnailKey: true,
          previewKey: true,
          transform: true,
        },
      },
    },
  })

  if (!upload) {
    return corsJson({ error: 'Upload not found' }, request, { status: 404 })
  }


  const itemStatuses = upload.items.map((i) => i.preflightStatus)
  let overallPreflight: 'pending' | 'ok' | 'warning' | 'error' = 'pending'

  if (itemStatuses.every((s) => s === 'ok')) {
    overallPreflight = 'ok'
  } else if (itemStatuses.some((s) => s === 'error')) {
    overallPreflight = 'error'
  } else if (itemStatuses.some((s) => s === 'warning')) {
    overallPreflight = 'warning'
  }




  const hostEnv = process.env.SHOPIFY_APP_URL || process.env.HOST
  const host = hostEnv?.startsWith('https://') ? hostEnv : `https://${hostEnv}`
  const firstItem = upload.items[0]


  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })



  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
  let downloadUrl: string | null = null
  let thumbnailUrl: string | null = null


  const isExternalUrl = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('http://') || key.startsWith('https://')
  }


  const isBunnyKey = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('bunny:') || isBunnyUrl(key)
  }


  const isShopifyFileId = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('shopify:')
  }


  const isR2Key = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('r2:')
  }


  const isLocalKey = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('local:')
  }

  if (firstItem?.storageKey) {
    if (isExternalUrl(firstItem.storageKey)) {

      downloadUrl = firstItem.storageKey
    } else if (isBunnyKey(firstItem.storageKey)) {

      const bunnyKey = firstItem.storageKey.replace('bunny:', '')
      const cdnUrl =
        storageConfig.bunnyCdnUrl ||
        process.env.BUNNY_CDN_URL ||
        'https://customizerappdev.b-cdn.net'

      const encodedPath = bunnyKey
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      downloadUrl = `${cdnUrl}/${encodedPath}`
    } else if (isR2Key(firstItem.storageKey)) {

      const r2Key = firstItem.storageKey.replace('r2:', '')

      const appHost = process.env.SHOPIFY_APP_URL!
      const encodedPath = r2Key
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')


      const tokenExpiresAt = Date.now() + 365 * 24 * 3600 * 1000
      const token = generateLocalFileToken(`r2:${r2Key}`, tokenExpiresAt)

      downloadUrl = `${appHost}/api/files/r2:${encodedPath}?token=${token}`
    } else if (isShopifyFileId(firstItem.storageKey)) {

      const fileId = firstItem.storageKey.replace('shopify:', '')
      const resolvedUrl = await resolveShopifyFileUrl(fileId, shop.shopDomain, shop.accessToken)
      if (resolvedUrl) {
        downloadUrl = resolvedUrl

        await prisma.uploadItem.updateMany({
          where: { id: firstItem.id, uploadId: upload.id },
          data: { storageKey: resolvedUrl },
        })
        console.log(`[Upload Status] Resolved Shopify fileId to URL: ${resolvedUrl}`)
      } else {

        downloadUrl = null
        console.log(`[Upload Status] Shopify file still processing: ${fileId}`)
      }
    } else {


      const localKey = firstItem.storageKey.startsWith('local:')
        ? firstItem.storageKey.replace('local:', '')
        : firstItem.storageKey
      const token = generateLocalFileToken(localKey, expiresAt)
      downloadUrl = `${host}/api/files/${encodeURIComponent(localKey)}?token=${encodeURIComponent(token)}`
    }
  }


  if (firstItem?.thumbnailKey) {
    if (isExternalUrl(firstItem.thumbnailKey)) {

      if (isBunnyUrl(firstItem.thumbnailKey)) {
        thumbnailUrl = getThumbnailUrl(storageConfig, firstItem.thumbnailKey, 200)
      } else {
        thumbnailUrl = firstItem.thumbnailKey
      }
    } else if (isBunnyKey(firstItem.thumbnailKey)) {

      thumbnailUrl = getThumbnailUrl(storageConfig, firstItem.thumbnailKey, 200)
    } else if (isR2Key(firstItem.thumbnailKey)) {

      const r2Key = firstItem.thumbnailKey.replace('r2:', '')


      const appHost = process.env.SHOPIFY_APP_URL!
      const encodedPath = r2Key
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')


      const tokenExpiresAt = Date.now() + 365 * 24 * 3600 * 1000
      const token = generateLocalFileToken(`r2:${r2Key}`, tokenExpiresAt)

      thumbnailUrl = `${appHost}/api/files/r2:${encodedPath}?token=${token}`
    } else if (isShopifyFileId(firstItem.thumbnailKey)) {
      const fileId = firstItem.thumbnailKey.replace('shopify:', '')
      thumbnailUrl = await resolveShopifyFileUrl(fileId, shop.shopDomain, shop.accessToken)
    } else {

      const localKey = firstItem.thumbnailKey.startsWith('local:')
        ? firstItem.thumbnailKey.replace('local:', '')
        : firstItem.thumbnailKey
      const token = generateLocalFileToken(localKey, expiresAt)
      thumbnailUrl = `${host}/api/files/${encodeURIComponent(localKey)}?token=${encodeURIComponent(token)}`
    }
  }






  const lifecycleItems = upload.items.map((item) =>
    deriveUploadItemLifecycle({
      preflightStatus: item.preflightStatus,
      preflightResult: item.preflightResult,
      thumbnailKey: item.thumbnailKey,
    })
  )
  const useFullCanvasMeasurement = isDtfPrintHouseShop(shop.shopDomain)
  const clientStatus = deriveUploadClientStatus(upload.status, lifecycleItems)
  const orderabilityStatus = deriveUploadOrderabilityStatus(lifecycleItems)

  const enrichedItems = upload.items.map((item, index) => {
    const lifecycle = lifecycleItems[index]
    const metadata = useFullCanvasMeasurement
      ? applyFullCanvasMeasurementMetadata(lifecycle.metadata)
      : lifecycle.metadata


    let itemThumbnailUrl: string | null = null
    if (item.thumbnailKey) {
      if (isExternalUrl(item.thumbnailKey)) {
        itemThumbnailUrl = isBunnyUrl(item.thumbnailKey)
          ? getThumbnailUrl(storageConfig, item.thumbnailKey, 200)
          : item.thumbnailKey
      } else if (isBunnyKey(item.thumbnailKey)) {
        itemThumbnailUrl = getThumbnailUrl(storageConfig, item.thumbnailKey, 200)
      } else if (isR2Key(item.thumbnailKey)) {
        const r2Key = item.thumbnailKey.replace('r2:', '')
        const appHost = process.env.SHOPIFY_APP_URL!
        const encodedPath = r2Key.split('/').map((s: string) => encodeURIComponent(s)).join('/')
        const tokenExp = Date.now() + 365 * 24 * 3600 * 1000
        const tok = generateLocalFileToken(`r2:${r2Key}`, tokenExp)
        itemThumbnailUrl = `${appHost}/api/files/r2:${encodedPath}?token=${tok}`
      } else if (isLocalKey(item.thumbnailKey)) {
        const localKey = item.thumbnailKey.replace('local:', '')
        const tok = generateLocalFileToken(localKey, expiresAt)
        itemThumbnailUrl = `${host}/api/files/${encodeURIComponent(localKey)}?token=${encodeURIComponent(tok)}`
      } else {
        const tok = generateLocalFileToken(item.thumbnailKey, expiresAt)
        itemThumbnailUrl = `${host}/api/files/${encodeURIComponent(item.thumbnailKey)}?token=${encodeURIComponent(tok)}`
      }
    }


    let itemOriginalUrl: string | null = null
    if (item.storageKey) {
      if (isExternalUrl(item.storageKey)) {
        itemOriginalUrl = item.storageKey
      } else if (isBunnyKey(item.storageKey)) {
        const bunnyKey = item.storageKey.replace('bunny:', '')
        const cdnUrl = storageConfig.bunnyCdnUrl || process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'
        const encodedPath = bunnyKey.split('/').map((s: string) => encodeURIComponent(s)).join('/')
        itemOriginalUrl = `${cdnUrl}/${encodedPath}`
      } else if (isR2Key(item.storageKey)) {
        const r2Key = item.storageKey.replace('r2:', '')
        const appHost = process.env.SHOPIFY_APP_URL!
        const encodedPath = r2Key.split('/').map((s: string) => encodeURIComponent(s)).join('/')
        const tokenExp = Date.now() + 365 * 24 * 3600 * 1000
        const tok = generateLocalFileToken(`r2:${r2Key}`, tokenExp)
        itemOriginalUrl = `${appHost}/api/files/r2:${encodedPath}?token=${tok}`
      } else if (isLocalKey(item.storageKey)) {
        const localKey = item.storageKey.replace('local:', '')
        const tok = generateLocalFileToken(localKey, expiresAt)
        itemOriginalUrl = `${host}/api/files/${encodeURIComponent(localKey)}?token=${encodeURIComponent(tok)}`
      } else {
        const tok = generateLocalFileToken(item.storageKey, expiresAt)
        itemOriginalUrl = `${host}/api/files/${encodeURIComponent(item.storageKey)}?token=${encodeURIComponent(tok)}`
      }
    }

    return {
      ...item,
      widthPx: metadata?.widthPx || 0,
      heightPx: metadata?.heightPx || 0,
      dpi: metadata?.dpi || 0,
      documentDpi: metadata?.documentDpi || 0,
      documentDpiSource: metadata?.documentDpiSource || null,
      trimmedWidthPx: metadata?.trimmedWidthPx || 0,
      trimmedHeightPx: metadata?.trimmedHeightPx || 0,
      trimmedOffsetXPx: metadata?.trimmedOffsetXPx || 0,
      trimmedOffsetYPx: metadata?.trimmedOffsetYPx || 0,
      measurementWidthPx: metadata?.measurementWidthPx || 0,
      measurementHeightPx: metadata?.measurementHeightPx || 0,
      effectiveDpi: metadata?.effectiveDpi || 0,
      sizingSource: metadata?.sizingSource || null,
      widthIn: metadata?.widthIn || 0,
      heightIn: metadata?.heightIn || 0,
      measurementMode: metadata?.measurementMode || null,
      measurementStatus: lifecycle.measurementStatus,
      previewStatus: lifecycle.previewStatus,
      orderabilityStatus: lifecycle.orderabilityStatus,
      stages: {
        measurement: { status: lifecycle.measurementStatus },
        preview: {
          status: lifecycle.previewStatus,
          hasPreview: lifecycle.hasPreview,
        },
        orderability: { status: lifecycle.orderabilityStatus },
      },
      metadata: metadata
        ? {
            widthPx: metadata.widthPx,
            heightPx: metadata.heightPx,
            dpi: metadata.dpi,
            documentDpi: metadata.documentDpi,
            documentDpiSource: metadata.documentDpiSource,
            trimmedWidthPx: metadata.trimmedWidthPx,
            trimmedHeightPx: metadata.trimmedHeightPx,
            trimmedOffsetXPx: metadata.trimmedOffsetXPx,
            trimmedOffsetYPx: metadata.trimmedOffsetYPx,
            measurementWidthPx: metadata.measurementWidthPx,
            measurementHeightPx: metadata.measurementHeightPx,
            effectiveDpi: metadata.effectiveDpi,
            sizingSource: metadata.sizingSource,
            widthIn: metadata.widthIn,
            heightIn: metadata.heightIn,
            measurementMode: metadata.measurementMode,
          }
        : null,
      problems: lifecycle.problems,
      warnings: lifecycle.warnings,
      errors: lifecycle.errors,
      capabilities: {
        canAddToCart: lifecycle.canAddToCart,
        canResolveProduct: lifecycle.canResolveProduct,
        hasPreview: lifecycle.hasPreview,
      },
      thumbnailUrl: itemThumbnailUrl,
      previewUrl: itemThumbnailUrl,
      originalUrl: itemOriginalUrl,
    }
  })

  const primaryLifecycle = lifecycleItems[0] || null
  const primaryMetadata = useFullCanvasMeasurement
    ? applyFullCanvasMeasurementMetadata(primaryLifecycle?.metadata || null)
    : primaryLifecycle?.metadata || null
  const problems = lifecycleItems.flatMap((lifecycle) => lifecycle.problems)
  const warnings = problems
    .filter((problem) => problem.severity === 'warning')
    .map((problem) => problem.message)
  const errors = problems
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message)

  return corsJson(
    {
      uploadId: upload.id,
      status: clientStatus,
      mode: upload.mode,
      productId: upload.productId,
      variantId: upload.variantId,
      overallPreflight,
      orderabilityStatus,
      stages: {
        upload: { status: upload.status },
        measurement: {
          status: primaryLifecycle?.measurementStatus || 'pending',
        },
        preview: {
          status: primaryLifecycle?.previewStatus || 'pending',
        },
        orderability: {
          status: orderabilityStatus,
        },
      },
      capabilities: {
        canAddToCart:
          lifecycleItems.length > 0 && lifecycleItems.every((lifecycle) => lifecycle.canAddToCart),
        canResolveProduct:
          lifecycleItems.length > 0 &&
          lifecycleItems.every((lifecycle) => lifecycle.canResolveProduct),
        hasPreview:
          lifecycleItems.length > 0 && lifecycleItems.every((lifecycle) => lifecycle.hasPreview),
      },
      metadata: primaryMetadata
        ? {
            width: primaryMetadata.measurementWidthPx,
            height: primaryMetadata.measurementHeightPx,
            dpi: primaryMetadata.dpi,
            documentDpi: primaryMetadata.documentDpi,
            documentDpiSource: primaryMetadata.documentDpiSource,
            widthPx: primaryMetadata.widthPx,
            heightPx: primaryMetadata.heightPx,
            trimmedWidthPx: primaryMetadata.trimmedWidthPx,
            trimmedHeightPx: primaryMetadata.trimmedHeightPx,
            trimmedOffsetXPx: primaryMetadata.trimmedOffsetXPx,
            trimmedOffsetYPx: primaryMetadata.trimmedOffsetYPx,
            measurementWidthPx: primaryMetadata.measurementWidthPx,
            measurementHeightPx: primaryMetadata.measurementHeightPx,
            effectiveDpi: primaryMetadata.effectiveDpi,
            sizingSource: primaryMetadata.sizingSource,
            widthIn: primaryMetadata.widthIn,
            heightIn: primaryMetadata.heightIn,
            measurementMode: primaryMetadata.measurementMode,
          }
        : null,
      problems,
      warnings,
      errors,
      preflightSummary: upload.preflightSummary,
      items: enrichedItems,
      downloadUrl,
      url: downloadUrl,
      thumbnailUrl,
      previewUrl: thumbnailUrl,
      createdAt: upload.createdAt,
      updatedAt: upload.updatedAt,
    },
    request
  )
}
