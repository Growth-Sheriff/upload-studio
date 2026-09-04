// Volume-tier ("returning customer inch") pricing helpers used by the
// storefront config, product config and sheet resolution routes.
//
// Historically this program was hard-wired to one tenant; the model layer in
// customerPricingModel.server now decides per shop. The storage key
// (`settings.alphaProDiscount`) and the builderConfig keys are unchanged so
// existing tenants keep their configuration byte for byte.

import {
  ALPHA_PRINT_SHOP_DOMAINS,
  DEFAULT_VOLUME_TIERS,
  getVolumeProgramProducts,
  isAlphaPrintShop,
  isVolumeProgramProduct,
  isVolumeTiersEnabled,
  normalizeVolumeProgram,
  resolveVolumeOffer,
  type VolumeTier,
} from '~/lib/customerPricingModel.server'

export { ALPHA_PRINT_SHOP_DOMAINS, isAlphaPrintShop }

export const ALPHA_DTF_GANG_SHEET_PRO_PRODUCT_ID = 'gid://shopify/Product/7453184196656'
export const ALPHA_UV_GANG_SHEET_PRO_PRODUCT_ID = 'gid://shopify/Product/7453211164720'

export const ALPHA_PRO_PRODUCT_IDS = [
  ALPHA_DTF_GANG_SHEET_PRO_PRODUCT_ID,
  ALPHA_UV_GANG_SHEET_PRO_PRODUCT_ID,
]

export type AlphaProDiscountTier = VolumeTier

export const ALPHA_PRO_DISCOUNT_TIERS: AlphaProDiscountTier[] = DEFAULT_VOLUME_TIERS

export function normalizeAlphaCustomerId(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const gidMatch = raw.match(/gid:\/\/shopify\/Customer\/(\d+)/i)
  if (gidMatch?.[1]) return gidMatch[1]
  const digits = raw.match(/\d+/g)?.join('') || ''
  return digits || raw
}

export function normalizeAlphaProductId(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.startsWith('gid://') ? raw : `gid://shopify/Product/${raw}`
}

/** Legacy check against the two historical Pro products. Prefer
 *  `isVolumeProgramProduct(shopDomain, settings, productId)`. */
export function isAlphaProProduct(productId: string | number | null | undefined): boolean {
  const normalized = normalizeAlphaProductId(productId)
  return ALPHA_PRO_PRODUCT_IDS.includes(normalized)
}

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
