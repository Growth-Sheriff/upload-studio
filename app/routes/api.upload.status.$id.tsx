import type { LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import {
  generateLocalFileToken,
  getStorageConfig,
  getThumbnailUrl,
  isBunnyUrl,
} from '~/lib/storage.server'

// Shopify File Query - Get file URL by ID
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

// Helper: Resolve Shopify fileId to URL
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

    // MediaImage type
    if (node.image?.url) return node.image.url
    if (node.image?.originalSrc) return node.image.originalSrc
    // GenericFile type
    if (node.url) return node.url

    return null
  } catch (error) {
    console.error('[Shopify File Resolve] Error:', error)
    return null
  }
}

// GET /api/upload/status/:id?shopDomain=xxx
export async function loader({ request, params }: LoaderFunctionArgs) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  // Rate limiting (using admin limit for status checks)
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

  // Determine overall status based on items
  const itemStatuses = upload.items.map((i) => i.preflightStatus)
  let overallPreflight: 'pending' | 'ok' | 'warning' | 'error' = 'pending'

  if (itemStatuses.every((s) => s === 'ok')) {
    overallPreflight = 'ok'
  } else if (itemStatuses.some((s) => s === 'error')) {
    overallPreflight = 'error'
  } else if (itemStatuses.some((s) => s === 'warning')) {
    overallPreflight = 'warning'
  }

  // Map status for widget compatibility
  // Widget expects 'ready' or 'completed', but we store 'uploaded'
  let clientStatus = upload.status
  if (upload.status === 'uploaded') {
    clientStatus = 'ready'
  }

  // Build download URLs for local storage with signed tokens (WI-004)
  // OR use Shopify URLs directly if storageKey is an external URL
  // FIX: Use SHOPIFY_APP_URL (has correct domain) instead of HOST (0.0.0.0 for binding)
  const hostEnv = process.env.SHOPIFY_APP_URL || process.env.HOST
  const host = hostEnv?.startsWith('https://') ? hostEnv : `https://${hostEnv}`
  const firstItem = upload.items[0]

  // Get storage config for this shop
  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })

  // FAZ 2 - API-002: Extended token expiry to 30 DAYS for Shopify admin order viewing
  // Previous: 1 hour was too short - orders stay in admin for weeks/months
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
  let downloadUrl: string | null = null
  let thumbnailUrl: string | null = null

  // Check if storageKey is an external URL (Shopify, R2, S3)
  const isExternalUrl = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('http://') || key.startsWith('https://')
  }

  // Check if storageKey is a Bunny key (bunny:path/to/file)
  const isBunnyKey = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('bunny:') || isBunnyUrl(key)
  }

  // Check if storageKey is a Shopify fileId (shopify:gid://...)
  const isShopifyFileId = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('shopify:')
  }

  // Check if storageKey is an R2 key (r2:path/to/file)
  const isR2Key = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('r2:')
  }

  // Check if storageKey is a local key (local:path/to/file)
  const isLocalKey = (key: string | null | undefined): boolean => {
    if (!key) return false
    return key.startsWith('local:')
  }

  if (firstItem?.storageKey) {
    if (isExternalUrl(firstItem.storageKey)) {
      // Already a full URL - use directly
      downloadUrl = firstItem.storageKey
    } else if (isBunnyKey(firstItem.storageKey)) {
      // Bunny storage - build CDN URL with proper encoding for special chars
      const bunnyKey = firstItem.storageKey.replace('bunny:', '')
      const cdnUrl =
        storageConfig.bunnyCdnUrl ||
        process.env.BUNNY_CDN_URL ||
        'https://customizerappdev.b-cdn.net'
      // Encode each path segment to handle spaces and special characters
      const encodedPath = bunnyKey
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      downloadUrl = `${cdnUrl}/${encodedPath}`
    } else if (isR2Key(firstItem.storageKey)) {
      // R2 storage - build public URL via Proxy
      const r2Key = firstItem.storageKey.replace('r2:', '')
      
      const appHost = process.env.SHOPIFY_APP_URL!
      const encodedPath = r2Key
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')
      
      // Generate token for proxy access
      const tokenExpiresAt = Date.now() + 365 * 24 * 3600 * 1000 // 1 year
      const token = generateLocalFileToken(`r2:${r2Key}`, tokenExpiresAt)
      
      downloadUrl = `${appHost}/api/files/r2:${encodedPath}?token=${token}`
    } else if (isShopifyFileId(firstItem.storageKey)) {
      // Shopify fileId - resolve to URL via API
      const fileId = firstItem.storageKey.replace('shopify:', '')
      const resolvedUrl = await resolveShopifyFileUrl(fileId, shop.shopDomain, shop.accessToken)
      if (resolvedUrl) {
        downloadUrl = resolvedUrl
        // Update storageKey with resolved URL for future requests (cache)
        await prisma.uploadItem.updateMany({
          where: { id: firstItem.id, uploadId: upload.id },
          data: { storageKey: resolvedUrl },
        })
        console.log(`[Upload Status] Resolved Shopify fileId to URL: ${resolvedUrl}`)
      } else {
        // Fallback: file still processing, return placeholder
        downloadUrl = null
        console.log(`[Upload Status] Shopify file still processing: ${fileId}`)
      }
    } else {
      // Local storage - generate signed URL
      // Strip local: prefix if present
      const localKey = firstItem.storageKey.startsWith('local:') 
        ? firstItem.storageKey.replace('local:', '') 
        : firstItem.storageKey
      const token = generateLocalFileToken(localKey, expiresAt)
      downloadUrl = `${host}/api/files/${encodeURIComponent(localKey)}?token=${encodeURIComponent(token)}`
    }
  }

  // Thumbnail URL logic - use Bunny Optimizer for CDN files
  if (firstItem?.thumbnailKey) {
    if (isExternalUrl(firstItem.thumbnailKey)) {
      // If Bunny URL, add optimizer params
      if (isBunnyUrl(firstItem.thumbnailKey)) {
        thumbnailUrl = getThumbnailUrl(storageConfig, firstItem.thumbnailKey, 200)
      } else {
        thumbnailUrl = firstItem.thumbnailKey
      }
    } else if (isBunnyKey(firstItem.thumbnailKey)) {
      // Bunny key - use optimizer
      thumbnailUrl = getThumbnailUrl(storageConfig, firstItem.thumbnailKey, 200)
    } else if (isR2Key(firstItem.thumbnailKey)) {
      // R2 thumbnail - build public URL via Proxy
      const r2Key = firstItem.thumbnailKey.replace('r2:', '')
      
       // FORCE UPDATE: Always use main app domain for R2 proxy
      const appHost = process.env.SHOPIFY_APP_URL!
      const encodedPath = r2Key
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')
      
       // Generate token for proxy access
      const tokenExpiresAt = Date.now() + 365 * 24 * 3600 * 1000 // 1 year
      const token = generateLocalFileToken(`r2:${r2Key}`, tokenExpiresAt)

      thumbnailUrl = `${appHost}/api/files/r2:${encodedPath}?token=${token}`
    } else if (isShopifyFileId(firstItem.thumbnailKey)) {
      const fileId = firstItem.thumbnailKey.replace('shopify:', '')
      thumbnailUrl = await resolveShopifyFileUrl(fileId, shop.shopDomain, shop.accessToken)
    } else {
      // Local storage - strip local: prefix if present
      const localKey = firstItem.thumbnailKey.startsWith('local:')
        ? firstItem.thumbnailKey.replace('local:', '')
        : firstItem.thumbnailKey
      const token = generateLocalFileToken(localKey, expiresAt)
      thumbnailUrl = `${host}/api/files/${encodeURIComponent(localKey)}?token=${encodeURIComponent(token)}`
    }
  }
  // FIX: Remove fallbacks that return downloadUrl as thumbnail
  // If no thumbnailKey exists, thumbnailUrl stays null
  // This allows the widget to show spinner and poll for thumbnail
  // Old code returned downloadUrl which made hasThumbnail always true for PSD/PDF etc.

  return corsJson(
    {
      uploadId: upload.id,
      status: clientStatus,
      mode: upload.mode,
      productId: upload.productId,
      variantId: upload.variantId,
      overallPreflight,
      preflightSummary: upload.preflightSummary,
      items: upload.items,
      downloadUrl,
      thumbnailUrl,
      createdAt: upload.createdAt,
      updatedAt: upload.updatedAt,
    },
    request
  )
}
