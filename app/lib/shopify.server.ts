import { freshShopifyAccessToken } from './shopifyCredential.server'

export const shopifyConfig = {
  apiVersion: '2026-10',
}

export async function shopifyGraphQLResponse(shop: string, query: string, variables?: Record<string, unknown>, timeoutMs = 5000): Promise<Response> {
  const accessToken = await freshShopifyAccessToken(shop)
  const response = await fetch(
    `https://${shop}/admin/api/${shopifyConfig.apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  )
  return response
}

/** Background billing obtains a current offline session for each request,
 * rather than retaining a client captured at the start of a long batch. */
export function backgroundShopifyAdmin(shop: string) {
  return { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => shopifyGraphQLResponse(shop, query, options?.variables, 30_000) }
}

export async function shopifyGraphQL<T = unknown>(
  shop: string,
  _cachedAccessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await shopifyGraphQLResponse(shop, query, variables)

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.statusText}`)
  }

  const json = await response.json()

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`)
  }

  return json.data as T
}
