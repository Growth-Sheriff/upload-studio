import { describe, expect, it } from 'vitest'
import {
  getPrintableWidthFailure,
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
  it('preserves selected service options while choosing the smallest fitting combined sheet', () => {
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
      },
    })

    expect(result).not.toBeNull()
    expect(result?.selectedVariantId).toBe('103')
    expect(result?.selectedSheetLabel).toContain('22 x 12')
    expect(result?.designsPerSheet).toBe(1)
    expect(result?.sheetsNeeded).toBe(3)
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
      },
    })

    expect(result).not.toBeNull()
    expect(result?.selectedVariantId).toBe('203')
    expect(result?.selectedSheetLabel).toContain('22')
    expect(result?.selectedSheetLabel).toContain('12')
    expect(result?.designsPerSheet).toBe(1)
    expect(result?.sheetsNeeded).toBe(3)
  })

  it('preserves service options when Shopify sends the selected variant as a GID', () => {
    const optionDefs: ProductOptionDef[] = [
      { name: 'Size', values: ['22 x 12', '22 x 24'] },
      { name: 'Finish', values: ['Matte', 'Gloss'] },
    ]
    const variants = [
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
      selectedVariantId: 'gid://shopify/ProductVariant/103',
      config: { sheetOptionName: 'Size', modalOptionNames: ['Finish'] },
    })

    expect(result?.selectedVariantId).toBe('103')
  })

  it('does not silently change the selected service when a fitting size lacks that service', () => {
    const optionDefs: ProductOptionDef[] = [
      { name: 'Size', values: ['22 x 12', '22 x 24'] },
      { name: 'Finish', values: ['Matte', 'Gloss'] },
    ]
    const variants: ProductVariantDef[] = [
      buildVariant('251', '22 x 12 / Gloss', '13.00', [
        { name: 'Size', value: '22 x 12' },
        { name: 'Finish', value: 'Gloss' },
      ]),
      buildVariant('252', '22 x 24 / Matte', '20.00', [
        { name: 'Size', value: '22 x 24' },
        { name: 'Finish', value: 'Matte' },
      ]),
    ]

    const result = resolveSheetVariant({
      widthIn: 20,
      heightIn: 20,
      quantity: 1,
      variants,
      optionDefs,
      selectedVariantId: '251',
      config: {
        sheetOptionName: 'Size',
        modalOptionNames: ['Finish'],
      },
    })

    expect(result).toBeNull()
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
      },
    })

    expect(result).toBeNull()
  })

  it('does not gang copies or let quantity change the selected sheet', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 12', '22 x 24'] }]
    const variants: ProductVariantDef[] = [
      buildVariant('401', '22 x 12', '12.00', [{ name: 'Size', value: '22 x 12' }]),
      buildVariant('402', '22 x 24', '16.00', [{ name: 'Size', value: '22 x 24' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 6.47,
      heightIn: 5.18,
      quantity: 10,
      variants,
      optionDefs,
      selectedVariantId: '401',
      config: {
        sheetOptionName: 'Size',
      },
    })

    expect(result).not.toBeNull()
    expect(result?.selectedVariantId).toBe('401')
    expect(result?.designsPerSheet).toBe(1)
    expect(result?.sheetsNeeded).toBe(10)
  })

  it('treats every requested copy as one complete production sheet', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 24'] }]
    const variants = [
      buildVariant('450', '22 x 24', '20.00', [{ name: 'Size', value: '22 x 24' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 5,
      heightIn: 6.35,
      quantity: 14,
      variants,
      optionDefs,
      selectedVariantId: '450',
      config: {
        sheetOptionName: 'Size',
      },
    })

    expect(result?.designsPerSheet).toBe(1)
    expect(result?.sheetsNeeded).toBe(14)
  })

  it('uses the normalized long edge to choose the smallest covering sheet', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 12', '22 x 24', '22 x 60'] }]
    const variants: ProductVariantDef[] = [
      buildVariant('501', '22 x 12', '12.00', [{ name: 'Size', value: '22 x 12' }]),
      buildVariant('503', '22 x 24', '20.00', [{ name: 'Size', value: '22 x 24' }]),
      buildVariant('502', '22 x 60', '27.00', [{ name: 'Size', value: '22 x 60' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 20.75,
      heightIn: 9.28,
      quantity: 10,
      variants,
      optionDefs,
      selectedVariantId: '501',
      config: {
        sheetOptionName: 'Size',
      },
    })

    expect(result).not.toBeNull()
    expect(result?.selectedVariantId).toBe('503')
    expect(result?.selectedSheetLabel).toContain('22 x 24')
  })

  it('chooses the shortest covering film length before comparing sheet width', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['12 x 30', '22 x 24'] }]
    const variants = [
      buildVariant('551', '12 x 30', '10.00', [{ name: 'Size', value: '12 x 30' }]),
      buildVariant('552', '22 x 24', '20.00', [{ name: 'Size', value: '22 x 24' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 10,
      heightIn: 17,
      quantity: 1,
      variants,
      optionDefs,
      config: { sheetOptionName: 'Size' },
    })

    expect(result?.selectedVariantId).toBe('552')
  })

  it('normalizes the short edge across the roll without issuing a production instruction', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 24'] }]
    const variants: ProductVariantDef[] = [
      buildVariant('601', '22 x 24', '20.00', [{ name: 'Size', value: '22 x 24' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 23.91,
      heightIn: 21.14,
      quantity: 1,
      variants,
      optionDefs,
      config: {
        sheetOptionName: 'Size',
        printableWidthIn: 22,
      },
    })

    expect(result?.placedWidthIn).toBe(21.14)
    expect(result?.placedHeightIn).toBe(23.91)
  })

  it('rejects artwork when neither orientation fits the configured cross-roll width', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 24'] }]
    const variants: ProductVariantDef[] = [
      buildVariant('602', '22 x 24', '20.00', [{ name: 'Size', value: '22 x 24' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 23,
      heightIn: 22.75,
      quantity: 1,
      variants,
      optionDefs,
      config: {
        sheetOptionName: 'Size',
        printableWidthIn: 22,
      },
    })

    expect(result).toBeNull()
  })

  it('uses the printable roll width without hidden margins or tolerance', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 240'] }]
    const variants: ProductVariantDef[] = [
      buildVariant('603', '22 x 240', '120.00', [{ name: 'Size', value: '22 x 240' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 21.98,
      heightIn: 237.99,
      quantity: 1,
      variants,
      optionDefs,
      config: {
        sheetOptionName: 'Size',
        printableWidthIn: 22,
      },
    })

    expect(result?.selectedVariantId).toBe('603')
    expect(result?.placedWidthIn).toBe(21.98)
  })

  it('rejects the file, rather than the nominal variant, when printable width is exceeded', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['24 x 24'] }]
    const variants: ProductVariantDef[] = [
      buildVariant('604', '24 x 24', '25.00', [{ name: 'Size', value: '24 x 24' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 23,
      heightIn: 23,
      quantity: 1,
      variants,
      optionDefs,
      config: {
        sheetOptionName: 'Size',
        printableWidthIn: 22,
      },
    })

    expect(result).toBeNull()
  })

  it('allows a nominal 22-inch variant on a 21.75-inch printable area when the file fits', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 24'] }]
    const variants = [
      buildVariant('605', '22 x 24', '20.00', [{ name: 'Size', value: '22 x 24' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 21.5,
      heightIn: 23,
      quantity: 2,
      variants,
      optionDefs,
      config: { sheetOptionName: 'Size', printableWidthIn: 21.75 },
    })

    expect(result?.selectedVariantId).toBe('605')
    expect(result?.sheetsNeeded).toBe(2)
  })

  it('uses printable width as the sole cross-roll limit, not the nominal variant width', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 240'] }]
    const variants = [
      buildVariant('606', '22 x 240', '120.00', [{ name: 'Size', value: '22 x 240' }]),
    ]

    const result = resolveSheetVariant({
      widthIn: 22.26,
      heightIn: 237.05,
      quantity: 1,
      variants,
      optionDefs,
      config: { sheetOptionName: 'Size', printableWidthIn: 22.5 },
    })

    expect(result?.selectedVariantId).toBe('606')
    expect(result?.placedWidthIn).toBe(22.26)
    expect(result?.placedHeightIn).toBe(237.05)
  })

  it('resolves portrait and landscape exports of the same finished sheet identically', () => {
    const optionDefs: ProductOptionDef[] = [{ name: 'Size', values: ['22 x 84'] }]
    const variants = [
      buildVariant('701', '22 x 84', '42.00', [{ name: 'Size', value: '22 x 84' }]),
    ]
    const input = {
      quantity: 2,
      variants,
      optionDefs,
      config: { sheetOptionName: 'Size', printableWidthIn: 22 },
    }

    const portrait = resolveSheetVariant({ ...input, widthIn: 22, heightIn: 80 })
    const landscape = resolveSheetVariant({ ...input, widthIn: 80, heightIn: 22 })

    expect(portrait?.selectedVariantId).toBe('701')
    expect(landscape?.selectedVariantId).toBe('701')
    expect(portrait?.widthIn).toBe(22)
    expect(landscape?.widthIn).toBe(22)
    expect(portrait?.heightIn).toBe(80)
    expect(landscape?.heightIn).toBe(80)
    expect(portrait?.sheetsNeeded).toBe(2)
    expect(landscape?.sheetsNeeded).toBe(2)
  })

  it('reports the exact normalized width and printable-width limit', () => {
    expect(
      getPrintableWidthFailure({
        widthIn: 80,
        heightIn: 23.91,
        config: { printableWidthIn: 22 },
      })
    ).toEqual({
      code: 'WIDTH_TOO_LARGE',
      widthIn: 23.91,
      lengthIn: 80,
      printableWidthIn: 22,
      message: 'Your file is 23.91 inches wide; maximum printable width is 22 inches.',
    })
  })
})
