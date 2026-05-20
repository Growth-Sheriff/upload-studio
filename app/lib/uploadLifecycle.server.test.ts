import { describe, expect, it } from 'vitest'
import {
  applyFullCanvasMeasurementMetadata,
  computeDocumentDpiInches,
  computeRollWidthAnchoredInches,
  computeSheetAnchoredInches,
  deriveUploadItemLifecycle,
} from './uploadLifecycle.server'

describe('computeSheetAnchoredInches', () => {



  it('anchors portrait artwork to a 22" sheet width and derives length from ratio', () => {

    const result = computeSheetAnchoredInches(1584, 4320, 22)
    expect(result.widthIn).toBe(22)
    expect(result.heightIn).toBe(60)
    expect(result.effectiveDpi).toBe(72)
    expect(result.sheetWidthIn).toBe(22)
  })

  it('anchors landscape artwork by swapping sides — long side gets the length', () => {
    const result = computeSheetAnchoredInches(4320, 1584, 22)
    expect(result.widthIn).toBe(60)
    expect(result.heightIn).toBe(22)
  })

  it('handles square artwork as a 22"x22" sheet', () => {
    const result = computeSheetAnchoredInches(2200, 2200, 22)
    expect(result.widthIn).toBe(22)
    expect(result.heightIn).toBe(22)
    expect(result.effectiveDpi).toBe(100)
  })

  it('produces the same physical size whether artwork is 72 DPI or 300 DPI as long as ratio matches', () => {

    const lowDpi = computeSheetAnchoredInches(1584, 4320, 22)
    const highDpi = computeSheetAnchoredInches(6600, 18000, 22)
    expect(highDpi.widthIn).toBe(lowDpi.widthIn)
    expect(highDpi.heightIn).toBe(lowDpi.heightIn)
    expect(highDpi.effectiveDpi).toBe(300)
    expect(lowDpi.effectiveDpi).toBe(72)
  })

  it('falls back to 22" sheet width when none provided', () => {
    const result = computeSheetAnchoredInches(1584, 4320)
    expect(result.sheetWidthIn).toBe(22)
    expect(result.heightIn).toBe(60)
  })

  it('honors a non-default sheet width (e.g. 24" press)', () => {
    const result = computeSheetAnchoredInches(1584, 4320, 24)
    expect(result.widthIn).toBe(24)

    expect(result.heightIn).toBeCloseTo(65.45, 1)
  })

  it('returns zeros for invalid pixel dimensions', () => {
    expect(computeSheetAnchoredInches(0, 4320, 22).widthIn).toBe(0)
    expect(computeSheetAnchoredInches(1584, 0, 22).heightIn).toBe(0)
    expect(computeSheetAnchoredInches(-1, -1, 22).effectiveDpi).toBe(0)
  })

  it('rejects negative or zero sheet widths and uses default', () => {
    const r = computeSheetAnchoredInches(1584, 4320, 0)
    expect(r.sheetWidthIn).toBe(22)
    expect(r.heightIn).toBe(60)
  })


  it('reports correct dimensions for a landscape file on a fixed-size 22"x12" sheet', () => {

    const result = computeSheetAnchoredInches(2904, 1584, 22, 12)
    expect(result.widthIn).toBe(22)
    expect(result.heightIn).toBe(12)
    expect(result.effectiveDpi).toBe(132)
    expect(result.sheetWidthIn).toBe(22)
    expect(result.sheetLengthIn).toBe(12)
  })

  it('reports correct dimensions for a portrait file on a fixed-size 22"x12" sheet', () => {

    const result = computeSheetAnchoredInches(1584, 2904, 22, 12)
    expect(result.widthIn).toBe(12)
    expect(result.heightIn).toBe(22)
    expect(result.effectiveDpi).toBe(132)
  })

  it('still treats variable-length sheet correctly when sheetLengthIn is undefined', () => {

    const result = computeSheetAnchoredInches(1584, 4320, 22)
    expect(result.widthIn).toBe(22)
    expect(result.heightIn).toBe(60)
    expect(result.sheetLengthIn).toBeUndefined()
  })

  it('uses shorter of two sheet dims even if caller passes them in opposite order', () => {

    const result = computeSheetAnchoredInches(2904, 1584, 12, 22)

    expect(result.heightIn).toBe(12)
    expect(result.widthIn).toBe(22)
  })
})

describe('computeRollWidthAnchoredInches', () => {
  it('snaps exact 22x12 sheet-ratio uploads to 22"x12" instead of forcing the short side to 22"', () => {
    const result = computeRollWidthAnchoredInches(6600, 3600, 22, [{ widthIn: 22, heightIn: 12 }])
    expect(result.widthIn).toBe(22)
    expect(result.heightIn).toBe(12)
    expect(result.effectiveDpi).toBe(300)
    expect(result.sheetLengthIn).toBe(12)
  })

  it('keeps variable-length uploads anchored to a 22" short side when no exact sheet ratio matches', () => {
    const result = computeRollWidthAnchoredInches(6485, 2605, 22, [
      { widthIn: 22, heightIn: 48 },
      { widthIn: 22, heightIn: 60 },
    ])
    expect(result.widthIn).toBe(54.77)
    expect(result.heightIn).toBe(22)
    expect(result.effectiveDpi).toBe(118)
  })
})

describe('applyFullCanvasMeasurementMetadata — sheet anchor preserved', () => {
  it('recomputes inch dims from full-canvas pixels via sheet anchor (not DPI)', () => {
    const result = applyFullCanvasMeasurementMetadata({
      widthPx: 1584,
      heightPx: 4320,
      dpi: 0,
      trimmedWidthPx: 1500,
      trimmedHeightPx: 4000,
      trimmedOffsetXPx: 10,
      trimmedOffsetYPx: 20,
      measurementWidthPx: 1500,
      measurementHeightPx: 4000,
      effectiveDpi: 0,
      sizingSource: null,
      sheetWidthIn: 22,
      widthIn: 0,
      heightIn: 0,
      measurementMode: 'trimmed',
    })

    expect(result?.measurementWidthPx).toBe(1584)
    expect(result?.measurementHeightPx).toBe(4320)
    expect(result?.widthIn).toBe(22)
    expect(result?.heightIn).toBe(60)
    expect(result?.measurementMode).toBe('full')
    expect(result?.sizingSource).toBe('sheet_width_anchor')
  })

  it('returns null when input is null', () => {
    expect(applyFullCanvasMeasurementMetadata(null)).toBeNull()
  })
})

describe('deriveUploadItemLifecycle — pricing path produces correct length', () => {
  it('derives 22"x60" inches from 1584x4320 px artwork via dimensions check details', () => {
    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: 'ok',
      preflightResult: {
        overall: 'ok',
        checks: [
          {
            name: 'dimensions',
            status: 'ok',
            value: '1584x4320',
            details: {
              width: 1584,
              height: 4320,
              measurementWidth: 1584,
              measurementHeight: 4320,
              trimmedWidth: 1584,
              trimmedHeight: 4320,
              trimmedOffsetX: 0,
              trimmedOffsetY: 0,
              sheetWidthIn: 22,
              effectiveDpi: 72,
              sizingSource: 'sheet_width_anchor',
              measurementMode: 'full',
              widthIn: 22,
              heightIn: 60,
            },
          },
          { name: 'dpi', status: 'warning', value: 72 },
        ],
      },
      thumbnailKey: 'preview/key',
    })

    expect(lifecycle.metadata?.widthIn).toBe(22)
    expect(lifecycle.metadata?.heightIn).toBe(60)
    expect(lifecycle.metadata?.effectiveDpi).toBe(72)
    expect(lifecycle.metadata?.sheetWidthIn).toBe(22)
    expect(lifecycle.measurementStatus).toBe('ready')
  })

  it('does NOT use DPI fallback to compute inches when sheet anchor is available', () => {


    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: 'ok',
      preflightResult: {
        overall: 'ok',
        checks: [
          {
            name: 'dimensions',
            status: 'ok',
            value: '1584x4320',
            details: {
              width: 1584,
              height: 4320,
              measurementWidth: 1584,
              measurementHeight: 4320,


            },
          },
        ],
      },
      thumbnailKey: null,
    })

    expect(lifecycle.metadata?.widthIn).toBe(22)
    expect(lifecycle.metadata?.heightIn).toBe(60)

    expect(lifecycle.metadata?.widthIn).not.toBeCloseTo(7.92)
    expect(lifecycle.metadata?.heightIn).not.toBeCloseTo(21.6)
  })
})

describe('computeDocumentDpiInches', () => {
  it('uses embedded document DPI for a 22"x12" PNG instead of roll-width anchoring', () => {
    const result = computeDocumentDpiInches(6600, 3600, 300)

    expect(result?.widthIn).toBe(22)
    expect(result?.heightIn).toBe(12)
    expect(result?.effectiveDpi).toBe(300)
  })

  it('matches Adobe dimensions from embedded DPI for non-roll-width artwork', () => {
    const result = computeDocumentDpiInches(6485, 2605, 300)

    expect(result?.widthIn).toBe(21.62)
    expect(result?.heightIn).toBe(8.68)
  })

  it('rejects missing or implausible document DPI so callers can fall back', () => {
    expect(computeDocumentDpiInches(6485, 2605, 0)).toBeNull()
    expect(computeDocumentDpiInches(6485, 2605, 20000)).toBeNull()
  })
})

describe('lifecycle prefers document DPI over sheet anchor when present', () => {
  it('reads metreicin-style 118 DPI PNG as 54.77x22.00 (Adobe-exact), not 54.96x22.08 (anchored)', () => {
    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: 'ok',
      preflightResult: {
        overall: 'ok',
        checks: [
          {
            name: 'dimensions',
            status: 'ok',
            value: '6485x2605',
            details: {
              width: 6485,
              height: 2605,
              measurementWidth: 6485,
              measurementHeight: 2605,
              documentDpi: 118.4148,
              documentDpiSource: 'png_phys',
              embeddedDpi: 118.4148,
              embeddedDpiSource: 'png_phys',
              sheetWidthIn: 22,
            },
          },
        ],
      },
      thumbnailKey: 'preview/key',
    })

    expect(lifecycle.metadata?.widthIn).toBe(54.77)
    expect(lifecycle.metadata?.heightIn).toBe(22)
    expect(lifecycle.metadata?.sizingSource).toBe('document_dpi')
    expect(lifecycle.metadata?.documentDpi).toBeCloseTo(118.4148, 2)
    expect(lifecycle.metadata?.effectiveDpi).toBeCloseTo(118.4148, 2)
  })

  it('reads a 300 DPI PNG as its declared size (21.62x8.68), not anchored to 22"', () => {
    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: 'ok',
      preflightResult: {
        overall: 'ok',
        checks: [
          {
            name: 'dimensions',
            status: 'ok',
            value: '6485x2605',
            details: {
              width: 6485,
              height: 2605,
              measurementWidth: 6485,
              measurementHeight: 2605,
              documentDpi: 299.9994,
              documentDpiSource: 'png_phys',
              sheetWidthIn: 22,
            },
          },
        ],
      },
      thumbnailKey: 'preview/key',
    })

    expect(lifecycle.metadata?.widthIn).toBe(21.62)
    expect(lifecycle.metadata?.heightIn).toBe(8.68)
    expect(lifecycle.metadata?.sizingSource).toBe('document_dpi')
  })

  it('falls back to sheet anchor when documentDpi is missing (Genuity-style no-DPI PNG)', () => {
    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: 'ok',
      preflightResult: {
        overall: 'ok',
        checks: [
          {
            name: 'dimensions',
            status: 'ok',
            value: '1494x668',
            details: {
              width: 1494,
              height: 668,
              measurementWidth: 1494,
              measurementHeight: 668,
              sheetWidthIn: 22,
            },
          },
        ],
      },
      thumbnailKey: 'preview/key',
    })

    expect(lifecycle.metadata?.sizingSource).toBe('sheet_width_anchor')
    expect(lifecycle.metadata?.heightIn).toBe(22)
    expect(lifecycle.metadata?.documentDpi).toBe(0)
  })
})

describe('applyFullCanvasMeasurementMetadata — uses documentDpi when present', () => {
  it('overrides anchored dims with documentDpi-based dims when embedded DPI is reliable', () => {
    const result = applyFullCanvasMeasurementMetadata({
      widthPx: 6485,
      heightPx: 2605,
      dpi: 118.4148,
      documentDpi: 118.4148,
      documentDpiSource: 'png_phys',
      trimmedWidthPx: 6485,
      trimmedHeightPx: 2605,
      trimmedOffsetXPx: 0,
      trimmedOffsetYPx: 0,
      measurementWidthPx: 6485,
      measurementHeightPx: 2605,
      effectiveDpi: 0,
      sizingSource: null,
      sheetWidthIn: 22,
      widthIn: 0,
      heightIn: 0,
      measurementMode: 'full',
    })

    expect(result?.widthIn).toBe(54.77)
    expect(result?.heightIn).toBe(22)
    expect(result?.sizingSource).toBe('document_dpi')
  })
})
