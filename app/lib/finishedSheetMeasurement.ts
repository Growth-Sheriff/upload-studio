export const DEFAULT_MAX_PRINTABLE_WIDTH_IN = 22.5
export const DEFAULT_MAX_PRINTABLE_LENGTH_IN = 240
export const DEFAULT_FIT_TOLERANCE_IN = 0.02

export const MIN_PRINTABLE_WIDTH_IN = 0.1
export const MAX_PRINTABLE_WIDTH_IN = 120
export const MIN_PRINTABLE_LENGTH_IN = 1
export const MAX_PRINTABLE_LENGTH_IN = 10_000
export const MIN_FIT_TOLERANCE_IN = 0.01
export const MAX_FIT_TOLERANCE_IN = 0.03

export interface FinishedSheetSettings {
  maxPrintableWidthIn: number
  maxPrintableLengthIn: number
  fitToleranceIn: number
}

export interface NormalizedFinishedSheet {
  widthIn: number
  lengthIn: number
}

export interface FinishedSheetWidthFailure extends NormalizedFinishedSheet {
  ok: false
  code: 'WIDTH_TOO_LARGE'
  maxPrintableWidthIn: number
  fitToleranceIn: number
  message: string
}

export interface FinishedSheetLengthFailure extends NormalizedFinishedSheet {
  ok: false
  code: 'LENGTH_TOO_LARGE'
  maxPrintableLengthIn: number
  fitToleranceIn: number
  message: string
}

export type FinishedSheetFitFailure = FinishedSheetWidthFailure | FinishedSheetLengthFailure

export type FinishedSheetFitResult =
  | ({ ok: true } & NormalizedFinishedSheet)
  | FinishedSheetFitFailure

function numberInRange(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

/**
 * Resolve only merchant-visible settings. Hidden legacy maxWidth/maxHeight and
 * margin fields are intentionally ignored: they were never a merchant choice.
 * Missing canonical values materialize as the visible defaults below.
 */
export function resolveFinishedSheetSettings(
  builderConfig: Record<string, unknown> | null | undefined
): FinishedSheetSettings {
  const maxPrintableWidthIn =
    numberInRange(
      builderConfig?.maxPrintableWidthIn,
      MIN_PRINTABLE_WIDTH_IN,
      MAX_PRINTABLE_WIDTH_IN
    ) ||
    DEFAULT_MAX_PRINTABLE_WIDTH_IN

  return {
    maxPrintableWidthIn,
    maxPrintableLengthIn:
      numberInRange(
        builderConfig?.maxPrintableLengthIn,
        MIN_PRINTABLE_LENGTH_IN,
        MAX_PRINTABLE_LENGTH_IN
      ) || DEFAULT_MAX_PRINTABLE_LENGTH_IN,
    fitToleranceIn:
      numberInRange(
        builderConfig?.fitToleranceIn,
        MIN_FIT_TOLERANCE_IN,
        MAX_FIT_TOLERANCE_IN
      ) || DEFAULT_FIT_TOLERANCE_IN,
  }
}

export function normalizeFinishedSheet(
  firstDimensionIn: number,
  secondDimensionIn: number
): NormalizedFinishedSheet | null {
  const first = Number(firstDimensionIn)
  const second = Number(secondDimensionIn)
  if (!(first > 0) || !(second > 0) || !Number.isFinite(first) || !Number.isFinite(second)) {
    return null
  }
  return {
    widthIn: Math.min(first, second),
    lengthIn: Math.max(first, second),
  }
}

export function isWithinFinishedSheetLimit(
  measuredIn: number,
  limitIn: number,
  fitToleranceIn: number
): boolean {
  if (!(measuredIn > 0) || !(limitIn > 0) || !(fitToleranceIn >= 0)) return false
  // The epsilon prevents binary floating-point noise from rejecting an exact
  // `limit + tolerance` boundary. It is far below a physical pixel at any
  // supported DPI and is not an additional fit allowance.
  return measuredIn <= limitIn + fitToleranceIn + Number.EPSILON * 16
}

export function formatFinishedSheetInches(value: number): string {
  return Number(Number(value).toFixed(4)).toString()
}

export function validateFinishedSheetFit(input: {
  widthIn: number
  heightIn: number
  maxPrintableWidthIn: number
  maxPrintableLengthIn?: number | null
  fitToleranceIn: number
}): FinishedSheetFitResult {
  const normalized = normalizeFinishedSheet(input.widthIn, input.heightIn)
  if (!normalized) {
    return {
      ok: false,
      code: 'WIDTH_TOO_LARGE',
      widthIn: 0,
      lengthIn: 0,
      maxPrintableWidthIn: input.maxPrintableWidthIn,
      fitToleranceIn: input.fitToleranceIn,
      message: 'The file does not contain a measurable width and length.',
    }
  }

  if (
    !isWithinFinishedSheetLimit(
      normalized.widthIn,
      input.maxPrintableWidthIn,
      input.fitToleranceIn
    )
  ) {
    return {
      ok: false,
      code: 'WIDTH_TOO_LARGE',
      ...normalized,
      maxPrintableWidthIn: input.maxPrintableWidthIn,
      fitToleranceIn: input.fitToleranceIn,
      message: `Your file is ${formatFinishedSheetInches(normalized.widthIn)} inches wide; maximum printable width is ${formatFinishedSheetInches(input.maxPrintableWidthIn)} inches.`,
    }
  }

  const maxPrintableLengthIn = Number(input.maxPrintableLengthIn)
  if (
    maxPrintableLengthIn > 0 &&
    !isWithinFinishedSheetLimit(
      normalized.lengthIn,
      maxPrintableLengthIn,
      input.fitToleranceIn
    )
  ) {
    return {
      ok: false,
      code: 'LENGTH_TOO_LARGE',
      ...normalized,
      maxPrintableLengthIn,
      fitToleranceIn: input.fitToleranceIn,
      message: `Your file is ${formatFinishedSheetInches(normalized.lengthIn)} inches long; maximum printable length is ${formatFinishedSheetInches(maxPrintableLengthIn)} inches.`,
    }
  }

  return { ok: true, ...normalized }
}
