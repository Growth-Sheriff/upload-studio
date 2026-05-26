import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'
import { abortR2Multipart, getStorageConfig } from '~/lib/storage.server'

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  return corsJson({ method: 'POST', description: 'Abort an in-progress multipart upload (cleanup)' }, request)
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') return handleCorsOptions(request)
  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, request, { status: 405 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return corsJson({ error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const { shopDomain, key, multipartUploadId } = body as {
    shopDomain?: string
    key?: string
    multipartUploadId?: string
  }

  if (!shopDomain || !key || !multipartUploadId) {
    return corsJson(
      { error: 'Missing required fields: shopDomain, key, multipartUploadId' },
      request,
      { status: 400 }
    )
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) return corsJson({ error: 'Shop not found' }, request, { status: 404 })

  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })

  const result = await abortR2Multipart(storageConfig, key, multipartUploadId)
  if (!result.ok) {
    console.error(`[Multipart Abort] R2 abort failed for ${key}:`, result.error)
    return corsJson({ error: result.error || 'multipart_abort_failed' }, request, { status: 500 })
  }
  console.log(`[Multipart Abort] OK shop=${shopDomain} key=${key}`)
  return corsJson({ success: true }, request)
}
