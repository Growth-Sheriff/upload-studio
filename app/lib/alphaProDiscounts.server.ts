// Server side of the volume-tier ("returning customer inch") program: marks a
// product's builderConfig as linear-inch priced and builds the storefront
// offer. The model layer (customerPricingModel.server) decides per shop; the
// storage keys and builderConfig keys are unchanged so tenants keep their
// configuration byte for byte.

import {
  getVolumeProgramProducts,
  isVolumeProgramProduct,
  isVolumeTiersEnabled,
  normalizeVolumeProgram,
  resolveVolumeOffer,
} from '~/lib/customerPricingModel.server'
import { DEFAULT_VOLUME_TIERS, isAlphaPrintShop } from '~/lib/customerPricingShared'
import { ALPHA_PRO_PRODUCT_IDS, isAlphaProProduct } from '~/lib/alphaProDiscounts'

export { isAlphaPrintShop }

/**
 * Marks a product's builderConfig as linear-inch priced when the shop runs
 * volume tiers and the product is in the program. Without `settings` the
 * legacy domain rule applies so old call sites keep working.
 */
export function applyAlphaProBuilderDefaults(
  shopDomain: string | null | undefined,
  productId: string | number | null | undefined,
  builderConfig: Record<string, unknown> | null | undefined,
  settings?: unknown
): Record<string, unknown> {
  const base = { ...(builderConfig || {}) }
  const inProgram =
    settings !== undefined
      ? isVolumeTiersEnabled(shopDomain, settings) && isVolumeProgramProduct(shopDomain, settings, productId)
      : isAlphaPrintShop(shopDomain) && isAlphaProProduct(productId)
  if (!inProgram) {
    return base
  }

  const program = settings !== undefined ? normalizeVolumeProgram(settings, shopDomain) : null
  const programTiers = program && program.tiers.length ? program.tiers : DEFAULT_VOLUME_TIERS

  return {
    ...base,
    pricingMode: base.pricingMode === 'sheet' ? 'sheet' : 'area',
    volumeDiscountTierUnit: 'linear_inches',
    volumeDiscountTiers: Array.isArray(base.volumeDiscountTiers) && base.volumeDiscountTiers.length
      ? base.volumeDiscountTiers
      : programTiers,
    alphaProDiscount: {
      enabled: true,
      unit: 'linear_inches',
      unitLabel: 'billable inches',
      products: settings !== undefined
        ? getVolumeProgramProducts(shopDomain, settings).map((product) => product.productId)
        : ALPHA_PRO_PRODUCT_IDS,
      checkoutMode: program ? program.checkoutMode : 'standard_cart',
      source: 'volume_program',
    },
  }
}

/** Storefront offer for a customer on a volume-program product, or null. */
export function buildAlphaProCustomerOffer({
  shopDomain,
  productId,
  settings,
  customerId,
  customerEmail,
  customerName,
  customerTags,
}: {
  shopDomain: string | null | undefined
  productId: string | number | null | undefined
  settings: unknown
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
  customerTags?: string[] | null
}): Record<string, unknown> | null {
  const offer = resolveVolumeOffer(shopDomain, settings, productId, {
    customerId,
    customerEmail,
    customerName,
    customerTags,
  })
  if (!offer) return null
  return {
    enabled: true,
    source: offer.source,
    label: offer.label,
    customerName: offer.customerName,
    headline: offer.headline,
    body: offer.body,
    tierUnit: offer.tierUnit,
    tiers: offer.tiers,
    checkoutMode: offer.checkoutMode,
    billingBasis: offer.billingBasis,
  }
}
