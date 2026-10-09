// Runtime side of customer special pricing: loads the paid-sheet order facts the
// pure model needs and returns
// the effective pricing for a customer on a product.

import prisma from '~/lib/prisma.server'
import { selectProductConfigForIdentity } from '~/lib/productConfigIdentity.server'
import { shopifyProductIdCandidates } from '~/lib/shopifyProductIdentity'
import {
  applyCustomerPricingDefaultsForShop,
  normalizeCustomerId,
  type CustomerPricingSettings,
} from '~/lib/customerPricing.server'
import {
  normalizeVolumeProgram,
  resolveCustomerPricingModelState,
  resolveEffectivePricing,
  type EffectivePricing,
} from '~/lib/customerPricingModel.server'

export interface PricingShopLike {
  id: string
  shopDomain: string
  accessToken?: string | null
  settings: unknown
}

/** Immutable paid order-line facts only. Legacy/unknown measurements cannot
 * invent eligibility, and a reused upload can belong to several paid orders. */
export async function loadRecentBillableInches(
  shop: PricingShopLike,
  customerId: string | null,
  months: number
): Promise<number> {
  if (!customerId) return 0
  const now = Date.now()
  const since = new Date(now - Math.max(1, months) * 30 * 24 * 3600 * 1000)
  const result = await prisma.paidSheetVolume.aggregate({
    where: {
      shopId: shop.id,
      paidAt: { gte: since },
      paidCustomerId: customerId,
    },
    _sum: { paidBillableInches: true },
  })
  const inches = Number(Number(result._sum.paidBillableInches || 0).toFixed(2))
  return inches
}

export interface EffectivePricingRequest {
  shop: PricingShopLike
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
  productId?: string | number | null
  billableInches?: number | null
  /** Pre-normalised status settings when the caller already built them. */
  settings?: CustomerPricingSettings
  /** Already-loaded product settings; omitted callers load the same scoped
   * product row used by the product editor. */
  builderConfig?: Record<string, unknown> | null
}

/**
 * Signed proxy customer IDs select merchant-entered assignments. Aggregate
 * paid-sheet history is read only when the merchant enables volume eligibility.
 * Customer contact/profile APIs and tag-based eligibility are not part of the
 * public app's permissions or pricing identity.
 */
export async function resolveEffectivePricingForShop(input: EffectivePricingRequest): Promise<EffectivePricing> {
  const { shop } = input
  const settings = input.settings || applyCustomerPricingDefaultsForShop(shop.shopDomain, shop.settings)
  const state = resolveCustomerPricingModelState(shop.shopDomain, shop.settings)
  const program = normalizeVolumeProgram(shop.settings, shop.shopDomain)
  const customerId = normalizeCustomerId(input.customerId)

  const needsInches = Boolean(customerId) && state.volumeTiersEnabled && program.autoEligibility.enabled
  const recentBillableInches = needsInches
    ? await loadRecentBillableInches(
        shop,
        customerId,
        program.autoEligibility.months
      )
    : 0

  const effective = resolveEffectivePricing({
    shopDomain: shop.shopDomain,
    rawSettings: shop.settings,
    normalizedSettings: settings,
    customerId,
    customerEmail: null,
    customerName: null,
    customerTags: [],
    recentBillableInches: needsInches ? recentBillableInches : null,
    productId: input.productId,
    billableInches: input.billableInches,
  })
  // A legacy/imported pricing record may carry contact fields. Pricing only
  // needs its assigned ID/rate, and the storefront must never receive those
  // fields or a personalized headline derived from them.
  if (effective.context.assignment) {
    const { customerEmail: _email, customerName: _name, ...assignment } = effective.context.assignment
    effective.context.assignment = assignment
  }
  if (effective.volumeOffer) {
    effective.volumeOffer.customerName = ''
    effective.volumeOffer.headline = 'Your returning-customer inch pricing is active.'
  }
  // A custom measured-length product has a merchant-entered public base rate.
  // It does not require account assignment or a hidden inch-carrier variant.
  // An explicit account/volume price still takes precedence over that base.
  if (!effective.context.hasCustomPricing && input.productId) {
    let builderConfig = input.builderConfig
    if (builderConfig === undefined) {
      const rows = await prisma.productConfig.findMany({
        where: { shopId: shop.id, productId: { in: shopifyProductIdCandidates(input.productId) } },
        select: { productId: true, builderConfig: true },
      })
      const product = selectProductConfigForIdentity({ rows, productId: input.productId,
        shopId: shop.id, source: 'publicProductPricing' })
      builderConfig = (product?.builderConfig as Record<string, unknown> | null) || null
    }
    const rate = Number(builderConfig?.pricePerInch)
    if (builderConfig?.publicPricingMode === 'measured_length' && Number.isFinite(rate) && rate > 0) {
      effective.source = 'product_rate'
      effective.context = { ...effective.context, enabled: true, customerType: customerId ? 'standard' : 'guest',
        statusKey: 'product_rate', statusLabel: 'Measured length', pricePerInch: rate,
        businessPricePerInch: rate, pricingMode: 'measured_length', hasCustomPricing: true }
    }
  }
  return effective
}
