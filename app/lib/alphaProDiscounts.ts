// Client-safe constants and helpers for the volume-tier program. Anything
// that reads shop settings lives in alphaProDiscounts.server.ts.

import { DEFAULT_VOLUME_TIERS, isAlphaPrintShop, type VolumeTier } from '~/lib/customerPricingShared'

export { isAlphaPrintShop }

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
