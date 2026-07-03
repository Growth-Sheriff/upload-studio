




import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { createHash } from 'crypto'
import prisma from '~/lib/prisma.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'


function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}


async function authenticateRequest(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const apiKey = authHeader.slice(7)
  const keyHash = hashApiKey(apiKey)

  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      keyHash,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })

  if (!keyRecord) return null


  await prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
  })


  const shop = await prisma.shop.findUnique({
    where: { id: keyRecord.shopId },
  })

  return shop
}


export async function loader({ request, params }: LoaderFunctionArgs) {

  const identifier = getIdentifier(request, 'shop')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  const shop = await authenticateRequest(request)
  if (!shop) {
    return json({ error: 'Unauthorized. Please provide valid API key.' }, { status: 401 })
  }

  const exportId = params.id
  if (!exportId) {
    return json({ error: 'Missing export ID' }, { status: 400 })
  }

  const exportRecord = await prisma.exportJob.findFirst({
    where: { id: exportId, shopId: shop.id },
  })

  if (!exportRecord) {
    return json({ error: 'Export not found' }, { status: 404 })
  }


  let downloadUrl = exportRecord.downloadUrl
  if (exportRecord.status === 'completed' && exportRecord.downloadUrl) {

    if (!exportRecord.downloadUrl.startsWith('http')) {
      try {
        const storageConfig = getStorageConfig({
          storageProvider: shop.storageProvider,
          storageConfig: shop.storageConfig as Record<string, string> | null,
        })
        downloadUrl = await getDownloadSignedUrl(
          storageConfig,
          exportRecord.downloadUrl,
          15 * 60
        )
      } catch (error) {
        console.error('[Export API] Failed to generate signed URL:', error)
        downloadUrl = null
      }
    }
  }

  return json({
    id: exportRecord.id,
    status: exportRecord.status,
    uploadIds: exportRecord.uploadIds,
    downloadUrl: exportRecord.status === 'completed' ? downloadUrl : null,
    createdAt: exportRecord.createdAt,
    completedAt: exportRecord.completedAt,
    expiresAt: exportRecord.expiresAt,
  })
}
