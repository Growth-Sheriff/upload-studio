/**
 * Visitor API Endpoint
 * Handles visitor identification and tracking
 *
 * @route POST /api/v1/visitors - Upsert visitor + session
 * @route GET /api/v1/visitors - Get visitor stats (admin)
 *
 * ⚠️ This is a NEW endpoint - does not modify existing flows
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { authenticateApiRequest } from '~/lib/api.server'
import { prisma } from '~/lib/prisma.server'
import {
  getVisitorStats,
  upsertVisitorAndSession,
  type AttributionData,
  type DeviceInfo,
  type VisitorIdentity,
} from '~/lib/visitor.server'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface VisitorUpsertRequest {
  shopDomain: string
  identity: VisitorIdentity
  device: DeviceInfo
  attribution: AttributionData
}

// ═══════════════════════════════════════════════════════════════════════════
// LOADER - GET /api/v1/visitors (Admin stats)
// ═══════════════════════════════════════════════════════════════════════════

export async function loader({ request }: LoaderFunctionArgs) {
  // Authenticate via API key (Enterprise plan required)
  const authResult = await authenticateApiRequest(request)
  if (authResult instanceof Response) return authResult

  const { shopId } = authResult

  const url = new URL(request.url)

  // Parse date range if provided
  const startDate = url.searchParams.get('start')
  const endDate = url.searchParams.get('end')

  const dateRange =
    startDate && endDate ? { start: new Date(startDate), end: new Date(endDate) } : undefined

  try {
    const stats = await getVisitorStats(shopId, dateRange)

    return json({
      success: true,
      stats,
    })
  } catch (error) {
    console.error('[Visitor Stats Error]', error)
    return json({ error: 'Failed to get visitor stats' }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION - POST /api/v1/visitors (Upsert visitor)
// ═══════════════════════════════════════════════════════════════════════════

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

  // Validate required fields
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

  // Find shop
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
