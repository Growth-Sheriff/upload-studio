import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  applyCustomerPricingDefaultsForShop,
  getDtfPrintHouseProductCatalog,
  normalizeCustomerId,
  normalizeProductId,
  resolveCustomerPricingContext,
} from '~/lib/customerPricing.server'
import prisma from '~/lib/prisma.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import {
  applyFullCanvasMeasurementMetadata,
  deriveUploadItemLifecycle,
} from '~/lib/uploadLifecycle.server'
import { authenticate } from '~/shopify.server'

const RECENT_ORDER_DETAILS_QUERY = `
  query CustomerPricingWorkspaceOrders($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        name
        createdAt
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              quantity
              customAttributes {
                key
                value
              }
              product {
                id
                title
                handle
              }
            }
          }
        }
      }
    }
  }
`

interface RecentOrdersQueryResponse {
  nodes?: Array<{
    id?: string | null
    name?: string | null
    createdAt?: string | null
    lineItems?: {
      edges?: Array<{
        node?: {
          id?: string | null
          title?: string | null
          quantity?: number | null
          customAttributes?: Array<{ key?: string | null; value?: string | null }> | null
          product?: {
            id?: string | null
            title?: string | null
            handle?: string | null
          } | null
        } | null
      }> | null
    } | null
  } | null>
}

function extractTrailingDigits(value: string | number | null | undefined): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const matches = raw.match(/\d+/g)
  return matches ? matches.join('') : raw
}

function getAttributeValue(
  attributes: Array<{ key?: string | null; value?: string | null }> | null | undefined,
  key: string
): string {
  const match = (attributes || []).find((attribute) => String(attribute?.key || '') === key)
  return String(match?.value || '').trim()
}

function parsePositiveInteger(value: string | number | null | undefined, fallback = 1): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.floor(parsed))
}

function buildProductCandidates(productId: string | null): string[] {
  if (!productId) return []
  const normalized = normalizeProductId(productId)
  const numeric = normalized ? extractTrailingDigits(normalized) : ''
  return Array.from(new Set([normalized, numeric].filter(Boolean) as string[]))
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request)

  const url = new URL(request.url)
  const shopDomain =
    url.searchParams.get('shopDomain')?.trim() || url.searchParams.get('shop')?.trim() || ''
  const loggedInCustomerId = normalizeCustomerId(url.searchParams.get('logged_in_customer_id'))
  const productId = normalizeProductId(url.searchParams.get('productId'))

  if (!shopDomain) {
    return json({ error: 'Missing shop parameter' }, { status: 400 })
  }

  if (!loggedInCustomerId) {
    return json(
      {
        shopDomain,
        items: [],
        customerType: 'guest',
        statusKey: 'guest',
        statusLabel: 'Guest',
        hasCustomPricing: false,
      },
      { status: 200 }
    )
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      accessToken: true,
      settings: true,
      storageProvider: true,
      storageConfig: true,
    },
  })

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const settings = applyCustomerPricingDefaultsForShop(shop.shopDomain, shop.settings)
  const pricingContext = resolveCustomerPricingContext(settings, loggedInCustomerId, productId)

  if (
    !pricingContext.isStatusAssigned ||
    (pricingContext.customerType !== 'business' && pricingContext.customerType !== 'vip')
  ) {
    return json({
      shopDomain: shop.shopDomain,
      items: [],
      customerType: pricingContext.customerType,
      statusKey: pricingContext.statusKey,
      statusLabel: pricingContext.statusLabel,
      hasCustomPricing: pricingContext.hasCustomPricing,
    })
  }

  const customerIdCandidates = Array.from(
    new Set(
      [
        loggedInCustomerId,
        `gid://shopify/Customer/${loggedInCustomerId}`,
        `gid://shopify/Customer/${extractTrailingDigits(loggedInCustomerId)}`,
      ].filter(Boolean)
    )
  )
  const productCandidates = buildProductCandidates(productId)
  const productLabelById = new Map(
    getDtfPrintHouseProductCatalog().map((item) => [normalizeProductId(item.productId) || item.productId, item.label])
  )

  const uploads = await prisma.upload.findMany({
    where: {
      shopId: shop.id,
      customerId: { in: customerIdCandidates },
      orderPaidAt: { not: null },
      ...(productCandidates.length
        ? {
            OR: productCandidates.map((candidate) => ({ productId: candidate })),
          }
        : {}),
    },
    orderBy: [{ orderPaidAt: 'desc' }, { updatedAt: 'desc' }],
    take: 10,
    select: {
      id: true,
      productId: true,
      variantId: true,
      orderId: true,
      orderPaidAt: true,
      items: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          originalName: true,
          storageKey: true,
          thumbnailKey: true,
          preflightStatus: true,
          preflightResult: true,
        },
      },
      ordersLink: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          orderId: true,
          lineItemId: true,
        },
      },
    },
  })

  if (!uploads.length) {
    return json({
      shopDomain: shop.shopDomain,
      items: [],
      customerType: pricingContext.customerType,
      statusKey: pricingContext.statusKey,
      statusLabel: pricingContext.statusLabel,
      hasCustomPricing: pricingContext.hasCustomPricing,
    })
  }

  const orderIds = Array.from(
    new Set(
      uploads
        .map((upload) => extractTrailingDigits(upload.ordersLink[0]?.orderId || upload.orderId))
        .filter(Boolean)
    )
  )

  const orderNodeMap = new Map<
    string,
    NonNullable<RecentOrdersQueryResponse['nodes']>[number]
  >()

  if (orderIds.length && shop.accessToken) {
    const orderResponse = await shopifyGraphQL<RecentOrdersQueryResponse>(
      shop.shopDomain,
      shop.accessToken,
      RECENT_ORDER_DETAILS_QUERY,
      {
        ids: orderIds.map((orderId) => `gid://shopify/Order/${orderId}`),
      }
    )

    for (const node of orderResponse?.nodes || []) {
      const orderId = extractTrailingDigits(node?.id)
      if (orderId) {
        orderNodeMap.set(orderId, node)
      }
    }
  }

  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: (shop.storageConfig as Record<string, string> | null) || null,
  })

  const items = await Promise.all(
    uploads.map(async (upload) => {
      const firstItem = upload.items[0]
      const lifecycle = firstItem ? deriveUploadItemLifecycle(firstItem) : null
      const metadata = lifecycle ? applyFullCanvasMeasurementMetadata(lifecycle.metadata) : null
      const orderId = extractTrailingDigits(upload.ordersLink[0]?.orderId || upload.orderId)
      const lineItemId = extractTrailingDigits(upload.ordersLink[0]?.lineItemId)
      const orderNode = orderId ? orderNodeMap.get(orderId) : null
      const lineItem =
        orderNode?.lineItems?.edges
          ?.map((edge) => edge?.node)
          .find((node) => {
            if (!node) return false
            const nodeLineItemId = extractTrailingDigits(node.id)
            const uploadIdMatch = getAttributeValue(node.customAttributes, '_ul_upload_id') === upload.id
            return (lineItemId && nodeLineItemId === lineItemId) || uploadIdMatch
          }) || null

      const uploadUrl = firstItem?.storageKey
        ? await getDownloadSignedUrl(storageConfig, firstItem.storageKey, 30 * 24 * 3600)
        : ''
      const thumbnailSource = firstItem?.thumbnailKey || firstItem?.storageKey || ''
      const thumbnailUrl = thumbnailSource
        ? await getDownloadSignedUrl(storageConfig, thumbnailSource, 30 * 24 * 3600)
        : ''
      const normalizedUploadProductId = normalizeProductId(upload.productId)
      const fallbackProductLabel = normalizedUploadProductId
        ? productLabelById.get(normalizedUploadProductId) || normalizedUploadProductId
        : 'Custom Upload'
      const lastOrderedQuantity = parsePositiveInteger(
        getAttributeValue(lineItem?.customAttributes, 'Requested Copies') ||
          getAttributeValue(lineItem?.customAttributes, '_ul_requested_copies') ||
          lineItem?.quantity,
        1
      )

      return {
        uploadId: upload.id,
        productId: normalizedUploadProductId,
        productTitle:
          lineItem?.product?.title ||
          lineItem?.title ||
          fallbackProductLabel,
        productHandle: lineItem?.product?.handle || null,
        orderId,
        orderName: orderNode?.name || null,
        orderedAt: upload.orderPaidAt?.toISOString() || orderNode?.createdAt || null,
        fileName:
          getAttributeValue(lineItem?.customAttributes, 'Design File') ||
          firstItem?.originalName ||
          'Print-ready upload',
        uploadUrl:
          getAttributeValue(lineItem?.customAttributes, 'Print READY') ||
          uploadUrl,
        thumbnailUrl,
        lastOrderedQuantity,
        requestedQuantity: lastOrderedQuantity,
        selectedVariantId: getAttributeValue(lineItem?.customAttributes, '_ul_selected_variant_id'),
        selectedVariantTitle: getAttributeValue(
          lineItem?.customAttributes,
          '_ul_selected_variant_title'
        ),
        selectedSheetLabel: getAttributeValue(
          lineItem?.customAttributes,
          '_ul_selected_sheet_label'
        ),
        billableLengthIn: Number(
          getAttributeValue(lineItem?.customAttributes, '_ul_billable_length_in') || 0
        ),
        measurement: metadata
          ? {
              widthPx: metadata.widthPx,
              heightPx: metadata.heightPx,
              trimmedWidthPx: metadata.trimmedWidthPx,
              trimmedHeightPx: metadata.trimmedHeightPx,
              trimmedOffsetXPx: metadata.trimmedOffsetXPx,
              trimmedOffsetYPx: metadata.trimmedOffsetYPx,
              effectiveDpi: metadata.effectiveDpi,
              widthIn: metadata.widthIn,
              heightIn: metadata.heightIn,
              measurementMode: metadata.measurementMode,
            }
          : null,
      }
    })
  )

  return json({
    shopDomain: shop.shopDomain,
    customerType: pricingContext.customerType,
    statusKey: pricingContext.statusKey,
    statusLabel: pricingContext.statusLabel,
    pricePerInch: pricingContext.pricePerInch,
    pricingMode: pricingContext.pricingMode,
    hasCustomPricing: pricingContext.hasCustomPricing,
    items,
  })
}
