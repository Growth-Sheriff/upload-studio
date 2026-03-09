import type { LoaderFunctionArgs } from '@remix-run/node'
import { isBunnyUrl, readLocalFile } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'
import prisma from '~/lib/prisma.server'

/**
 * GET /api/storage/preview/:key
 *
 * Protected endpoint - requires admin authentication
 * Serves files from local storage with proper caching headers.
 * For thumbnails and preview images in the admin panel.
 *
 * For Bunny storage: Redirects to CDN
 * For Local storage: Serves from filesystem
 *
 * The key is URL-encoded and can contain slashes.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  try {
    // Require admin authentication for storage preview
    let session: { shop: string }
    try {
      const auth = await authenticate.admin(request)
      session = auth.session
    } catch (authError) {
      console.error('[Storage Preview] Auth failed:', authError)
      return new Response('Unauthorized', { status: 401 })
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    })
    if (!shop) {
      return new Response('Shop not found', { status: 404 })
    }

    // Get the full key from params - Remix handles the splat
    const url = new URL(request.url)
    const pathAfterPreview = url.pathname.replace('/api/storage/preview/', '')
    const key = decodeURIComponent(pathAfterPreview)

    if (!key) {
      return new Response('Missing key', { status: 400 })
    }

    // Verify the storage key belongs to this shop
    const ownsKey = await prisma.upload.findFirst({
      where: {
        shopId: shop.id,
        OR: [
          { storageKey: key },
          { thumbnailKey: key },
          { items: { some: { storageKey: key } } },
        ],
      },
      select: { id: true },
    })

    if (!ownsKey) {
      return new Response('Forbidden', { status: 403 })
    }

    // If key is a Bunny URL or bunny: prefixed, redirect to CDN
    if (isBunnyUrl(key) || key.startsWith('bunny:')) {
      const cdnUrl = process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'
      let redirectUrl: string

      if (key.startsWith('http')) {
        redirectUrl = key
      } else {
        const cleanKey = key.replace('bunny:', '')
        redirectUrl = `${cdnUrl}/${cleanKey}`
      }

      return Response.redirect(redirectUrl, 302)
    }

    // Local storage
    try {
      const data = await readLocalFile(key)
      const contentType = getContentType(key)
      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      return new Response('File not found', { status: 404 })
    }
  } catch (error: any) {
    console.error('[Storage Preview] Error:', error)
    return new Response('Internal error', { status: 500 })
  }
}

function getContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    ai: 'application/postscript',
    eps: 'application/postscript',
    psd: 'image/vnd.adobe.photoshop',
  }
  return types[ext || ''] || 'application/octet-stream'
}
