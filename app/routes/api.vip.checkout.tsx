import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { normalizeCustomerId } from '~/lib/customerPricing.server'
import {
  prepareCustomPricingJobQuote,
} from '~/lib/customerPricingCheckout.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import { authenticate } from '~/shopify.server'
import prisma from '~/lib/prisma.server'
import { DPI_PROPERTY, PRINT_READY_PROPERTY, SHEET_IDENTITY_PROPERTY } from '~/lib/orderMatching.server'
import { buildIdentityUrl } from '~/lib/uploadUrls.server'

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

function normalizeDiscountCode(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').slice(0, 64)
}

function normalizeDiscountCodes(body: Record<string, unknown>): string[] {
  const rawCodes = Array.isArray(body.discountCodes)
    ? body.discountCodes
    : [body.discountCode, body.discount]
  const seen = new Set<string>()
  const codes: string[] = []

  for (const raw of rawCodes) {
    const code = normalizeDiscountCode(raw)
    if (!code) continue
    const key = code.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    codes.push(code)
  }

  return codes.slice(0, 5)
}

function toCustomerGid(customerId: string | null): string | null {
  if (!customerId) return null
  if (customerId.startsWith('gid://shopify/Customer/')) return customerId
  return `gid://shopify/Customer/${customerId}`
}

function toVariantGid(variantId: string | null | undefined): string | null {
  const raw = String(variantId || '').trim()
  if (!raw) return null
  if (raw.startsWith('gid://shopify/ProductVariant/')) return raw
  const legacyId = raw.match(/(\d{6,})$/)?.[1] || raw.replace(/[^\d]/g, '')
  return legacyId ? `gid://shopify/ProductVariant/${legacyId}` : null
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
  const fallbackMeasurementPolicy = String(body.measurementPolicy || '').trim() || null
  const fallbackRollWidthIn = Number(body.rollWidthIn)
  const normalizedItems = rawItems
    .map((entry) => {
      const item = (entry || {}) as Record<string, unknown>
      const uploadId = String(item.uploadId || '').trim()
      if (!uploadId) return null
      const itemRollWidthIn = Number(item.rollWidthIn)
      return {
        uploadId,
        quantity: parsePositiveInteger(item.quantity, 1),
        selectedVariantId:
          item.selectedVariantId != null && String(item.selectedVariantId).trim()
            ? String(item.selectedVariantId).trim()
            : null,
        measurementPolicy:
          String(item.measurementPolicy || '').trim() || fallbackMeasurementPolicy,
        rollWidthIn:
          Number.isFinite(itemRollWidthIn) && itemRollWidthIn > 0
            ? itemRollWidthIn
            : Number.isFinite(fallbackRollWidthIn) && fallbackRollWidthIn > 0
              ? fallbackRollWidthIn
              : null,
      }
    })
    .filter(Boolean) as Array<{
      uploadId: string
      quantity: number
      selectedVariantId: string | null
      measurementPolicy: string | null
      rollWidthIn: number | null
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
      measurementPolicy: fallbackMeasurementPolicy,
      rollWidthIn:
        Number.isFinite(fallbackRollWidthIn) && fallbackRollWidthIn > 0 ? fallbackRollWidthIn : null,
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
  const customerNote = String(body.customerNote || body.note || '').trim().slice(0, 500)
  const checkoutIntent = String(body.checkoutIntent || '').trim()
  const discountCodes = normalizeDiscountCodes(body)
  const loggedInCustomerId =
    normalizeCustomerId(url.searchParams.get('logged_in_customer_id')) ||
    normalizeCustomerId(
      typeof body.customerId === 'string' || typeof body.customerId === 'number'
        ? body.customerId
        : null
    )
  const normalizedItems = normalizeCheckoutItems(body)

  if (!normalizedItems.length) {
    return json({ error: 'Missing uploadId' }, { status: 400 })
  }

  let prepared
  try {
    prepared = await prepareCustomPricingJobQuote({
      shopDomain,
      loggedInCustomerId,
      loggedInCustomerEmail: fallbackCustomerEmail,
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
  const customerGid = toCustomerGid(loggedInCustomerId || firstItem.pricingContext.customerId)

  // Persist the nesting request on the upload rows (same fields the cart
  // path writes) so the identity page and admin show copies/sheets even
  // though the order line carries only the three visible properties.
  await Promise.all(
    preparedItems.map((item) =>
      prisma.upload
        .update({
          where: { id: item.upload.id },
          data: {
            requestedCopies: Math.max(1, item.requestedQuantity),
            sheetsNeeded: Number(item.resolvedVariant?.sheetsNeeded || item.quote.sheetsNeeded || 1) || 1,
            designsPerSheet: Number(item.resolvedVariant?.designsPerSheet || 0) || null,
            cartSheetLabel:
              item.pricingContext.pricingMode === 'measured_length'
                ? 'Exact measured length'
                : item.resolvedVariant?.selectedSheetLabel || null,
          },
        })
        .catch((error) => console.warn('[VIP Checkout] copies persist failed:', error))
    )
  )

  const draftOrderInput: Record<string, unknown> = {
    acceptAutomaticDiscounts: body.acceptAutomaticDiscounts !== false,
    allowDiscountCodesInCheckout: true,
    ...(discountCodes.length ? { discountCodes } : {}),
    ...(fallbackCustomerEmail ? { email: fallbackCustomerEmail } : {}),
    ...(customerGid
      ? {
          purchasingEntity: { customerId: customerGid },
          useCustomerDefaultAddress: true,
        }
      : {}),
    note:
      `Custom pricing checkout for upload ${noteUploadIds}` +
      (checkoutIntent ? `\nIntent: ${checkoutIntent}` : '') +
      (discountCodes.length ? `\nDiscount code(s): ${discountCodes.join(', ')}` : '\nDiscounts: eligible automatic Shopify discounts accepted') +
      (customerNote ? `\nCustomer note: ${customerNote}` : ''),
    lineItems: preparedItems.map((item, index) => {
      const isMeasuredLength = item.pricingContext.pricingMode === 'measured_length'
      const linkedVariantId = toVariantGid(
        isMeasuredLength
          ? normalizedItems[index]?.selectedVariantId ||
              item.upload.variantId ||
              item.resolvedVariant?.selectedVariantId
          : item.upload.variantId ||
              item.resolvedVariant?.selectedVariantId ||
              normalizedItems[index]?.selectedVariantId
      )
      const lineTitle =
        item.pricingContext.customerType === 'business'
          ? `${item.productTitle} - Business Pricing`
          : `${item.productTitle} - VIP Pricing`
      const requestedCopies = Math.max(1, item.requestedQuantity)
      const unitAmount = item.quote.totalPrice / requestedCopies
      const unitPrice = {
        amount: formatDecimalAmount(unitAmount),
        currencyCode: item.currencyCode,
      }

      return {
        ...(linkedVariantId
          ? {
              variantId: linkedVariantId,
              priceOverride: unitPrice,
            }
          : {
              title:
                lineTitle +
                ` (${item.quote.pageWidthIn.toFixed(2)}" x ${item.quote.pageLengthIn.toFixed(2)}", ${requestedCopies} cop${requestedCopies === 1 ? 'y' : 'ies'})`,
              originalUnitPriceWithCurrency: unitPrice,
            }),
        quantity: requestedCopies,
        requiresShipping: true,
        // Exactly the three customer-visible line properties every block
        // writes. Quote facts (per-inch price, billable length, copies) are
        // persisted on the upload row + order note, not as line properties.
        customAttributes: [
          { key: PRINT_READY_PROPERTY, value: item.upload.uploadUrl || buildIdentityUrl(item.upload.id) },
          { key: SHEET_IDENTITY_PROPERTY, value: buildIdentityUrl(item.upload.id) },
          {
            key: DPI_PROPERTY,
            value: (() => {
              const dpi = Number((item.measurement as { effectiveDpi?: number; dpi?: number })?.effectiveDpi || (item.measurement as { dpi?: number })?.dpi || 0)
              return dpi > 0 ? String(Math.round(dpi)) : 'n/a'
            })(),
          },
        ],
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
      discountCodes,
      acceptAutomaticDiscounts: body.acceptAutomaticDiscounts !== false,
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
