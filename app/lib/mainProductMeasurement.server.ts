import {
  computePrintableWidthAnchoredInches,
  resolveBestDimensions,
  type FinishedSheetSize,
} from './uploadLifecycle.server'
import type { ProductVariantDef } from './dtfSheetResolver.server'

export const FINISHED_SHEET_MEASUREMENT_POLICY = 'finished_sheet'
const LEGACY_FINISHED_SHEET_MEASUREMENT_POLICY = 'main_product_roll_width'

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
  maxPrintableWidthIn: number
  fitToleranceIn: number
  sheetSizes?: FinishedSheetSize[]
}

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function shouldUseFinishedSheetMeasurementPolicy(value: unknown): boolean {
  const normalized = String(value || '').trim()
  return (
    normalized === FINISHED_SHEET_MEASUREMENT_POLICY ||
    normalized === LEGACY_FINISHED_SHEET_MEASUREMENT_POLICY
  )
}

export function resolveUploadIntentMeasurementBasis(
  runtimeBasis: 'full_page' | 'artwork_bounds',
  requestedPolicy: unknown
): 'full_page' | 'artwork_bounds' {
  // This hint can only select the more conservative full-page path. It never
  // authorizes a physical limit, sheet snap, variant, or price.
  return shouldUseFinishedSheetMeasurementPolicy(requestedPolicy) ? 'full_page' : runtimeBasis
}

function parseSheetSize(value: unknown): FinishedSheetSize | null {
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

export function getFinishedSheetSizes(variants: ProductVariantDef[]): FinishedSheetSize[] {
  const seen = new Set<string>()
  const sizes: FinishedSheetSize[] = []

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
  const candidate =
    parsePositiveNumber(measurement.documentDpi) ||
    (measurement.documentDpiSource ? parsePositiveNumber(measurement.dpi) : 0)
  return candidate > 1 && candidate <= 10_000 ? candidate : 0
}

export function applyFinishedSheetMeasurementPolicy<T extends MainProductMeasurementLike>(
  measurement: T,
  options: MainProductMeasurementOptions
): T
export function applyFinishedSheetMeasurementPolicy<T extends MainProductMeasurementLike>(
  measurement: T | null,
  options: MainProductMeasurementOptions
): T | null
export function applyFinishedSheetMeasurementPolicy<T extends MainProductMeasurementLike>(
  measurement: T | null,
  options: MainProductMeasurementOptions
): T | null {
  if (!measurement) return null
  if (!shouldUseFinishedSheetMeasurementPolicy(options.measurementPolicy)) return measurement

  const { widthPx, heightPx } = getFullCanvasPixels(measurement)
  const documentDpi = getDocumentDpi(measurement)
  const hadInvalidDocumentDpi =
    (parsePositiveNumber(measurement.documentDpi) > 0 ||
      Boolean(measurement.documentDpiSource && parsePositiveNumber(measurement.dpi) > 0)) &&
    !(documentDpi > 0)
  const anchored = computePrintableWidthAnchoredInches(
    widthPx,
    heightPx,
    options.maxPrintableWidthIn,
    options.sheetSizes || [],
    options.fitToleranceIn
  )
  const resolved = resolveBestDimensions(
    widthPx,
    heightPx,
    documentDpi,
    anchored,
    'max_printable_width_anchor',
    options.fitToleranceIn
  )

  return {
    ...measurement,
    ...(documentDpi > 0
      ? {
          dpi: documentDpi,
          documentDpi,
          documentDpiSource: measurement.documentDpiSource || 'document_dpi',
        }
      : hadInvalidDocumentDpi
        ? {
            dpi: resolved.effectiveDpi,
            documentDpi: 0,
            documentDpiSource: null,
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
