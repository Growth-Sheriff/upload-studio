import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  calculateVipQuote,
  extractVipUploadMeasurement,
  normalizeCustomerId,
  resolveCustomerPricingContext,
  validateVipQuoteAgainstLimits,
} from '~/lib/customerPricing.server'
import { authenticate } from '~/shopify.server'

const SHOP_CURRENCY_QUERY = `
  query VipQuoteShopCurrency {
    shop {
      currencyCode
    }
  }
`

function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return request.json() as Promise<Record<string, unknown>>
  }

  if (contentType.includes('form')) {
    return request.formData().then((formData) => Object.fromEntries(formData.entries()))
  }

  return request.text().then((text) => {
    if (!text) return {}
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return {}
    }
  })
}

function normalizeProductId(productId: string | null | undefined): string | null {
  if (!productId) return null
  const raw = String(productId).trim()
  if (!raw) return null
  return raw.startsWith('gid://') ? raw : `gid://shopify/Product/${raw}`
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  await authenticate.public.appProxy(request)

  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')?.trim() || ''
  const loggedInCustomerId = normalizeCustomerId(url.searchParams.get('logged_in_customer_id'))

  if (!shopDomain) {
    return json({ error: 'Missing shop parameter' }, { status: 400 })
  }

  const body = await parseBody(request)
  const uploadId = String(body.uploadId || '').trim()

  if (!uploadId) {
    return json({ error: 'Missing uploadId' }, { status: 400 })
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      accessToken: true,
      settings: true,
    },
  })

  if (!shop?.accessToken) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const pricingContext = resolveCustomerPricingContext(shop.settings, loggedInCustomerId)

  if (pricingContext.customerType !== 'vip') {
    return json({ error: 'VIP quote is only available to assigned VIP customers' }, { status: 403 })
  }

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    select: {
      id: true,
      productId: true,
      customerId: true,
      items: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          preflightStatus: true,
          preflightResult: true,
        },
      },
    },
  })

  if (!upload) {
    return json({ error: 'Upload not found' }, { status: 404 })
  }

  const uploadCustomerId = normalizeCustomerId(upload.customerId)
  if (uploadCustomerId && loggedInCustomerId && uploadCustomerId !== loggedInCustomerId) {
    return json({ error: 'Upload does not belong to the logged in customer' }, { status: 403 })
  }

  const measurement = extractVipUploadMeasurement(upload.items)
  if (!measurement) {
    return json({ error: 'Upload measurement is not ready' }, { status: 409 })
  }

  const productConfig = upload.productId
    ? await prisma.productConfig.findFirst({
        where: {
          shopId: shop.id,
          OR: [
            { productId: upload.productId },
            { productId: normalizeProductId(upload.productId) || upload.productId },
          ],
        },
        select: {
          builderConfig: true,
        },
      })
    : null

  const quote = calculateVipQuote(measurement, pricingContext.pricePerInch)
  const validation = validateVipQuoteAgainstLimits(
    quote,
    (productConfig?.builderConfig as Record<string, unknown> | null) || null
  )

  if (!validation.ok) {
    return json(
      {
        error: validation.reason || 'VIP design is outside product limits',
        code: validation.code,
      },
      { status: 422 }
    )
  }

  let currencyCode = 'USD'
  try {
    const currencyResponse = await shopifyGraphQL<{ shop: { currencyCode?: string | null } }>(
      shop.shopDomain,
      shop.accessToken,
      SHOP_CURRENCY_QUERY
    )
    currencyCode = String(currencyResponse?.shop?.currencyCode || 'USD').toUpperCase()
  } catch (error) {
    console.warn('[VIP Quote] Falling back to USD currency code:', error)
  }

  return json({
    ok: true,
    customerType: pricingContext.customerType,
    statusKey: pricingContext.statusKey,
    statusLabel: pricingContext.statusLabel,
    pricePerInch: quote.pricePerInch,
    pageWidthIn: quote.pageWidthIn,
    pageLengthIn: quote.pageLengthIn,
    billableLengthIn: quote.pageLengthIn,
    totalPrice: quote.totalPrice,
    quoteTotal: quote.totalPrice,
    exactTotal: quote.totalPrice,
    currency: currencyCode,
    quote: {
      customerType: pricingContext.customerType,
      statusKey: pricingContext.statusKey,
      statusLabel: pricingContext.statusLabel,
      pricePerInch: quote.pricePerInch,
      pageWidthIn: quote.pageWidthIn,
      pageLengthIn: quote.pageLengthIn,
      billableLengthIn: quote.pageLengthIn,
      totalPrice: quote.totalPrice,
      quoteTotal: quote.totalPrice,
      exactTotal: quote.totalPrice,
      currency: currencyCode,
    },
  })
}
