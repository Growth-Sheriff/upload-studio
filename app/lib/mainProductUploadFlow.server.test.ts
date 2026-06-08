import { describe, expect, it } from 'vitest'
import {
  resolveSheetVariant,
  type ProductOptionDef,
  type ProductVariantDef,
} from './dtfSheetResolver.server'
import {
  applyMainProductMeasurementPolicy,
  getMainProductSheetSizes,
  MAIN_PRODUCT_MEASUREMENT_POLICY,
} from './mainProductMeasurement.server'
import { deriveUploadItemLifecycle } from './uploadLifecycle.server'

function buildVariant(lengthIn: number): ProductVariantDef {
  const label = `22 x ${lengthIn}`
  return {
    id: String(lengthIn),
    title: label,
    price: String((lengthIn / 2).toFixed(2)),
    available: true,
    availableForSale: true,
    option1: label,
    options: [label],
    selectedOptions: [{ name: 'Size', value: label }],
  }
}

const variants = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120].map(buildVariant)
const optionDefs: ProductOptionDef[] = [
  { name: 'Size', values: variants.map((variant) => variant.option1 || '') },
]
const sheetSizes = getMainProductSheetSizes(variants)

function resolveMainProductUpload({
  widthPx,
  heightPx,
  documentDpi = 0,
  documentDpiSource = null,
}: {
  widthPx: number
  heightPx: number
  documentDpi?: number
  documentDpiSource?: string | null
}) {
  const lifecycle = deriveUploadItemLifecycle({
    preflightStatus: 'ok',
    preflightResult: {
      overall: 'ok',
      checks: [
        {
          name: 'dimensions',
          status: 'ok',
          value: `${widthPx}x${heightPx}`,
          details: {
            width: widthPx,
            height: heightPx,
            measurementWidth: widthPx,
            measurementHeight: heightPx,
            documentDpi,
            documentDpiSource,
            sheetWidthIn: 22,
            measurementMode: 'full',
          },
        },
      ],
    },
  })

  const measurement = applyMainProductMeasurementPolicy(lifecycle.metadata, {
    measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
    rollWidthIn: 22,
    sheetSizes,
  })
  if (!measurement) throw new Error('Expected measurement')

  const resolution = resolveSheetVariant({
    widthIn: measurement.widthIn,
    heightIn: measurement.heightIn,
    quantity: 1,
    variants,
    optionDefs,
    selectedVariantId: '12',
    config: {
      sheetOptionName: 'Size',
      fitToleranceIn: 0.5,
      selectionStrategy: 'smallest_fitting_sheet',
    },
  })

  return { measurement, resolution }
}

describe('main product upload measurement flow', () => {
  it('routes Annette-style 6600x3600 @ 300 DPI to 22x12', () => {
    const { measurement, resolution } = resolveMainProductUpload({
      widthPx: 6600,
      heightPx: 3600,
      documentDpi: 299.9994,
      documentDpiSource: 'png_phys',
    })

    expect(measurement.widthIn).toBe(22)
    expect(measurement.heightIn).toBe(12)
    expect(measurement.sizingSource).toBe('document_dpi')
    expect(resolution?.selectedSheetLabel).toBe('22 x 12')
  })

  it('routes metreicin-style 6485x2605 @ 118.4148 DPI to 22x60', () => {
    const { measurement, resolution } = resolveMainProductUpload({
      widthPx: 6485,
      heightPx: 2605,
      documentDpi: 118.4148,
      documentDpiSource: 'png_phys',
    })

    expect(measurement.widthIn).toBe(54.77)
    expect(measurement.heightIn).toBe(22)
    expect(measurement.sizingSource).toBe('document_dpi')
    expect(resolution?.selectedSheetLabel).toBe('22 x 60')
  })

  it('routes Genuity-style 1494x668 no-DPI PNG to 22x12', () => {
    const { measurement, resolution } = resolveMainProductUpload({
      widthPx: 1494,
      heightPx: 668,
    })

    expect(measurement.widthIn).toBe(20.75)
    expect(measurement.heightIn).toBe(9.28)
    expect(measurement.sizingSource).toBe('adobe_default_dpi')
    expect(resolution?.selectedSheetLabel).toBe('22 x 12')
  })

  it('keeps large no-DPI gang sheets roll-anchored and routes to 22x60', () => {
    const { measurement, resolution } = resolveMainProductUpload({
      widthPx: 6485,
      heightPx: 2605,
    })

    expect(measurement.widthIn).toBe(54.77)
    expect(measurement.heightIn).toBe(22)
    expect(measurement.sizingSource).toBe('sheet_width_anchor')
    expect(resolution?.selectedSheetLabel).toBe('22 x 60')
  })
})
