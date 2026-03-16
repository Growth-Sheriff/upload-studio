/**
 * Public API v1 - Pricing Endpoint
 * GET /api/v1/pricing/:productId?shop=domain
 *
 * Returns area-based pricing tiers and volume discounts
 * for the builder modal. Storefront-facing (CORS enabled).
 */

import type { LoaderFunctionArgs } from '@remix-run/node'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import prisma from '~/lib/prisma.server'

// Default pricing tiers (used when shop has no custom config)
const DEFAULT_TIERS = [
  { minSqIn: 0, maxSqIn: 25, ratePerSqIn: 15 },
  { minSqIn: 25, maxSqIn: 100, ratePerSqIn: 12 },
  { minSqIn: 100, maxSqIn: 500, ratePerSqIn: 10 },
  { minSqIn: 500, maxSqIn: 999999, ratePerSqIn: 8 },
]

const DEFAULT_VOLUME_DISCOUNTS = [
  { minQty: 1, discountPercent: 0 },
  { minQty: 10, discountPercent: 5 },
  { minQty: 25, discountPercent: 10 },
  { minQty: 50, discountPercent: 15 },
  { minQty: 100, discountPercent: 20 },
  { minQty: 250, discountPercent: 25 },
]

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }

  const productId = params.productId
  if (!productId) {
    return corsJson({ error: 'Missing productId' }, request, { status: 400 })
  }

  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')
  if (!shopDomain) {
    return corsJson({ error: 'Missing shop parameter' }, request, { status: 400 })
  }

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
      settings: true,
    },
  })

  if (!shop) {
    return corsJson({ error: 'Shop not found' }, request, { status: 404 })
  }

  // Check for product-specific pricing config
  const productConfig = await prisma.productConfig.findUnique({
    where: {
      shopId_productId: {
        shopId: shop.id,
        productId: productId,
      },
    },
    select: {
      builderConfig: true,
    },
  })

  // Extract pricing from product config or shop settings
  const shopSettings = (shop.settings as Record<string, unknown>) || {}
  const productBuilderConfig = (productConfig?.builderConfig as Record<string, unknown>) || {}
  const shopBuilderPricing = (shopSettings.builderPricing as Record<string, unknown>) || {}
  const pricingConfig = (
    Object.keys(productBuilderConfig).length > 0
      ? productBuilderConfig
      : shopBuilderPricing
  ) as Record<string, unknown>

  const tiers = Array.isArray(pricingConfig.tiers)
    ? pricingConfig.tiers
    : DEFAULT_TIERS

  const volumeDiscounts = Array.isArray(pricingConfig.volumeDiscounts)
    ? pricingConfig.volumeDiscounts
    : DEFAULT_VOLUME_DISCOUNTS

  const minimumCharge =
    typeof pricingConfig.minimumCharge === 'number'
      ? pricingConfig.minimumCharge
      : 500

  const setupFee =
    typeof pricingConfig.setupFee === 'number'
      ? pricingConfig.setupFee
      : 0

  return corsJson(
    {
      productId,
      tiers,
      volumeDiscounts,
      minimumCharge,
      setupFee,
      currency: (shopSettings.currency as string) || 'USD',
    },
    request,
    {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    }
  )
}
