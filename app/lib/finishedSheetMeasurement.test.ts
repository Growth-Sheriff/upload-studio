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
})
