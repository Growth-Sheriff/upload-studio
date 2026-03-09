/**
 * Visitor Server Utilities
 * Handles visitor identification, session management, and tracking
 *
 * @module visitor.server
 * @version 1.0.0
 *
 * ⚠️ IMPORTANT: This module is ADDITIVE ONLY
 * - Does NOT modify existing upload/cart/webhook flows
 * - All visitor fields are OPTIONAL/NULLABLE
 * - Mevcut sistem etkilenmez
 */

import { determineReferrerType, getGeoWithFallback, parseReferrer } from './geo.server'
import { prisma } from './prisma.server'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface VisitorIdentity {
  localStorageId: string
  fingerprint?: string | null
  sessionToken: string
}

export interface DeviceInfo {
  deviceType?: string | null
  browser?: string | null
  browserVersion?: string | null
  os?: string | null
  osVersion?: string | null
  screenResolution?: string | null
  language?: string | null
  timezone?: string | null
}

export interface AttributionData {
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmTerm?: string | null
  utmContent?: string | null
  gclid?: string | null
  fbclid?: string | null
  msclkid?: string | null
  ttclid?: string | null
  referrer?: string | null
  landingPage?: string | null
}

export interface VisitorUpsertResult {
  visitorId: string
  sessionId: string
  isNewVisitor: boolean
  isNewSession: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert visitor and session with full attribution tracking
 * This is the main entry point for visitor identification
 */
export async function upsertVisitorAndSession(
  shopId: string,
  identity: VisitorIdentity,
  device: DeviceInfo,
  attribution: AttributionData,
  request: Request
): Promise<VisitorUpsertResult> {
  // Get geo with IP-based fallback
  const geo = await getGeoWithFallback(request)

  // Parse referrer
  const { referrerDomain } = parseReferrer(attribution.referrer || null)

  // Determine referrer type
  const referrerType = determineReferrerType(
    referrerDomain,
    attribution.utmMedium || null,
    attribution.gclid || null,
    attribution.fbclid || null,
    attribution.msclkid || null,
    attribution.ttclid || null
  )

  // Parse landing page path
  let landingPath: string | null = null
  if (attribution.landingPage) {
    try {
      landingPath = new URL(attribution.landingPage).pathname
    } catch {
      landingPath = null
    }
  }

  // Try to find existing visitor
  let visitor = await findVisitor(shopId, identity)
  let isNewVisitor = false
  let isNewSession = false

  if (!visitor) {
    // Create new visitor
    visitor = await prisma.visitor.create({
      data: {
        shopId,
        localStorageId: identity.localStorageId,
        fingerprint: identity.fingerprint,
        deviceType: device.deviceType,
        browser: device.browser,
        browserVersion: device.browserVersion,
        os: device.os,
        osVersion: device.osVersion,
        screenResolution: device.screenResolution,
        language: device.language,
        timezone: device.timezone,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        totalSessions: 1,
      },
    })
    isNewVisitor = true
  } else {
    // Update last seen
    await prisma.visitor.update({
      where: { id: visitor.id },
      data: {
        lastSeenAt: new Date(),
        // Update geo if we have newer info
        ...(geo.country && { country: geo.country }),
        ...(geo.city && { city: geo.city }),
      },
    })
  }

  // Check for existing session
  let session = await prisma.visitorSession.findUnique({
    where: {
      session_shop_token: {
        shopId,
        sessionToken: identity.sessionToken,
      },
    },
  })

  if (!session) {
    // Create new session
    session = await prisma.visitorSession.create({
      data: {
        shopId,
        visitorId: visitor.id,
        sessionToken: identity.sessionToken,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign,
        utmTerm: attribution.utmTerm,
        utmContent: attribution.utmContent,
        gclid: attribution.gclid,
        fbclid: attribution.fbclid,
        msclkid: attribution.msclkid,
        ttclid: attribution.ttclid,
        referrer: attribution.referrer,
        referrerDomain,
        referrerType,
        landingPage: attribution.landingPage,
        landingPath,
      },
    })
    isNewSession = true

    // Increment visitor session count if new session
    if (!isNewVisitor) {
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: {
          totalSessions: { increment: 1 },
        },
      })
    }
  } else {
    // Update session activity
    await prisma.visitorSession.update({
      where: { id: session.id },
      data: {
        lastActivityAt: new Date(),
        pageViews: { increment: 1 },
      },
    })
  }

  return {
    visitorId: visitor.id,
    sessionId: session.id,
    isNewVisitor,
    isNewSession,
  }
}

/**
 * Find existing visitor by fingerprint or localStorage ID
 * Priority: fingerprint > localStorageId
 */
async function findVisitor(shopId: string, identity: VisitorIdentity) {
  // First try fingerprint match (more reliable)
  if (identity.fingerprint) {
    const byFingerprint = await prisma.visitor.findUnique({
      where: {
        visitor_shop_fingerprint: {
          shopId,
          fingerprint: identity.fingerprint,
        },
      },
    })
    if (byFingerprint) return byFingerprint
  }

  // Fall back to localStorage ID
  const byLocalStorage = await prisma.visitor.findUnique({
    where: {
      visitor_shop_localStorage: {
        shopId,
        localStorageId: identity.localStorageId,
      },
    },
  })

  return byLocalStorage
}

/**
 * Link upload to visitor and session
 * Called when an upload is created
 */
export async function linkUploadToVisitor(
  shopId: string,
  uploadId: string,
  visitorId: string,
  sessionId: string
): Promise<void> {
  const results = await prisma.$transaction([
    // Update upload with visitor info (scoped to shop)
    prisma.upload.updateMany({
      where: { id: uploadId, shopId },
      data: { visitorId, sessionId },
    }),

    // Increment visitor upload count (scoped to shop)
    prisma.visitor.updateMany({
      where: { id: visitorId, shopId },
      data: {
        totalUploads: { increment: 1 },
      },
    }),

    // Increment session upload count (scoped to shop)
    prisma.visitorSession.updateMany({
      where: { id: sessionId, shopId },
      data: {
        uploadsInSession: { increment: 1 },
      },
    }),
  ])

  if (results.some((r) => r.count === 0)) {
    console.warn(
      `[Tenant Guard] linkUploadToVisitor: some records not found for shop ${shopId}`
    )
  }
}

/**
 * Record add to cart event
 */
export async function recordAddToCart(shopId: string, sessionId: string): Promise<void> {
  await prisma.visitorSession.updateMany({
    where: { id: sessionId, shopId },
    data: {
      addToCartCount: { increment: 1 },
    },
  })
}

/**
 * Record order completion (called from webhook, OPTIONAL enhancement)
 */
export async function recordOrderForVisitor(shopId: string, visitorId: string, orderTotal: number): Promise<void> {
  await prisma.visitor.updateMany({
    where: { id: visitorId, shopId },
    data: {
      totalOrders: { increment: 1 },
      totalRevenue: { increment: orderTotal },
    },
  })
}

/**
 * Get visitor by ID with sessions
 */
export async function getVisitorWithSessions(shopId: string, visitorId: string) {
  return prisma.visitor.findFirst({
    where: {
      id: visitorId,
      shopId, // Tenant isolation
    },
    include: {
      sessions: {
        orderBy: { startedAt: 'desc' },
        take: 10,
      },
      uploads: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          createdAt: true,
          productId: true,
        },
      },
    },
  })
}

/**
 * Get visitor statistics for analytics dashboard
 */
export async function getVisitorStats(shopId: string, dateRange?: { start: Date; end: Date }) {
  const where = {
    shopId,
    ...(dateRange && {
      firstSeenAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
    }),
  }

  const [totalVisitors, returningVisitors, topCountries, topReferrerTypes, topCampaigns] =
    await Promise.all([
      // Total unique visitors
      prisma.visitor.count({ where }),

      // Returning visitors (more than 1 session)
      prisma.visitor.count({
        where: {
          ...where,
          totalSessions: { gt: 1 },
        },
      }),

      // Top countries
      prisma.visitor.groupBy({
        by: ['country'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // Top referrer types
      prisma.visitorSession.groupBy({
        by: ['referrerType'],
        where: { shopId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // Top campaigns
      prisma.visitorSession.groupBy({
        by: ['utmCampaign'],
        where: {
          shopId,
          utmCampaign: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ])

  return {
    totalVisitors,
    returningVisitors,
    newVisitors: totalVisitors - returningVisitors,
    returningRate: totalVisitors > 0 ? Math.round((returningVisitors / totalVisitors) * 100) : 0,
    topCountries: topCountries.map((c) => ({
      country: c.country || 'Unknown',
      count: c._count.id,
    })),
    topReferrerTypes: topReferrerTypes.map((r) => ({
      type: r.referrerType || 'direct',
      count: r._count.id,
    })),
    topCampaigns: topCampaigns.map((c) => ({
      campaign: c.utmCampaign || 'None',
      count: c._count.id,
    })),
  }
}

/**
 * Update visitor consent status
 */
export async function updateVisitorConsent(
  shopId: string,
  visitorId: string,
  consentGiven: boolean
): Promise<void> {
  await prisma.visitor.updateMany({
    where: { id: visitorId, shopId },
    data: {
      consentGiven,
      consentTimestamp: consentGiven ? new Date() : null,
      degradedMode: !consentGiven,
    },
  })
}

/**
 * Link Shopify customer to visitor (when they log in)
 */
export async function linkCustomerToVisitor(
  shopId: string,
  visitorId: string,
  shopifyCustomerId: string,
  customerEmail: string
): Promise<void> {
  await prisma.visitor.updateMany({
    where: { id: visitorId, shopId },
    data: {
      shopifyCustomerId,
      customerEmail,
    },
  })
}
