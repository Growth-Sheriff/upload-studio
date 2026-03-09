import type { LoaderFunctionArgs } from '@remix-run/node'
import mime from 'mime-types'
import prisma from '~/lib/prisma.server'
import { isBunnyUrl, readLocalFile } from '~/lib/storage.server'

/**
 * GET /api/upload/file/:id
 *
 * Public endpoint to serve uploaded files by upload ID
 * Used by storefront checkout to display uploaded file links
 *
 * This endpoint:
 * 1. Looks up the upload by ID
 * 2. Gets the first upload item's storage key
 * 3. For Bunny storage: Redirects to CDN
 * 4. For Local storage: Serves from filesystem
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  // Handle CORS preflight
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
    const shopDomain = url.searchParams.get('shop')

    let upload
    if (shopDomain) {
      // Scoped access: verify upload belongs to shop
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
      })
      if (!shop) {
        return new Response('Not found', {
          status: 404,
          headers: { 'Access-Control-Allow-Origin': '*' },
        })
      }
      upload = await prisma.upload.findFirst({
        where: { id: uploadId, shopId: shop.id },
        include: {
          items: {
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    } else {
      // Legacy unscoped access — log warning for monitoring
      console.warn(`[API Upload File] Unscoped file access for uploadId: ${uploadId}`)
      upload = await prisma.upload.findUnique({
        where: { id: uploadId },
        include: {
          items: {
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    }

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

    // If storageKey is a Bunny URL or bunny: prefixed, redirect to CDN
    if (isBunnyUrl(storageKey) || storageKey.startsWith('bunny:')) {
      const cdnUrl = process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'
      let redirectUrl: string

      if (storageKey.startsWith('http')) {
        redirectUrl = storageKey
      } else {
        const cleanKey = storageKey.replace('bunny:', '')
        redirectUrl = `${cdnUrl}/${cleanKey}`
      }

      return Response.redirect(redirectUrl, 302)
    }

    // Read file from local storage
    const buffer = await readLocalFile(storageKey)

    // Determine content type from file extension or original name
    const ext = (item.originalName || storageKey).split('.').pop() || ''
    const contentType = item.mimeType || mime.lookup(ext) || 'application/octet-stream'

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': item.originalName
          ? `inline; filename="${encodeURIComponent(item.originalName)}"`
          : 'inline',
        'Cache-Control': 'public, max-age=31536000', // 1 year cache
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    console.error('[API Upload File] Error serving file:', error)
    return new Response('File not found', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }
}
