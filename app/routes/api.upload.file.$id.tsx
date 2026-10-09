import type { LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { buildFileUrl, storageConfigForShop } from '~/lib/uploadUrls.server'
import { bindUploadCapability } from '~/lib/uploadCapability.server'













export async function loader({ params, request }: LoaderFunctionArgs) {

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
      },
    })
  }

  const uploadId = params.id

  if (!uploadId) {
    return new Response('Upload ID required', {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const url = new URL(request.url)
    if (!bindUploadCapability(uploadId, url.searchParams.get('token'))) return new Response('Not found', { status: 404 })
    const upload = await prisma.upload.findUnique({
        where: { id: uploadId },
        include: {
          shop: { select: { storageProvider: true, storageConfig: true } },
          items: {
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
      })

    if (!upload || upload.items.length === 0) {
      return new Response('Upload not found', {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }

    const item = upload.items[0]
    const storageKey = item.storageKey

    if (!storageKey) {
      return new Response('File not found', {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }


    const fileUrl = buildFileUrl(storageConfigForShop(upload.shop), storageKey)
    return fileUrl ? Response.redirect(fileUrl, 302) : new Response('File not found', { status: 404 })
  } catch (error) {
    console.error('[API Upload File] Error serving file:', error)
    return new Response('File not found', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }
}
