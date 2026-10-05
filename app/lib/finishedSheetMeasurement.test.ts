import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIT_TOLERANCE_IN,
  DEFAULT_MAX_PRINTABLE_LENGTH_IN,
  DEFAULT_MAX_PRINTABLE_WIDTH_IN,
  resolveFinishedSheetSettings,
  validateFinishedSheetFit,
} from './finishedSheetMeasurement'

describe('finished-sheet measurement settings', () => {
  it('materializes the three visible defaults and ignores hidden legacy sizing fields', () => {
    expect(resolveFinishedSheetSettings(null)).toEqual({
      maxPrintableWidthIn: DEFAULT_MAX_PRINTABLE_WIDTH_IN,
      maxPrintableLengthIn: DEFAULT_MAX_PRINTABLE_LENGTH_IN,
      fitToleranceIn: DEFAULT_FIT_TOLERANCE_IN,
    })

    expect(
      resolveFinishedSheetSettings({
        rollWidthIn: 18,
        maxWidthIn: 19,
        maxHeightIn: 20,
        artboardMarginIn: 1,
        imageMarginIn: 1,
      })
    ).toEqual({
      maxPrintableWidthIn: 22.5,
      maxPrintableLengthIn: 240,
      fitToleranceIn: 0.02,
    })
  })

  it('uses only merchant-visible canonical values when they are saved', () => {
    expect(
      resolveFinishedSheetSettings({
        maxPrintableWidthIn: 21.75,
        maxPrintableLengthIn: 180,
        fitToleranceIn: 0.01,
        rollWidthIn: 17,
      })
    ).toEqual({
      maxPrintableWidthIn: 21.75,
      maxPrintableLengthIn: 180,
      fitToleranceIn: 0.01,
    })
  })
})

describe('finished-sheet physical limits', () => {
  const limits = {
    maxPrintableWidthIn: 22.5,
    maxPrintableLengthIn: 240,
    fitToleranceIn: 0.02,
  }

  it('accepts the exact limit and export-rounding overflow without changing measured dimensions', () => {
    expect(validateFinishedSheetFit({ widthIn: 22.5, heightIn: 240, ...limits })).toEqual({
      ok: true,
      widthIn: 22.5,
      lengthIn: 240,
    })

    expect(validateFinishedSheetFit({ widthIn: 240.019, heightIn: 22.503, ...limits })).toEqual({
      ok: true,
      widthIn: 22.503,
      lengthIn: 240.019,
    })
  })

  it('rejects material width overflow and reports both the file width and press limit', () => {
    const result = validateFinishedSheetFit({ widthIn: 80, heightIn: 23.91, ...limits })

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({
      code: 'WIDTH_TOO_LARGE',
      widthIn: 23.91,
      lengthIn: 80,
      maxPrintableWidthIn: 22.5,
    })
    if (result.ok) throw new Error('Expected a width failure')
    expect(result.message).toContain('23.91')
    expect(result.message).toContain('22.5')
  })

  it('rejects material custom-length overflow instead of splitting the file', () => {
    const result = validateFinishedSheetFit({ widthIn: 22, heightIn: 240.03, ...limits })

    expect(result).toMatchObject({
      ok: false,
      code: 'LENGTH_TOO_LARGE',
      widthIn: 22,
      lengthIn: 240.03,
      maxPrintableLengthIn: 240,
    })
  })

  // Billing is ceil(lengthIn * copies), so the orientation decides the price.
  // Reported by a legendtransfers customer on 2026-10-05: a 22x11 sheet billed
  // 22 inches instead of 11 — the same print for double the money.
  it('turns a sheet that fits both ways so the shorter side is billed', () => {
    const result = validateFinishedSheetFit({ widthIn: 22, heightIn: 11, ...limits })

    expect(result).toEqual({ ok: true, widthIn: 22, lengthIn: 11 })
  })

  it('bills the same whichever way the measurement arrives', () => {
    const asMeasured = validateFinishedSheetFit({ widthIn: 22, heightIn: 11, ...limits })
    const rotated = validateFinishedSheetFit({ widthIn: 11, heightIn: 22, ...limits })

    expect(rotated).toEqual(asMeasured)
  })

  it('keeps the only feasible orientation when the long side cannot cross the roll', () => {
    const result = validateFinishedSheetFit({ widthIn: 22, heightIn: 240, ...limits })

    expect(result).toEqual({ ok: true, widthIn: 22, lengthIn: 240 })
  })

  it('leaves a square sheet alone', () => {
    const result = validateFinishedSheetFit({ widthIn: 18, heightIn: 18, ...limits })

    expect(result).toEqual({ ok: true, widthIn: 18, lengthIn: 18 })
  })

  it('still reports the narrower side when neither side crosses the roll', () => {
    const result = validateFinishedSheetFit({ widthIn: 30, heightIn: 40, ...limits })

    expect(result).toMatchObject({ ok: false, code: 'WIDTH_TOO_LARGE', widthIn: 30, lengthIn: 40 })
  })

  it('turns a sheet right up to the fit tolerance', () => {
    const result = validateFinishedSheetFit({ widthIn: 22.52, heightIn: 9, ...limits })

    expect(result).toEqual({ ok: true, widthIn: 22.52, lengthIn: 9 })
  })
})
