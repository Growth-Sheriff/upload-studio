export const ALPHA_PRINT_SHOP_DOMAINS = [
  'da49fd-8.myshopify.com',
  'alphaprintcenter.myshopify.com',
]

export const ALPHA_DTF_GANG_SHEET_PRO_PRODUCT_ID = 'gid://shopify/Product/7453184196656'
export const ALPHA_UV_GANG_SHEET_PRO_PRODUCT_ID = 'gid://shopify/Product/7453211164720'

export const ALPHA_PRO_PRODUCT_IDS = [
  ALPHA_DTF_GANG_SHEET_PRO_PRODUCT_ID,
  ALPHA_UV_GANG_SHEET_PRO_PRODUCT_ID,
]

export interface AlphaProDiscountTier {
  min_qty: number
  max_qty: number | null
  price_per_sqin: number
  price_per_inch: number
  label: string
  popular?: boolean
}

export const ALPHA_PRO_DISCOUNT_TIERS: AlphaProDiscountTier[] = [
  { min_qty: 1, max_qty: 249, price_per_sqin: 0.28, price_per_inch: 0.28, label: '1+ inches' },
  { min_qty: 250, max_qty: 499, price_per_sqin: 0.22, price_per_inch: 0.22, label: '250+ inches', popular: true },
  { min_qty: 500, max_qty: null, price_per_sqin: 0.2, price_per_inch: 0.2, label: '500+ inches' },
]

interface AlphaProCustomerEntry {
  customerId?: string | number | null
  email?: string | null
  name?: string | null
  firstName?: string | null
  lastName?: string | null
}

function normalizeDomain(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

export function normalizeAlphaCustomerId(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const gidMatch = raw.match(/gid:\/\/shopify\/Customer\/(\d+)/i)
  if (gidMatch?.[1]) return gidMatch[1]
  const digits = raw.match(/\d+/g)?.join('') || ''
  return digits || raw
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function cleanAlphaCustomerName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^\d+\.\s*/, '')
    .trim()
}

export function isAlphaPrintShop(shopDomain: string | null | undefined): boolean {
  return ALPHA_PRINT_SHOP_DOMAINS.includes(normalizeDomain(shopDomain))
}

export function normalizeAlphaProductId(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.startsWith('gid://') ? raw : `gid://shopify/Product/${raw}`
}

export function isAlphaProProduct(productId: string | number | null | undefined): boolean {
  const normalized = normalizeAlphaProductId(productId)
  return ALPHA_PRO_PRODUCT_IDS.includes(normalized)
}

function alphaSettingsProductIds(settings: unknown): string[] {
  const rawSettings = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>)
    : {}
  const rawDiscount = rawSettings.alphaProDiscount && typeof rawSettings.alphaProDiscount === 'object'
    ? (rawSettings.alphaProDiscount as Record<string, unknown>)
    : {}
  const rawProducts = Array.isArray(rawDiscount.products) ? rawDiscount.products : []

  return rawProducts
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const product = entry as Record<string, unknown>
        return normalizeAlphaProductId(
          (product.productId || product.gid || product.id) as string | number | null | undefined
        )
      }
      return normalizeAlphaProductId(entry as string | number | null | undefined)
    })
    .filter((productId) => Boolean(productId))
}

function isAlphaProProductForSettings(
  productId: string | number | null | undefined,
  settings: unknown
): boolean {
  const normalized = normalizeAlphaProductId(productId)
  const configuredProductIds = alphaSettingsProductIds(settings)
  if (configuredProductIds.length) return configuredProductIds.includes(normalized)
  return isAlphaProProduct(normalized)
}

function alphaSettingsTiers(settings: unknown): AlphaProDiscountTier[] {
  const rawSettings = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>)
    : {}
  const rawDiscount = rawSettings.alphaProDiscount && typeof rawSettings.alphaProDiscount === 'object'
    ? (rawSettings.alphaProDiscount as Record<string, unknown>)
    : {}
  const rawTiers = Array.isArray(rawDiscount.tiers) ? rawDiscount.tiers : []
  const tiers: AlphaProDiscountTier[] = []
  for (const entry of rawTiers) {
    const raw = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    const minQty = Number(raw.min_qty ?? raw.minQty)
    const maxValue = raw.max_qty ?? raw.maxQty
    const maxQty = maxValue == null || String(maxValue).trim() === ''
      ? null
      : Number(maxValue)
    const price = Number(raw.price_per_inch ?? raw.pricePerInch ?? raw.price_per_sqin)
    if (!Number.isFinite(minQty) || minQty < 1 || !Number.isFinite(price) || price <= 0) {
      continue
    }

    tiers.push({
        min_qty: Math.round(minQty),
        max_qty: Number.isFinite(maxQty) && maxQty != null ? Math.round(maxQty) : null,
        price_per_sqin: price,
        price_per_inch: price,
        label: String(raw.label || `${Math.round(minQty)}+ inches`),
        popular: Boolean(raw.popular),
    })
  }
  tiers.sort((left, right) => left.min_qty - right.min_qty)

  return tiers.length ? tiers : ALPHA_PRO_DISCOUNT_TIERS
}

export function applyAlphaProBuilderDefaults(
  shopDomain: string | null | undefined,
  productId: string | number | null | undefined,
  builderConfig: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const base = { ...(builderConfig || {}) }
  if (!isAlphaPrintShop(shopDomain) || !isAlphaProProduct(productId)) {
    return base
  }

  return {
    ...base,
    pricingMode: base.pricingMode === 'sheet' ? 'sheet' : 'area',
    volumeDiscountTierUnit: 'linear_inches',
    volumeDiscountTiers: Array.isArray(base.volumeDiscountTiers) && base.volumeDiscountTiers.length
      ? base.volumeDiscountTiers
      : ALPHA_PRO_DISCOUNT_TIERS,
    alphaProDiscount: {
      enabled: true,
      unit: 'linear_inches',
      unitLabel: 'billable inches',
      products: ALPHA_PRO_PRODUCT_IDS,
      source: 'alpha_last_year_pro_customers',
    },
  }
}

export function buildAlphaProCustomerOffer({
  shopDomain,
  productId,
  settings,
  customerId,
  customerEmail,
  customerName,
}: {
  shopDomain: string | null | undefined
  productId: string | number | null | undefined
  settings: unknown
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
}): Record<string, unknown> | null {
  const rawSettings = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>)
    : {}
  if (!isAlphaPrintShop(shopDomain) || !isAlphaProProductForSettings(productId, rawSettings)) return null

  const rawDiscount = rawSettings.alphaProDiscount && typeof rawSettings.alphaProDiscount === 'object'
    ? (rawSettings.alphaProDiscount as Record<string, unknown>)
    : null
  const eligibleCustomers = Array.isArray(rawDiscount?.eligibleCustomers)
    ? (rawDiscount!.eligibleCustomers as AlphaProCustomerEntry[])
    : []
  if (!eligibleCustomers.length) return null

  const normalizedCustomerId = normalizeAlphaCustomerId(customerId)
  const normalizedEmail = normalizeEmail(customerEmail)
  const match = eligibleCustomers.find((entry) => {
    const entryId = normalizeAlphaCustomerId(entry.customerId)
    const entryEmail = normalizeEmail(entry.email)
    return Boolean(
      (normalizedCustomerId && entryId && normalizedCustomerId === entryId) ||
      (normalizedEmail && entryEmail && normalizedEmail === entryEmail)
    )
  })

  if (!match) return null

  const displayName = (
    cleanAlphaCustomerName(customerName) ||
    cleanAlphaCustomerName(match.firstName) ||
    cleanAlphaCustomerName(match.name) ||
    normalizeEmail(match.email) ||
    'valued customer'
  )

  return {
    enabled: true,
    customerName: displayName,
    headline: `Dear valued customer ${displayName}, your returning-customer inch pricing is active.`,
    body: 'Your returning-customer pricing is calculated by billable gang-sheet inches and updates automatically as your measured length changes.',
    tierUnit: 'linear_inches',
    tiers: alphaSettingsTiers(rawSettings),
  }
}
