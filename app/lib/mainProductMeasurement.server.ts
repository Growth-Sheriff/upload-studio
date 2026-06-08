import {
  computeDocumentDpiInches,
  computeRollWidthAnchoredInches,
  type RollWidthSheetSize,
} from './uploadLifecycle.server'
import type { ProductVariantDef } from './dtfSheetResolver.server'

export const MAIN_PRODUCT_MEASUREMENT_POLICY = 'main_product_roll_width'
export const DEFAULT_MAIN_PRODUCT_ROLL_WIDTH_IN = 22

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

export function shouldUseMainProductMeasurementPolicy(value: unknown): boolean {
  return String(value || '').trim() === MAIN_PRODUCT_MEASUREMENT_POLICY
}

export function getMainProductRollWidth(value: unknown): number {
  return parsePositiveNumber(value) || DEFAULT_MAIN_PRODUCT_ROLL_WIDTH_IN
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

function hasUsableInches(measurement: MainProductMeasurementLike): boolean {
  return measurement.widthIn > 0 && measurement.heightIn > 0
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
  const rollWidthIn = getMainProductRollWidth(options.rollWidthIn)
  const source = String(measurement.sizingSource || '').trim()

  const documentDpi = getDocumentDpi(measurement)
  const documentSized = computeDocumentDpiInches(widthPx, heightPx, documentDpi || undefined)
  if (documentSized && documentDpi) {
    return {
      ...measurement,
      dpi: documentDpi,
      documentDpi,
      documentDpiSource: measurement.documentDpiSource || 'document_dpi',
      measurementWidthPx: widthPx,
      measurementHeightPx: heightPx,
      effectiveDpi: documentSized.effectiveDpi,
      sizingSource: 'document_dpi',
      sheetWidthIn: rollWidthIn,
      sheetLengthIn: undefined,
      widthIn: documentSized.widthIn,
      heightIn: documentSized.heightIn,
      measurementMode: 'full',
    }
  }

  if (source === 'adobe_default_dpi' && hasUsableInches(measurement)) {
    return {
      ...measurement,
      measurementWidthPx: widthPx,
      measurementHeightPx: heightPx,
      sheetWidthIn: rollWidthIn,
      sheetLengthIn: measurement.sheetLengthIn,
      measurementMode: 'full',
    }
  }

  const anchored = computeRollWidthAnchoredInches(
    widthPx,
    heightPx,
    rollWidthIn,
    options.sheetSizes || []
  )

  return {
    ...measurement,
    measurementWidthPx: widthPx,
    measurementHeightPx: heightPx,
    effectiveDpi: anchored.effectiveDpi,
    sizingSource: 'sheet_width_anchor',
    sheetWidthIn: anchored.sheetWidthIn,
    sheetLengthIn: anchored.sheetLengthIn,
    widthIn: anchored.widthIn,
    heightIn: anchored.heightIn,
    measurementMode: 'full',
  }
}
