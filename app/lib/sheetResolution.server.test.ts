import { describe, expect, it } from 'vitest'
import { resolveLinearInchVariant } from './sheetResolution.server'

const measured = {
  widthPx: 9000,
  heightPx: 12000,
  dpi: 300,
  documentDpi: 300,
  documentDpiSource: 'png_phys',
  trimmedWidthPx: 9000,
  trimmedHeightPx: 12000,
  trimmedOffsetXPx: 0,
  trimmedOffsetYPx: 0,
  measurementWidthPx: 9000,
  measurementHeightPx: 12000,
  effectiveDpi: 300,
  sizingSource: 'document_dpi',
  measurementMode: 'full',
  widthIn: 30,
  heightIn: 40,
}

describe('resolveLinearInchVariant', () => {
  it('keeps billable inch quantity separate from physical sheet count', () => {
    const result = resolveLinearInchVariant({
      dimensions: { ...measured, widthIn: 21.98, heightIn: 23.91 },
      quantity: 2,
      variants: [{ id: '1', title: '22x1', price: '1.00', availableForSale: true }],
      maxCrossRollWidthIn: 22,
    })

    expect(result?.cartQuantity).toBe(48)
    expect(result?.billableLengthIn).toBe(47.82)
    expect(result?.sheetsNeeded).toBe(2)
    expect(result?.selectedSheetLabel).toBe('48 billable inches')
  })

  it('rejects a design whose short edge cannot fit across the roll in either orientation', () => {
    expect(
      resolveLinearInchVariant({
        dimensions: measured,
        quantity: 1,
        variants: [{ id: '1', title: '22x1', price: '1.00', availableForSale: true }],
        maxCrossRollWidthIn: 22,
      })
    ).toBeNull()
  })

  it('subtracts artboard margins from the physical roll once, not from the design cap twice', () => {
    const result = resolveLinearInchVariant({
      dimensions: { ...measured, widthIn: 21.5, heightIn: 40 },
      quantity: 1,
      variants: [{ id: '1', title: '22x1', price: '1.00', availableForSale: true }],
      maxCrossRollWidthIn: 22,
      maxDesignWidthIn: 21.5,
      artboardMarginIn: 0.25,
    })

    expect(result?.placedWidthIn).toBe(21.5)
  })

  it('does not select an unavailable unit variant', () => {
    expect(
      resolveLinearInchVariant({
        dimensions: { ...measured, widthIn: 20 },
        quantity: 1,
        variants: [{ id: '1', title: '22x1', price: '1.00', availableForSale: false }],
        maxCrossRollWidthIn: 22,
      })
    ).toBeNull()
  })

  it('preserves a selected unit variant sent as a Shopify GID', () => {
    const result = resolveLinearInchVariant({
      dimensions: { ...measured, widthIn: 20, heightIn: 40 },
      quantity: 1,
      variants: [
        { id: '1', title: '24 x 1 / Standard', price: '0.80', availableForSale: true },
        { id: '2', title: '24 x 1 / Premium', price: '1.25', availableForSale: true },
      ],
      selectedVariantId: 'gid://shopify/ProductVariant/2',
      maxCrossRollWidthIn: 22,
    })

    expect(result?.selectedVariantId).toBe('2')
    expect(result?.pricePerInch).toBe(1.25)
  })

  it('replaces a stored page variant with the matching one-inch carrier', () => {
    const result = resolveLinearInchVariant({
      dimensions: { ...measured, widthIn: 20, heightIn: 40 },
      quantity: 1,
      variants: [
        {
          id: '10',
          title: '22 x 12 / Gloss',
          price: '18.00',
          availableForSale: true,
          selectedOptions: [
            { name: 'Size', value: '22 x 12' },
            { name: 'Finish', value: 'Gloss' },
          ],
        },
        {
          id: '11',
          title: '22 x 1 / Matte',
          price: '0.80',
          availableForSale: true,
          selectedOptions: [
            { name: 'Size', value: '22 x 1' },
            { name: 'Finish', value: 'Matte' },
          ],
        },
        {
          id: '12',
          title: '22 x 1 / Gloss',
          price: '1.25',
          availableForSale: true,
          selectedOptions: [
            { name: 'Size', value: '22 x 1' },
            { name: 'Finish', value: 'Gloss' },
          ],
        },
      ],
      selectedVariantId: '10',
      maxCrossRollWidthIn: 22,
    })

    expect(result?.selectedVariantId).toBe('12')
    expect(result?.pricePerInch).toBe(1.25)
  })

  it('preserves service choices when the stored page variant is no longer available', () => {
    const result = resolveLinearInchVariant({
      dimensions: { ...measured, widthIn: 20, heightIn: 40 },
      quantity: 1,
      variants: [
        {
          id: '20',
          title: '22 x 12 / Gloss',
          price: '18.00',
          availableForSale: false,
          selectedOptions: [
            { name: 'Size', value: '22 x 12' },
            { name: 'Sheet Type', value: 'Gloss' },
          ],
        },
        {
          id: '21',
          title: '22 x 1 / Matte',
          price: '0.80',
          availableForSale: true,
          selectedOptions: [
            { name: 'Size', value: '22 x 1' },
            { name: 'Sheet Type', value: 'Matte' },
          ],
        },
        {
          id: '22',
          title: '22 x 1 / Gloss',
          price: '1.25',
          availableForSale: true,
          selectedOptions: [
            { name: 'Size', value: '22 x 1' },
            { name: 'Sheet Type', value: 'Gloss' },
          ],
        },
      ],
      selectedVariantId: '20',
      maxCrossRollWidthIn: 22,
    })

    expect(result?.selectedVariantId).toBe('22')
    expect(result?.pricePerInch).toBe(1.25)
  })
})
