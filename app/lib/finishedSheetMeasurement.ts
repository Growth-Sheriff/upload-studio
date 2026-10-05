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

/**
 * Pick which measured side runs across the roll.
 *
 * `normalizeFinishedSheet` cannot answer this: it never sees the roll, so it
 * always calls the short side the width and the long side the length. That is
 * right for a sheet taller than the roll is wide — there is only one way to
 * feed it — but when BOTH sides fit across the roll the sheet can be turned,
 * and turning it changes the bill. Billing is `ceil(lengthIn * copies)`, so the
 * cheaper orientation is the one that puts the LONGER side across the roll and
 * leaves the shorter side as the length.
 *
 * A 22in x 11in sheet on a 22.5in roll is the case customers reported
 * (legendtransfers, 2026-10-05): fed as 11 wide it bills 22 inches, fed as 22
 * wide it bills 11 — the same print for double the money. Long sheets never
 * showed it because only one orientation fits, which is why it read as "large
 * orders are fine".
 *
 * Returns null when neither side fits across the roll; the caller reports that
 * as WIDTH_TOO_LARGE using the narrower side, the sheet's best case.
 */
export function chooseFinishedSheetOrientation(
  firstDimensionIn: number,
  secondDimensionIn: number,
  maxPrintableWidthIn: number,
  fitToleranceIn: number
): NormalizedFinishedSheet | null {
  const bounds = normalizeFinishedSheet(firstDimensionIn, secondDimensionIn)
  if (!bounds) return null

  const longSideFits = isWithinFinishedSheetLimit(
    bounds.lengthIn,
    maxPrintableWidthIn,
    fitToleranceIn
  )
  if (longSideFits) {
    // Both sides fit across the roll. Turn the sheet so the long side runs
    // across it and only the short side is billed.
    return { widthIn: bounds.lengthIn, lengthIn: bounds.widthIn }
  }

  // Only the short side can run across the roll, if either can.
  return bounds
}

export function validateFinishedSheetFit(input: {
  widthIn: number
  heightIn: number
  maxPrintableWidthIn: number
  maxPrintableLengthIn?: number | null
  fitToleranceIn: number
}): FinishedSheetFitResult {
  const normalized = chooseFinishedSheetOrientation(
    input.widthIn,
    input.heightIn,
    input.maxPrintableWidthIn,
    input.fitToleranceIn
  )
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
