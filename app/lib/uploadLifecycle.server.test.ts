import { describe, expect, it } from 'vitest'
import {
  applyFullCanvasMeasurementMetadata,
  computeSheetAnchoredInches,
  deriveUploadItemLifecycle,
} from './uploadLifecycle.server'

describe('computeSheetAnchoredInches', () => {
  // Pricing depends directly on these values. Each case here mirrors a real
  // gang-sheet artwork shape and the pricing-correct dimensions.

  it('anchors portrait artwork to a 22" sheet width and derives length from ratio', () => {
    // Randle_Lions_Back-60.png case — 1584x4320 with no embedded DPI
    const result = computeSheetAnchoredInches(1584, 4320, 22)
    expect(result.widthIn).toBe(22)
    expect(result.heightIn).toBe(60)
    expect(result.effectiveDpi).toBe(72) // 1584 / 22
    expect(result.sheetWidthIn).toBe(22)
  })

  it('anchors landscape artwork by swapping sides — long side gets the length', () => {
    const result = computeSheetAnchoredInches(4320, 1584, 22)
    expect(result.widthIn).toBe(60) // long side -> width when landscape
    expect(result.heightIn).toBe(22) // short side -> sheet width
  })

  it('handles square artwork as a 22"x22" sheet', () => {
    const result = computeSheetAnchoredInches(2200, 2200, 22)
    expect(result.widthIn).toBe(22)
    expect(result.heightIn).toBe(22)
    expect(result.effectiveDpi).toBe(100) // 2200 / 22
  })

  it('produces the same physical size whether artwork is 72 DPI or 300 DPI as long as ratio matches', () => {
    // Both produce a 22"x60" sheet
    const lowDpi = computeSheetAnchoredInches(1584, 4320, 22)
    const highDpi = computeSheetAnchoredInches(6600, 18000, 22)
    expect(highDpi.widthIn).toBe(lowDpi.widthIn)
    expect(highDpi.heightIn).toBe(lowDpi.heightIn)
    expect(highDpi.effectiveDpi).toBe(300) // 6600 / 22
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
    // 4320/1584 * 24 = 65.45...
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
      measurementWidthPx: 1500, // trimmed (will be overridden to full)
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
    // Even with no embedded DPI and no sizingSource hint, sheet anchor must
    // produce 22"x60" — never 7.92"x21.6" (the old broken 200-DPI fallback).
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
              // NOTE: no widthIn/heightIn/effectiveDpi pre-baked. Forces lifecycle
              // to recompute via sheet anchor. sheetWidthIn omitted -> default 22.
            },
          },
        ],
      },
      thumbnailKey: null,
    })

    expect(lifecycle.metadata?.widthIn).toBe(22)
    expect(lifecycle.metadata?.heightIn).toBe(60)
    // Old broken fallback used to give 7.92 / 21.6
    expect(lifecycle.metadata?.widthIn).not.toBeCloseTo(7.92)
    expect(lifecycle.metadata?.heightIn).not.toBeCloseTo(21.6)
  })
})
