// Runtime side of customer special pricing: loads the few external facts the
// pure model needs (Shopify customer tags, recent ordered inches) and returns
// the effective pricing for a customer on a product.

import prisma from '~/lib/prisma.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
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
import {
  applyMeasurementBasisMetadata,
  deriveUploadItemLifecycle,
  getStoredMeasurementBasis,
} from '~/lib/uploadLifecycle.server'

export interface PricingShopLike {
  id: string
  shopDomain: string
  accessToken?: string | null
  settings: unknown
}

const CUSTOMER_PROFILE_QUERY = `
  query CustomerPricingProfile($id: ID!) {
    customer(id: $id) {
      id
      tags
      email
      displayName
    }
  }
`

const TAG_CACHE_TTL_MS = 5 * 60 * 1000
const INCHES_CACHE_TTL_MS = 10 * 60 * 1000
export interface TrustedCustomerProfile {
  customerId: string
  tags: string[]
  email: string | null
  name: string | null
}

export class TrustedCustomerProfileUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Customer profile lookup is temporarily unavailable', options)
    this.name = 'TrustedCustomerProfileUnavailableError'
  }
}

interface CustomerProfileQueryData {
  customer?: {
    id?: string
    tags?: string[]
    email?: string | null
    displayName?: string | null
  } | null
}

export function trustedCustomerProfileFromQuery(
  customerId: string,
  response: CustomerProfileQueryData | null | undefined
): TrustedCustomerProfile | null {
  const customer = response?.customer
  if (!customer) return null
  return {
    customerId,
    tags: (customer.tags || [])
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean),
    email: String(customer.email || '').trim().toLowerCase() || null,
    name: String(customer.displayName || '').trim() || null,
  }
}

const profileCache = new Map<string, { profile: TrustedCustomerProfile; expiresAt: number }>()
const inchesCache = new Map<string, { inches: number; expiresAt: number }>()

function pruneCache<T extends { expiresAt: number }>(cache: Map<string, T>, now: number) {
  if (cache.size < 500) return
  for (const [key, value] of cache) {
    if (value.expiresAt <= now) cache.delete(key)
  }
}

export function invalidatePricingRuntimeCaches(shopDomain?: string) {
  if (!shopDomain) {
    profileCache.clear()
    inchesCache.clear()
    return
  }
  for (const key of Array.from(profileCache.keys())) if (key.startsWith(`${shopDomain}:`)) profileCache.delete(key)
  for (const key of Array.from(inchesCache.keys())) if (key.startsWith(`${shopDomain}:`)) inchesCache.delete(key)
}

/** Shopify-sourced identity and tags, cached per shop+customer for a few minutes. */
export async function loadTrustedCustomerProfile(
  shop: PricingShopLike,
  customerId: string | null
): Promise<TrustedCustomerProfile | null> {
  if (!customerId || !shop.accessToken) return null
  const now = Date.now()
  const key = `${shop.shopDomain}:${customerId}`
  const cached = profileCache.get(key)
  if (cached && cached.expiresAt > now) return cached.profile
  try {
    const response = await shopifyGraphQL<CustomerProfileQueryData>(
      shop.shopDomain,
      shop.accessToken,
      CUSTOMER_PROFILE_QUERY,
      { id: `gid://shopify/Customer/${customerId}` }
    )
    const profile = trustedCustomerProfileFromQuery(customerId, response)
    if (!profile) return null
    pruneCache(profileCache, now)
    profileCache.set(key, { profile, expiresAt: now + TAG_CACHE_TTL_MS })
    return profile
  } catch (error) {
    console.warn('[Customer Pricing] customer profile lookup failed:', error)
    throw new TrustedCustomerProfileUnavailableError({ cause: error })
  }
}

/** Lower-cased customer tags, cached per shop+customer for a few minutes. */
export async function loadCustomerTags(shop: PricingShopLike, customerId: string | null): Promise<string[]> {
  return (await loadTrustedCustomerProfile(shop, customerId))?.tags || []
}

/** Billable inches this customer paid for in the last `months`, from our own
 *  order-linked uploads (measured length × copies). */
export async function loadRecentBillableInches(
  shop: PricingShopLike,
  customerId: string | null,
  months: number,
  basis: 'full_page' | 'artwork_bounds'
): Promise<number> {
  if (!customerId) return 0
  const now = Date.now()
  const key = `${shop.shopDomain}:${customerId}:${months}:${basis}`
  const cached = inchesCache.get(key)
  if (cached && cached.expiresAt > now) return cached.inches

  const since = new Date(now - Math.max(1, months) * 30 * 24 * 3600 * 1000)
  const uploads = await prisma.upload.findMany({
    where: {
      shopId: shop.id,
      orderPaidAt: { gte: since },
      customerId: { in: [customerId, `gid://shopify/Customer/${customerId}`] },
    },
    select: {
      requestedCopies: true,
      sheetsNeeded: true,
      items: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { preflightStatus: true, preflightResult: true },
      },
    },
    take: 500,
  })

  let inches = 0
  for (const upload of uploads) {
    const item = upload.items[0]
    if (!item) continue
    const lifecycle = deriveUploadItemLifecycle(item)
    const metadata = applyMeasurementBasisMetadata(
      lifecycle.metadata,
      getStoredMeasurementBasis(item.preflightResult, basis)
    )
    if (!metadata || lifecycle.measurementStatus !== 'ready') continue
    const lengthIn = Math.max(Number(metadata.widthIn) || 0, Number(metadata.heightIn) || 0)
    const copies = Math.max(1, Number(upload.requestedCopies) || Number(upload.sheetsNeeded) || 1)
    inches += lengthIn * copies
  }
  inches = Number(inches.toFixed(2))
  pruneCache(inchesCache, now)
  inchesCache.set(key, { inches, expiresAt: now + INCHES_CACHE_TTL_MS })
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
}

/**
 * Effective pricing for a customer on a product. Only fetches customer tags
 * when a tag rule exists and only aggregates order history when the volume
 * program's automatic eligibility is switched on, so plain shops pay nothing.
 */
export async function resolveEffectivePricingForShop(input: EffectivePricingRequest): Promise<EffectivePricing> {
  const { shop } = input
  const settings = input.settings || applyCustomerPricingDefaultsForShop(shop.shopDomain, shop.settings)
  const state = resolveCustomerPricingModelState(shop.shopDomain, shop.settings)
  const program = normalizeVolumeProgram(shop.settings, shop.shopDomain)
  const customerId = normalizeCustomerId(input.customerId)

  const needsTags =
    Boolean(customerId) &&
    ((state.statusRatesEnabled && settings.tagRules.length > 0) ||
      (state.volumeTiersEnabled && program.eligibleTags.length > 0))
  const needsInches = Boolean(customerId) && state.volumeTiersEnabled && program.autoEligibility.enabled

  const [trustedProfile, recentBillableInches] = await Promise.all([
    customerId
      ? loadTrustedCustomerProfile(shop, customerId)
      : Promise.resolve<TrustedCustomerProfile | null>(null),
    needsInches
      ? loadRecentBillableInches(
          shop,
          customerId,
          program.autoEligibility.months,
          state.policyExplicit ? state.policy.measurementBasis : 'full_page'
        )
      : Promise.resolve(0),
  ])
  const customerTags = needsTags ? trustedProfile?.tags || [] : []
  const trustedEmail = customerId ? trustedProfile?.email || null : input.customerEmail || null
  const trustedName = customerId ? trustedProfile?.name || null : input.customerName || null

  return resolveEffectivePricing({
    shopDomain: shop.shopDomain,
    rawSettings: shop.settings,
    normalizedSettings: settings,
    customerId,
    customerEmail: trustedEmail,
    customerName: trustedName,
    customerTags,
    recentBillableInches: needsInches ? recentBillableInches : null,
    productId: input.productId,
    billableInches: input.billableInches,
  })
}
