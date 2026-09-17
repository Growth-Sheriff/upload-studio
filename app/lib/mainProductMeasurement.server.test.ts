import { describe, expect, it } from 'vitest'
import {
  applyFinishedSheetMeasurementPolicy,
  FINISHED_SHEET_MEASUREMENT_POLICY,
  getFinishedSheetSizes,
  resolveUploadIntentMeasurementBasis,
} from './mainProductMeasurement.server'
import type { ProductVariantDef } from './dtfSheetResolver.server'
import type { UploadLifecycleMetadata } from './uploadLifecycle.server'

function measurement(overrides: Partial<UploadLifecycleMetadata>): UploadLifecycleMetadata {
  return {
    widthPx: 0,
    heightPx: 0,
    dpi: 0,
    documentDpi: 0,
    documentDpiSource: null,
    trimmedWidthPx: 0,
    trimmedHeightPx: 0,
    trimmedOffsetXPx: 0,
    trimmedOffsetYPx: 0,
    measurementWidthPx: 0,
    measurementHeightPx: 0,
    effectiveDpi: 0,
    sizingSource: null,
    sheetWidthIn: 22.5,
    sheetLengthIn: undefined,
    widthIn: 0,
    heightIn: 0,
    measurementMode: 'full',
    ...overrides,
  }
}

describe('finished-sheet measurement policy', () => {
  it('selects the full production canvas for canonical and historical policy markers', () => {
    expect(
      resolveUploadIntentMeasurementBasis('artwork_bounds', FINISHED_SHEET_MEASUREMENT_POLICY)
    ).toBe('full_page')
    expect(resolveUploadIntentMeasurementBasis('artwork_bounds', 'main_product_roll_width')).toBe(
      'full_page'
    )
    expect(resolveUploadIntentMeasurementBasis('artwork_bounds', 'other')).toBe('artwork_bounds')
  })

  it('keeps embedded-DPI dimensions instead of anchoring them to the press limit', () => {
    const result = applyFinishedSheetMeasurementPolicy(
      measurement({
        widthPx: 6485,
        heightPx: 2605,
        measurementWidthPx: 6485,
        measurementHeightPx: 2605,
        dpi: 118.4148,
        documentDpi: 118.4148,
        documentDpiSource: 'png_phys',
      }),
      {
        measurementPolicy: FINISHED_SHEET_MEASUREMENT_POLICY,
        maxPrintableWidthIn: 22.5,
        fitToleranceIn: 0.02,
      }
    )

    expect(result?.widthIn).toBe(54.7651)
    expect(result?.heightIn).toBe(21.9989)
    expect(result?.sizingSource).toBe('document_dpi')
  })

  it('calibrates a no-DPI 6600x3600 export to its 22x12 sold variant under a 22.5 press limit', () => {
    const result = applyFinishedSheetMeasurementPolicy(
      measurement({
        widthPx: 6600,
        heightPx: 3600,
        measurementWidthPx: 6600,
        measurementHeightPx: 3600,
      }),
      {
        measurementPolicy: FINISHED_SHEET_MEASUREMENT_POLICY,
        maxPrintableWidthIn: 22.5,
        fitToleranceIn: 0.02,
        sheetSizes: [{ widthIn: 22, heightIn: 12 }],
      }
    )

    expect(result?.widthIn).toBe(22)
    expect(result?.heightIn).toBe(12)
    expect(result?.sheetWidthIn).toBe(22.5)
    expect(result?.sheetLengthIn).toBe(12)
    expect(result?.sizingSource).toBe('max_printable_width_anchor')
  })

  it('uses Adobe 72 DPI for a no-DPI file whose short edge already fits', () => {
    const result = applyFinishedSheetMeasurementPolicy(
      measurement({
        widthPx: 1494,
        heightPx: 668,
        measurementWidthPx: 1494,
        measurementHeightPx: 668,
      }),
      {
        measurementPolicy: FINISHED_SHEET_MEASUREMENT_POLICY,
        maxPrintableWidthIn: 22.5,
        fitToleranceIn: 0.02,
      }
    )

    expect(result?.widthIn).toBe(20.75)
    expect(result?.heightIn).toBe(9.2778)
    expect(result?.sizingSource).toBe('adobe_default_dpi')
  })
})

describe('getFinishedSheetSizes', () => {
  it('parses nominal sheet dimensions without treating nominal width as the press limit', () => {
    const variants: ProductVariantDef[] = [
      {
        id: '1',
        title: '22 x 12 / Matte',
        price: '12.00',
        selectedOptions: [
          { name: 'Size', value: '22 x 12' },
          { name: 'Finish', value: 'Matte' },
        ],
      },
      {
        id: '2',
        title: '22 by 60 / Gloss',
        price: '27.00',
        selectedOptions: [
          { name: 'Size', value: '22 by 60' },
          { name: 'Finish', value: 'Gloss' },
        ],
      },
    ]

    expect(getFinishedSheetSizes(variants)).toEqual([
      { widthIn: 22, heightIn: 12 },
      { widthIn: 22, heightIn: 60 },
    ])
  })
})
