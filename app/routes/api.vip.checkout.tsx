import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { normalizeCustomerId } from '~/lib/customerPricing.server'
import {
  prepareCustomPricingJobQuote,
} from '~/lib/customerPricingCheckout.server'
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

function formatDecimalAmount(value: number, digits = 6): string {
  const safe = Number(value)
  if (!Number.isFinite(safe)) return '0'
  return safe
    .toFixed(digits)
    .replace(/\.?0+$/, '')
}

function normalizeCheckoutItems(body: Record<string, unknown>) {
  const rawItems = Array.isArray(body.items) ? body.items : []
  const normalizedItems = rawItems
    .map((entry) => {
      const item = (entry || {}) as Record<string, unknown>
      const uploadId = String(item.uploadId || '').trim()
      if (!uploadId) return null
      return {
        uploadId,
        quantity: parsePositiveInteger(item.quantity, 1),
        selectedVariantId:
          item.selectedVariantId != null && String(item.selectedVariantId).trim()
            ? String(item.selectedVariantId).trim()
            : null,
      }
    })
    .filter(Boolean) as Array<{
      uploadId: string
      quantity: number
      selectedVariantId: string | null
    }>

  if (normalizedItems.length) return normalizedItems

  const uploadId = String(body.uploadId || '').trim()
  if (!uploadId) return []

  return [
    {
      uploadId,
      quantity: parsePositiveInteger(body.quantity, 1),
      selectedVariantId:
        body.selectedVariantId != null && String(body.selectedVariantId).trim()
          ? String(body.selectedVariantId).trim()
          : null,
    },
  ]
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
  const normalizedItems = normalizeCheckoutItems(body)

  if (!normalizedItems.length) {
    return json({ error: 'Missing uploadId' }, { status: 400 })
  }

  let prepared
  try {
    prepared = await prepareCustomPricingJobQuote({
      shopDomain,
      loggedInCustomerId,
      items: normalizedItems,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare custom checkout.'
    return json({ error: message }, { status: errorStatusFromMessage(message) })
  }

  const preparedItems = prepared.items
  const firstItem = preparedItems[0]
  const aggregateTotal =
    'totalPrice' in prepared && typeof prepared.totalPrice === 'number'
      ? prepared.totalPrice
      : preparedItems.reduce((sum, item) => sum + item.quote.totalPrice, 0)
  const aggregateBillableLengthIn =
    'totalBillableLengthIn' in prepared && typeof prepared.totalBillableLengthIn === 'number'
      ? prepared.totalBillableLengthIn
      : preparedItems.reduce((sum, item) => sum + item.quote.billableLengthIn, 0)

  const checkoutLabel =
    firstItem.pricingContext.customerType === 'business'
      ? 'Business custom checkout'
      : 'VIP custom checkout'
  const noteUploadIds = preparedItems.map((item) => item.upload.id).join(', ')

  const draftOrderInput = {
    note: `Custom pricing checkout for upload ${noteUploadIds}`,
    lineItems: preparedItems.map((item, index) => {
      const lineTitle =
        item.pricingContext.customerType === 'business'
          ? `${item.productTitle} - Business Pricing`
          : `${item.productTitle} - VIP Pricing`
      const requestedCopies = Math.max(1, item.requestedQuantity)
      const unitAmount = item.quote.totalPrice / requestedCopies

      return {
        title:
          lineTitle +
          ` (${item.quote.pageWidthIn.toFixed(2)}" x ${item.quote.pageLengthIn.toFixed(2)}", ${requestedCopies} cop${requestedCopies === 1 ? 'y' : 'ies'})`,
        quantity: requestedCopies,
        requiresShipping: true,
        originalUnitPriceWithCurrency: {
          amount: formatDecimalAmount(unitAmount),
          currencyCode: item.currencyCode,
        },
        customAttributes: [
          { key: '_ul_upload_id', value: item.upload.id },
          { key: '_ul_uploaded', value: 'true' },
          { key: '_ul_shop_domain', value: item.shop.shopDomain },
          { key: '_ul_customer_id', value: loggedInCustomerId || '' },
          { key: '_ul_customer_type', value: item.pricingContext.customerType },
          { key: '_ul_status_key', value: item.pricingContext.statusKey },
          { key: '_ul_status_label', value: item.pricingContext.statusLabel },
          { key: '_ul_pricing_mode', value: item.pricingContext.pricingMode },
          { key: '_ul_price_per_inch', value: item.quote.pricePerInch.toFixed(4) },
          { key: '_ul_page_width_in', value: item.quote.pageWidthIn.toFixed(2) },
          { key: '_ul_page_length_in', value: item.quote.pageLengthIn.toFixed(2) },
          { key: '_ul_billable_length_in', value: item.quote.billableLengthIn.toFixed(2) },
          { key: '_ul_measurement_mode', value: item.measurement.measurementMode || '' },
          { key: '_ul_product_id', value: item.upload.productId || '' },
          { key: '_ul_variant_id', value: item.upload.variantId || '' },
          { key: '_ul_requested_copies', value: String(item.requestedQuantity) },
          { key: 'Requested Copies', value: String(item.requestedQuantity) },
          { key: 'Print READY', value: item.upload.uploadUrl || '' },
          { key: 'Design File', value: item.upload.fileName || '' },
          {
            key: '_ul_selected_variant_id',
            value: item.resolvedVariant?.selectedVariantId || normalizedItems[index]?.selectedVariantId || '',
          },
          {
            key: '_ul_selected_variant_title',
            value:
              item.resolvedVariant?.selectedVariantTitle ||
              item.quote.sheetVariantTitle ||
              '',
          },
          {
            key: '_ul_selected_sheet_label',
            value: item.resolvedVariant?.selectedSheetLabel || '',
          },
          {
            key: '_ul_sheets_needed',
            value: String(item.resolvedVariant?.sheetsNeeded || item.quote.sheetsNeeded || 1),
          },
          {
            key: '_ul_designs_per_sheet',
            value: String(item.resolvedVariant?.designsPerSheet || ''),
          },
        ].filter((entry) => entry.value !== ''),
      }
    }),
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
      quoteTotal: aggregateTotal,
      exactTotal: aggregateTotal,
      currency: firstItem.currencyCode,
      items: preparedItems.map((item) => ({
        uploadId: item.upload.id,
        fileName: item.upload.fileName,
        requestedQuantity: item.requestedQuantity,
        pageWidthIn: item.quote.pageWidthIn,
        pageLengthIn: item.quote.pageLengthIn,
        billableLengthIn: item.quote.billableLengthIn,
        totalPrice: item.quote.totalPrice,
        selectedVariantId: item.resolvedVariant?.selectedVariantId || null,
        selectedVariantTitle:
          item.resolvedVariant?.selectedVariantTitle || item.quote.sheetVariantTitle || null,
        selectedSheetLabel: item.resolvedVariant?.selectedSheetLabel || null,
        sheetsNeeded: item.resolvedVariant?.sheetsNeeded || item.quote.sheetsNeeded || null,
        designsPerSheet: item.resolvedVariant?.designsPerSheet || null,
      })),
      quote: {
        pageWidthIn: firstItem.quote.pageWidthIn,
        pageLengthIn: firstItem.quote.pageLengthIn,
        billableLengthIn: aggregateBillableLengthIn,
        pricePerInch: firstItem.quote.pricePerInch,
        totalPrice: aggregateTotal,
        formattedTotalPrice: aggregateTotal.toFixed(2),
        currencyCode: firstItem.currencyCode,
        selectedVariantId: firstItem.resolvedVariant?.selectedVariantId || null,
        selectedVariantTitle:
          firstItem.resolvedVariant?.selectedVariantTitle || firstItem.quote.sheetVariantTitle || null,
        selectedSheetLabel: firstItem.resolvedVariant?.selectedSheetLabel || null,
        sheetsNeeded: firstItem.resolvedVariant?.sheetsNeeded || firstItem.quote.sheetsNeeded || null,
      },
      customer: {
        customerId: firstItem.pricingContext.customerId,
        customerType: firstItem.pricingContext.customerType,
        statusKey: firstItem.pricingContext.statusKey,
        statusLabel: firstItem.pricingContext.statusLabel,
        pricingMode: firstItem.pricingContext.pricingMode,
        pricePerInch: firstItem.pricingContext.pricePerInch,
      },
    })
  } catch (error) {
    console.error('[Custom Checkout] Draft order creation failed:', error)
    return json({ error: `Failed to create ${checkoutLabel}` }, { status: 500 })
  }
}
