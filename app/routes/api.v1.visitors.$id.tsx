/**
 * Visitor Detail API Endpoint
 * Get single visitor with sessions and uploads
 *
 * @route GET /api/v1/visitors/:id
 *
 * ⚠️ This is a NEW endpoint - does not modify existing flows
 */

import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { authenticateApiRequest } from '~/lib/api.server'
import { getVisitorWithSessions } from '~/lib/visitor.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Authenticate via API key (Enterprise plan required)
  const authResult = await authenticateApiRequest(request)
  if (authResult instanceof Response) return authResult

  const { shopId } = authResult

  const visitorId = params.id

  if (!visitorId) {
    return json({ error: 'Missing visitor ID' }, { status: 400 })
  }

  try {
    const visitor = await getVisitorWithSessions(shopId, visitorId)

    if (!visitor) {
      return json({ error: 'Visitor not found' }, { status: 404 })
    }

    return json({
      success: true,
      visitor,
    })
  } catch (error) {
    console.error('[Visitor Detail Error]', error)
    return json({ error: 'Failed to get visitor' }, { status: 500 })
  }
}
