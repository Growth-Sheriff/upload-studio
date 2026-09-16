import {
  canonicalShopifyProductId,
  equivalentProductConfigRows,
  productConfigPayloadsConflict,
  selectPreferredProductConfig,
} from './shopifyProductIdentity'

type ProductConfigIdentityRow = {
  productId: string
  builderConfig: unknown
}

/**
 * Select a ProductConfig without depending on database return order. The log
 * intentionally contains only merchant/config identifiers, never upload or
 * customer fields and never the conflicting configuration payloads.
 */
export function selectProductConfigForIdentity<T extends ProductConfigIdentityRow>(input: {
  rows: readonly T[]
  productId: unknown
  shopId: string
  source: string
}): T | null {
  const matchingRows = equivalentProductConfigRows(input.rows, input.productId)
  if (productConfigPayloadsConflict(matchingRows, (row) => row.builderConfig ?? null)) {
    console.warn('[ProductConfig Identity] Conflicting equivalent rows', {
      source: input.source,
      shopId: input.shopId,
      productId: canonicalShopifyProductId(input.productId) || String(input.productId || ''),
      rowProductIds: matchingRows.map((row) => row.productId).sort(),
    })
  }

  return selectPreferredProductConfig(matchingRows, input.productId)
}
