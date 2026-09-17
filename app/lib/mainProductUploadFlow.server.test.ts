import { describe, expect, it } from 'vitest'
import {
  resolveSheetVariant,
  type ProductOptionDef,
  type ProductVariantDef,
} from './dtfSheetResolver.server'
import {
  applyFinishedSheetMeasurementPolicy,
  FINISHED_SHEET_MEASUREMENT_POLICY,
  getFinishedSheetSizes,
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
const sheetSizes = getFinishedSheetSizes(variants)

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
            sheetWidthIn: 22.5,
            measurementMode: 'full',
          },
        },
      ],
    },
  })

  const measurement = applyFinishedSheetMeasurementPolicy(lifecycle.metadata, {
    measurementPolicy: FINISHED_SHEET_MEASUREMENT_POLICY,
    maxPrintableWidthIn: 22.5,
    fitToleranceIn: 0.02,
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
      maxPrintableWidthIn: 22.5,
      fitToleranceIn: 0.02,
    },
  })

  return { measurement, resolution }
}

describe('main product upload measurement flow', () => {
  it('normalizes an embedded-DPI 22x12 file onto the 22x12 sheet it actually consumes', () => {
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

    expect(measurement.widthIn).toBe(54.7651)
    expect(measurement.heightIn).toBe(21.9989)
    expect(measurement.sizingSource).toBe('document_dpi')
    expect(resolution?.selectedSheetLabel).toBe('22 x 60')
  })

  it('routes Genuity-style 1494x668 no-DPI PNG to the 22x12 sheet it fits across the roll', () => {
    const { measurement, resolution } = resolveMainProductUpload({
      widthPx: 1494,
      heightPx: 668,
    })

    expect(measurement.widthIn).toBe(20.75)
    expect(measurement.heightIn).toBe(9.2778)
    expect(measurement.sizingSource).toBe('adobe_default_dpi')
    expect(resolution?.selectedSheetLabel).toBe('22 x 12')
  })

  it('keeps large no-DPI gang sheets press-width anchored and routes to 22x60', () => {
    const { measurement, resolution } = resolveMainProductUpload({
      widthPx: 6485,
      heightPx: 2605,
    })

    expect(Math.max(measurement.widthIn, measurement.heightIn)).toBe(56.0125)
    expect(Math.min(measurement.widthIn, measurement.heightIn)).toBe(22.5)
    expect(measurement.sizingSource).toBe('max_printable_width_anchor')
    expect(resolution?.selectedSheetLabel).toBe('22 x 60')
  })

  it('calibrates no-DPI dimensions from 22x12 and bills only the film consumed', () => {
    const { measurement, resolution } = resolveMainProductUpload({
      widthPx: 6600,
      heightPx: 3600,
    })

    expect(Math.min(measurement.widthIn, measurement.heightIn)).toBe(12)
    expect(Math.max(measurement.widthIn, measurement.heightIn)).toBe(22)
    expect(resolution?.selectedSheetLabel).toBe('22 x 12')
  })
})
