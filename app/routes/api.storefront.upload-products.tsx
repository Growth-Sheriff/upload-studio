import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { authenticate } from '~/shopify.server'

// Cart page helper: which products in this shop must carry an uploaded design.
// The cart embed uses it to flag lines that reached the cart without our
// properties (Shopify "Buy it again", a direct variant add, a third-party
// reorder) before the order is placed.
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request)
  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')?.trim() || url.searchParams.get('shopDomain')?.trim() || ''
  if (!shopDomain) {
    return json({ error: 'Missing shop parameter' }, { status: 400 })
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, settings: true },
  })
  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const configs = await prisma.productConfig.findMany({
    where: { shopId: shop.id, enabled: true, uploadEnabled: true },
    select: { productId: true },
  })
  const productIds = Array.from(
    new Set(
      configs
        .map((config) => String(config.productId || '').split('/').pop() || '')
        .filter((id) => /^\d+$/.test(id))
    )
  )
  const settings = (shop.settings as Record<string, unknown> | null) || {}

  return json(
    {
      productIds,
      requireUpload: settings.requireUpload !== false,
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
