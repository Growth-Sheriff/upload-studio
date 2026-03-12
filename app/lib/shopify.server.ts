import crypto from 'crypto'

// Helper to normalize HOST to include https://
const normalizeHost = (host: string): string => {
  if (host.startsWith('https://') || host.startsWith('http://')) {
    return host
  }
  return `https://${host}`
}

// Shopify API configuration
export const shopifyConfig = {
  apiKey: process.env.SHOPIFY_API_KEY || '',
  apiSecret: process.env.SHOPIFY_API_SECRET || '',
  scopes: process.env.SHOPIFY_SCOPES || 'read_products,write_products,read_orders,write_orders',
  hostName: normalizeHost(process.env.APP_DOMAIN || process.env.HOST || 'localhost:3000'),
  apiVersion: '2025-10',
}

// Generate OAuth authorization URL
export function getAuthorizationUrl(shop: string, state: string): string {
  const redirectUri = `${shopifyConfig.hostName}/auth/callback`
  const scopes = shopifyConfig.scopes

  return `https://${shop}/admin/oauth/authorize?client_id=${shopifyConfig.apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
}

// Exchange authorization code for access token
export async function exchangeCodeForToken(shop: string, code: string): Promise<string> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: shopifyConfig.apiKey,
      client_secret: shopifyConfig.apiSecret,
      code,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to exchange code: ${response.statusText}`)
  }

  const data = await response.json()
  return data.access_token
}

// Verify HMAC signature from Shopify
export function verifyHmac(query: URLSearchParams): boolean {
  const hmac = query.get('hmac')
  if (!hmac) return false

  // Create a copy without hmac
  const params = new URLSearchParams(query)
  params.delete('hmac')

  // Sort parameters
  const sortedParams = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

  const hash = crypto
    .createHmac('sha256', shopifyConfig.apiSecret)
    .update(sortedParams)
    .digest('hex')

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac))
}

// Generate random state for OAuth
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

// Shopify Admin GraphQL API client
export async function shopifyGraphQL<T = unknown>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(
    `https://${shop}/admin/api/${shopifyConfig.apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  )

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.statusText}`)
  }

  const json = await response.json()

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`)
  }

  return json.data as T
}

// Get shop info
export async function getShopInfo(shop: string, accessToken: string) {
  const query = `
    query {
      shop {
        id
        name
        email
        myshopifyDomain
        plan {
          displayName
        }
      }
    }
  `

  return shopifyGraphQL<{
    shop: {
      id: string
      name: string
      email: string
      myshopifyDomain: string
      plan: { displayName: string }
    }
  }>(shop, accessToken, query)
}

// Register webhooks
export async function registerWebhooks(shop: string, accessToken: string) {
  const webhooks = [
    { topic: 'APP_UNINSTALLED', address: `${shopifyConfig.hostName}/webhooks/app-uninstalled` },
    { topic: 'ORDERS_CREATE', address: `${shopifyConfig.hostName}/webhooks/orders-create` },
    { topic: 'ORDERS_PAID', address: `${shopifyConfig.hostName}/webhooks/orders-paid` },
    { topic: 'ORDERS_CANCELLED', address: `${shopifyConfig.hostName}/webhooks/orders-cancelled` },
    { topic: 'ORDERS_FULFILLED', address: `${shopifyConfig.hostName}/webhooks/orders-fulfilled` },
    { topic: 'PRODUCTS_UPDATE', address: `${shopifyConfig.hostName}/webhooks/products-update` },
    { topic: 'PRODUCTS_DELETE', address: `${shopifyConfig.hostName}/webhooks/products-delete` },
  ]

  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `

  for (const webhook of webhooks) {
    try {
      await shopifyGraphQL(shop, accessToken, mutation, {
        topic: webhook.topic,
        webhookSubscription: {
          callbackUrl: webhook.address,
          format: 'JSON',
        },
      })
      console.log(`Registered webhook: ${webhook.topic}`)
    } catch (error) {
      console.error(`Failed to register webhook ${webhook.topic}:`, error)
    }
  }
}
