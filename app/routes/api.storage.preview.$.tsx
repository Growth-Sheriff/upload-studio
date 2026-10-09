import type { LoaderFunctionArgs } from '@remix-run/node'
import { buildFileUrl, storageConfigForShop } from '~/lib/uploadUrls.server'
import { authenticate } from '~/shopify.server'
import prisma from '~/lib/prisma.server'













export async function loader({ params, request }: LoaderFunctionArgs) {
  try {

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
      select: { id: true, storageProvider: true, storageConfig: true },
    })
    if (!shop) {
      return new Response('Shop not found', { status: 404 })
    }


    const url = new URL(request.url)
    const pathAfterPreview = url.pathname.replace('/api/storage/preview/', '')
    const key = decodeURIComponent(pathAfterPreview)

    if (!key) {
      return new Response('Missing key', { status: 400 })
    }


    const ownsKey = await prisma.upload.findFirst({
      where: {
        shopId: shop.id,
        items: { some: { OR: [{ storageKey: key }, { thumbnailKey: key }, { previewKey: key }] } },
      },
      select: { id: true },
    })

    if (!ownsKey) {
      return new Response('Forbidden', { status: 403 })
    }


    const fileUrl = buildFileUrl(storageConfigForShop(shop), key)
    return fileUrl ? Response.redirect(fileUrl, 302) : new Response('File not found', { status: 404 })
  } catch (error: any) {
    console.error('[Storage Preview] Error:', error)
    return new Response('Internal error', { status: 500 })
  }
}
