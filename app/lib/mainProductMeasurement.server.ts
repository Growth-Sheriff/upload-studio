import {
  computeRollWidthAnchoredInches,
  resolveBestDimensions,
  type RollWidthSheetSize,
} from './uploadLifecycle.server'
import type { ProductVariantDef } from './dtfSheetResolver.server'

export const MAIN_PRODUCT_MEASUREMENT_POLICY = 'main_product_roll_width'
export const DEFAULT_MAIN_PRODUCT_ROLL_WIDTH_IN = 22
export const MIN_MAIN_PRODUCT_ROLL_WIDTH_IN = 0.1
export const MAX_MAIN_PRODUCT_ROLL_WIDTH_IN = 120

interface MainProductMeasurementLike {
  widthPx: number
  heightPx: number
  measurementWidthPx: number
  measurementHeightPx: number
  dpi: number
  documentDpi?: number
  documentDpiSource?: string | null
  effectiveDpi: number
  sizingSource: string | null
  sheetWidthIn?: number
  sheetLengthIn?: number
  widthIn: number
  heightIn: number
  measurementMode: string | null
}

export interface MainProductMeasurementOptions {
  measurementPolicy?: string | null
  rollWidthIn?: number | string | null
  sheetSizes?: RollWidthSheetSize[]
}

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function parseValidRollWidth(value: unknown): number {
  const parsed = parsePositiveNumber(value)
  return parsed >= MIN_MAIN_PRODUCT_ROLL_WIDTH_IN && parsed <= MAX_MAIN_PRODUCT_ROLL_WIDTH_IN
    ? parsed
    : 0
}

export function shouldUseMainProductMeasurementPolicy(value: unknown): boolean {
  return String(value || '').trim() === MAIN_PRODUCT_MEASUREMENT_POLICY
}

export function resolveUploadIntentMeasurementBasis(
  runtimeBasis: 'full_page' | 'artwork_bounds',
  requestedPolicy: unknown
): 'full_page' | 'artwork_bounds' {
  // This hint can only select the more conservative full-page path. It never
  // authorizes a roll width, sheet snap, variant, or price.
  return shouldUseMainProductMeasurementPolicy(requestedPolicy) ? 'full_page' : runtimeBasis
}

export function getMainProductRollWidth(value: unknown): number {
  return parseValidRollWidth(value) || DEFAULT_MAIN_PRODUCT_ROLL_WIDTH_IN
}

export function resolveServerMainProductRollWidth(
  builderConfig: Record<string, unknown> | null | undefined,
  options: {
    policyExplicit?: boolean
    maxSheetWidthIn?: number | string | null
  } = {}
): number {
  const configured = parseValidRollWidth(builderConfig?.rollWidthIn)
  // rollWidthIn is the explicit, purpose-built setting. Before that field
  // existed the worker supplied maxWidthIn and maxHeightIn, and the preflight
  // anchor used the shorter valid side. Reproduce that exact fallback until a
  // merchant explicitly saves rollWidthIn.
  const legacyMaxWidth = parseValidRollWidth(builderConfig?.maxWidthIn)
  const legacyMaxHeight = parseValidRollWidth(builderConfig?.maxHeightIn)
  const legacyConfiguredWidth =
    legacyMaxWidth > 0 && legacyMaxHeight > 0
      ? Math.min(legacyMaxWidth, legacyMaxHeight)
      : legacyMaxWidth || legacyMaxHeight
  const legacyWidth = configured || legacyConfiguredWidth || DEFAULT_MAIN_PRODUCT_ROLL_WIDTH_IN
  const policyLimit = parseValidRollWidth(options.maxSheetWidthIn)

  return options.policyExplicit && policyLimit > 0
    ? Math.min(legacyWidth, policyLimit)
    : legacyWidth
}

function parseSheetSize(value: unknown): RollWidthSheetSize | null {
  if (!value) return null

  const cleaned = String(value)
    .replace(/["'\u2032\u2033]/g, '')
    .replace(/\binch(es)?\b/gi, '')
    .replace(/\bin\b/gi, '')
    .trim()

  let match = cleaned.match(/(\d+(?:\.\d+)?)\s*[x\u00d7X]\s*(\d+(?:\.\d+)?)/)
  if (!match) {
    match = cleaned.match(/(\d+(?:\.\d+)?)\s*by\s*(\d+(?:\.\d+)?)/i)
  }
  if (!match) {
    const numbers = cleaned.match(/(\d+(?:\.\d+)?)/g)
    if (numbers && numbers.length >= 2) {
      match = [numbers.join(' '), numbers[0], numbers[1]]
    }
  }
  if (!match) return null

  const widthIn = parseFloat(match[1])
  const heightIn = parseFloat(match[2])
  if (!(widthIn > 0) || !(heightIn > 0)) return null
  return { widthIn, heightIn }
}

export function getMainProductSheetSizes(variants: ProductVariantDef[]): RollWidthSheetSize[] {
  const seen = new Set<string>()
  const sizes: RollWidthSheetSize[] = []

  for (const variant of variants) {
    const values = [
      variant.title,
      variant.option1,
      variant.option2,
      variant.option3,
      ...(variant.options || []),
      ...(variant.selectedOptions || []).map((option) => option.value),
    ]

    for (const value of values) {
      const parsed = parseSheetSize(value)
      if (!parsed) continue
      const key = `${parsed.widthIn}x${parsed.heightIn}`
      if (seen.has(key)) continue
      seen.add(key)
      sizes.push(parsed)
    }
  }

  return sizes
}

function getFullCanvasPixels(measurement: MainProductMeasurementLike) {
  return {
    widthPx: measurement.widthPx > 0 ? measurement.widthPx : measurement.measurementWidthPx,
    heightPx: measurement.heightPx > 0 ? measurement.heightPx : measurement.measurementHeightPx,
  }
}

function getDocumentDpi(measurement: MainProductMeasurementLike): number {
  return (
    parsePositiveNumber(measurement.documentDpi) ||
    (measurement.documentDpiSource ? parsePositiveNumber(measurement.dpi) : 0)
  )
}

export function applyMainProductMeasurementPolicy<T extends MainProductMeasurementLike>(
  measurement: T,
  options: MainProductMeasurementOptions
): T
export function applyMainProductMeasurementPolicy<T extends MainProductMeasurementLike>(
  measurement: T | null,
  options: MainProductMeasurementOptions
): T | null
export function applyMainProductMeasurementPolicy<T extends MainProductMeasurementLike>(
  measurement: T | null,
  options: MainProductMeasurementOptions
): T | null {
  if (!measurement) return null
  if (!shouldUseMainProductMeasurementPolicy(options.measurementPolicy)) return measurement

  const { widthPx, heightPx } = getFullCanvasPixels(measurement)
  const rollWidthIn = getMainProductRollWidth(
    options.rollWidthIn ?? measurement.sheetWidthIn
  )
  const documentDpi = getDocumentDpi(measurement)
  const anchored = computeRollWidthAnchoredInches(
    widthPx,
    heightPx,
    rollWidthIn,
    options.sheetSizes || []
  )
  const resolved = resolveBestDimensions(
    widthPx,
    heightPx,
    documentDpi,
    anchored,
    'sheet_width_anchor'
  )

  return {
    ...measurement,
    ...(documentDpi > 0
      ? {
          dpi: documentDpi,
          documentDpi,
          documentDpiSource: measurement.documentDpiSource || 'document_dpi',
        }
      : {}),
    measurementWidthPx: widthPx,
    measurementHeightPx: heightPx,
    effectiveDpi: resolved.effectiveDpi,
    sizingSource: resolved.sizingSource,
    sheetWidthIn: resolved.sheetWidthIn,
    sheetLengthIn: resolved.sheetLengthIn,
    widthIn: resolved.widthIn,
    heightIn: resolved.heightIn,
    measurementMode: 'full',
  }
}
