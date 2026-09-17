export type UploadQuantitySemantics = 'whole_sheet' | 'legacy_nesting' | 'unknown'

export interface UploadQuantityRecord {
  quantitySemantics?: string | null
  requestedCopies?: number | null
  designsPerSheet?: number | null
  sheetsNeeded?: number | null
}

export interface UploadQuantityFacts {
  semantics: UploadQuantitySemantics
  requestedCopies: number | null
  designsPerSheet: number | null
  physicalSheets: number | null
  wholeSheetCopies: number | null
}

export interface UploadOrderHistoryRecord {
  orderId?: string | null
  orderPaidAt?: Date | string | null
  ordersLink?: Array<unknown> | null
}

/** Upload facts live on a mutable row, so any order association makes that
 * row historical and ineligible for a new cart. */
export function hasUploadOrderHistory(record: UploadOrderHistoryRecord): boolean {
  return Boolean(record.orderId || record.orderPaidAt || record.ordersLink?.length)
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : null
}

/**
 * New finished-sheet writes are explicit: one uploaded file per sheet and the
 * number of physical sheets equals requested copies. Older rows may describe
 * the retired loose-design nesting model and must never be reinterpreted as
 * whole-sheet copies.
 */
export function deriveUploadQuantityFacts(record: UploadQuantityRecord): UploadQuantityFacts {
  const explicitSemantics = String(record.quantitySemantics || '').trim()
  const requestedCopies = positiveInteger(record.requestedCopies)
  const designsPerSheet = positiveInteger(record.designsPerSheet)
  const physicalSheets = positiveInteger(record.sheetsNeeded)

  const legacyNesting =
    (designsPerSheet != null && designsPerSheet > 1) ||
    (requestedCopies != null && physicalSheets != null && requestedCopies !== physicalSheets)

  if (legacyNesting) {
    return {
      semantics: 'legacy_nesting',
      requestedCopies,
      designsPerSheet,
      physicalSheets,
      wholeSheetCopies: null,
    }
  }

  if (
    explicitSemantics === 'whole_sheet' &&
    requestedCopies != null &&
    designsPerSheet === 1 &&
    physicalSheets === requestedCopies
  ) {
    return {
      semantics: 'whole_sheet',
      requestedCopies,
      designsPerSheet,
      physicalSheets,
      wholeSheetCopies: requestedCopies,
    }
  }

  // Rows written before the finished-sheet cutover can coincidentally have
  // requestedCopies === sheetsNeeded and designsPerSheet === 1. Without the
  // explicit marker there is no evidence that those numbers meant whole-sheet
  // copies, so historical records fail closed.

  return {
    semantics: 'unknown',
    requestedCopies,
    designsPerSheet,
    physicalSheets,
    wholeSheetCopies: null,
  }
}
