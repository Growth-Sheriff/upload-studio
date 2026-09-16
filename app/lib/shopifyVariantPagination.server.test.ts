import { describe, expect, it, vi } from 'vitest'
import { collectShopifyConnectionPages } from './shopifyVariantPagination.server'

type Page = {
  product: {
    title: string
    variants: {
      edges: Array<{ node: { id: string } }>
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  } | null
  shop: { currencyCode: string }
}

function page(
  ids: string[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
  title = 'First-page product'
): Page {
  return {
    product: {
      title,
      variants: {
        edges: ids.map((id) => ({ node: { id } })),
        pageInfo,
      },
    },
    shop: { currencyCode: 'USD' },
  }
}

describe('collectShopifyConnectionPages', () => {
  it('merges every page in order and returns the untouched first-page metadata', async () => {
    const fetchPage = vi
      .fn<(after: string | null) => Promise<Page>>()
      .mockResolvedValueOnce(page(['1', '2'], { hasNextPage: true, endCursor: 'cursor-1' }))
      .mockResolvedValueOnce(
        page(['3'], { hasNextPage: true, endCursor: 'cursor-2' }, 'Repeated metadata')
      )
      .mockResolvedValueOnce(page(['4'], { hasNextPage: false, endCursor: 'cursor-3' }))

    const result = await collectShopifyConnectionPages({
      fetchPage,
      getConnection: (response) => response.product?.variants,
    })

    expect(fetchPage.mock.calls).toEqual([[null], ['cursor-1'], ['cursor-2']])
    expect(result.pagesFetched).toBe(3)
    expect(result.firstPage.product?.title).toBe('First-page product')
    expect(result.firstPage.shop.currencyCode).toBe('USD')
    expect(result.connection?.edges.map((edge) => edge.node.id)).toEqual(['1', '2', '3', '4'])
  })

  it('fails closed when hasNextPage has no usable cursor', async () => {
    await expect(
      collectShopifyConnectionPages({
        fetchPage: async () => page(['1'], { hasNextPage: true, endCursor: '  ' }),
        getConnection: (response) => response.product?.variants,
      })
    ).rejects.toThrow('hasNextPage without an end cursor')
  })

  it('fails closed when Shopify repeats a cursor', async () => {
    const fetchPage = vi
      .fn<(after: string | null) => Promise<Page>>()
      .mockResolvedValueOnce(page(['1'], { hasNextPage: true, endCursor: 'same' }))
      .mockResolvedValueOnce(page(['2'], { hasNextPage: true, endCursor: 'same' }))

    await expect(
      collectShopifyConnectionPages({
        fetchPage,
        getConnection: (response) => response.product?.variants,
      })
    ).rejects.toThrow('repeated cursor same')
  })

  it('fails closed before fetching beyond the configured page bound', async () => {
    const fetchPage = vi
      .fn<(after: string | null) => Promise<Page>>()
      .mockResolvedValueOnce(page(['1'], { hasNextPage: true, endCursor: 'cursor-1' }))
      .mockResolvedValueOnce(page(['2'], { hasNextPage: true, endCursor: 'cursor-2' }))

    await expect(
      collectShopifyConnectionPages({
        fetchPage,
        getConnection: (response) => response.product?.variants,
        maxPages: 2,
      })
    ).rejects.toThrow('safe limit of 2 pages')
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('returns a missing first connection without attempting another request', async () => {
    const missingPage: Page = {
      product: null,
      shop: { currencyCode: 'USD' },
    }
    const fetchPage = vi.fn(async () => missingPage)

    const result = await collectShopifyConnectionPages({
      fetchPage,
      getConnection: (response) => response.product?.variants,
    })

    expect(result.connection).toBeNull()
    expect(result.firstPage).toBe(missingPage)
    expect(fetchPage).toHaveBeenCalledOnce()
  })
})
