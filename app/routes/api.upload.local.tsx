import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import {
  saveLocalFile,
  saveLocalFileStream,
} from '~/lib/storage.server'
import { authorizeUploadStorageCapability } from '~/lib/uploadStorageCapability.server'

function capabilityCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'PUT, POST, OPTIONS',
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
  if (request.method !== 'PUT' && request.method !== 'POST') {
    return capabilityJson({ error: 'Method not allowed' }, request, 405)
  }

  const url = new URL(request.url)
  const key = url.searchParams.get('key') || ''
  const expectedSize = Number(url.searchParams.get('size'))
  const token = url.searchParams.get('token') || ''

  if (
    !key ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    !await authorizeUploadStorageCapability('local', key, expectedSize, token)
  ) {
    return capabilityJson({ error: 'Invalid or expired upload capability' }, request, 401)
  }

  const item = await prisma.uploadItem.findFirst({
    where: {
      storageKey: { in: [`local:${key}`, `bunny:${key}`, `r2:${key}`] },
      fileSize: expectedSize,
      upload: { status: 'draft', privacyRedactedAt: null },
    },
    select: { id: true },
  })
  if (!item) {
    return capabilityJson({ error: 'Upload intent is no longer writable' }, request, 409)
  }

  try {
    if (request.method === 'PUT') {
      const contentLength = Number(request.headers.get('content-length'))
      if (contentLength !== expectedSize || !request.body) {
        return capabilityJson({ error: 'Upload size does not match the signed intent' }, request, 400)
      }
      await saveLocalFileStream(key, request.body, expectedSize)
    } else {
      // Compatibility for an older installed theme asset. New clients use
      // streaming PUT so the app does not buffer a gang sheet in memory.
      const wireLength = Number(request.headers.get('content-length'))
      if (!Number.isFinite(wireLength) || wireLength <= 0 || wireLength > expectedSize + 1024 * 1024) {
        return capabilityJson({ error: 'Multipart upload exceeds the signed intent' }, request, 400)
      }
      const formData = await request.formData()
      const file = formData.get('file')
      const postedKey = String(formData.get('key') || key)
      if (!(file instanceof File) || postedKey !== key || file.size !== expectedSize) {
        return capabilityJson({ error: 'Multipart upload does not match the signed intent' }, request, 400)
      }
      await saveLocalFile(key, Buffer.from(await file.arrayBuffer()))
    }

    return capabilityJson({ success: true, key }, request, 200)
  } catch (error) {
    console.error('[LocalUpload] Upload failed:',
      error instanceof Error ? error.message : String(error))
    return capabilityJson({ error: 'Upload failed' }, request, 500)
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: capabilityCorsHeaders(request) })
  }
  return capabilityJson({ error: 'Method not allowed' }, request, 405)
}
