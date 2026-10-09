import { chooseFinishedSheetOrientation, DEFAULT_MAX_PRINTABLE_WIDTH_IN, DEFAULT_FIT_TOLERANCE_IN, validateFinishedSheetFit } from './finishedSheetMeasurement'

export const DTF_PRINTHOUSE_SHOP_DOMAIN = 'e3bd2d-3.myshopify.com'

export type CustomerPricingCustomerType = 'guest' | 'standard' | 'business' | 'vip'
export type CustomerPricingMode = 'standard_variant' | 'variant_length' | 'measured_length'
export type CustomerPricingStatusType = 'standard' | 'business' | 'vip'

export interface CustomerPricingProductRule {
  id: string
  productId: string
  productLabel: string
  active: boolean
  pricingMode: CustomerPricingMode
  pricePerInch: number
}

export interface CustomerPricingProductOverride {
  productId: string
  pricePerInch: number
}

export interface CustomerPricingStatus {
  id: string
  key: string
  label: string
  type: CustomerPricingStatusType
  active: boolean
  pricePerInch: number
  productRules: CustomerPricingProductRule[]
}

export interface CustomerPricingAssignment {
  customerId: string
  customerEmail?: string | null
  customerName?: string | null
  statusKey: string
  active: boolean
  pricePerInchOverride: number | null
  productOverrides: CustomerPricingProductOverride[]
}

export interface CustomerPricingTagRule {
  tag: string
  statusKey: string
}

export interface CustomerPricingSettings {
  version: number
  enabled: boolean
  businessPricePerInch: number
  statuses: CustomerPricingStatus[]
  assignments: CustomerPricingAssignment[]
  /** Shopify customer tags that grant a status without a manual assignment. */
  tagRules: CustomerPricingTagRule[]
  /** Model, priority and policy are owned by customerPricingModel.server; they
   *  are carried here verbatim so every save round-trips them untouched. */
  model: string | null
  priority: string | null
  policy: Record<string, unknown> | null
}

export interface CustomerPricingContext {
  enabled: boolean
  customerId: string | null
  customerType: CustomerPricingCustomerType
  statusKey: string
  statusLabel: string
  pricePerInch: number | null
  businessPricePerInch: number
  status: CustomerPricingStatus
  assignment: CustomerPricingAssignment | null
  pricingMode: CustomerPricingMode
  hasCustomPricing: boolean
  productId: string | null
  productRule: CustomerPricingProductRule | null
  productOverride: CustomerPricingProductOverride | null
  isStatusAssigned: boolean
}

export interface VipUploadMeasurement {
  widthPx: number
  heightPx: number
  measurementWidthPx: number
  measurementHeightPx: number
  dpi: number
  documentDpi?: number
  documentDpiSource?: string | null
  effectiveDpi: number
  sizingSource: string | null
  widthIn: number
  heightIn: number
  measurementMode: string | null
}

export interface CustomPricedQuote {
  pageWidthIn: number
  pageLengthIn: number
  billableLengthIn: number
  pricePerInch: number
  totalPrice: number
  formattedTotalPrice: string
  sheetVariantTitle?: string | null
  sheetsNeeded?: number | null
}

export interface ParsedSheetSize {
  widthIn: number
  lengthIn: number
}

export interface ProductRuleCatalogItem {
  productId: string
  label: string
}

// Zero means "not configured". Runtime quote helpers reject it, so a new or
// incomplete pricing profile cannot silently invent a customer-facing rate.
// Explicit legacy values stored at the shop/status/rule level still flow
// through the normal fallback chain unchanged.
const UNCONFIGURED_PRICE_PER_INCH = 0
const DEFAULT_CUSTOMER_PRICING_VERSION = 2

function toPositiveNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function slugifyKey(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'status'
}

function normalizeStatusType(
  value: unknown,
  keyHint: string,
  labelHint: string
): CustomerPricingStatusType {
  const raw = String(value || '')
    .trim()
    .toLowerCase()

  if (raw === 'standard' || raw === 'business' || raw === 'vip') {
    return raw
  }

  const haystack = `${keyHint} ${labelHint}`.toLowerCase()
  if (haystack.includes('business')) return 'business'
  if (haystack.includes('standard')) return 'standard'
  return 'vip'
}

function normalizePricingMode(
  value: unknown,
  fallback: CustomerPricingMode
): CustomerPricingMode {
  const raw = String(value || '')
    .trim()
    .toLowerCase()

  if (raw === 'variant_length' || raw === 'measured_length' || raw === 'standard_variant') {
    return raw
  }
  if (raw === 'variant' || raw === 'variant-price') return 'variant_length'
  if (raw === 'measured' || raw === 'actual_length') return 'measured_length'
  return fallback
}

function normalizeProductLabel(productId: string): string {
  if (isWildcardProductId(productId)) return 'All products'
  return productId
}

function ensureProductId(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (isWildcardProductId(raw)) return '*'
  return raw.startsWith('gid://') ? raw : `gid://shopify/Product/${raw}`
}

function isWildcardProductId(productId: string | null | undefined): boolean {
  return String(productId || '').trim() === '*'
}

function productRuleMatches(ruleProductId: string, productId: string | null): boolean {
  if (isWildcardProductId(ruleProductId)) return true
  if (!productId) return false
  return ensureProductId(ruleProductId) === productId
}

function findBestProductRule<T extends { productId: string }>(
  rules: T[],
  productId: string | null
): T | null {
  if (!rules.length) return null
  if (productId) {
    const exactMatch = rules.find((rule) => !isWildcardProductId(rule.productId) && productRuleMatches(rule.productId, productId))
    if (exactMatch) return exactMatch
  }
  return rules.find((rule) => isWildcardProductId(rule.productId)) || null
}

function ensureStatus(
  statuses: CustomerPricingStatus[],
  nextStatus: CustomerPricingStatus
): CustomerPricingStatus[] {
  const existingIndex = statuses.findIndex((status) => status.key === nextStatus.key)
  if (existingIndex < 0) return statuses.concat(nextStatus)
  return statuses.map((status, index) => (index === existingIndex ? nextStatus : status))
}

export function normalizeCustomerId(value: string | number | null | undefined): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null

  const gidMatch = raw.match(/gid:\/\/shopify\/Customer\/(\d+)/)
  if (gidMatch?.[1]) return gidMatch[1]

  const digits = raw.match(/\d+/g)?.join('') || ''
  return digits || raw
}

function normalizeCustomerEmail(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export interface MeasuredFinishedSheetFitResult {
  ok: boolean
  reason: string | null
  code: string | null
  maxPrintableWidthIn: number
  maxPrintableLengthIn: number
  placedWidthIn: number
  placedLengthIn: number
}

export function matchesTrustedUploadOwner(input: {
  loggedInCustomerId: string | number | null | undefined
  trustedCustomerEmail?: string | null
  uploadCustomerId?: string | number | null
  uploadCustomerEmail?: string | null
}): boolean {
  const loggedInCustomerId = normalizeCustomerId(input.loggedInCustomerId)
  if (!loggedInCustomerId) return false

  const uploadCustomerId = normalizeCustomerId(input.uploadCustomerId)
  if (uploadCustomerId) return uploadCustomerId === loggedInCustomerId

  const trustedEmail = normalizeCustomerEmail(input.trustedCustomerEmail)
  const uploadEmail = normalizeCustomerEmail(input.uploadCustomerEmail)
  return Boolean(trustedEmail && uploadEmail && trustedEmail === uploadEmail)
}

export function normalizeProductId(value: string | number | null | undefined): string | null {
  return ensureProductId(value)
}

export function isDtfPrintHouseShop(shopDomain: string | null | undefined): boolean {
  return String(shopDomain || '').trim().toLowerCase() === DTF_PRINTHOUSE_SHOP_DOMAIN
}

export function buildDtfPrintHouseCustomerPricingSettings(): CustomerPricingSettings {
  const standardStatus: CustomerPricingStatus = {
    id: 'standard',
    key: 'standard',
    label: 'Standard Customer',
    type: 'standard',
    active: true,
    pricePerInch: UNCONFIGURED_PRICE_PER_INCH,
    productRules: [],
  }

  const businessStatus: CustomerPricingStatus = {
    id: 'business',
    key: 'business',
    label: 'Business',
    type: 'business',
    active: true,
    pricePerInch: UNCONFIGURED_PRICE_PER_INCH,
    productRules: [],
  }

  const vipStatus: CustomerPricingStatus = {
    id: 'vip',
    key: 'vip',
    label: 'VIP',
    type: 'vip',
    active: true,
    pricePerInch: UNCONFIGURED_PRICE_PER_INCH,
    productRules: [],
  }

  return {
    version: DEFAULT_CUSTOMER_PRICING_VERSION,
    enabled: true,
    businessPricePerInch: UNCONFIGURED_PRICE_PER_INCH,
    statuses: [standardStatus, businessStatus, vipStatus],
    assignments: [],
    tagRules: [],
    model: null,
    priority: null,
    policy: null,
  }
}

/** Default status set every shop starts from (Standard / Business / VIP). */
export function buildDefaultCustomerPricingSettings(): CustomerPricingSettings {
  return buildDtfPrintHouseCustomerPricingSettings()
}

export function normalizeCustomerPricingSettings(rawSettings: unknown): CustomerPricingSettings {
  const raw = rawSettings && typeof rawSettings === 'object' ? (rawSettings as Record<string, unknown>) : {}
  const rawPricing =
    raw.customerPricing && typeof raw.customerPricing === 'object'
      ? (raw.customerPricing as Record<string, unknown>)
      : {}

  const version = Math.max(
    DEFAULT_CUSTOMER_PRICING_VERSION,
    Math.floor(toPositiveNumber(rawPricing.version, DEFAULT_CUSTOMER_PRICING_VERSION))
  )
  const businessPricePerInch = toPositiveNumber(
    rawPricing.businessPricePerInch ?? rawPricing.defaultPricePerInch,
    UNCONFIGURED_PRICE_PER_INCH
  )

  const rawStatuses = Array.isArray(rawPricing.statuses) ? rawPricing.statuses : []
  const statuses = rawStatuses
    .map((entry, index) => {
      const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      const label = String(value.label || value.name || '').trim()
      const key = slugifyKey(String(value.key || value.id || label || `status-${index + 1}`))
      const type = normalizeStatusType(value.type, key, label)
      const defaultPricingMode: CustomerPricingMode =
        type === 'business'
          ? 'variant_length'
          : type === 'vip'
            ? 'measured_length'
            : 'standard_variant'
      const pricePerInch = toPositiveNumber(
        value.pricePerInch ?? value.defaultPricePerInch,
        businessPricePerInch
      )

      const rawRules = Array.isArray(value.productRules) ? value.productRules : []
      const productRules = rawRules
        .map((rule, ruleIndex) => {
          const rawRule = rule && typeof rule === 'object' ? (rule as Record<string, unknown>) : {}
          const productId = ensureProductId(rawRule.productId) || String(rawRule.productId || '').trim()
          if (!productId) return null
          const rulePrice = toPositiveNumber(rawRule.pricePerInch, pricePerInch)
          return {
            id: String(rawRule.id || `${key}_${ruleIndex + 1}`),
            productId,
            productLabel: String(rawRule.productLabel || normalizeProductLabel(productId)).trim() || productId,
            active: rawRule.active !== false,
            pricingMode: normalizePricingMode(rawRule.pricingMode, defaultPricingMode),
            pricePerInch: rulePrice,
          } satisfies CustomerPricingProductRule
        })
        .filter((rule): rule is CustomerPricingProductRule => Boolean(rule))

      return {
        id: String(value.id || key),
        key,
        label: label || key,
        type,
        active: value.active !== false,
        pricePerInch,
        productRules,
      } satisfies CustomerPricingStatus
    })
    .filter((status) => Boolean(status.id) && Boolean(status.label))

  const rawAssignments = Array.isArray(rawPricing.assignments) ? rawPricing.assignments : []
  const assignments = rawAssignments
    .map((entry) => {
      const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      const customerId = normalizeCustomerId(
        (value.customerId as string | number | null | undefined) ??
          (value.shopifyCustomerId as string | number | null | undefined)
      )
      const statusKey = slugifyKey(String(value.statusKey || value.statusId || 'vip'))
      const rawProductOverrides = Array.isArray(value.productOverrides) ? value.productOverrides : []
      const productOverrides = rawProductOverrides
        .map((override) => {
          const rawOverride =
            override && typeof override === 'object' ? (override as Record<string, unknown>) : {}
          const productId = ensureProductId(rawOverride.productId) || String(rawOverride.productId || '').trim()
          const pricePerInch = toPositiveNumber(rawOverride.pricePerInch, 0)
          if (!productId || !(pricePerInch > 0)) return null
          return {
            productId,
            pricePerInch,
          } satisfies CustomerPricingProductOverride
        })
        .filter((override): override is CustomerPricingProductOverride => Boolean(override))

      const legacyOverride = toPositiveNumber(value.pricePerInchOverride, 0)
      if (!productOverrides.length && legacyOverride > 0) {
        productOverrides.push({
          productId: '*',
          pricePerInch: legacyOverride,
        })
      }

      return {
        customerId: customerId || '',
        customerEmail: String(value.customerEmail || '').trim() || null,
        customerName: String(value.customerName || '').trim() || null,
        statusKey,
        active: value.active !== false,
        pricePerInchOverride: productOverrides[0]?.pricePerInch || null,
        productOverrides,
      } satisfies CustomerPricingAssignment
    })
    .filter((assignment) => Boolean(assignment.customerId))

  const rawTagRules = Array.isArray(rawPricing.tagRules) ? rawPricing.tagRules : []
  const tagRules = rawTagRules
    .map((entry) => {
      const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      const tag = String(value.tag || '').trim().toLowerCase()
      const statusKey = slugifyKey(String(value.statusKey || ''))
      if (!tag || !statusKey) return null
      return { tag, statusKey } satisfies CustomerPricingTagRule
    })
    .filter((rule): rule is CustomerPricingTagRule => Boolean(rule))

  const model = typeof rawPricing.model === 'string' && rawPricing.model.trim() ? rawPricing.model.trim() : null
  const priority =
    typeof rawPricing.priority === 'string' && rawPricing.priority.trim() ? rawPricing.priority.trim() : null
  const policy =
    rawPricing.policy && typeof rawPricing.policy === 'object' && !Array.isArray(rawPricing.policy)
      ? (rawPricing.policy as Record<string, unknown>)
      : null

  return {
    version,
    enabled: rawPricing.enabled !== false,
    businessPricePerInch,
    statuses,
    assignments,
    tagRules,
    model,
    priority,
    policy,
  }
}

function coerceCustomerPricingSettings(rawSettings: unknown): CustomerPricingSettings {
  const raw = rawSettings && typeof rawSettings === 'object' ? (rawSettings as Record<string, unknown>) : {}
  const looksNormalized =
    Array.isArray(raw.statuses) &&
    Array.isArray(raw.assignments) &&
    ('enabled' in raw || 'businessPricePerInch' in raw || 'version' in raw)

  return looksNormalized
    ? normalizeCustomerPricingSettings({ customerPricing: raw })
    : normalizeCustomerPricingSettings(rawSettings)
}

/**
 * Every shop gets the Standard / Business / VIP status set so the admin page
 * and the storefront share one vocabulary. Existing statuses keep their
 * labels and rates; only missing ones are added. (`shopDomain` is kept for
 * call-site compatibility; defaults no longer depend on it.)
 */
export function applyCustomerPricingDefaultsForShop(
  _shopDomain: string | null | undefined,
  rawSettings: unknown
): CustomerPricingSettings {
  const current = normalizeCustomerPricingSettings(rawSettings)
  const defaults = buildDefaultCustomerPricingSettings()
  let mergedStatuses = current.statuses

  for (const defaultStatus of defaults.statuses) {
    const currentStatus = mergedStatuses.find((status) => status.key === defaultStatus.key)
    if (!currentStatus) {
      mergedStatuses = ensureStatus(mergedStatuses, defaultStatus)
      continue
    }

    let nextStatus = { ...currentStatus }
    if (currentStatus.type !== defaultStatus.type) {
      nextStatus = { ...nextStatus, type: defaultStatus.type }
    }

    if (!currentStatus.label || currentStatus.label === currentStatus.key) {
      nextStatus = { ...nextStatus, label: defaultStatus.label }
    }

    mergedStatuses = ensureStatus(mergedStatuses, nextStatus)
  }

  return {
    ...current,
    version: DEFAULT_CUSTOMER_PRICING_VERSION,
    enabled: current.enabled,
    businessPricePerInch: current.businessPricePerInch || defaults.businessPricePerInch,
    statuses: mergedStatuses,
    assignments: current.assignments,
  }
}

export function buildCustomerPricingSettingsPayload(
  settings: CustomerPricingSettings
): Record<string, unknown> {
  return {
    version: DEFAULT_CUSTOMER_PRICING_VERSION,
    enabled: settings.enabled,
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.priority ? { priority: settings.priority } : {}),
    ...(settings.policy ? { policy: settings.policy } : {}),
    tagRules: settings.tagRules.map((rule) => ({ tag: rule.tag, statusKey: rule.statusKey })),
    businessPricePerInch: settings.businessPricePerInch,
    statuses: settings.statuses.map((status) => ({
      id: status.id,
      key: status.key,
      label: status.label,
      type: status.type,
      active: status.active,
      pricePerInch: status.pricePerInch,
      productRules: status.productRules.map((rule) => ({
        id: rule.id,
        productId: rule.productId,
        productLabel: rule.productLabel,
        active: rule.active,
        pricingMode: rule.pricingMode,
        pricePerInch: rule.pricePerInch,
      })),
    })),
    assignments: settings.assignments.map((assignment) => ({
      customerId: assignment.customerId,
      customerEmail: assignment.customerEmail || null,
      customerName: assignment.customerName || null,
      statusKey: assignment.statusKey,
      active: assignment.active,
      pricePerInchOverride: assignment.pricePerInchOverride,
      productOverrides: assignment.productOverrides.map((override) => ({
        productId: override.productId,
        pricePerInch: override.pricePerInch,
      })),
    })),
  }
}

export function resolveCustomerPricingContext(
  rawSettings: unknown,
  loggedInCustomerId: string | number | null | undefined,
  productIdInput?: string | number | null,
  customerEmailInput?: string | null,
  customerTagsInput?: string[] | null
): CustomerPricingContext {
  const settings = coerceCustomerPricingSettings(rawSettings)
  const customerId = normalizeCustomerId(loggedInCustomerId)
  const productId = normalizeProductId(productIdInput)
  const customerEmail = normalizeCustomerEmail(customerEmailInput)
  const customerTags = Array.isArray(customerTagsInput)
    ? customerTagsInput.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
    : []

  const standardStatus: CustomerPricingStatus = {
    id: 'standard',
    key: 'standard',
    label: 'Standard Customer',
    type: 'standard',
    active: true,
    pricePerInch: settings.businessPricePerInch,
    productRules: [],
  }

  if (!customerId && !customerEmail) {
    return {
      enabled: settings.enabled,
      customerId: null,
      customerType: 'guest',
      statusKey: 'guest',
      statusLabel: 'Guest',
      pricePerInch: null,
      businessPricePerInch: settings.businessPricePerInch,
      status: {
        ...standardStatus,
        id: 'guest',
        key: 'guest',
        label: 'Guest',
      },
      assignment: null,
      pricingMode: 'standard_variant',
      hasCustomPricing: false,
      productId,
      productRule: null,
      productOverride: null,
      isStatusAssigned: false,
    }
  }

  if (!settings.enabled) {
    return {
      enabled: false,
      customerId,
      customerType: 'standard',
      statusKey: standardStatus.key,
      statusLabel: standardStatus.label,
      pricePerInch: null,
      businessPricePerInch: settings.businessPricePerInch,
      status: standardStatus,
      assignment: null,
      pricingMode: 'standard_variant',
      hasCustomPricing: false,
      productId,
      productRule: null,
      productOverride: null,
      isStatusAssigned: false,
    }
  }

  const assignmentById = customerId
    ? settings.assignments.find(
        (entry) => entry.active && normalizeCustomerId(entry.customerId) === customerId
      ) || null
    : null
  const assignmentByEmail =
    assignmentById ||
    (customerEmail
      ? settings.assignments.find(
          (entry) =>
            entry.active &&
            normalizeCustomerEmail(entry.customerEmail) === customerEmail
        ) || null
      : null)

  // Tag rules grant a status to every customer carrying the tag, without a
  // per-customer assignment. A manual assignment always wins over a tag.
  const tagRule =
    !assignmentByEmail && customerTags.length
      ? settings.tagRules.find((rule) => customerTags.includes(rule.tag)) || null
      : null
  const assignment: CustomerPricingAssignment | null =
    assignmentByEmail ||
    (tagRule
      ? {
          customerId: customerId || '',
          customerEmail: customerEmail || null,
          customerName: null,
          statusKey: tagRule.statusKey,
          active: true,
          pricePerInchOverride: null,
          productOverrides: [],
        }
      : null)

  if (!assignment) {
    return {
      enabled: settings.enabled,
      customerId,
      customerType: 'standard',
      statusKey: standardStatus.key,
      statusLabel: standardStatus.label,
      pricePerInch: null,
      businessPricePerInch: settings.businessPricePerInch,
      status: standardStatus,
      assignment: null,
      pricingMode: 'standard_variant',
      hasCustomPricing: false,
      productId,
      productRule: null,
      productOverride: null,
      isStatusAssigned: false,
    }
  }

  const matchedStatus = settings.statuses.find(
    (status) => status.active && status.key === assignment.statusKey
  )

  if (!matchedStatus) {
    return {
      enabled: settings.enabled,
      customerId,
      customerType: 'standard',
      statusKey: standardStatus.key,
      statusLabel: standardStatus.label,
      pricePerInch: null,
      businessPricePerInch: settings.businessPricePerInch,
      status: standardStatus,
      assignment: null,
      pricingMode: 'standard_variant',
      hasCustomPricing: false,
      productId,
      productRule: null,
      productOverride: null,
      isStatusAssigned: false,
    }
  }

  const productRule = findBestProductRule(
    matchedStatus.productRules.filter((rule) => rule.active && productRuleMatches(rule.productId, productId)),
    productId
  )
  const productOverride = findBestProductRule(
    assignment.productOverrides.filter((override) => productRuleMatches(override.productId, productId)),
    productId
  )
  const hasCustomPricing = Boolean(productRule && productRule.pricingMode !== 'standard_variant')
  const pricePerInch = hasCustomPricing
    ? productOverride?.pricePerInch || productRule?.pricePerInch || matchedStatus.pricePerInch || settings.businessPricePerInch
    : null

  return {
    enabled: settings.enabled,
    customerId,
    customerType: matchedStatus.type,
    statusKey: matchedStatus.key,
    statusLabel: matchedStatus.label,
    pricePerInch,
    businessPricePerInch: settings.businessPricePerInch,
    status: matchedStatus,
    assignment,
    pricingMode: hasCustomPricing ? productRule!.pricingMode : 'standard_variant',
    hasCustomPricing,
    productId,
    productRule: productRule || null,
    productOverride: productOverride || null,
    isStatusAssigned: true,
  }
}

export function calculateMeasuredLengthQuote(
  measurement: VipUploadMeasurement,
  pricePerInch: number,
  requestedQuantity = 1,
  maxPrintableWidthIn = DEFAULT_MAX_PRINTABLE_WIDTH_IN,
  fitToleranceIn = DEFAULT_FIT_TOLERANCE_IN
): CustomPricedQuote {
  // Physical file dimensions retain their uploaded orientation. The central
  // film-orientation chooser, not Math.max, determines the consumed length.
  const placed = chooseFinishedSheetOrientation(measurement.widthIn, measurement.heightIn, maxPrintableWidthIn, fitToleranceIn)
  if (!placed) throw new Error('Valid finished-sheet dimensions are required')
  const pageWidthIn = Number(placed.widthIn.toFixed(2))
  const pageLengthIn = Number(placed.lengthIn.toFixed(2))
  const sheetsNeeded = Math.max(1, Math.floor(Number(requestedQuantity) || 1))
  // The displayed two-decimal sheet length is the billing unit. Multiplying
  // that same visible number makes quantity math explainable and preserves
  // established prices when source metadata gains more precision.
  const billableLengthIn = Number((pageLengthIn * sheetsNeeded).toFixed(2))
  const rate = Number(pricePerInch)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('A positive configured price per inch is required')
  }
  const totalPrice = Number((billableLengthIn * rate).toFixed(2))

  return {
    pageWidthIn,
    pageLengthIn,
    billableLengthIn,
    pricePerInch: rate,
    totalPrice,
    formattedTotalPrice: totalPrice.toFixed(2),
    sheetsNeeded,
  }
}

export function validateMeasuredFinishedSheetFit(input: {
  measurement: Pick<VipUploadMeasurement, 'widthIn' | 'heightIn'>
  maxPrintableWidthIn: number
  maxPrintableLengthIn: number
  fitToleranceIn: number
}): MeasuredFinishedSheetFitResult {
  const fit = validateFinishedSheetFit({
    widthIn: input.measurement.widthIn,
    heightIn: input.measurement.heightIn,
    maxPrintableWidthIn: input.maxPrintableWidthIn,
    maxPrintableLengthIn: input.maxPrintableLengthIn,
    fitToleranceIn: input.fitToleranceIn,
  })
  return {
    ok: fit.ok,
    code: fit.ok ? null : fit.code,
    reason: fit.ok ? null : fit.message,
    maxPrintableWidthIn: input.maxPrintableWidthIn,
    maxPrintableLengthIn: input.maxPrintableLengthIn,
    placedWidthIn: fit.widthIn,
    placedLengthIn: fit.lengthIn,
  }
}

export function parseSheetSizeFromTitle(title: string | null | undefined): ParsedSheetSize | null {
  const raw = String(title || '').trim()
  if (!raw) return null

  const normalized = raw
    .replace(/["']/g, '')
    .replace(/[×xX]/g, 'x')
    .replace(/\s+/g, '')
  let match = normalized.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i)
  if (!match) {
    const numbers = raw.match(/(\d+(?:\.\d+)?)/g)
    if (numbers && numbers.length >= 2) {
      match = [numbers.join(' '), numbers[0], numbers[1]]
    }
  }
  if (!match) return null

  const widthIn = Number(match[1])
  const lengthIn = Number(match[2])
  if (!(widthIn > 0) || !(lengthIn > 0)) return null

  return {
    widthIn,
    lengthIn,
  }
}

export function calculateVariantLengthQuote({
  measurement,
  pricePerInch,
  variantTitle,
  sheetsNeeded,
}: {
  measurement: VipUploadMeasurement
  pricePerInch: number
  variantTitle: string
  sheetsNeeded: number
}): CustomPricedQuote | null {
  const parsedVariant = parseSheetSizeFromTitle(variantTitle)
  if (!parsedVariant) return null

  const pageWidthIn = Number(Math.min(measurement.widthIn, measurement.heightIn).toFixed(2))
  const pageLengthIn = Number(Math.max(measurement.widthIn, measurement.heightIn).toFixed(2))
  const safeSheetsNeeded = Math.max(1, Math.floor(Number(sheetsNeeded) || 1))
  // Variant sizes retain their merchant-authored commercial width x length
  // contract. Only the uploaded file is orientation-normalized.
  const sheetLengthIn = parsedVariant.lengthIn
  const billableLengthIn = Number((sheetLengthIn * safeSheetsNeeded).toFixed(2))
  const rate = Number(pricePerInch)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('A positive configured price per inch is required')
  }
  const totalPrice = Number((billableLengthIn * rate).toFixed(2))

  return {
    pageWidthIn,
    pageLengthIn,
    billableLengthIn,
    pricePerInch: rate,
    totalPrice,
    formattedTotalPrice: totalPrice.toFixed(2),
    sheetVariantTitle: variantTitle,
    sheetsNeeded: safeSheetsNeeded,
  }
}
