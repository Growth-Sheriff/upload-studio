import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Prisma } from '@prisma/client'
import { prisma } from '~/lib/prisma.server'
import {
  upsertVisitorAndSession,
  type AttributionData,
  type DeviceInfo,
  type VisitorIdentity,
} from '~/lib/visitor.server'

// Storefront visitor tracker (ul-visitor.js) — reached through the app proxy.
// Only the upsert action survives from the old public API; the stats loader
// went away with the merchant API keys.

interface VisitorUpsertRequest {
  shopDomain: string
  identity: VisitorIdentity
  device: DeviceInfo
  attribution: AttributionData
}

export async function loader() {
  return json({ error: 'Not found' }, { status: 404 })
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: VisitorUpsertRequest
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { shopDomain, identity, device, attribution } = body
  if (!shopDomain) {
    return json({ error: 'Missing shopDomain' }, { status: 400 })
  }
  if (!identity?.localStorageId || !identity?.sessionToken) {
    return json(
      { error: 'Missing required identity fields (localStorageId, sessionToken)' },
      { status: 400 }
    )
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  })
  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  try {
    const upsert = () =>
      upsertVisitorAndSession(shop.id, identity, device || {}, attribution || {}, request)
    // The tracker can fire twice at once for the same browser; both requests
    // miss the lookup and race on (shop_id, fingerprint). The loser retries
    // once and finds the row the winner just created.
    const result = await upsert().catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return upsert()
      throw error
    })
    return json({
      success: true,
      visitorId: result.visitorId,
      sessionId: result.sessionId,
      isNewVisitor: result.isNewVisitor,
      isNewSession: result.isNewSession,
    })
  } catch (error) {
    console.error('[Visitor Upsert Error]', error)
    return json({ error: 'Failed to upsert visitor' }, { status: 500 })
  }
}
