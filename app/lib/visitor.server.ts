












import { determineReferrerType, getGeoWithFallback, parseReferrer } from './geo.server'
import { prisma } from './prisma.server'





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









export async function upsertVisitorAndSession(
  shopId: string,
  identity: VisitorIdentity,
  device: DeviceInfo,
  attribution: AttributionData,
  request: Request
): Promise<VisitorUpsertResult> {

  const geo = await getGeoWithFallback(request)


  const { referrerDomain } = parseReferrer(attribution.referrer || null)


  const referrerType = determineReferrerType(
    referrerDomain,
    attribution.utmMedium || null,
    attribution.gclid || null,
    attribution.fbclid || null,
    attribution.msclkid || null,
    attribution.ttclid || null
  )


  let landingPath: string | null = null
  if (attribution.landingPage) {
    try {
      landingPath = new URL(attribution.landingPage).pathname
    } catch {
      landingPath = null
    }
  }


  let visitor = await findVisitor(shopId, identity)
  let isNewVisitor = false
  let isNewSession = false

  if (!visitor) {

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

    await prisma.visitor.update({
      where: { id: visitor.id },
      data: {
        lastSeenAt: new Date(),

        ...(geo.country && { country: geo.country }),
        ...(geo.city && { city: geo.city }),
      },
    })
  }


  let session = await prisma.visitorSession.findUnique({
    where: {
      session_shop_token: {
        shopId,
        sessionToken: identity.sessionToken,
      },
    },
  })

  if (!session) {

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


    if (!isNewVisitor) {
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: {
          totalSessions: { increment: 1 },
        },
      })
    }
  } else {

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





async function findVisitor(shopId: string, identity: VisitorIdentity) {

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





export async function linkUploadToVisitor(
  shopId: string,
  uploadId: string,
  visitorId: string,
  sessionId: string
): Promise<void> {
  const results = await prisma.$transaction([

    prisma.upload.updateMany({
      where: { id: uploadId, shopId },
      data: { visitorId, sessionId },
    }),


    prisma.visitor.updateMany({
      where: { id: visitorId, shopId },
      data: {
        totalUploads: { increment: 1 },
      },
    }),


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




export async function recordAddToCart(shopId: string, sessionId: string): Promise<void> {
  await prisma.visitorSession.updateMany({
    where: { id: sessionId, shopId },
    data: {
      addToCartCount: { increment: 1 },
    },
  })
}




export async function recordOrderForVisitor(shopId: string, visitorId: string, orderTotal: number): Promise<void> {
  await prisma.visitor.updateMany({
    where: { id: visitorId, shopId },
    data: {
      totalOrders: { increment: 1 },
      totalRevenue: { increment: orderTotal },
    },
  })
}




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

      prisma.visitor.count({ where }),


      prisma.visitor.count({
        where: {
          ...where,
          totalSessions: { gt: 1 },
        },
      }),


      prisma.visitor.groupBy({
        by: ['country'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),


      prisma.visitorSession.groupBy({
        by: ['referrerType'],
        where: { shopId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),


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
