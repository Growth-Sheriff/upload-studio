import { describe, expect, it } from 'vitest'
import {
  resolveSheetVariant,
  type ProductOptionDef,
  type ProductVariantDef,
} from './dtfSheetResolver.server'

function buildVariant(
  id: string,
  title: string,
  price: string,
  options: Array<{ name: string; value: string }>
): ProductVariantDef {
  return {
    id,
    title,
    price,
    available: true,
    availableForSale: true,
    option1: options[0]?.value || null,
    option2: options[1]?.value || null,
    option3: options[2]?.value || null,
    options: options.map((option) => option.value),
    selectedOptions: options,
  }
}

describe('resolveSheetVariant', () => {
  it('preserves selected service options while choosing the cheapest fitting combined sheet', () => {
    const optionDefs: ProductOptionDef[] = [
      { name: 'Size', values: ['22 x 12', '22 x 24'] },
      { name: 'Finish', values: ['Matte', 'Gloss'] },
    ]

    const variants: ProductVariantDef[] = [
      buildVariant('101', '22 x 12 / Matte', '12.00', [
        { name: 'Size', value: '22 x 12' },
        { name: 'Finish', value: 'Matte' },
      ]),
      buildVariant('102', '22 x 24 / Matte', '20.00', [
        { name: 'Size', value: '22 x 24' },
        { name: 'Finish', value: 'Matte' },
      ]),
      buildVariant('103', '22 x 12 / Gloss', '13.00', [
        { name: 'Size', value: '22 x 12' },
        { name: 'Finish', value: 'Gloss' },
      ]),
      buildVariant('104', '22 x 24 / Gloss', '21.00', [
        { name: 'Size', value: '22 x 24' },
        { name: 'Finish', value: 'Gloss' },
      ]),
    ]

    const result = resolveSheetVariant({
      widthIn: 10,
      heightIn: 10,
      quantity: 3,
      variants,
      optionDefs,
      selectedVariantId: '103',
      config: {
        sheetOptionName: 'Size',
        modalOptionNames: ['Finish'],
        artboardMarginIn: 0.125,
        imageMarginIn: 0.125,
      },
    })

    expect(result).not.toBeNull()
    expect(result?.selectedVariantId).toBe('104')
    expect(result?.selectedSheetLabel).toContain('22 x 24')
    expect(result?.designsPerSheet).toBe(4)
    expect(result?.sheetsNeeded).toBe(1)
  })

  it('detects split width and height options and keeps service options matched', () => {
    const optionDefs: ProductOptionDef[] = [
      { name: 'Width', values: ['22', '22', '22', '22'] },
      { name: 'Length', values: ['12', '24', '12', '24'] },
      { name: 'Finish', values: ['Matte', 'Matte', 'Gloss', 'Gloss'] },
    ]

    const variants: ProductVariantDef[] = [
      buildVariant('201', '22 x 12 / Matte', '12.00', [
        { name: 'Width', value: '22' },
        { name: 'Length', value: '12' },
        { name: 'Finish', value: 'Matte' },
      ]),
      buildVariant('202', '22 x 24 / Matte', '20.00', [
        { name: 'Width', value: '22' },
        { name: 'Length', value: '24' },
        { name: 'Finish', value: 'Matte' },
      ]),
      buildVariant('203', '22 x 12 / Gloss', '13.00', [
        { name: 'Width', value: '22' },
        { name: 'Length', value: '12' },
        { name: 'Finish', value: 'Gloss' },
      ]),
      buildVariant('204', '22 x 24 / Gloss', '21.00', [
        { name: 'Width', value: '22' },
        { name: 'Length', value: '24' },
        { name: 'Finish', value: 'Gloss' },
      ]),
    ]

    const result = resolveSheetVariant({
      widthIn: 10,
      heightIn: 10,
      quantity: 3,
      variants,
      optionDefs,
      selectedVariantId: '203',
      config: {
        widthOptionName: 'Width',
        heightOptionName: 'Length',
        modalOptionNames: ['Finish'],
        artboardMarginIn: 0.125,
        imageMarginIn: 0.125,
      },
    })

    expect(result).not.toBeNull()
    expect(result?.selectedVariantId).toBe('204')
    expect(result?.selectedSheetLabel).toContain('22')
    expect(result?.selectedSheetLabel).toContain('24')
    expect(result?.designsPerSheet).toBe(4)
    expect(result?.sheetsNeeded).toBe(1)
  })

  it('returns null when no available sheet can fit the uploaded design', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['10 x 10'] }]
    const variants: ProductVariantDef[] = [
      buildVariant('301', '10 x 10', '8.00', [{ name: 'Size', value: '10 x 10' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 20,
      heightIn: 20,
      quantity: 1,
      variants,
      optionDefs,
      selectedVariantId: '301',
      config: {
        sheetOptionName: 'Size',
        artboardMarginIn: 0.125,
        imageMarginIn: 0.125,
      },
    })

    expect(result).toBeNull()
  })
})
