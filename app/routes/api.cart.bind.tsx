// POST /api/cart/bind — bind uploads to a Shopify cart token.
//
// After the widget adds lines to the cart it reads `token` from /cart.js and
// posts it here. ORDERS_CREATE webhooks carry the same value as
// `order.cart_token`, so even when a third-party cart app strips every line
// property, the order still resolves to its uploads server-side.
//
// Request:  { shopDomain, cartToken, uploadIds: string[] }
// Response: { success, bound }

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { corsJson, handleCorsOptions } from '~/lib/cors.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import { normalizeCartToken } from '~/lib/orderMatching.server'

const MAX_UPLOADS_PER_REQUEST = 20

// Shopify cart tokens: legacy 32-hex, or the newer base64-ish form which
// /cart.js serves with a `?key=...` suffix that order.cart_token does NOT
// carry. normalizeCartToken strips the suffix so both sides store the same value.
const CART_TOKEN_PATTERN = /^[A-Za-z0-9+/=_:-]{8,128}$/

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }
  if (request.method !== 'POST') {
    return corsJson({ success: false, error: 'Method not allowed' }, request, { status: 405 })
  }

  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  let body: { shopDomain?: string; cartToken?: string; uploadIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return corsJson({ success: false, error: 'Invalid JSON body' }, request, { status: 400 })
  }

  const shopDomain = String(body.shopDomain || '').trim()
  const cartToken = normalizeCartToken(body.cartToken)
  const uploadIds = Array.isArray(body.uploadIds)
    ? body.uploadIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(id))
    : []

  if (!shopDomain || !cartToken || !uploadIds.length || uploadIds.length > MAX_UPLOADS_PER_REQUEST) {
    return corsJson(
      { success: false, error: 'shopDomain, cartToken and 1-20 uploadIds are required' },
      request,
      { status: 400 }
    )
  }
  if (!CART_TOKEN_PATTERN.test(cartToken)) {
    return corsJson({ success: false, error: 'Invalid cart token' }, request, { status: 400 })
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) {
    return corsJson({ success: false, error: 'Shop not found' }, request, { status: 404 })
  }

  const result = await prisma.upload.updateMany({
    where: { id: { in: uploadIds }, shopId: shop.id },
    data: { cartToken, cartAddedAt: new Date() },
  })

  console.log(
    `[Cart Bind] ${result.count}/${uploadIds.length} uploads bound to cart ${cartToken.slice(0, 12)}… for ${shopDomain}`
  )

  return corsJson({ success: true, bound: result.count }, request)
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request)
  }
  return corsJson({ success: false, error: 'POST only' }, request, { status: 405 })
}
