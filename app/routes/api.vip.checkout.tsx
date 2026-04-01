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
  query VipCheckoutShopCurrency {
    shop {
      currencyCode
    }
  }
`

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation VipDraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
      }
      userErrors {
        field
        message
      }
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
    return json({ error: 'VIP checkout is only available to assigned VIP customers' }, { status: 403 })
  }

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    select: {
      id: true,
      productId: true,
      variantId: true,
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

  let currencyCode = 'USD'
  try {
    const currencyResponse = await shopifyGraphQL<{ shop: { currencyCode?: string | null } }>(
      shop.shopDomain,
      shop.accessToken,
      SHOP_CURRENCY_QUERY
    )
    currencyCode = String(currencyResponse?.shop?.currencyCode || 'USD').toUpperCase()
  } catch (error) {
    console.warn('[VIP Checkout] Falling back to USD currency code:', error)
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

  const draftOrderInput = {
    note: `VIP checkout for upload ${upload.id}`,
    lineItems: [
      {
        title: 'VIP Custom Transfer',
        quantity: 1,
        requiresShipping: true,
        originalUnitPriceWithCurrency: {
          amount: quote.formattedTotalPrice,
          currencyCode,
        },
        customAttributes: [
          { key: '_ul_upload_id', value: upload.id },
          { key: '_ul_shop_domain', value: shop.shopDomain },
          { key: '_ul_customer_id', value: loggedInCustomerId || '' },
          { key: '_ul_customer_type', value: pricingContext.customerType },
          { key: '_ul_status_key', value: pricingContext.statusKey },
          { key: '_ul_status_label', value: pricingContext.statusLabel },
          { key: '_ul_price_per_inch', value: pricingContext.pricePerInch.toFixed(4) },
          { key: '_ul_page_width_in', value: quote.pageWidthIn.toFixed(2) },
          { key: '_ul_page_length_in', value: quote.pageLengthIn.toFixed(2) },
          { key: '_ul_measurement_mode', value: measurement.measurementMode || '' },
          { key: '_ul_product_id', value: upload.productId || '' },
          { key: '_ul_variant_id', value: upload.variantId || '' },
        ].filter((entry) => entry.value !== ''),
      },
    ],
  }

  let result:
    | {
        draftOrder: { id: string; invoiceUrl: string | null } | null
        userErrors: Array<{ field: string[] | null; message: string }>
      }
    | null = null

  try {
    const draftOrderResponse = await shopifyGraphQL<{
      draftOrderCreate: {
        draftOrder: { id: string; invoiceUrl: string | null } | null
        userErrors: Array<{ field: string[] | null; message: string }>
      }
    }>(shop.shopDomain, shop.accessToken, DRAFT_ORDER_CREATE_MUTATION, {
      input: draftOrderInput,
    })
    result = draftOrderResponse?.draftOrderCreate || null
  } catch (error) {
    console.error('[VIP Checkout] Draft order creation failed:', error)
    return json({ error: 'Failed to create VIP draft order' }, { status: 500 })
  }

  if (!result?.draftOrder?.invoiceUrl) {
    return json(
      {
        error: result?.userErrors?.[0]?.message || 'Failed to create VIP draft order',
        userErrors: result?.userErrors || [],
      },
      { status: 500 }
    )
  }

  return json({
    ok: true,
    checkoutUrl: result.draftOrder.invoiceUrl,
    redirectUrl: result.draftOrder.invoiceUrl,
    url: result.draftOrder.invoiceUrl,
    invoiceUrl: result.draftOrder.invoiceUrl,
    draftOrderId: result.draftOrder.id,
    quoteTotal: quote.totalPrice,
    exactTotal: quote.totalPrice,
    quote: {
      pageWidthIn: quote.pageWidthIn,
      pageLengthIn: quote.pageLengthIn,
      pricePerInch: quote.pricePerInch,
      totalPrice: quote.totalPrice,
      formattedTotalPrice: quote.formattedTotalPrice,
      currencyCode,
    },
    customer: {
      customerId: pricingContext.customerId,
      customerType: pricingContext.customerType,
      statusKey: pricingContext.statusKey,
      statusLabel: pricingContext.statusLabel,
      pricePerInch: pricingContext.pricePerInch,
    },
  })
}
