import { describe, expect, it } from 'vitest'
import {
  canonicalShopifyProductId,
  equivalentProductConfigRows,
  productConfigPayloadsConflict,
  selectPreferredProductConfig,
  shopifyProductIdCandidates,
  shopifyProductIdsEqual,
} from './shopifyProductIdentity'

describe('Shopify product identity', () => {
  it('generates both canonical and legacy ProductConfig candidates in stable order', () => {
    expect(shopifyProductIdCandidates('123')).toEqual([
      'gid://shopify/Product/123',
      '123',
    ])
    expect(shopifyProductIdCandidates('gid://shopify/Product/123')).toEqual([
      'gid://shopify/Product/123',
      '123',
    ])
    expect(canonicalShopifyProductId(' 123 ')).toBe('gid://shopify/Product/123')
  })

  it('compares numeric and GID forms symmetrically', () => {
    expect(shopifyProductIdsEqual('123', 'gid://shopify/Product/123')).toBe(true)
    expect(shopifyProductIdsEqual('gid://shopify/Product/123', '123')).toBe(true)
    expect(shopifyProductIdsEqual('123', 'gid://shopify/Product/124')).toBe(false)
  })

  it('prefers the canonical ProductConfig row regardless of query order', () => {
    const numeric = { productId: '123', builderConfig: { maxWidthIn: 22 } }
    const canonical = {
      productId: 'gid://shopify/Product/123',
      builderConfig: { maxWidthIn: 24 },
    }

    expect(selectPreferredProductConfig([numeric, canonical], '123')).toBe(canonical)
    expect(selectPreferredProductConfig([canonical, numeric], '123')).toBe(canonical)
    expect(equivalentProductConfigRows([numeric, canonical], '123')).toHaveLength(2)
  })

  it('detects payload conflicts without treating object key order as a conflict', () => {
    const same = [
      { productId: '123', builderConfig: { max: 22, margins: { x: 1, y: 2 } } },
      {
        productId: 'gid://shopify/Product/123',
        builderConfig: { margins: { y: 2, x: 1 }, max: 22 },
      },
    ]
    const different = [
      ...same.slice(0, 1),
      { productId: 'gid://shopify/Product/123', builderConfig: { max: 24 } },
    ]

    expect(productConfigPayloadsConflict(same, (row) => row.builderConfig)).toBe(false)
    expect(productConfigPayloadsConflict(different, (row) => row.builderConfig)).toBe(true)
  })

  it('keeps an exact fallback for a non-Shopify legacy key', () => {
    expect(shopifyProductIdCandidates('legacy-product')).toEqual(['legacy-product'])
    expect(shopifyProductIdsEqual('legacy-product', 'legacy-product')).toBe(true)
    expect(shopifyProductIdsEqual('legacy-product', 'LEGACY-PRODUCT')).toBe(false)
  })
})
