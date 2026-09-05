import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { deriveUploadItemLifecycle } from '~/lib/uploadLifecycle.server'
import { DPI_PROPERTY, PRINT_READY_PROPERTY, SHEET_IDENTITY_PROPERTY } from '~/lib/orderMatching.server'
import { buildFileUrl, buildIdentityUrl, buildThumbnailUrl, storageConfigForShop } from '~/lib/uploadUrls.server'
import { authenticate } from '~/shopify.server'

// "Buy it again" support for the cart page. Shopify re-adds the variant but
// drops our line properties, so the cart embed asks here which design the
// line should carry. Two answers, both bound to the logged-in customer:
//   match   — only when the cart embed knows the exact source order
//             (`orderId`): the upload linked to that order for this product.
//   history — the customer's own previously ordered designs for this product,
//             for them to pick from. Nothing is chosen automatically here.

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request)
  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')?.trim() || url.searchParams.get('shopDomain')?.trim() || ''
  const customerId = digits(url.searchParams.get('logged_in_customer_id'))
  const productId = digits(url.searchParams.get('productId'))
  const variantId = digits(url.searchParams.get('variantId'))
  const sourceOrderId = digits(url.searchParams.get('orderId'))

  if (!shopDomain) return json({ error: 'Missing shop parameter' }, { status: 400 })
  if (!customerId) return json({ customer: false, match: null, history: [] })
  if (!productId) return json({ customer: true, match: null, history: [] })

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, storageProvider: true, storageConfig: true },
  })
  if (!shop) return json({ error: 'Shop not found' }, { status: 404 })

  const storageConfig = storageConfigForShop(shop)
  const customerCandidates = [customerId, `gid://shopify/Customer/${customerId}`]
  const productCandidates = [productId, `gid://shopify/Product/${productId}`]
  const variantCandidates = variantId ? [variantId, `gid://shopify/ProductVariant/${variantId}`] : []

  const uploads = await prisma.upload.findMany({
    where: {
      shopId: shop.id,
      customerId: { in: customerCandidates },
      productId: { in: productCandidates },
      orderId: { not: null },
      status: { notIn: ['archived', 'blocked'] },
    },
    orderBy: [{ orderPaidAt: 'desc' }, { createdAt: 'desc' }],
    take: 40,
    select: {
      id: true,
      variantId: true,
      orderId: true,
      orderName: true,
      orderPaidAt: true,
      createdAt: true,
      requestedCopies: true,
      items: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { originalName: true, storageKey: true, thumbnailKey: true, preflightStatus: true, preflightResult: true },
      },
      ordersLink: { select: { orderId: true }, take: 5 },
    },
  })

  const describe = (upload: (typeof uploads)[number]) => {
    const item = upload.items[0]
    if (!item || !item.storageKey) return null // ghost record: no file to reuse
    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: item.preflightStatus,
      preflightResult: item.preflightResult,
      thumbnailKey: item.thumbnailKey,
    })
    const dpi = Number(lifecycle.metadata?.effectiveDpi || lifecycle.metadata?.documentDpi || lifecycle.metadata?.dpi || 0)
    const identityUrl = buildIdentityUrl(upload.id)
    return {
      uploadId: upload.id,
      orderId: digits(upload.orderId),
      orderName: upload.orderName || null,
      orderedAt: (upload.orderPaidAt || upload.createdAt).toISOString(),
      fileName: item.originalName || 'Design',
      thumbnailUrl: buildThumbnailUrl(storageConfig, item.thumbnailKey),
      variantId: digits(upload.variantId),
      copies: upload.requestedCopies || 1,
      properties: {
        [PRINT_READY_PROPERTY]: buildFileUrl(storageConfig, item.storageKey) || identityUrl,
        [SHEET_IDENTITY_PROPERTY]: identityUrl,
        [DPI_PROPERTY]: dpi > 0 ? String(Math.round(dpi)) : 'n/a',
      },
    }
  }

  const history = uploads.map(describe).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  let match: (typeof history)[number] | null = null
  if (sourceOrderId) {
    const fromOrder = uploads.filter(
      (upload) =>
        digits(upload.orderId) === sourceOrderId || upload.ordersLink.some((link) => digits(link.orderId) === sourceOrderId)
    )
    const preferred =
      (variantCandidates.length ? fromOrder.find((upload) => upload.variantId && variantCandidates.includes(upload.variantId)) : null) ||
      (fromOrder.length === 1 ? fromOrder[0] : null)
    match = preferred ? describe(preferred) : null
  }

  return json({ customer: true, match, history: history.slice(0, 8) })
}
