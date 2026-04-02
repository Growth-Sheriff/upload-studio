import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { normalizeCustomerId } from '~/lib/customerPricing.server'
import { prepareCustomPricingQuote } from '~/lib/customerPricingCheckout.server'
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

function errorStatusFromMessage(message: string): number {
  if (message === 'Shop not found') return 404
  if (message === 'Upload not found') return 404
  if (message === 'Upload measurement is not ready') return 409
  if (message === 'Upload does not belong to the logged in customer') return 403
  if (message === 'Custom pricing is not active for this customer and product') return 403
  if (message.includes('No product variant can fit')) return 422
  if (message.includes('outside product limits')) return 422
  if (message.includes('exceeds')) return 422
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

  try {
    const prepared = await prepareCustomPricingQuote({
      shopDomain,
      loggedInCustomerId,
      uploadId,
      quantity,
      selectedVariantId,
    })

    return json({
      ok: true,
      customerType: prepared.pricingContext.customerType,
      statusKey: prepared.pricingContext.statusKey,
      statusLabel: prepared.pricingContext.statusLabel,
      pricingMode: prepared.pricingContext.pricingMode,
      hasCustomPricing: prepared.pricingContext.hasCustomPricing,
      pricePerInch: prepared.quote.pricePerInch,
      pageWidthIn: prepared.quote.pageWidthIn,
      pageLengthIn: prepared.quote.pageLengthIn,
      billableLengthIn: prepared.quote.billableLengthIn,
      totalPrice: prepared.quote.totalPrice,
      quoteTotal: prepared.quote.totalPrice,
      exactTotal: prepared.quote.totalPrice,
      currency: prepared.currencyCode,
      selectedVariantId: prepared.resolvedVariant?.selectedVariantId || null,
      selectedVariantTitle:
        prepared.resolvedVariant?.selectedVariantTitle || prepared.quote.sheetVariantTitle || null,
      selectedSheetLabel: prepared.resolvedVariant?.selectedSheetLabel || null,
      sheetsNeeded:
        prepared.resolvedVariant?.sheetsNeeded || prepared.quote.sheetsNeeded || quantity,
      designsPerSheet: prepared.resolvedVariant?.designsPerSheet || null,
      quote: {
        customerType: prepared.pricingContext.customerType,
        statusKey: prepared.pricingContext.statusKey,
        statusLabel: prepared.pricingContext.statusLabel,
        pricingMode: prepared.pricingContext.pricingMode,
        pricePerInch: prepared.quote.pricePerInch,
        pageWidthIn: prepared.quote.pageWidthIn,
        pageLengthIn: prepared.quote.pageLengthIn,
        billableLengthIn: prepared.quote.billableLengthIn,
        totalPrice: prepared.quote.totalPrice,
        quoteTotal: prepared.quote.totalPrice,
        exactTotal: prepared.quote.totalPrice,
        currency: prepared.currencyCode,
        selectedVariantId: prepared.resolvedVariant?.selectedVariantId || null,
        selectedVariantTitle:
          prepared.resolvedVariant?.selectedVariantTitle || prepared.quote.sheetVariantTitle || null,
        selectedSheetLabel: prepared.resolvedVariant?.selectedSheetLabel || null,
        sheetsNeeded:
          prepared.resolvedVariant?.sheetsNeeded || prepared.quote.sheetsNeeded || quantity,
        designsPerSheet: prepared.resolvedVariant?.designsPerSheet || null,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to calculate custom quote.'
    return json({ error: message }, { status: errorStatusFromMessage(message) })
  }
}
