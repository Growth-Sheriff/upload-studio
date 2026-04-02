import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { normalizeCustomerId } from '~/lib/customerPricing.server'
import { prepareCustomPricingQuote } from '~/lib/customerPricingCheckout.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import { authenticate } from '~/shopify.server'

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation CustomPricingDraftOrderCreate($input: DraftOrderInput!) {
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

function parsePositiveInteger(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.floor(parsed))
}

function errorStatusFromMessage(message: string): number {
  if (message === 'Shop not found') return 404
  if (message === 'Upload not found') return 404
  if (message === 'Product not found') return 404
  if (message === 'Upload measurement is not ready') return 409
  if (message === 'Upload does not belong to the logged in customer') return 403
  if (message === 'Custom pricing is not active for this customer and product') return 403
  if (message === 'Upload product is missing') return 422
  if (message.includes('No product variant can fit')) return 422
  if (message.includes('outside product limits')) return 422
  if (message.includes('exceeds')) return 422
  if (message.includes('must be at least')) return 422
  return 500
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
  const quantity = parsePositiveInteger(body.quantity, 1)
  const selectedVariantId =
    body.selectedVariantId != null && String(body.selectedVariantId).trim()
      ? String(body.selectedVariantId).trim()
      : null

  if (!uploadId) {
    return json({ error: 'Missing uploadId' }, { status: 400 })
  }

  let prepared
  try {
    prepared = await prepareCustomPricingQuote({
      shopDomain,
      loggedInCustomerId,
      uploadId,
      quantity,
      selectedVariantId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare custom checkout.'
    return json({ error: message }, { status: errorStatusFromMessage(message) })
  }

  const checkoutLabel =
    prepared.pricingContext.customerType === 'business'
      ? 'Business custom checkout'
      : 'VIP custom checkout'
  const lineTitle =
    prepared.pricingContext.customerType === 'business'
      ? `${prepared.productTitle} - Business Pricing`
      : `${prepared.productTitle} - VIP Pricing`

  const draftOrderInput = {
    note: `Custom pricing checkout for upload ${prepared.upload.id}`,
    lineItems: [
      {
        title: lineTitle,
        quantity: 1,
        requiresShipping: true,
        originalUnitPriceWithCurrency: {
          amount: prepared.quote.formattedTotalPrice,
          currencyCode: prepared.currencyCode,
        },
        customAttributes: [
          { key: '_ul_upload_id', value: prepared.upload.id },
          { key: '_ul_uploaded', value: 'true' },
          { key: '_ul_shop_domain', value: prepared.shop.shopDomain },
          { key: '_ul_customer_id', value: loggedInCustomerId || '' },
          { key: '_ul_customer_type', value: prepared.pricingContext.customerType },
          { key: '_ul_status_key', value: prepared.pricingContext.statusKey },
          { key: '_ul_status_label', value: prepared.pricingContext.statusLabel },
          { key: '_ul_pricing_mode', value: prepared.pricingContext.pricingMode },
          { key: '_ul_price_per_inch', value: prepared.quote.pricePerInch.toFixed(4) },
          { key: '_ul_page_width_in', value: prepared.quote.pageWidthIn.toFixed(2) },
          { key: '_ul_page_length_in', value: prepared.quote.pageLengthIn.toFixed(2) },
          { key: '_ul_billable_length_in', value: prepared.quote.billableLengthIn.toFixed(2) },
          { key: '_ul_measurement_mode', value: prepared.measurement.measurementMode || '' },
          { key: '_ul_product_id', value: prepared.upload.productId || '' },
          { key: '_ul_variant_id', value: prepared.upload.variantId || '' },
          { key: 'Print READY', value: prepared.upload.uploadUrl || '' },
          { key: 'Design File', value: prepared.upload.fileName || '' },
          {
            key: '_ul_selected_variant_id',
            value: prepared.resolvedVariant?.selectedVariantId || selectedVariantId || '',
          },
          {
            key: '_ul_selected_variant_title',
            value:
              prepared.resolvedVariant?.selectedVariantTitle ||
              prepared.quote.sheetVariantTitle ||
              '',
          },
          {
            key: '_ul_selected_sheet_label',
            value: prepared.resolvedVariant?.selectedSheetLabel || '',
          },
          {
            key: '_ul_sheets_needed',
            value: String(prepared.resolvedVariant?.sheetsNeeded || prepared.quote.sheetsNeeded || 1),
          },
          {
            key: '_ul_designs_per_sheet',
            value: String(prepared.resolvedVariant?.designsPerSheet || ''),
          },
        ].filter((entry) => entry.value !== ''),
      },
    ],
  }

  try {
    const draftOrderResponse = await shopifyGraphQL<{
      draftOrderCreate: {
        draftOrder: { id: string; invoiceUrl: string | null } | null
        userErrors: Array<{ field: string[] | null; message: string }>
      }
    }>(prepared.shop.shopDomain, prepared.shop.accessToken, DRAFT_ORDER_CREATE_MUTATION, {
      input: draftOrderInput,
    })

    const result = draftOrderResponse?.draftOrderCreate
    if (!result?.draftOrder?.invoiceUrl) {
      return json(
        {
          error: result?.userErrors?.[0]?.message || `Failed to create ${checkoutLabel}`,
          userErrors: result?.userErrors || [],
        },
        { status: 500 }
      )
    }

    return json({
      ok: true,
      checkoutLabel,
      checkoutUrl: result.draftOrder.invoiceUrl,
      redirectUrl: result.draftOrder.invoiceUrl,
      url: result.draftOrder.invoiceUrl,
      invoiceUrl: result.draftOrder.invoiceUrl,
      draftOrderId: result.draftOrder.id,
      quoteTotal: prepared.quote.totalPrice,
      exactTotal: prepared.quote.totalPrice,
      currency: prepared.currencyCode,
      quote: {
        pageWidthIn: prepared.quote.pageWidthIn,
        pageLengthIn: prepared.quote.pageLengthIn,
        billableLengthIn: prepared.quote.billableLengthIn,
        pricePerInch: prepared.quote.pricePerInch,
        totalPrice: prepared.quote.totalPrice,
        formattedTotalPrice: prepared.quote.formattedTotalPrice,
        currencyCode: prepared.currencyCode,
        selectedVariantId: prepared.resolvedVariant?.selectedVariantId || null,
        selectedVariantTitle:
          prepared.resolvedVariant?.selectedVariantTitle || prepared.quote.sheetVariantTitle || null,
        selectedSheetLabel: prepared.resolvedVariant?.selectedSheetLabel || null,
        sheetsNeeded: prepared.resolvedVariant?.sheetsNeeded || prepared.quote.sheetsNeeded || null,
      },
      customer: {
        customerId: prepared.pricingContext.customerId,
        customerType: prepared.pricingContext.customerType,
        statusKey: prepared.pricingContext.statusKey,
        statusLabel: prepared.pricingContext.statusLabel,
        pricingMode: prepared.pricingContext.pricingMode,
        pricePerInch: prepared.pricingContext.pricePerInch,
      },
    })
  } catch (error) {
    console.error('[Custom Checkout] Draft order creation failed:', error)
    return json({ error: `Failed to create ${checkoutLabel}` }, { status: 500 })
  }
}
