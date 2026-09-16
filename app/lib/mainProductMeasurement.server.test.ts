import { describe, expect, it } from 'vitest'
import {
  applyMainProductMeasurementPolicy,
  getMainProductSheetSizes,
  MAIN_PRODUCT_MEASUREMENT_POLICY,
  resolveUploadIntentMeasurementBasis,
  resolveServerMainProductRollWidth,
} from './mainProductMeasurement.server'
import {
  resolveSheetVariant,
  type ProductOptionDef,
  type ProductVariantDef,
} from './dtfSheetResolver.server'
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
    sheetWidthIn: 22,
    sheetLengthIn: undefined,
    widthIn: 0,
    heightIn: 0,
    measurementMode: 'full',
    ...overrides,
  }
}

describe('resolveUploadIntentMeasurementBasis', () => {
  it('lets only the exact main-product marker select full-page intent', () => {
    expect(resolveUploadIntentMeasurementBasis('artwork_bounds', MAIN_PRODUCT_MEASUREMENT_POLICY)).toBe(
      'full_page'
    )
    expect(resolveUploadIntentMeasurementBasis('artwork_bounds', 'other')).toBe('artwork_bounds')
    expect(resolveUploadIntentMeasurementBasis('full_page', null)).toBe('full_page')
  })
})

describe('applyMainProductMeasurementPolicy', () => {
  it('preserves document-DPI truth for metreicin-style uploads', () => {
    const result = applyMainProductMeasurementPolicy(
      measurement({
        widthPx: 6485,
        heightPx: 2605,
        measurementWidthPx: 6485,
        measurementHeightPx: 2605,
        dpi: 118.4148,
        documentDpi: 118.4148,
        documentDpiSource: 'png_phys',
        sizingSource: 'document_dpi',
        widthIn: 54.77,
        heightIn: 22,
      }),
      { measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY, rollWidthIn: 22 }
    )

    expect(result?.widthIn).toBe(54.77)
    expect(result?.heightIn).toBe(22)
    expect(result?.sizingSource).toBe('document_dpi')
    expect(result?.effectiveDpi).toBeCloseTo(118.4148, 4)
  })

  it('does not re-anchor Adobe-default no-DPI truth for Genuity-style uploads', () => {
    const result = applyMainProductMeasurementPolicy(
      measurement({
        widthPx: 1494,
        heightPx: 668,
        measurementWidthPx: 1494,
        measurementHeightPx: 668,
        effectiveDpi: 72,
        sizingSource: 'adobe_default_dpi',
        widthIn: 20.75,
        heightIn: 9.28,
      }),
      { measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY, rollWidthIn: 22 }
    )

    expect(result?.widthIn).toBe(20.75)
    expect(result?.heightIn).toBe(9.28)
    expect(result?.sizingSource).toBe('adobe_default_dpi')
  })

  it('keeps Genuity-style no-DPI dimensions small enough to select 22x12', () => {
    const variants: ProductVariantDef[] = [
      {
        id: '12',
        title: '22 x 12',
        price: '12.00',
        available: true,
        availableForSale: true,
        option1: '22 x 12',
        options: ['22 x 12'],
        selectedOptions: [{ name: 'Size', value: '22 x 12' }],
      },
      {
        id: '60',
        title: '22 x 60',
        price: '27.00',
        available: true,
        availableForSale: true,
        option1: '22 x 60',
        options: ['22 x 60'],
        selectedOptions: [{ name: 'Size', value: '22 x 60' }],
      },
    ]
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 12', '22 x 60'] }]

    const result = applyMainProductMeasurementPolicy(
      measurement({
        widthPx: 1494,
        heightPx: 668,
        measurementWidthPx: 1494,
        measurementHeightPx: 668,
        effectiveDpi: 72,
        sizingSource: 'adobe_default_dpi',
        widthIn: 20.75,
        heightIn: 9.28,
      }),
      {
        measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
        rollWidthIn: 22,
        sheetSizes: getMainProductSheetSizes(variants),
      }
    )

    const resolution = resolveSheetVariant({
      widthIn: result.widthIn,
      heightIn: result.heightIn,
      quantity: 1,
      variants,
      optionDefs,
      selectedVariantId: '12',
      config: {
        sheetOptionName: 'Size',
        selectionStrategy: 'smallest_fitting_sheet',
      },
    })

    expect(result.widthIn).toBe(20.75)
    expect(result.heightIn).toBe(9.28)
    expect(resolution?.selectedVariantId).toBe('12')
  })

  it('uses sheet-aware roll anchoring only when canonical metadata is an anchor fallback', () => {
    const result = applyMainProductMeasurementPolicy(
      measurement({
        widthPx: 6600,
        heightPx: 3600,
        measurementWidthPx: 6600,
        measurementHeightPx: 3600,
        effectiveDpi: 164,
        sizingSource: 'sheet_width_anchor',
        widthIn: 40.33,
        heightIn: 22,
      }),
      {
        measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
        rollWidthIn: 22,
        sheetSizes: [{ widthIn: 22, heightIn: 12 }],
      }
    )

    expect(result?.widthIn).toBe(22)
    expect(result?.heightIn).toBe(12)
    expect(result?.sizingSource).toBe('sheet_width_anchor')
    expect(result?.sheetLengthIn).toBe(12)
  })

  it('keeps large no-DPI gang sheets anchored to the roll when no exact sheet ratio matches', () => {
    const result = applyMainProductMeasurementPolicy(
      measurement({
        widthPx: 6485,
        heightPx: 2605,
        measurementWidthPx: 6485,
        measurementHeightPx: 2605,
        effectiveDpi: 118,
        sizingSource: 'sheet_width_anchor',
        widthIn: 54.77,
        heightIn: 22,
      }),
      {
        measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
        rollWidthIn: 22,
        sheetSizes: [{ widthIn: 22, heightIn: 60 }],
      }
    )

    expect(result?.widthIn).toBe(54.77)
    expect(result?.heightIn).toBe(22)
    expect(result?.sizingSource).toBe('sheet_width_anchor')
  })

  it('inherits the server-measured roll width when no provisional width is supplied', () => {
    const result = applyMainProductMeasurementPolicy(
      measurement({
        widthPx: 2250,
        heightPx: 4500,
        measurementWidthPx: 2250,
        measurementHeightPx: 4500,
        sheetWidthIn: 22.5,
        sizingSource: 'sheet_width_anchor',
        widthIn: 22.5,
        heightIn: 45,
      }),
      { measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY }
    )

    expect(result?.sheetWidthIn).toBe(22.5)
    expect(result?.widthIn).toBe(22.5)
    expect(result?.heightIn).toBe(45)
  })
})

describe('resolveServerMainProductRollWidth', () => {
  it('preserves the legacy 22-inch main-product default', () => {
    expect(resolveServerMainProductRollWidth(null)).toBe(22)
  })

  it('uses a dedicated server-side roll width instead of maxWidthIn', () => {
    expect(resolveServerMainProductRollWidth({ rollWidthIn: 24, maxWidthIn: 1 })).toBe(24)
  })

  it('keeps the legacy maxWidthIn roll anchor until rollWidthIn is explicitly saved', () => {
    expect(resolveServerMainProductRollWidth({ maxWidthIn: 22.5 })).toBe(22.5)
    expect(resolveServerMainProductRollWidth({ maxWidthIn: 60, maxHeightIn: 35.75 })).toBe(35.75)
  })

  it('enforces an explicitly saved shop width limit', () => {
    expect(
      resolveServerMainProductRollWidth(
        { rollWidthIn: 24 },
        { policyExplicit: true, maxSheetWidthIn: 22.5 }
      )
    ).toBe(22.5)
  })

  it('rejects corrupt roll widths outside the admin contract', () => {
    expect(resolveServerMainProductRollWidth({ rollWidthIn: 0.01 })).toBe(22)
    expect(resolveServerMainProductRollWidth({ rollWidthIn: 121 })).toBe(22)
    expect(
      resolveServerMainProductRollWidth(
        { rollWidthIn: 24 },
        { policyExplicit: true, maxSheetWidthIn: 0.01 }
      )
    ).toBe(24)
  })
})

describe('getMainProductSheetSizes', () => {
  it('parses sheet sizes from composite variant titles and selected options', () => {
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

    expect(getMainProductSheetSizes(variants)).toEqual([
      { widthIn: 22, heightIn: 12 },
      { widthIn: 22, heightIn: 60 },
    ])
  })
})
