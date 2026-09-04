import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { normalizeProductId, normalizeCustomerId } from '~/lib/customerPricing.server'
import { resolveEffectivePricingForShop } from '~/lib/customerPricingRuntime.server'
import { authenticate } from '~/shopify.server'

// Storefront pricing context (Custom Price Sheet Upload, Variant Gang Sheet
// Upload). Both pricing engines are evaluated server-side; the storefront only
// sees the resulting status, mode and per-inch rate plus the tier table when a
// volume program applies.
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request)

  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')?.trim() || ''
  const fallbackCustomerId = normalizeCustomerId(url.searchParams.get('customerId'))
  const fallbackCustomerEmail = String(url.searchParams.get('customerEmail') || '').trim()
  const customerName = String(url.searchParams.get('customerName') || '').trim() || null
  const loggedInCustomerId =
    normalizeCustomerId(url.searchParams.get('logged_in_customer_id')) || fallbackCustomerId
  const productId = normalizeProductId(url.searchParams.get('productId'))

  if (!shopDomain) {
    return json({ error: 'Missing shop parameter' }, { status: 400 })
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

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const effective = await resolveEffectivePricingForShop({
    shop,
    customerId: loggedInCustomerId,
    customerEmail: fallbackCustomerEmail,
    customerName,
    productId,
  })
  const context = effective.context

  return json({
    shopDomain: shop.shopDomain,
    enabled: context.enabled,
    customerId: context.customerId,
    customerType: context.customerType,
    statusKey: context.statusKey,
    statusLabel: context.statusLabel,
    pricePerInch: context.pricePerInch,
    businessPricePerInch: context.businessPricePerInch,
    pricingMode: context.pricingMode,
    hasCustomPricing: context.hasCustomPricing,
    pricingSource: effective.source,
    pricingModel: effective.model.model,
    volumeTiers: effective.volumeTiers,
    volumeOffer: effective.volumeOffer,
    productId: context.productId,
    productRule: context.productRule,
    productOverride: context.productOverride,
    isStatusAssigned: context.isStatusAssigned,
    status: context.status,
    assignment: context.assignment,
    customerName: context.assignment?.customerName || effective.volumeOffer?.customerName || customerName,
    customerEmail: context.assignment?.customerEmail || fallbackCustomerEmail || null,
  })
}
