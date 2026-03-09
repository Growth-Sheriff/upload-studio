import type { LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'

// GET /api/asset-sets/:id
export async function loader({ request, params }: LoaderFunctionArgs) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  // Rate limiting
  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  const assetSetId = params.id

  if (!assetSetId) {
    return corsJson({ error: 'Missing asset set ID' }, request, { status: 400 })
  }

  // Get asset set (public for storefront)
  // Require shop param to prevent cross-tenant asset set retrieval
  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')

  if (!shopDomain) {
    return corsJson({ error: 'Missing shop parameter' }, request, { status: 400 })
  }

  const assetSet = await prisma.assetSet.findFirst({
    where: { id: assetSetId, status: 'active', shop: { shopDomain } },
    include: {
      shop: {
        select: {
          shopDomain: true,
          storageConfig: true,
          storageProvider: true,
        },
      },
    },
  })

  if (!assetSet) {
    return corsJson({ error: 'Asset set not found' }, request, { status: 404 })
  }

  const schema = assetSet.schema as Record<string, unknown>

  // Get signed URL for model if it's a storage key
  let modelUrl = (schema.model as any)?.source || ''
  if (modelUrl && !modelUrl.startsWith('http') && !modelUrl.startsWith('default_')) {
    try {
      const storageConfig = getStorageConfig({
        storageProvider: assetSet.shop.storageProvider || 'local',
        storageConfig: assetSet.shop.storageConfig as Record<string, string> | null,
      })
      modelUrl = await getDownloadSignedUrl(storageConfig, modelUrl, 3600)
    } catch (e) {
      console.error('Failed to get model URL:', e)
    }
  }

  return corsJson(
    {
      id: assetSet.id,
      name: assetSet.name,
      version: (schema as any).version || '1.0',
      model: {
        type: (schema.model as any)?.type || 'glb',
        source: (schema.model as any)?.source || 'default_tshirt.glb',
        url: modelUrl,
      },
      printLocations: (schema as any).printLocations || [],
      cameraPresets: (schema as any).cameraPresets || [],
      renderPreset: (schema as any).renderPreset || {},
      uploadPolicy: (schema as any).uploadPolicy || {
        maxFileSizeMB: 1024,
        minDPI: 150,
        allowedFormats: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/tiff',
          'image/vnd.adobe.photoshop',
          'image/svg+xml',
          'application/pdf',
          'application/postscript',
        ],
      },
    },
    request
  )
}
