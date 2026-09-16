export const SHOPIFY_VARIANT_PAGE_SIZE = 250
export const MAX_SHOPIFY_VARIANT_PAGES = 10

export interface ShopifyConnectionPageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

export interface ShopifyConnection<TEdge> {
  edges: TEdge[]
  pageInfo: ShopifyConnectionPageInfo
}

export interface ShopifyConnectionPaginationResult<TPage, TEdge> {
  firstPage: TPage
  connection: ShopifyConnection<TEdge> | null
  pagesFetched: number
}

/**
 * Loads and joins a Shopify cursor connection while retaining the complete
 * first response. Callers can therefore replace only the connection and keep
 * product/shop metadata from the same authoritative first request.
 */
export async function collectShopifyConnectionPages<TPage, TEdge>({
  fetchPage,
  getConnection,
  maxPages = MAX_SHOPIFY_VARIANT_PAGES,
}: {
  fetchPage: (after: string | null) => Promise<TPage>
  getConnection: (page: TPage) => ShopifyConnection<TEdge> | null | undefined
  maxPages?: number
}): Promise<ShopifyConnectionPaginationResult<TPage, TEdge>> {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('Shopify connection pagination requires a positive page limit')
  }

  const firstPage = await fetchPage(null)
  const firstConnection = getConnection(firstPage)
  if (!firstConnection) {
    return { firstPage, connection: null, pagesFetched: 1 }
  }

  assertValidConnection(firstConnection, 1)

  const edges = [...firstConnection.edges]
  const seenCursors = new Set<string>()
  let pageInfo = firstConnection.pageInfo
  let pagesFetched = 1

  while (pageInfo.hasNextPage) {
    if (pagesFetched >= maxPages) {
      throw new Error(
        `Shopify variant pagination exceeded the safe limit of ${maxPages} pages`
      )
    }

    const cursor = typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor.trim() : ''
    if (!cursor) {
      throw new Error('Shopify variant pagination returned hasNextPage without an end cursor')
    }
    if (seenCursors.has(cursor)) {
      throw new Error(`Shopify variant pagination repeated cursor ${cursor}`)
    }
    seenCursors.add(cursor)

    const nextPage = await fetchPage(cursor)
    const nextConnection = getConnection(nextPage)
    if (!nextConnection) {
      throw new Error('Shopify product disappeared while paginating variants')
    }

    pagesFetched += 1
    assertValidConnection(nextConnection, pagesFetched)
    edges.push(...nextConnection.edges)
    pageInfo = nextConnection.pageInfo
  }

  return {
    firstPage,
    connection: { edges, pageInfo },
    pagesFetched,
  }
}

function assertValidConnection<TEdge>(
  connection: ShopifyConnection<TEdge>,
  pageNumber: number
): void {
  if (!Array.isArray(connection.edges)) {
    throw new Error(`Shopify variant page ${pageNumber} did not contain an edge list`)
  }
  if (!connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') {
    throw new Error(`Shopify variant page ${pageNumber} did not contain valid page info`)
  }
}
