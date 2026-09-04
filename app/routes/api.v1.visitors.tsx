import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
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
    const result = await upsertVisitorAndSession(
      shop.id,
      identity,
      device || {},
      attribution || {},
      request
    )
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
