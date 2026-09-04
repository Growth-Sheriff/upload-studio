// Customer special pricing: the merchant-facing model layer.
//
// Two pricing engines exist and both keep their historical storage keys so no
// tenant loses configuration:
//   - status rates   → settings.customerPricing   (Business / VIP per-inch rates)
//   - volume tiers   → settings.alphaProDiscount  (returning-customer inch tiers)
//
// This module decides which engine(s) a shop runs (`model`), how uploads are
// measured and matched to sheets (`policy`), and resolves the *effective*
// pricing for a customer on a product, combining both engines under the
// merchant's priority rule. Shop-domain constants only seed defaults for
// tenants that predate the setting; nothing is gated by domain any more.

import {
  isDtfPrintHouseShop,
  normalizeCustomerId,
  normalizeCustomerPricingSettings,
  normalizeProductId,
  resolveCustomerPricingContext,
  type CustomerPricingContext,
  type CustomerPricingMode,
  type CustomerPricingSettings,
} from '~/lib/customerPricing.server'

import {
  ALPHA_PRINT_SHOP_DOMAINS,
  CUSTOMER_PRICING_MODELS,
  CUSTOMER_PRICING_TEMPLATES,
  DEFAULT_VOLUME_TIERS,
  isAlphaPrintShop,
  isCustomerPricingModel,
  pickVolumeTier,
  type CustomerPricingModel,
  type CustomerPricingPriority,
  type CustomerPricingTemplate,
  type MeasurementBasis,
  type PricingSource,
  type SheetSelection,
  type VolumeBillingBasis,
  type VolumeCheckoutMode,
  type VolumeTier,
} from '~/lib/customerPricingShared'

export {
  ALPHA_PRINT_SHOP_DOMAINS,
  CUSTOMER_PRICING_MODELS,
  CUSTOMER_PRICING_TEMPLATES,
  DEFAULT_VOLUME_TIERS,
  isAlphaPrintShop,
  isCustomerPricingModel,
  pickVolumeTier,
}
export type {
  CustomerPricingModel,
  CustomerPricingPriority,
  CustomerPricingTemplate,
  MeasurementBasis,
  PricingSource,
  SheetSelection,
  VolumeBillingBasis,
  VolumeCheckoutMode,
  VolumeTier,
}

export interface CustomerPricingPolicy {
  /** What the customer is billed for: the whole uploaded page or only the artwork bounds. */
  measurementBasis: MeasurementBasis
  /** Which sheet variant wins when several fit. `block_default` keeps each block's own rule. */
  sheetSelection: SheetSelection
  /** Extra inches an artwork may exceed a sheet by and still count as fitting. */
  fitToleranceIn: number
  /** Widest sheet the shop prints (roll width). */
  maxSheetWidthIn: number
  /** Safe margins used when nesting designs onto a sheet. */
  artboardMarginIn: number
  imageMarginIn: number
}

export interface VolumeProgramProduct {
  productId: string
  title: string
}

export interface VolumeProgramCustomer {
  customerId: string
  email: string
  name: string
  totalInches: number
  dtfInches: number
  uvInches: number
  orders: number
  lastOrder: string
  lastOrderedAt: string
  source: 'manual' | 'import' | 'auto'
}

export interface VolumeAutoEligibility {
  enabled: boolean
  months: number
  minInches: number
}

export interface VolumeProgram {
  version: number
  /** Explicit switch stored with the program (independent from the model). */
  enabled: boolean
  label: string
  products: VolumeProgramProduct[]
  tiers: VolumeTier[]
  eligibleCustomers: VolumeProgramCustomer[]
  eligibleTags: string[]
  autoEligibility: VolumeAutoEligibility
  checkoutMode: VolumeCheckoutMode
  billingBasis: VolumeBillingBasis
  updatedAt: string | null
}

export interface CustomerPricingModelState {
  model: CustomerPricingModel
  priority: CustomerPricingPriority
  /** True when the model value came from the stored setting, false when derived. */
  explicit: boolean
  statusRatesEnabled: boolean
  volumeTiersEnabled: boolean
  policy: CustomerPricingPolicy
  policyExplicit: boolean
}

export interface VolumeOffer {
  enabled: true
  source: 'volume_tiers'
  label: string
  customerName: string
  headline: string
  body: string
  tierUnit: 'linear_inches'
  tiers: VolumeTier[]
  checkoutMode: VolumeCheckoutMode
  billingBasis: VolumeBillingBasis
  matchedBy: 'customer_id' | 'email' | 'tag' | 'auto'
}

export interface EffectivePricing {
  source: PricingSource
  context: CustomerPricingContext
  volumeOffer: VolumeOffer | null
  /** Tier list to show the customer (volume source only). */
  volumeTiers: VolumeTier[]
  model: CustomerPricingModelState
}

const DEFAULT_POLICY: CustomerPricingPolicy = {
  measurementBasis: 'artwork_bounds',
  sheetSelection: 'block_default',
  fitToleranceIn: 0,
  maxSheetWidthIn: 22,
  artboardMarginIn: 0.125,
  imageMarginIn: 0.125,
}

const FULL_PAGE_POLICY: CustomerPricingPolicy = {
  measurementBasis: 'full_page',
  sheetSelection: 'block_default',
  fitToleranceIn: 0.5,
  maxSheetWidthIn: 22.5,
  artboardMarginIn: 0,
  imageMarginIn: 0,
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function normalizeEmail(value: unknown): string {
  return text(value).toLowerCase()
}

function normalizeTag(value: unknown): string {
  return text(value).toLowerCase()
}

export function modelIncludesStatusRates(model: CustomerPricingModel): boolean {
  return model === 'status_rates' || model === 'both'
}

export function modelIncludesVolumeTiers(model: CustomerPricingModel): boolean {
  return model === 'volume_tiers' || model === 'both'
}

// ── Volume program (settings.alphaProDiscount) ─────────────────────────────

export function normalizeVolumeTier(entry: unknown): VolumeTier | null {
  const raw = asRecord(entry)
  const minQty = Math.max(1, Math.round(num(raw.min_qty ?? raw.minQty ?? raw.minimum, 1)))
  const maxSource = raw.max_qty ?? raw.maxQty ?? raw.maximum
  const maxQty =
    maxSource == null || text(maxSource) === '' || text(maxSource).toLowerCase() === 'null'
      ? null
      : Math.max(minQty, Math.round(num(maxSource)))
  const price = num(raw.price_per_inch ?? raw.pricePerInch ?? raw.price_per_sqin ?? raw.price, 0)
  if (!(price > 0)) return null
  const label = text(raw.label) || (maxQty == null ? `${minQty}+ inches` : `${minQty}-${maxQty} inches`)
  return { min_qty: minQty, max_qty: maxQty, price_per_sqin: price, price_per_inch: price, label, popular: Boolean(raw.popular) }
}

export function normalizeVolumeTiers(rawTiers: unknown, fallback: VolumeTier[] = []): VolumeTier[] {
  const tiers = Array.isArray(rawTiers)
    ? rawTiers.map((entry) => normalizeVolumeTier(entry)).filter((tier): tier is VolumeTier => Boolean(tier))
    : []
  const list = tiers.length ? tiers : fallback.map((tier) => ({ ...tier }))
  return list.sort((left, right) => left.min_qty - right.min_qty)
}

export function normalizeVolumeProduct(entry: unknown, index = 0): VolumeProgramProduct | null {
  const raw = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : { productId: entry }
  const productId =
    normalizeProductId(raw.productId as string | number | null | undefined) ||
    normalizeProductId(raw.gid as string | number | null | undefined) ||
    normalizeProductId(raw.id as string | number | null | undefined)
  if (!productId || productId === '*') return null
  return { productId, title: text(raw.title) || text(raw.label) || `Product ${index + 1}` }
}

export function normalizeVolumeCustomer(entry: unknown): VolumeProgramCustomer | null {
  const raw = asRecord(entry)
  const customerId = normalizeCustomerId(raw.customerId as string | number | null | undefined) || ''
  const email = normalizeEmail(raw.email)
  if (!customerId && !email) return null
  const source = text(raw.source)
  return {
    customerId,
    email,
    name: text(raw.name || raw.firstName).replace(/^\d+\.\s*/, '') || email || customerId,
    totalInches: num(raw.totalInches),
    dtfInches: num(raw.dtfInches),
    uvInches: num(raw.uvInches),
    orders: Math.round(num(raw.orders)),
    lastOrder: text(raw.lastOrder),
    lastOrderedAt: text(raw.lastOrderedAt),
    source: source === 'import' || source === 'auto' ? source : 'manual',
  }
}

export function normalizeVolumeProgram(rawSettings: unknown, shopDomain?: string | null): VolumeProgram {
  const settings = asRecord(rawSettings)
  const raw = asRecord(settings.alphaProDiscount)
  const legacyAlpha = isAlphaPrintShop(shopDomain)
  const products = (Array.isArray(raw.products) ? raw.products : [])
    .map((entry, index) => normalizeVolumeProduct(entry, index))
    .filter((entry): entry is VolumeProgramProduct => Boolean(entry))
  const uniqueProducts = products.filter(
    (product, index, list) => list.findIndex((item) => item.productId === product.productId) === index
  )
  const auto = asRecord(raw.autoEligibility)
  const checkoutMode = text(raw.checkoutMode)
  const billingBasis = text(raw.billingBasis)

  return {
    version: Math.max(2, Math.floor(num(raw.version, 2))),
    enabled: raw.enabled !== false,
    label: text(raw.label) || 'Returning customer pricing',
    products: uniqueProducts,
    tiers: normalizeVolumeTiers(raw.tiers, legacyAlpha || !Array.isArray(raw.tiers) ? DEFAULT_VOLUME_TIERS : []),
    eligibleCustomers: (Array.isArray(raw.eligibleCustomers) ? raw.eligibleCustomers : [])
      .map((entry) => normalizeVolumeCustomer(entry))
      .filter((entry): entry is VolumeProgramCustomer => Boolean(entry)),
    eligibleTags: Array.from(
      new Set((Array.isArray(raw.eligibleTags) ? raw.eligibleTags : []).map(normalizeTag).filter(Boolean))
    ),
    autoEligibility: {
      enabled: auto.enabled === true,
      months: Math.max(1, Math.round(num(auto.months, 12))),
      minInches: Math.max(1, Math.round(num(auto.minInches, 250))),
    },
    // Legacy alpha tenants price tiers through their own Shopify discounts on a
    // per-inch variant; everyone else gets the exact tier price via custom checkout.
    checkoutMode:
      checkoutMode === 'custom_checkout' || checkoutMode === 'standard_cart'
        ? (checkoutMode as VolumeCheckoutMode)
        : legacyAlpha
          ? 'standard_cart'
          : 'custom_checkout',
    billingBasis: billingBasis === 'variant_length' ? 'variant_length' : 'measured_length',
    updatedAt: text(raw.updatedAt) || null,
  }
}

/** Serialises a program back into the stored `alphaProDiscount` shape, keeping
 *  unknown keys that other code may rely on. */
export function buildVolumeProgramPayload(
  program: VolumeProgram,
  existing: unknown
): Record<string, unknown> {
  const base = asRecord(existing)
  return {
    ...base,
    enabled: program.enabled,
    version: Math.max(3, program.version),
    unit: 'linear_inches',
    unitLabel: 'billable inches',
    label: program.label,
    products: program.products.map((product) => ({
      gid: product.productId,
      productId: product.productId,
      legacyId: product.productId.split('/').pop() || product.productId,
      title: product.title,
    })),
    tiers: program.tiers,
    eligibleCustomers: program.eligibleCustomers,
    eligibleTags: program.eligibleTags,
    autoEligibility: program.autoEligibility,
    checkoutMode: program.checkoutMode,
    billingBasis: program.billingBasis,
    updatedAt: new Date().toISOString(),
    source: 'customer_pricing_editor',
  }
}

export function volumeProgramHasProduct(program: VolumeProgram, productId: string | number | null | undefined): boolean {
  const normalized = normalizeProductId(productId)
  if (!normalized) return false
  return program.products.some((product) => product.productId === normalized)
}

// ── Model + policy ─────────────────────────────────────────────────────────

export function derivePolicyDefaults(shopDomain: string | null | undefined): CustomerPricingPolicy {
  return isDtfPrintHouseShop(shopDomain) ? { ...FULL_PAGE_POLICY } : { ...DEFAULT_POLICY }
}

export function normalizePolicy(rawPolicy: unknown, defaults: CustomerPricingPolicy): CustomerPricingPolicy {
  const raw = asRecord(rawPolicy)
  const basis = text(raw.measurementBasis)
  const selection = text(raw.sheetSelection)
  return {
    measurementBasis: basis === 'full_page' || basis === 'artwork_bounds' ? (basis as MeasurementBasis) : defaults.measurementBasis,
    sheetSelection:
      selection === 'lowest_total_cost' || selection === 'smallest_fitting_sheet' || selection === 'block_default'
        ? (selection as SheetSelection)
        : defaults.sheetSelection,
    fitToleranceIn: raw.fitToleranceIn == null || text(raw.fitToleranceIn) === '' ? defaults.fitToleranceIn : Math.min(5, num(raw.fitToleranceIn, defaults.fitToleranceIn)),
    maxSheetWidthIn: num(raw.maxSheetWidthIn, 0) > 0 ? num(raw.maxSheetWidthIn) : defaults.maxSheetWidthIn,
    artboardMarginIn: raw.artboardMarginIn == null || text(raw.artboardMarginIn) === '' ? defaults.artboardMarginIn : Math.min(2, num(raw.artboardMarginIn, defaults.artboardMarginIn)),
    imageMarginIn: raw.imageMarginIn == null || text(raw.imageMarginIn) === '' ? defaults.imageMarginIn : Math.min(2, num(raw.imageMarginIn, defaults.imageMarginIn)),
  }
}

export function deriveCustomerPricingModel(
  shopDomain: string | null | undefined,
  rawSettings: unknown
): CustomerPricingModel {
  const settings = asRecord(rawSettings)
  const pricing = normalizeCustomerPricingSettings(settings)
  const program = normalizeVolumeProgram(settings, shopDomain)
  const hasStatusUse = pricing.enabled && pricing.assignments.length > 0
  const hasVolumeUse =
    program.enabled &&
    (program.eligibleCustomers.length > 0 || program.eligibleTags.length > 0 || program.autoEligibility.enabled)

  if (isAlphaPrintShop(shopDomain)) return hasStatusUse ? 'both' : 'volume_tiers'
  if (isDtfPrintHouseShop(shopDomain)) return hasVolumeUse ? 'both' : 'status_rates'
  if (hasStatusUse && hasVolumeUse) return 'both'
  if (hasVolumeUse) return 'volume_tiers'
  if (hasStatusUse) return 'status_rates'
  return 'off'
}

export function resolveCustomerPricingModelState(
  shopDomain: string | null | undefined,
  rawSettings: unknown
): CustomerPricingModelState {
  const settings = asRecord(rawSettings)
  const pricing = asRecord(settings.customerPricing)
  const explicit = isCustomerPricingModel(pricing.model)
  const model = explicit ? (pricing.model as CustomerPricingModel) : deriveCustomerPricingModel(shopDomain, settings)
  const priority = text(pricing.priority) === 'volume_first' ? 'volume_first' : 'status_first'
  const defaults = derivePolicyDefaults(shopDomain)
  const policyExplicit = Boolean(pricing.policy && typeof pricing.policy === 'object')

  return {
    model,
    priority,
    explicit,
    statusRatesEnabled: modelIncludesStatusRates(model),
    volumeTiersEnabled: modelIncludesVolumeTiers(model),
    policy: normalizePolicy(pricing.policy, defaults),
    policyExplicit,
  }
}

export function getPricingPolicy(shopDomain: string | null | undefined, rawSettings: unknown): CustomerPricingPolicy {
  return resolveCustomerPricingModelState(shopDomain, rawSettings).policy
}

export function isVolumeTiersEnabled(shopDomain: string | null | undefined, rawSettings: unknown): boolean {
  return resolveCustomerPricingModelState(shopDomain, rawSettings).volumeTiersEnabled
}

/** Products the volume program applies to. Legacy alpha tenants that never
 *  saved a product list keep their two historical Pro products. */
export function getVolumeProgramProducts(shopDomain: string | null | undefined, rawSettings: unknown): VolumeProgramProduct[] {
  const program = normalizeVolumeProgram(rawSettings, shopDomain)
  if (program.products.length) return program.products
  if (isAlphaPrintShop(shopDomain)) {
    return [
      { productId: 'gid://shopify/Product/7453184196656', title: 'DTF Gang Sheets Pro' },
      { productId: 'gid://shopify/Product/7453211164720', title: 'UV Gang Sheets Pro' },
    ]
  }
  return []
}

export function isVolumeProgramProduct(
  shopDomain: string | null | undefined,
  rawSettings: unknown,
  productId: string | number | null | undefined
): boolean {
  const normalized = normalizeProductId(productId)
  if (!normalized) return false
  return getVolumeProgramProducts(shopDomain, rawSettings).some((product) => product.productId === normalized)
}

// ── Effective pricing (both engines, merchant priority) ────────────────────

export interface VolumeMatchInput {
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
  /** Lower-cased Shopify customer tags when the caller could load them. */
  customerTags?: string[] | null
  /** Billable inches the customer ordered in the auto-eligibility window, when known. */
  recentBillableInches?: number | null
}

export function matchVolumeCustomer(
  program: VolumeProgram,
  input: VolumeMatchInput
): { matchedBy: VolumeOffer['matchedBy']; entry: VolumeProgramCustomer | null } | null {
  const customerId = normalizeCustomerId(input.customerId)
  const email = normalizeEmail(input.customerEmail)
  if (!customerId && !email) return null

  const byId = customerId
    ? program.eligibleCustomers.find((entry) => entry.customerId && entry.customerId === customerId)
    : null
  if (byId) return { matchedBy: 'customer_id', entry: byId }
  const byEmail = email ? program.eligibleCustomers.find((entry) => entry.email && entry.email === email) : null
  if (byEmail) return { matchedBy: 'email', entry: byEmail }

  if (program.eligibleTags.length && Array.isArray(input.customerTags)) {
    const tags = input.customerTags.map(normalizeTag)
    if (program.eligibleTags.some((tag) => tags.includes(tag))) return { matchedBy: 'tag', entry: null }
  }

  if (
    program.autoEligibility.enabled &&
    input.recentBillableInches != null &&
    input.recentBillableInches >= program.autoEligibility.minInches
  ) {
    return { matchedBy: 'auto', entry: null }
  }

  return null
}

function cleanName(value: unknown): string {
  return text(value).replace(/^\d+\.\s*/, '')
}

export function buildVolumeOffer(
  program: VolumeProgram,
  match: NonNullable<ReturnType<typeof matchVolumeCustomer>>,
  input: VolumeMatchInput
): VolumeOffer {
  const displayName =
    cleanName(input.customerName) ||
    cleanName(match.entry?.name) ||
    normalizeEmail(match.entry?.email || input.customerEmail) ||
    'valued customer'
  return {
    enabled: true,
    source: 'volume_tiers',
    label: program.label,
    customerName: displayName,
    headline: `Dear valued customer ${displayName}, your returning-customer inch pricing is active.`,
    body: 'Your returning-customer pricing is calculated by billable gang-sheet inches and updates automatically as your measured length changes.',
    tierUnit: 'linear_inches',
    tiers: program.tiers,
    checkoutMode: program.checkoutMode,
    billingBasis: program.billingBasis,
    matchedBy: match.matchedBy,
  }
}

/** Resolves the volume offer for a customer on a product, or null. */
export function resolveVolumeOffer(
  shopDomain: string | null | undefined,
  rawSettings: unknown,
  productId: string | number | null | undefined,
  input: VolumeMatchInput
): VolumeOffer | null {
  const state = resolveCustomerPricingModelState(shopDomain, rawSettings)
  if (!state.volumeTiersEnabled) return null
  const program = normalizeVolumeProgram(rawSettings, shopDomain)
  if (!program.enabled || !program.tiers.length) return null
  if (!isVolumeProgramProduct(shopDomain, rawSettings, productId)) return null
  const match = matchVolumeCustomer(program, input)
  if (!match) return null
  return buildVolumeOffer(program, match, input)
}

function volumeContextFromOffer(
  base: CustomerPricingContext,
  offer: VolumeOffer,
  billableInches: number | null | undefined
): CustomerPricingContext {
  const tier = pickVolumeTier(offer.tiers, billableInches ?? 0)
  const pricingMode: CustomerPricingMode = offer.billingBasis === 'variant_length' ? 'variant_length' : 'measured_length'
  const customerType = offer.billingBasis === 'variant_length' ? 'business' : 'vip'
  return {
    ...base,
    enabled: true,
    customerType,
    statusKey: 'volume',
    statusLabel: offer.label,
    pricePerInch: tier ? tier.price_per_inch : null,
    status: {
      id: 'volume',
      key: 'volume',
      label: offer.label,
      type: customerType,
      active: true,
      pricePerInch: tier ? tier.price_per_inch : base.businessPricePerInch,
      productRules: [],
    },
    assignment: null,
    pricingMode,
    hasCustomPricing: Boolean(tier),
    productRule: null,
    productOverride: null,
    isStatusAssigned: true,
  }
}

/**
 * The single entry point storefront and checkout code should use. Status rates
 * and volume tiers are both evaluated; the merchant's priority decides when a
 * customer qualifies for both. `billableInches` selects the tier (omit before
 * the upload is measured: the first tier is used as the preview rate).
 */
export function resolveEffectivePricing({
  shopDomain,
  rawSettings,
  normalizedSettings,
  customerId,
  customerEmail,
  customerName,
  customerTags,
  recentBillableInches,
  productId,
  billableInches,
}: {
  shopDomain: string | null | undefined
  rawSettings: unknown
  /** Pass the already-normalised status settings when the caller has them. */
  normalizedSettings?: CustomerPricingSettings
  customerId?: string | number | null
  customerEmail?: string | null
  customerName?: string | null
  customerTags?: string[] | null
  recentBillableInches?: number | null
  productId?: string | number | null
  billableInches?: number | null
}): EffectivePricing {
  const model = resolveCustomerPricingModelState(shopDomain, rawSettings)
  const statusSettings = normalizedSettings || normalizeCustomerPricingSettings(rawSettings)
  const statusContext = resolveCustomerPricingContext(
    { ...statusSettings, enabled: statusSettings.enabled && model.statusRatesEnabled },
    customerId,
    productId,
    customerEmail,
    customerTags
  )
  const statusApplies = statusContext.hasCustomPricing && statusContext.pricingMode !== 'standard_variant'

  const volumeOffer = resolveVolumeOffer(shopDomain, rawSettings, productId, {
    customerId,
    customerEmail,
    customerName,
    customerTags,
    recentBillableInches,
  })
  // Standard-cart programs price through the shop's own discounts: they are an
  // offer to display, never a checkout price we compute.
  const volumeApplies = Boolean(volumeOffer && volumeOffer.checkoutMode === 'custom_checkout')

  if (statusApplies && (!volumeApplies || model.priority === 'status_first')) {
    return { source: 'status_rates', context: statusContext, volumeOffer, volumeTiers: [], model }
  }
  if (volumeApplies && volumeOffer) {
    return {
      source: 'volume_tiers',
      context: volumeContextFromOffer(statusContext, volumeOffer, billableInches),
      volumeOffer,
      volumeTiers: volumeOffer.tiers,
      model,
    }
  }
  return { source: 'none', context: statusContext, volumeOffer, volumeTiers: volumeOffer ? volumeOffer.tiers : [], model }
}

