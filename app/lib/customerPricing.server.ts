import {
  applyFullCanvasMeasurementMetadata,
  deriveUploadItemLifecycle,
} from '~/lib/uploadLifecycle.server'

export const DTF_PRINTHOUSE_SHOP_DOMAIN = 'e3bd2d-3.myshopify.com'
export const DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID = 'gid://shopify/Product/7605186560158'
export const DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID = 'gid://shopify/Product/7717339562142'

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

export interface CustomerPricingSettings {
  version: number
  enabled: boolean
  businessPricePerInch: number
  statuses: CustomerPricingStatus[]
  assignments: CustomerPricingAssignment[]
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

export interface BuilderLimits {
  maxWidthIn?: number | null
  maxHeightIn?: number | null
  minWidthIn?: number | null
  minHeightIn?: number | null
}

export interface QuoteValidationResult {
  ok: boolean
  reason: string | null
  code: string | null
}

export interface ParsedSheetSize {
  widthIn: number
  lengthIn: number
}

export interface ProductRuleCatalogItem {
  productId: string
  label: string
}

const DEFAULT_BUSINESS_PRICE_PER_INCH = 0.2
const DEFAULT_MAX_WIDTH_IN = 22
const DEFAULT_MAX_HEIGHT_IN = 240
const DEFAULT_CUSTOMER_PRICING_VERSION = 2

const DTF_PRINTHOUSE_PRODUCT_RULE_CATALOG: ProductRuleCatalogItem[] = [
  {
    productId: DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
    label: 'Upload DTF Gang Sheet',
  },
  {
    productId: DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
    label: 'Upload UV DTF Gang Sheet',
  },
]

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
  const match = DTF_PRINTHOUSE_PRODUCT_RULE_CATALOG.find((item) => item.productId === productId)
  return match?.label || productId
}

function ensureProductId(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
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

function ensureStatusRule(
  rules: CustomerPricingProductRule[],
  nextRule: CustomerPricingProductRule
): CustomerPricingProductRule[] {
  const existingIndex = rules.findIndex((rule) => rule.productId === nextRule.productId)
  if (existingIndex < 0) return rules.concat(nextRule)
  return rules.map((rule, index) => (index === existingIndex ? nextRule : rule))
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

export function normalizeProductId(value: string | number | null | undefined): string | null {
  return ensureProductId(value)
}

export function isDtfPrintHouseShop(shopDomain: string | null | undefined): boolean {
  return String(shopDomain || '').trim().toLowerCase() === DTF_PRINTHOUSE_SHOP_DOMAIN
}

export function getDtfPrintHouseProductCatalog(): ProductRuleCatalogItem[] {
  return DTF_PRINTHOUSE_PRODUCT_RULE_CATALOG.map((item) => ({ ...item }))
}

export function buildDtfPrintHouseCustomerPricingSettings(): CustomerPricingSettings {
  const standardStatus: CustomerPricingStatus = {
    id: 'standard',
    key: 'standard',
    label: 'Standard Customer',
    type: 'standard',
    active: true,
    pricePerInch: DEFAULT_BUSINESS_PRICE_PER_INCH,
    productRules: [],
  }

  const businessStatus: CustomerPricingStatus = {
    id: 'business',
    key: 'business',
    label: 'Business',
    type: 'business',
    active: true,
    pricePerInch: DEFAULT_BUSINESS_PRICE_PER_INCH,
    productRules: [
      {
        id: 'business_dtf_upload',
        productId: DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
        productLabel: 'Upload DTF Gang Sheet',
        active: true,
        pricingMode: 'variant_length',
        pricePerInch: 0.2,
      },
      {
        id: 'business_uv_upload',
        productId: DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
        productLabel: 'Upload UV DTF Gang Sheet',
        active: true,
        pricingMode: 'variant_length',
        pricePerInch: 0.6,
      },
    ],
  }

  const vipStatus: CustomerPricingStatus = {
    id: 'vip',
    key: 'vip',
    label: 'VIP',
    type: 'vip',
    active: true,
    pricePerInch: DEFAULT_BUSINESS_PRICE_PER_INCH,
    productRules: [
      {
        id: 'vip_dtf_upload',
        productId: DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
        productLabel: 'Upload DTF Gang Sheet',
        active: true,
        pricingMode: 'measured_length',
        pricePerInch: 0.2,
      },
      {
        id: 'vip_uv_upload',
        productId: DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
        productLabel: 'Upload UV DTF Gang Sheet',
        active: false,
        pricingMode: 'measured_length',
        pricePerInch: 0.2,
      },
    ],
  }

  return {
    version: DEFAULT_CUSTOMER_PRICING_VERSION,
    enabled: true,
    businessPricePerInch: DEFAULT_BUSINESS_PRICE_PER_INCH,
    statuses: [standardStatus, businessStatus, vipStatus],
    assignments: [],
  }
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
    DEFAULT_BUSINESS_PRICE_PER_INCH
  ) || DEFAULT_BUSINESS_PRICE_PER_INCH

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
      ) || businessPricePerInch

      const rawRules = Array.isArray(value.productRules) ? value.productRules : []
      const productRules = rawRules
        .map((rule, ruleIndex) => {
          const rawRule = rule && typeof rule === 'object' ? (rule as Record<string, unknown>) : {}
          const productId = ensureProductId(rawRule.productId) || String(rawRule.productId || '').trim()
          if (!productId) return null
          const rulePrice = toPositiveNumber(rawRule.pricePerInch, pricePerInch) || pricePerInch
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

      const normalizedRules =
        productRules.length || type === 'standard'
          ? productRules
          : [
              {
                id: `${key}_default`,
                productId: '*',
                productLabel: 'All products',
                active: true,
                pricingMode: defaultPricingMode,
                pricePerInch,
              },
            ]

      return {
        id: String(value.id || key),
        key,
        label: label || key,
        type,
        active: value.active !== false,
        pricePerInch,
        productRules: normalizedRules,
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

  return {
    version,
    enabled: rawPricing.enabled !== false,
    businessPricePerInch,
    statuses,
    assignments,
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

export function applyCustomerPricingDefaultsForShop(
  shopDomain: string | null | undefined,
  rawSettings: unknown
): CustomerPricingSettings {
  const current = normalizeCustomerPricingSettings(rawSettings)
  if (!isDtfPrintHouseShop(shopDomain)) {
    return current
  }

  const defaults = buildDtfPrintHouseCustomerPricingSettings()
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

    for (const defaultRule of defaultStatus.productRules) {
      const currentRule = currentStatus.productRules.find((rule) => rule.productId === defaultRule.productId)
      if (!currentRule) {
        nextStatus = {
          ...nextStatus,
          productRules: ensureStatusRule(nextStatus.productRules, defaultRule),
        }
        continue
      }

      const mergedRule: CustomerPricingProductRule = {
        ...currentRule,
        productLabel: currentRule.productLabel || defaultRule.productLabel,
        pricingMode: currentRule.pricingMode || defaultRule.pricingMode,
      }
      nextStatus = {
        ...nextStatus,
        productRules: ensureStatusRule(nextStatus.productRules, mergedRule),
      }
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
  productIdInput?: string | number | null
): CustomerPricingContext {
  const settings = coerceCustomerPricingSettings(rawSettings)
  const customerId = normalizeCustomerId(loggedInCustomerId)
  const productId = normalizeProductId(productIdInput)

  const standardStatus: CustomerPricingStatus = {
    id: 'standard',
    key: 'standard',
    label: 'Standard Customer',
    type: 'standard',
    active: true,
    pricePerInch: settings.businessPricePerInch,
    productRules: [],
  }

  if (!customerId) {
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

  const assignment = settings.assignments.find(
    (entry) => entry.active && normalizeCustomerId(entry.customerId) === customerId
  )

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

export function extractVipUploadMeasurement(
  uploadItems: Array<{ preflightStatus?: string | null; preflightResult?: unknown }>,
  shopDomain?: string | null
): VipUploadMeasurement | null {
  const useFullCanvasMeasurement = isDtfPrintHouseShop(shopDomain)

  for (const item of uploadItems) {
    const lifecycle = deriveUploadItemLifecycle(item)
    const metadata = useFullCanvasMeasurement
      ? applyFullCanvasMeasurementMetadata(lifecycle.metadata)
      : lifecycle.metadata

    if (lifecycle.measurementStatus !== 'ready' || !metadata) {
      continue
    }

    return {
      widthPx: metadata.widthPx,
      heightPx: metadata.heightPx,
      measurementWidthPx: metadata.measurementWidthPx,
      measurementHeightPx: metadata.measurementHeightPx,
      dpi: metadata.dpi,
      effectiveDpi: metadata.effectiveDpi,
      sizingSource: metadata.sizingSource,
      widthIn: metadata.widthIn,
      heightIn: metadata.heightIn,
      measurementMode: metadata.measurementMode,
    }
  }

  return null
}

export function calculateMeasuredLengthQuote(
  measurement: VipUploadMeasurement,
  pricePerInch: number
): CustomPricedQuote {
  const pageWidthIn = Number(Math.min(measurement.widthIn, measurement.heightIn).toFixed(2))
  const pageLengthIn = Number(Math.max(measurement.widthIn, measurement.heightIn).toFixed(2))
  const billableLengthIn = Number(pageLengthIn.toFixed(2))
  const rate = Number(pricePerInch) || DEFAULT_BUSINESS_PRICE_PER_INCH
  const totalPrice = Number((billableLengthIn * rate).toFixed(2))

  return {
    pageWidthIn,
    pageLengthIn,
    billableLengthIn,
    pricePerInch: Number(rate.toFixed(4)),
    totalPrice,
    formattedTotalPrice: totalPrice.toFixed(2),
  }
}

export function parseSheetSizeFromTitle(title: string | null | undefined): ParsedSheetSize | null {
  const raw = String(title || '').trim()
  if (!raw) return null

  const normalized = raw
    .replace(/["']/g, '')
    .replace(/[×xX]/g, 'x')
    .replace(/\s+/g, '')
  const parts = normalized.split('x').map((part) => Number(part))
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return null
  }

  const widthIn = Number(parts[0])
  const lengthIn = Number(parts[1])
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
  const billableLengthIn = Number((parsedVariant.lengthIn * safeSheetsNeeded).toFixed(2))
  const rate = Number(pricePerInch) || DEFAULT_BUSINESS_PRICE_PER_INCH
  const totalPrice = Number((billableLengthIn * rate).toFixed(2))

  return {
    pageWidthIn,
    pageLengthIn,
    billableLengthIn,
    pricePerInch: Number(rate.toFixed(4)),
    totalPrice,
    formattedTotalPrice: totalPrice.toFixed(2),
    sheetVariantTitle: variantTitle,
    sheetsNeeded: safeSheetsNeeded,
  }
}

export function deriveVariantBasedLimits(
  variantTitles: string[],
  fallbackLimits?: BuilderLimits | null
): BuilderLimits {
  const parsedSizes = variantTitles
    .map((title) => parseSheetSizeFromTitle(title))
    .filter((value): value is ParsedSheetSize => Boolean(value))

  if (!parsedSizes.length) {
    return {
      maxWidthIn: toPositiveNumber(fallbackLimits?.maxWidthIn, DEFAULT_MAX_WIDTH_IN) || DEFAULT_MAX_WIDTH_IN,
      maxHeightIn: toPositiveNumber(fallbackLimits?.maxHeightIn, DEFAULT_MAX_HEIGHT_IN) || DEFAULT_MAX_HEIGHT_IN,
      minWidthIn: toPositiveNumber(fallbackLimits?.minWidthIn, 1) || 1,
      minHeightIn: toPositiveNumber(fallbackLimits?.minHeightIn, 1) || 1,
    }
  }

  return {
    maxWidthIn: Math.max(...parsedSizes.map((size) => size.widthIn)),
    maxHeightIn: Math.max(...parsedSizes.map((size) => size.lengthIn)),
    minWidthIn: 1,
    minHeightIn: 1,
  }
}

export function validateCustomQuoteAgainstLimits(
  quote: Pick<CustomPricedQuote, 'pageWidthIn' | 'pageLengthIn'>,
  limits: BuilderLimits | null | undefined,
  prefixLabel = 'Design'
): QuoteValidationResult {
  const maxWidthIn = toPositiveNumber(limits?.maxWidthIn, DEFAULT_MAX_WIDTH_IN) || DEFAULT_MAX_WIDTH_IN
  const maxHeightIn = toPositiveNumber(limits?.maxHeightIn, DEFAULT_MAX_HEIGHT_IN) || DEFAULT_MAX_HEIGHT_IN
  const minWidthIn = toPositiveNumber(limits?.minWidthIn, 1) || 1
  const minHeightIn = toPositiveNumber(limits?.minHeightIn, 1) || 1
  const epsilon = 0.001

  if (quote.pageWidthIn + epsilon < minWidthIn) {
    return {
      ok: false,
      code: 'WIDTH_TOO_SMALL',
      reason: `${prefixLabel} width must be at least ${minWidthIn.toFixed(2)}".`,
    }
  }

  if (quote.pageLengthIn + epsilon < minHeightIn) {
    return {
      ok: false,
      code: 'LENGTH_TOO_SMALL',
      reason: `${prefixLabel} length must be at least ${minHeightIn.toFixed(2)}".`,
    }
  }

  if (quote.pageWidthIn > maxWidthIn + epsilon) {
    return {
      ok: false,
      code: 'WIDTH_TOO_LARGE',
      reason: `${prefixLabel} width exceeds the configured limit of ${maxWidthIn.toFixed(2)}".`,
    }
  }

  if (quote.pageLengthIn > maxHeightIn + epsilon) {
    return {
      ok: false,
      code: 'LENGTH_TOO_LARGE',
      reason: `${prefixLabel} length exceeds the configured limit of ${maxHeightIn.toFixed(2)}".`,
    }
  }

  return {
    ok: true,
    code: null,
    reason: null,
  }
}
