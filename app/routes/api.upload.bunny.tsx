import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import {
  getStorageConfig,
  proxyUploadToBunny,
  validateUploadCapabilityToken,
} from '~/lib/storage.server'

function capabilityCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  })
  const origin = request.headers.get('origin')
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  return headers
}

function capabilityJson(data: unknown, request: Request, status: number): Response {
  const headers = capabilityCorsHeaders(request)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(data), { status, headers })
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: capabilityCorsHeaders(request) })
  }
  if (request.method !== 'PUT') {
    return capabilityJson({ error: 'Method not allowed' }, request, 405)
  }

  const url = new URL(request.url)
  const key = url.searchParams.get('key') || ''
  const expectedSize = Number(url.searchParams.get('size'))
  const token = url.searchParams.get('token') || ''
  const contentLength = Number(request.headers.get('content-length'))

  if (
    !key ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    !validateUploadCapabilityToken('bunny', key, expectedSize, token)
  ) {
    return capabilityJson({ error: 'Invalid or expired upload capability' }, request, 401)
  }
  if (contentLength !== expectedSize || !request.body) {
    return capabilityJson({ error: 'Upload size does not match the signed intent' }, request, 400)
  }

  const item = await prisma.uploadItem.findFirst({
    where: {
      storageKey: `bunny:${key}`,
      fileSize: expectedSize,
      upload: { status: 'draft' },
    },
    select: {
      mimeType: true,
      upload: {
        select: {
          shop: {
            select: { storageProvider: true, storageConfig: true },
          },
        },
      },
    },
  })
  if (!item) {
    return capabilityJson({ error: 'Upload intent is no longer writable' }, request, 409)
  }

  const storageConfig = getStorageConfig({
    storageProvider: item.upload.shop.storageProvider,
    storageConfig: item.upload.shop.storageConfig as Record<string, string> | null,
  })
  if (storageConfig.provider !== 'bunny') {
    return capabilityJson({ error: 'Storage provider mismatch' }, request, 409)
  }

  try {
    await proxyUploadToBunny(
      storageConfig,
      key,
      request.body,
      expectedSize,
      item.mimeType || request.headers.get('content-type') || 'application/octet-stream'
    )
    return capabilityJson({ success: true, key }, request, 200)
  } catch (error) {
    console.error('[BunnyUploadProxy] Upload failed:',
      error instanceof Error ? error.message : String(error))
    return capabilityJson({ error: 'Upload failed' }, request, 502)
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: capabilityCorsHeaders(request) })
  }
  return capabilityJson({ error: 'Method not allowed' }, request, 405)
}
