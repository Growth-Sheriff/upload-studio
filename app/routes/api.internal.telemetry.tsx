/**
 * Internal Telemetry API - On-demand endpoint
 *
 * GET /api/internal/telemetry
 *
 * Returns full telemetry payload for the billing panel.
 * Protected by x-internal-secret header.
 *
 * This is a PULL endpoint - the billing panel calls each container.
 * The PUSH approach is handled by workers/telemetry.worker.ts.
 */

import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { collectTelemetry } from '~/lib/telemetry.server'

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || process.env.CRON_SECRET || ''

export async function loader({ request }: LoaderFunctionArgs) {
  // Auth check - require internal secret
  const authHeader = request.headers.get('x-internal-secret') || ''
  if (!INTERNAL_SECRET || authHeader !== INTERNAL_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await collectTelemetry(prisma)
    return json(payload, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[Telemetry] Collection error:', error)
    return json(
      { error: 'Internal error', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
