import { describe, expect, it } from 'vitest'
import { deriveUploadQuantityFacts, hasUploadOrderHistory } from './uploadQuantitySemantics'

describe('deriveUploadQuantityFacts', () => {
  it('recognises current finished-sheet writes', () => {
    expect(
      deriveUploadQuantityFacts({
        quantitySemantics: 'whole_sheet',
        requestedCopies: 8,
        designsPerSheet: 1,
        sheetsNeeded: 8,
      })
    ).toEqual({
      semantics: 'whole_sheet',
      requestedCopies: 8,
      designsPerSheet: 1,
      physicalSheets: 8,
      wholeSheetCopies: 8,
    })
  })

  it('does not reinterpret historical nesting as whole-sheet copies', () => {
    expect(
      deriveUploadQuantityFacts({ requestedCopies: 8, designsPerSheet: 8, sheetsNeeded: 1 })
    ).toEqual({
      semantics: 'legacy_nesting',
      requestedCopies: 8,
      designsPerSheet: 8,
      physicalSheets: 1,
      wholeSheetCopies: null,
    })
  })

  it('keeps incomplete historical rows unknown', () => {
    expect(deriveUploadQuantityFacts({ requestedCopies: 2 })).toMatchObject({
      semantics: 'unknown',
      wholeSheetCopies: null,
    })
  })

  it('does not infer new semantics from coincidentally matching historical columns', () => {
    expect(
      deriveUploadQuantityFacts({ requestedCopies: 2, designsPerSheet: 1, sheetsNeeded: 2 })
    ).toMatchObject({
      semantics: 'unknown',
      wholeSheetCopies: null,
    })
  })
})

describe('hasUploadOrderHistory', () => {
  it('blocks even a valid whole-sheet row once it belongs to an order', () => {
    expect(hasUploadOrderHistory({ orderId: '43232', ordersLink: [] })).toBe(true)
  })

  it('recognises relation-only order history', () => {
    expect(hasUploadOrderHistory({ orderId: null, ordersLink: [{ id: 'link-1' }] })).toBe(true)
  })

  it('leaves an unlinked upload eligible for its first order', () => {
    expect(hasUploadOrderHistory({ orderId: null, orderPaidAt: null, ordersLink: [] })).toBe(false)
  })
})
