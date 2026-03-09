/**
 * Advanced Analytics API v1
 * Revenue attribution, cohorts, AI insights
 *
 * @route /api/v1/analytics/advanced
 * @version 2.0.0
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/node'
import { createHash } from 'crypto'
import {
  generateAIInsights,
  getAttributionStats,
  getSourceBreakdown,
  getUploadStats,
  getVisitorStats,
  getVisitorsByCountry,
  getVisitorsByDevice,
  getWeeklyCohorts,
} from '~/lib/analytics.server'
import prisma from '~/lib/prisma.server'

// Types
interface TimeRange {
  start: Date
  end: Date
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function parseTimeRange(searchParams: URLSearchParams): TimeRange {
  const now = new Date()
  const days = parseInt(searchParams.get('days') || '30', 10)

  const start = searchParams.get('start')
    ? new Date(searchParams.get('start')!)
    : new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const end = searchParams.get('end') ? new Date(searchParams.get('end')!) : now

  return { start, end }
}

async function authenticateRequest(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const apiKey = authHeader.slice(7)
  const keyHash = hashApiKey(apiKey)

  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      keyHash,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })

  if (!keyRecord) return null

  // Update last used
  await prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
  })

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { id: keyRecord.shopId },
  })

  return shop
}

// ═══════════════════════════════════════════════════════════════════════════
// LOADER - GET endpoints
// ═══════════════════════════════════════════════════════════════════════════

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await authenticateRequest(request)

  if (!shop) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const endpoint = url.searchParams.get('endpoint') || 'overview'
  const range = parseTimeRange(url.searchParams)

  try {
    switch (endpoint) {
      // ═════════════════════════════════════════════════════════════════════
      // Visitor Stats
      // ═════════════════════════════════════════════════════════════════════
      case 'visitors': {
        const stats = await getVisitorStats(shop.id, range.start, range.end)
        return json({ success: true, data: stats })
      }

      // ═════════════════════════════════════════════════════════════════════
      // Attribution Stats
      // ═════════════════════════════════════════════════════════════════════
      case 'attribution': {
        const stats = await getAttributionStats(shop.id, range.start, range.end)
        const sources = await getSourceBreakdown(shop.id, range.start, range.end)
        return json({ success: true, data: { stats, sources } })
      }

      // ═════════════════════════════════════════════════════════════════════
      // Cohort Analysis
      // ═════════════════════════════════════════════════════════════════════
      case 'cohorts': {
        const weeks = parseInt(url.searchParams.get('weeks') || '8', 10)
        const data = await getWeeklyCohorts(shop.id, weeks)
        return json({ success: true, data })
      }

      // ═════════════════════════════════════════════════════════════════════
      // Device Performance
      // ═════════════════════════════════════════════════════════════════════
      case 'devices': {
        const data = await getVisitorsByDevice(shop.id)
        return json({ success: true, data })
      }

      // ═════════════════════════════════════════════════════════════════════
      // Geo Analytics
      // ═════════════════════════════════════════════════════════════════════
      case 'geo': {
        const data = await getVisitorsByCountry(shop.id)
        return json({ success: true, data })
      }

      // ═════════════════════════════════════════════════════════════════════
      // AI Insights
      // ═════════════════════════════════════════════════════════════════════
      case 'insights': {
        const insights = await generateAIInsights(shop.id, range.start, range.end)
        return json({ success: true, data: insights })
      }

      // ═════════════════════════════════════════════════════════════════════
      // Upload Stats
      // ═════════════════════════════════════════════════════════════════════
      case 'uploads': {
        const data = await getUploadStats(shop.id, range.start, range.end)
        return json({ success: true, data })
      }

      // ═════════════════════════════════════════════════════════════════════
      // Overview (All metrics combined)
      // ═════════════════════════════════════════════════════════════════════
      case 'overview': {
        const [visitors, attribution, devices, geoData, insights, uploads] = await Promise.all([
          getVisitorStats(shop.id, range.start, range.end),
          getAttributionStats(shop.id, range.start, range.end),
          getVisitorsByDevice(shop.id),
          getVisitorsByCountry(shop.id),
          generateAIInsights(shop.id, range.start, range.end),
          getUploadStats(shop.id, range.start, range.end),
        ])

        return json({
          success: true,
          data: {
            visitors,
            attribution,
            devices,
            topCountries: geoData.slice(0, 10),
            insights,
            uploads,
          },
        })
      }

      default:
        return json({ error: `Unknown endpoint: ${endpoint}` }, { status: 400 })
    }
  } catch (error) {
    console.error('[Analytics Advanced API] Error:', error)
    return json({ error: 'Internal server error', details: String(error) }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION - POST endpoints
// ═══════════════════════════════════════════════════════════════════════════

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  const shop = await authenticateRequest(request)

  if (!shop) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const endpoint = url.searchParams.get('endpoint')

  try {
    switch (endpoint) {
      // ═════════════════════════════════════════════════════════════════════
      // Track cart addition
      // ═════════════════════════════════════════════════════════════════════
      case 'track-cart': {
        const body = await request.json()
        const { uploadId } = body

        if (!uploadId) {
          return json({ error: 'uploadId is required' }, { status: 400 })
        }

        // Verify upload belongs to shop
        const upload = await prisma.upload.findFirst({
          where: { id: uploadId, shopId: shop.id },
        })

        if (!upload) {
          return json({ error: 'Upload not found' }, { status: 404 })
        }

        // Mark upload as added to cart
        await prisma.upload.updateMany({
          where: { id: uploadId, shopId: shop.id },
          data: { addedToCartAt: new Date() },
        })

        return json({ success: true })
      }

      default:
        return json({ error: `Unknown endpoint: ${endpoint}` }, { status: 400 })
    }
  } catch (error) {
    console.error('[Analytics Advanced API] Action error:', error)
    return json({ error: 'Internal server error', details: String(error) }, { status: 500 })
  }
}
