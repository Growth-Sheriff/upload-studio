import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { normalizeCustomerId } from '~/lib/customerPricing.server'
import {
  prepareCustomPricingJobQuote,
  prepareCustomPricingQuote,
} from '~/lib/customerPricingCheckout.server'
import { authenticate } from '~/shopify.server'

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

function normalizeQuoteItems(body: Record<string, unknown>) {
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

  if (!shopDomain) {
    return json({ error: 'Missing shop parameter' }, { status: 400 })
  }

  const body = await parseBody(request)
  const fallbackCustomerEmail = String(body.customerEmail || '').trim()
  const loggedInCustomerId =
    normalizeCustomerId(url.searchParams.get('logged_in_customer_id')) ||
    normalizeCustomerId(body.customerId)
  const normalizedItems = normalizeQuoteItems(body)

  if (!normalizedItems.length) {
    return json({ error: 'Missing uploadId' }, { status: 400 })
  }

  try {
    const prepared =
      normalizedItems.length === 1
        ? {
            items: [
              await prepareCustomPricingQuote({
                shopDomain,
                loggedInCustomerId,
                loggedInCustomerEmail: fallbackCustomerEmail,
                uploadId: normalizedItems[0].uploadId,
                quantity: normalizedItems[0].quantity,
                selectedVariantId: normalizedItems[0].selectedVariantId,
              }),
            ],
          }
        : await prepareCustomPricingJobQuote({
            shopDomain,
            loggedInCustomerId,
            loggedInCustomerEmail: fallbackCustomerEmail,
            items: normalizedItems,
          })

    const preparedItems = prepared.items
    const firstItem = preparedItems[0]
    const totalPrice =
      'totalPrice' in prepared && typeof prepared.totalPrice === 'number'
        ? prepared.totalPrice
        : firstItem.quote.totalPrice
    const totalBillableLengthIn =
      'totalBillableLengthIn' in prepared && typeof prepared.totalBillableLengthIn === 'number'
        ? prepared.totalBillableLengthIn
        : firstItem.quote.billableLengthIn
    const totalRequestedQuantity =
      'totalRequestedQuantity' in prepared && typeof prepared.totalRequestedQuantity === 'number'
        ? prepared.totalRequestedQuantity
        : firstItem.requestedQuantity

    return json({
      ok: true,
      customerType: firstItem.pricingContext.customerType,
      statusKey: firstItem.pricingContext.statusKey,
      statusLabel: firstItem.pricingContext.statusLabel,
      pricingMode: firstItem.pricingContext.pricingMode,
      hasCustomPricing: firstItem.pricingContext.hasCustomPricing,
      pricePerInch: firstItem.quote.pricePerInch,
      pageWidthIn: firstItem.quote.pageWidthIn,
      pageLengthIn: firstItem.quote.pageLengthIn,
      billableLengthIn: totalBillableLengthIn,
      totalPrice,
      quoteTotal: totalPrice,
      exactTotal: totalPrice,
      currency: firstItem.currencyCode,
      selectedVariantId: firstItem.resolvedVariant?.selectedVariantId || null,
      selectedVariantTitle:
        firstItem.resolvedVariant?.selectedVariantTitle || firstItem.quote.sheetVariantTitle || null,
      selectedSheetLabel: firstItem.resolvedVariant?.selectedSheetLabel || null,
      sheetsNeeded:
        firstItem.resolvedVariant?.sheetsNeeded ||
        firstItem.quote.sheetsNeeded ||
        firstItem.requestedQuantity,
      designsPerSheet: firstItem.resolvedVariant?.designsPerSheet || null,
      totalRequestedQuantity,
      items: preparedItems.map((item) => ({
        uploadId: item.upload.id,
        fileName: item.upload.fileName,
        uploadUrl: item.upload.uploadUrl,
        thumbnailUrl: item.upload.thumbnailUrl,
        customerType: item.pricingContext.customerType,
        statusKey: item.pricingContext.statusKey,
        statusLabel: item.pricingContext.statusLabel,
        pricingMode: item.pricingContext.pricingMode,
        requestedQuantity: item.requestedQuantity,
        pricePerInch: item.quote.pricePerInch,
        pageWidthIn: item.quote.pageWidthIn,
        pageLengthIn: item.quote.pageLengthIn,
        billableLengthIn: item.quote.billableLengthIn,
        totalPrice: item.quote.totalPrice,
        exactTotal: item.quote.totalPrice,
        currency: item.currencyCode,
        selectedVariantId: item.resolvedVariant?.selectedVariantId || null,
        selectedVariantTitle:
          item.resolvedVariant?.selectedVariantTitle || item.quote.sheetVariantTitle || null,
        selectedSheetLabel: item.resolvedVariant?.selectedSheetLabel || null,
        sheetsNeeded:
          item.resolvedVariant?.sheetsNeeded || item.quote.sheetsNeeded || item.requestedQuantity,
        designsPerSheet: item.resolvedVariant?.designsPerSheet || null,
        measurement: {
          dpi: item.measurement.dpi,
          effectiveDpi: item.measurement.effectiveDpi,
          sizingSource: item.measurement.sizingSource,
          widthIn: item.measurement.widthIn,
          heightIn: item.measurement.heightIn,
          measurementMode: item.measurement.measurementMode,
        },
      })),
      quote: {
        customerType: firstItem.pricingContext.customerType,
        statusKey: firstItem.pricingContext.statusKey,
        statusLabel: firstItem.pricingContext.statusLabel,
        pricingMode: firstItem.pricingContext.pricingMode,
        pricePerInch: firstItem.quote.pricePerInch,
        pageWidthIn: firstItem.quote.pageWidthIn,
        pageLengthIn: firstItem.quote.pageLengthIn,
        billableLengthIn: totalBillableLengthIn,
        totalPrice,
        quoteTotal: totalPrice,
        exactTotal: totalPrice,
        currency: firstItem.currencyCode,
        selectedVariantId: firstItem.resolvedVariant?.selectedVariantId || null,
        selectedVariantTitle:
          firstItem.resolvedVariant?.selectedVariantTitle || firstItem.quote.sheetVariantTitle || null,
        selectedSheetLabel: firstItem.resolvedVariant?.selectedSheetLabel || null,
        sheetsNeeded:
          firstItem.resolvedVariant?.sheetsNeeded ||
          firstItem.quote.sheetsNeeded ||
          firstItem.requestedQuantity,
        designsPerSheet: firstItem.resolvedVariant?.designsPerSheet || null,
        totalRequestedQuantity,
        items: preparedItems.map((item) => ({
          uploadId: item.upload.id,
          fileName: item.upload.fileName,
          uploadUrl: item.upload.uploadUrl,
          thumbnailUrl: item.upload.thumbnailUrl,
          requestedQuantity: item.requestedQuantity,
          pageWidthIn: item.quote.pageWidthIn,
          pageLengthIn: item.quote.pageLengthIn,
          billableLengthIn: item.quote.billableLengthIn,
          totalPrice: item.quote.totalPrice,
          selectedVariantId: item.resolvedVariant?.selectedVariantId || null,
          selectedVariantTitle:
            item.resolvedVariant?.selectedVariantTitle || item.quote.sheetVariantTitle || null,
          selectedSheetLabel: item.resolvedVariant?.selectedSheetLabel || null,
          sheetsNeeded:
            item.resolvedVariant?.sheetsNeeded || item.quote.sheetsNeeded || item.requestedQuantity,
          designsPerSheet: item.resolvedVariant?.designsPerSheet || null,
        })),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to calculate custom quote.'
    return json({ error: message }, { status: errorStatusFromMessage(message) })
  }
}
