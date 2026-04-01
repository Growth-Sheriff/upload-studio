import { deriveUploadItemLifecycle } from '~/lib/uploadLifecycle.server'

export type CustomerPricingCustomerType = 'guest' | 'business' | 'vip'

export interface CustomerPricingStatus {
  id: string
  key: string
  label: string
  active: boolean
  pricePerInch: number
}

export interface CustomerPricingAssignment {
  customerId: string
  customerEmail?: string | null
  customerName?: string | null
  statusKey: string
  active: boolean
  pricePerInchOverride: number | null
}

export interface CustomerPricingSettings {
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
  pricePerInch: number
  businessPricePerInch: number
  status: CustomerPricingStatus
  assignment: CustomerPricingAssignment | null
}

export interface VipUploadMeasurement {
  widthPx: number
  heightPx: number
  measurementWidthPx: number
  measurementHeightPx: number
  effectiveDpi: number
  widthIn: number
  heightIn: number
  measurementMode: string | null
}

export interface VipQuote {
  pageWidthIn: number
  pageLengthIn: number
  pricePerInch: number
  totalPrice: number
  formattedTotalPrice: string
}

export interface BuilderLimits {
  maxWidthIn?: number | null
  maxHeightIn?: number | null
  minWidthIn?: number | null
  minHeightIn?: number | null
}

export interface VipQuoteValidationResult {
  ok: boolean
  reason: string | null
  code: string | null
}

const DEFAULT_BUSINESS_PRICE_PER_INCH = 0.2
const DEFAULT_MAX_WIDTH_IN = 21.75
const DEFAULT_MAX_HEIGHT_IN = 35.75

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

  return normalized || 'vip'
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

export function normalizeCustomerPricingSettings(rawSettings: unknown): CustomerPricingSettings {
  const raw = rawSettings && typeof rawSettings === 'object' ? (rawSettings as Record<string, unknown>) : {}
  const rawPricing = raw.customerPricing && typeof raw.customerPricing === 'object'
    ? (raw.customerPricing as Record<string, unknown>)
    : {}

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
      const pricePerInch = toPositiveNumber(value.pricePerInch ?? value.defaultPricePerInch, businessPricePerInch)

      return {
        id: String(value.id || key),
        key,
        label: label || key,
        active: value.active !== false,
        pricePerInch: pricePerInch > 0 ? pricePerInch : businessPricePerInch,
      }
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
      const pricePerInchOverride = toPositiveNumber(value.pricePerInchOverride, 0)

      return {
        customerId: customerId || '',
        customerEmail: String(value.customerEmail || '').trim() || null,
        customerName: String(value.customerName || '').trim() || null,
        statusKey,
        active: value.active !== false,
        pricePerInchOverride: pricePerInchOverride > 0 ? pricePerInchOverride : null,
      }
    })
    .filter((assignment) => Boolean(assignment.customerId))

  return {
    enabled: rawPricing.enabled !== false,
    businessPricePerInch,
    statuses,
    assignments,
  }
}

export function resolveCustomerPricingContext(
  rawSettings: unknown,
  loggedInCustomerId: string | number | null | undefined
): CustomerPricingContext {
  const settings = normalizeCustomerPricingSettings(rawSettings)
  const customerId = normalizeCustomerId(loggedInCustomerId)

  const businessStatus: CustomerPricingStatus = {
    id: 'business',
    key: 'business',
    label: 'Business',
    active: true,
    pricePerInch: settings.businessPricePerInch,
  }

  if (!customerId) {
    return {
      enabled: settings.enabled,
      customerId: null,
      customerType: 'guest',
      statusKey: 'guest',
      statusLabel: 'Guest',
      pricePerInch: settings.businessPricePerInch,
      businessPricePerInch: settings.businessPricePerInch,
      status: {
        id: 'guest',
        key: 'guest',
        label: 'Guest',
        active: true,
        pricePerInch: settings.businessPricePerInch,
      },
      assignment: null,
    }
  }

  if (!settings.enabled) {
    return {
      enabled: false,
      customerId,
      customerType: 'business',
      statusKey: businessStatus.key,
      statusLabel: businessStatus.label,
      pricePerInch: businessStatus.pricePerInch,
      businessPricePerInch: settings.businessPricePerInch,
      status: businessStatus,
      assignment: null,
    }
  }

  const assignment = settings.assignments.find(
    (entry) => entry.active && normalizeCustomerId(entry.customerId) === customerId
  )

  if (!assignment) {
    return {
      enabled: settings.enabled,
      customerId,
      customerType: 'business',
      statusKey: businessStatus.key,
      statusLabel: businessStatus.label,
      pricePerInch: businessStatus.pricePerInch,
      businessPricePerInch: settings.businessPricePerInch,
      status: businessStatus,
      assignment: null,
    }
  }

  const matchedStatus = settings.statuses.find(
    (status) => status.active && status.key === assignment.statusKey
  )

  if (!matchedStatus) {
    return {
      enabled: settings.enabled,
      customerId,
      customerType: 'business',
      statusKey: businessStatus.key,
      statusLabel: businessStatus.label,
      pricePerInch: businessStatus.pricePerInch,
      businessPricePerInch: settings.businessPricePerInch,
      status: businessStatus,
      assignment: null,
    }
  }

  const pricePerInch =
    assignment.pricePerInchOverride && assignment.pricePerInchOverride > 0
      ? assignment.pricePerInchOverride
      : matchedStatus.pricePerInch > 0
        ? matchedStatus.pricePerInch
        : settings.businessPricePerInch

  return {
    enabled: settings.enabled,
    customerId,
    customerType: 'vip',
    statusKey: matchedStatus.key,
    statusLabel: matchedStatus.label,
    pricePerInch,
    businessPricePerInch: settings.businessPricePerInch,
    status: matchedStatus,
    assignment,
  }
}

export function extractVipUploadMeasurement(uploadItems: Array<{ preflightStatus?: string | null; preflightResult?: unknown }>): VipUploadMeasurement | null {
  for (const item of uploadItems) {
    const lifecycle = deriveUploadItemLifecycle(item)

    if (lifecycle.measurementStatus !== 'ready' || !lifecycle.metadata) {
      continue
    }

    return {
      widthPx: lifecycle.metadata.widthPx,
      heightPx: lifecycle.metadata.heightPx,
      measurementWidthPx: lifecycle.metadata.measurementWidthPx,
      measurementHeightPx: lifecycle.metadata.measurementHeightPx,
      effectiveDpi: lifecycle.metadata.effectiveDpi,
      widthIn: lifecycle.metadata.widthIn,
      heightIn: lifecycle.metadata.heightIn,
      measurementMode: lifecycle.metadata.measurementMode,
    }
  }

  return null
}

export function calculateVipQuote(
  measurement: VipUploadMeasurement,
  pricePerInch: number
): VipQuote {
  const pageWidthIn = Number(Math.min(measurement.widthIn, measurement.heightIn).toFixed(2))
  const pageLengthIn = Number(Math.max(measurement.widthIn, measurement.heightIn).toFixed(2))
  const rate = Number(pricePerInch) || DEFAULT_BUSINESS_PRICE_PER_INCH
  const totalPrice = Number((pageLengthIn * rate).toFixed(2))

  return {
    pageWidthIn,
    pageLengthIn,
    pricePerInch: Number(rate.toFixed(4)),
    totalPrice,
    formattedTotalPrice: totalPrice.toFixed(2),
  }
}

export function validateVipQuoteAgainstLimits(
  quote: VipQuote,
  limits: BuilderLimits | null | undefined
): VipQuoteValidationResult {
  const maxWidthIn = toPositiveNumber(limits?.maxWidthIn, DEFAULT_MAX_WIDTH_IN) || DEFAULT_MAX_WIDTH_IN
  const maxHeightIn = toPositiveNumber(limits?.maxHeightIn, DEFAULT_MAX_HEIGHT_IN) || DEFAULT_MAX_HEIGHT_IN
  const minWidthIn = toPositiveNumber(limits?.minWidthIn, 1) || 1
  const minHeightIn = toPositiveNumber(limits?.minHeightIn, 1) || 1
  const epsilon = 0.001

  if (quote.pageWidthIn + epsilon < minWidthIn) {
    return {
      ok: false,
      code: 'WIDTH_TOO_SMALL',
      reason: `VIP design width must be at least ${minWidthIn.toFixed(2)}".`,
    }
  }

  if (quote.pageLengthIn + epsilon < minHeightIn) {
    return {
      ok: false,
      code: 'LENGTH_TOO_SMALL',
      reason: `VIP design length must be at least ${minHeightIn.toFixed(2)}".`,
    }
  }

  if (quote.pageWidthIn > maxWidthIn + epsilon) {
    return {
      ok: false,
      code: 'WIDTH_TOO_LARGE',
      reason: `VIP design width exceeds the configured limit of ${maxWidthIn.toFixed(2)}".`,
    }
  }

  if (quote.pageLengthIn > maxHeightIn + epsilon) {
    return {
      ok: false,
      code: 'LENGTH_TOO_LARGE',
      reason: `VIP design length exceeds the configured limit of ${maxHeightIn.toFixed(2)}".`,
    }
  }

  return {
    ok: true,
    code: null,
    reason: null,
  }
}
