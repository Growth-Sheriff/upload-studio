







import type { Decimal } from '@prisma/client/runtime/library'
import prisma from './prisma.server'


function toNumber(value: number | Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  return Number(value)
}





export async function getShopIdFromDomain(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  })
  return shop?.id || null
}





export interface VisitorStats {
  totalVisitors: number
  newVisitors: number
  returningVisitors: number
  totalSessions: number
  avgSessionsPerVisitor: number
  visitorsWithUploads: number
  visitorsWithOrders: number
  uploadConversionRate: number
  orderConversionRate: number
}

export interface VisitorGeo {
  country: string
  count: number
  percentage: number
}

export interface VisitorDevice {
  type: string
  count: number
  percentage: number
}

export interface VisitorBrowser {
  name: string
  count: number
  percentage: number
}

export interface DailyVisitors {
  date: string
  visitors: number
  sessions: number
  newVisitors: number
}

export interface TopVisitor {
  id: string
  email: string | null
  country: string | null
  deviceType: string | null
  browser: string | null
  totalSessions: number
  totalUploads: number
  totalOrders: number
  firstSeenAt: Date
  lastSeenAt: Date
}

export async function getVisitorStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<VisitorStats> {
  const [totalVisitors, newVisitors, totalSessions, visitorsWithUploads, visitorsWithOrders] =
    await Promise.all([
      prisma.visitor.count({ where: { shopId } }),
      prisma.visitor.count({
        where: { shopId, firstSeenAt: { gte: startDate, lte: endDate } },
      }),
      prisma.visitorSession.count({
        where: { shopId, startedAt: { gte: startDate, lte: endDate } },
      }),
      prisma.visitor.count({
        where: { shopId, totalUploads: { gt: 0 } },
      }),
      prisma.visitor.count({
        where: { shopId, totalOrders: { gt: 0 } },
      }),
    ])

  const returningVisitors = await prisma.visitor.count({
    where: { shopId, totalSessions: { gt: 1 } },
  })

  const avgSessionsPerVisitor = totalVisitors > 0 ? totalSessions / totalVisitors : 0
  const uploadConversionRate = totalVisitors > 0 ? (visitorsWithUploads / totalVisitors) * 100 : 0
  const orderConversionRate = totalVisitors > 0 ? (visitorsWithOrders / totalVisitors) * 100 : 0

  return {
    totalVisitors,
    newVisitors,
    returningVisitors,
    totalSessions,
    avgSessionsPerVisitor,
    visitorsWithUploads,
    visitorsWithOrders,
    uploadConversionRate,
    orderConversionRate,
  }
}

export async function getVisitorsByCountry(shopId: string): Promise<VisitorGeo[]> {
  const results = await prisma.visitor.groupBy({
    by: ['country'],
    where: { shopId, country: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 15,
  })

  const total = results.reduce((sum, r) => sum + r._count.id, 0)

  return results.map((r) => ({
    country: r.country || 'Unknown',
    count: r._count.id,
    percentage: total > 0 ? (r._count.id / total) * 100 : 0,
  }))
}

export async function getVisitorsByDevice(shopId: string): Promise<VisitorDevice[]> {
  const results = await prisma.visitor.groupBy({
    by: ['deviceType'],
    where: { shopId },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  const total = results.reduce((sum, r) => sum + r._count.id, 0)

  return results.map((r) => ({
    type: r.deviceType || 'Unknown',
    count: r._count.id,
    percentage: total > 0 ? (r._count.id / total) * 100 : 0,
  }))
}

export async function getVisitorsByBrowser(shopId: string): Promise<VisitorBrowser[]> {
  const results = await prisma.visitor.groupBy({
    by: ['browser'],
    where: { shopId, browser: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  const total = results.reduce((sum, r) => sum + r._count.id, 0)

  return results.map((r) => ({
    name: r.browser || 'Unknown',
    count: r._count.id,
    percentage: total > 0 ? (r._count.id / total) * 100 : 0,
  }))
}

export async function getDailyVisitors(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<DailyVisitors[]> {

  const sessions = await prisma.visitorSession.findMany({
    where: { shopId, startedAt: { gte: startDate, lte: endDate } },
    select: { startedAt: true, visitorId: true },
  })

  const visitors = await prisma.visitor.findMany({
    where: { shopId, firstSeenAt: { gte: startDate, lte: endDate } },
    select: { firstSeenAt: true },
  })


  const dayMap = new Map<string, { visitors: Set<string>; sessions: number; newVisitors: number }>()

  sessions.forEach((s) => {
    const day = s.startedAt.toISOString().split('T')[0]
    if (!dayMap.has(day)) {
      dayMap.set(day, { visitors: new Set(), sessions: 0, newVisitors: 0 })
    }
    const data = dayMap.get(day)!
    data.visitors.add(s.visitorId)
    data.sessions++
  })

  visitors.forEach((v) => {
    const day = v.firstSeenAt.toISOString().split('T')[0]
    if (dayMap.has(day)) {
      dayMap.get(day)!.newVisitors++
    }
  })

  return Array.from(dayMap.entries())
    .map(([date, data]) => ({
      date,
      visitors: data.visitors.size,
      sessions: data.sessions,
      newVisitors: data.newVisitors,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getTopVisitors(shopId: string, limit = 20): Promise<TopVisitor[]> {
  const visitors = await prisma.visitor.findMany({
    where: { shopId },
    orderBy: [{ totalOrders: 'desc' }, { totalUploads: 'desc' }, { totalSessions: 'desc' }],
    take: limit,
    select: {
      id: true,
      customerEmail: true,
      country: true,
      deviceType: true,
      browser: true,
      totalSessions: true,
      totalUploads: true,
      totalOrders: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  })


  return visitors.map((v) => ({
    ...v,
    email: v.customerEmail,
  }))
}





export interface AttributionStats {
  totalSessions: number
  sessionsWithUTM: number
  utmPercentage: number
  topSource: string
  topMedium: string
  paidClicks: number
}

export interface SourceBreakdown {
  source: string
  sessions: number
  uploads: number
  orders: number
  conversionRate: number
}

export interface MediumBreakdown {
  medium: string
  sessions: number
  uploads: number
  percentage: number
}

export interface CampaignBreakdown {
  campaign: string
  sessions: number
  uploads: number
  source: string | null
}

export interface ClickIdStats {
  gclid: number
  fbclid: number
  msclkid: number
  ttclid: number
  total: number
}

export interface ReferrerBreakdown {
  type: string
  sessions: number
  percentage: number
}

export async function getAttributionStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<AttributionStats> {
  const [totalSessions, sessionsWithUTM] = await Promise.all([
    prisma.visitorSession.count({
      where: { shopId, startedAt: { gte: startDate, lte: endDate } },
    }),
    prisma.visitorSession.count({
      where: {
        shopId,
        startedAt: { gte: startDate, lte: endDate },
        utmSource: { not: null },
      },
    }),
  ])


  const topSourceResult = await prisma.visitorSession.groupBy({
    by: ['utmSource'],
    where: { shopId, startedAt: { gte: startDate, lte: endDate }, utmSource: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  })


  const topMediumResult = await prisma.visitorSession.groupBy({
    by: ['utmMedium'],
    where: { shopId, startedAt: { gte: startDate, lte: endDate }, utmMedium: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  })


  const paidClicks = await prisma.visitorSession.count({
    where: {
      shopId,
      startedAt: { gte: startDate, lte: endDate },
      OR: [
        { gclid: { not: null } },
        { fbclid: { not: null } },
        { msclkid: { not: null } },
        { ttclid: { not: null } },
      ],
    },
  })

  return {
    totalSessions,
    sessionsWithUTM,
    utmPercentage: totalSessions > 0 ? (sessionsWithUTM / totalSessions) * 100 : 0,
    topSource: topSourceResult[0]?.utmSource || 'N/A',
    topMedium: topMediumResult[0]?.utmMedium || 'N/A',
    paidClicks,
  }
}

export async function getSourceBreakdown(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<SourceBreakdown[]> {
  const sessions = await prisma.visitorSession.groupBy({
    by: ['utmSource'],
    where: { shopId, startedAt: { gte: startDate, lte: endDate } },
    _count: { id: true },
    _sum: { uploadsInSession: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  return sessions.map((s) => ({
    source: s.utmSource || 'direct',
    sessions: s._count.id,
    uploads: s._sum.uploadsInSession || 0,
    orders: 0,
    conversionRate: s._count.id > 0 ? ((s._sum.uploadsInSession || 0) / s._count.id) * 100 : 0,
  }))
}

export async function getMediumBreakdown(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<MediumBreakdown[]> {
  const sessions = await prisma.visitorSession.groupBy({
    by: ['utmMedium'],
    where: { shopId, startedAt: { gte: startDate, lte: endDate } },
    _count: { id: true },
    _sum: { uploadsInSession: true },
    orderBy: { _count: { id: 'desc' } },
  })

  const total = sessions.reduce((sum, s) => sum + s._count.id, 0)

  return sessions.map((s) => ({
    medium: s.utmMedium || 'none',
    sessions: s._count.id,
    uploads: s._sum.uploadsInSession || 0,
    percentage: total > 0 ? (s._count.id / total) * 100 : 0,
  }))
}

export async function getCampaignBreakdown(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<CampaignBreakdown[]> {
  const sessions = await prisma.visitorSession.groupBy({
    by: ['utmCampaign', 'utmSource'],
    where: { shopId, startedAt: { gte: startDate, lte: endDate }, utmCampaign: { not: null } },
    _count: { id: true },
    _sum: { uploadsInSession: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  return sessions.map((s) => ({
    campaign: s.utmCampaign || 'unknown',
    sessions: s._count.id,
    uploads: s._sum.uploadsInSession || 0,
    source: s.utmSource,
  }))
}

export async function getClickIdStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<ClickIdStats> {
  const [gclid, fbclid, msclkid, ttclid] = await Promise.all([
    prisma.visitorSession.count({
      where: { shopId, startedAt: { gte: startDate, lte: endDate }, gclid: { not: null } },
    }),
    prisma.visitorSession.count({
      where: { shopId, startedAt: { gte: startDate, lte: endDate }, fbclid: { not: null } },
    }),
    prisma.visitorSession.count({
      where: { shopId, startedAt: { gte: startDate, lte: endDate }, msclkid: { not: null } },
    }),
    prisma.visitorSession.count({
      where: { shopId, startedAt: { gte: startDate, lte: endDate }, ttclid: { not: null } },
    }),
  ])

  return {
    gclid,
    fbclid,
    msclkid,
    ttclid,
    total: gclid + fbclid + msclkid + ttclid,
  }
}

export async function getReferrerBreakdown(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<ReferrerBreakdown[]> {
  const sessions = await prisma.visitorSession.groupBy({
    by: ['referrerType'],
    where: { shopId, startedAt: { gte: startDate, lte: endDate } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  const total = sessions.reduce((sum, s) => sum + s._count.id, 0)

  return sessions.map((s) => ({
    type: s.referrerType || 'direct',
    sessions: s._count.id,
    percentage: total > 0 ? (s._count.id / total) * 100 : 0,
  }))
}





export interface WeeklyCohort {
  weekStart: string
  totalVisitors: number
  week0: number
  week1: number
  week2: number
  week3: number
  week4: number
}

export async function getWeeklyCohorts(shopId: string, weeks = 8): Promise<WeeklyCohort[]> {
  const cohorts: WeeklyCohort[] = []
  const now = new Date()

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - 7 * (i + 1))
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)


    const cohortVisitors = await prisma.visitor.findMany({
      where: {
        shopId,
        firstSeenAt: { gte: weekStart, lt: weekEnd },
      },
      select: { id: true },
    })

    const visitorIds = cohortVisitors.map((v) => v.id)
    const totalVisitors = visitorIds.length

    if (totalVisitors === 0) {
      cohorts.push({
        weekStart: weekStart.toISOString().split('T')[0],
        totalVisitors: 0,
        week0: 0,
        week1: 0,
        week2: 0,
        week3: 0,
        week4: 0,
      })
      continue
    }


    const retentionCounts = [0, 0, 0, 0, 0]

    for (let w = 0; w <= 4 && i - w >= 0; w++) {
      const retentionStart = new Date(weekStart)
      retentionStart.setDate(retentionStart.getDate() + 7 * w)

      const retentionEnd = new Date(retentionStart)
      retentionEnd.setDate(retentionEnd.getDate() + 7)

      if (retentionEnd <= now) {
        const activeCount = await prisma.visitorSession.count({
          where: {
            shopId,
            visitorId: { in: visitorIds },
            startedAt: { gte: retentionStart, lt: retentionEnd },
          },
        })


        const uniqueActive = await prisma.visitorSession.groupBy({
          by: ['visitorId'],
          where: {
            shopId,
            visitorId: { in: visitorIds },
            startedAt: { gte: retentionStart, lt: retentionEnd },
          },
        })

        retentionCounts[w] = uniqueActive.length
      }
    }

    cohorts.push({
      weekStart: weekStart.toISOString().split('T')[0],
      totalVisitors,
      week0: totalVisitors > 0 ? Math.round((retentionCounts[0] / totalVisitors) * 100) : 0,
      week1: totalVisitors > 0 ? Math.round((retentionCounts[1] / totalVisitors) * 100) : 0,
      week2: totalVisitors > 0 ? Math.round((retentionCounts[2] / totalVisitors) * 100) : 0,
      week3: totalVisitors > 0 ? Math.round((retentionCounts[3] / totalVisitors) * 100) : 0,
      week4: totalVisitors > 0 ? Math.round((retentionCounts[4] / totalVisitors) * 100) : 0,
    })
  }

  return cohorts
}





export interface AIInsight {
  id: string
  type: 'positive' | 'negative' | 'neutral' | 'suggestion'
  title: string
  description: string
  metric?: string
  change?: number
  priority: 'high' | 'medium' | 'low'
}

export async function generateAIInsights(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<AIInsight[]> {
  const insights: AIInsight[] = []


  const stats = await getVisitorStats(shopId, startDate, endDate)


  const periodLength = endDate.getTime() - startDate.getTime()
  const prevStart = new Date(startDate.getTime() - periodLength)
  const prevEnd = startDate
  const prevStats = await getVisitorStats(shopId, prevStart, prevEnd)


  if (prevStats.totalVisitors > 0) {
    const growth = ((stats.newVisitors - prevStats.newVisitors) / prevStats.newVisitors) * 100
    if (growth > 20) {
      insights.push({
        id: 'visitor-growth',
        type: 'positive',
        title: 'Strong Visitor Growth',
        description: `New visitors increased by ${growth.toFixed(1)}% compared to the previous period.`,
        metric: `${stats.newVisitors} new visitors`,
        change: growth,
        priority: 'high',
      })
    } else if (growth < -20) {
      insights.push({
        id: 'visitor-decline',
        type: 'negative',
        title: 'Visitor Decline',
        description: `New visitors decreased by ${Math.abs(growth).toFixed(1)}% compared to the previous period.`,
        metric: `${stats.newVisitors} new visitors`,
        change: growth,
        priority: 'high',
      })
    }
  }


  if (stats.uploadConversionRate > 15) {
    insights.push({
      id: 'good-upload-rate',
      type: 'positive',
      title: 'Excellent Upload Conversion',
      description: `${stats.uploadConversionRate.toFixed(1)}% of visitors are uploading designs. This is above average.`,
      metric: `${stats.visitorsWithUploads} uploaders`,
      priority: 'medium',
    })
  } else if (stats.uploadConversionRate < 5 && stats.totalVisitors > 50) {
    insights.push({
      id: 'low-upload-rate',
      type: 'suggestion',
      title: 'Low Upload Conversion',
      description:
        'Consider improving the upload flow visibility or adding incentives to increase uploads.',
      metric: `${stats.uploadConversionRate.toFixed(1)}% conversion`,
      priority: 'high',
    })
  }


  const returnRate =
    stats.totalVisitors > 0 ? (stats.returningVisitors / stats.totalVisitors) * 100 : 0
  if (returnRate > 30) {
    insights.push({
      id: 'good-retention',
      type: 'positive',
      title: 'Strong Customer Loyalty',
      description: `${returnRate.toFixed(1)}% of visitors return for multiple sessions, indicating good engagement.`,
      metric: `${stats.returningVisitors} returning visitors`,
      priority: 'medium',
    })
  }


  const devices = await getVisitorsByDevice(shopId)
  const mobileDevice = devices.find((d) => d.type === 'mobile')
  if (mobileDevice && mobileDevice.percentage > 60) {
    insights.push({
      id: 'mobile-heavy',
      type: 'neutral',
      title: 'Mobile-First Audience',
      description: `${mobileDevice.percentage.toFixed(1)}% of visitors use mobile devices. Ensure your upload flow is mobile-optimized.`,
      metric: `${mobileDevice.count} mobile visitors`,
      priority: 'medium',
    })
  }


  if (insights.length === 0) {
    insights.push({
      id: 'collect-more-data',
      type: 'neutral',
      title: 'Gathering Data',
      description: 'Continue collecting visitor data to generate personalized insights.',
      priority: 'low',
    })
  }

  return insights
}





export interface UploadStats {
  totalUploads: number
  completedUploads: number
  failedUploads: number
  successRate: number
  avgFileSize: number
  totalDataTransferred: number
  totalItems: number
}

export async function getUploadStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<UploadStats> {
  const [total, completed, failed] = await Promise.all([
    prisma.upload.count({
      where: { shopId, createdAt: { gte: startDate, lte: endDate } },
    }),
    prisma.upload.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        status: { in: ['uploaded', 'ready', 'completed', 'approved'] },
      },
    }),
    prisma.upload.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        status: 'failed',
      },
    }),
  ])


  const uploadIds = await prisma.upload.findMany({
    where: { shopId, createdAt: { gte: startDate, lte: endDate } },
    select: { id: true },
  })

  const itemStats = await prisma.uploadItem.aggregate({
    where: { uploadId: { in: uploadIds.map((u) => u.id) } },
    _avg: { fileSize: true },
    _sum: { fileSize: true },
    _count: { id: true },
  })

  return {
    totalUploads: total,
    completedUploads: completed,
    failedUploads: failed,
    successRate: total > 0 ? (completed / total) * 100 : 0,
    avgFileSize: itemStats._avg?.fileSize ?? 0,
    totalDataTransferred: itemStats._sum?.fileSize ?? 0,
    totalItems: itemStats._count?.id ?? 0,
  }
}





export interface CustomerSegmentation {
  loggedInCustomers: number
  anonymousVisitors: number
  loggedInPercentage: number
  loggedInUploads: number
  anonymousUploads: number
  loggedInOrders: number
  anonymousOrders: number
  loggedInRevenue: number
  anonymousRevenue: number
  loggedInConversionRate: number
  anonymousConversionRate: number
}

export interface CustomerMetrics {
  uniqueCustomers: number
  repeatCustomers: number
  newCustomers: number
  avgUploadsPerCustomer: number
  avgOrdersPerCustomer: number
  avgRevenuePerCustomer: number
  topCustomerRevenue: number
}

export interface CustomerByValue {
  customerId: string
  customerEmail: string | null
  totalUploads: number
  totalOrders: number
  totalRevenue: number
  firstPurchaseDate: Date | null
  lastPurchaseDate: Date | null
}

export async function getCustomerSegmentation(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<CustomerSegmentation> {

  const [
    loggedInCustomers,
    anonymousVisitors,
    loggedInUploads,
    anonymousUploads,
    uploadsWithOrders,
  ] = await Promise.all([

    prisma.upload
      .groupBy({
        by: ['customerId'],
        where: {
          shopId,
          createdAt: { gte: startDate, lte: endDate },
          customerId: { not: null },
        },
      })
      .then((r) => r.length),


    prisma.upload.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        customerId: null,
      },
    }),


    prisma.upload.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        customerId: { not: null },
      },
    }),


    prisma.upload.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        customerId: null,
      },
    }),


    prisma.upload.findMany({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        orderId: { not: null },
      },
      select: {
        customerId: true,
        orderTotal: true,
      },
    }),
  ])


  let loggedInOrders = 0
  let anonymousOrders = 0
  let loggedInRevenue = 0
  let anonymousRevenue = 0

  uploadsWithOrders.forEach((u) => {
    if (u.customerId) {
      loggedInOrders++
      loggedInRevenue += toNumber(u.orderTotal)
    } else {
      anonymousOrders++
      anonymousRevenue += toNumber(u.orderTotal)
    }
  })

  const totalCustomers = loggedInCustomers + anonymousVisitors
  const loggedInPercentage = totalCustomers > 0 ? (loggedInCustomers / totalCustomers) * 100 : 0

  const loggedInConversionRate = loggedInUploads > 0 ? (loggedInOrders / loggedInUploads) * 100 : 0
  const anonymousConversionRate =
    anonymousUploads > 0 ? (anonymousOrders / anonymousUploads) * 100 : 0

  return {
    loggedInCustomers,
    anonymousVisitors,
    loggedInPercentage,
    loggedInUploads,
    anonymousUploads,
    loggedInOrders,
    anonymousOrders,
    loggedInRevenue,
    anonymousRevenue,
    loggedInConversionRate,
    anonymousConversionRate,
  }
}

export async function getCustomerMetrics(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<CustomerMetrics> {

  const uploads = await prisma.upload.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
      customerId: { not: null },
    },
    select: {
      customerId: true,
      orderId: true,
      orderTotal: true,
      createdAt: true,
    },
  })


  const customerMap = new Map<
    string,
    {
      uploads: number
      orders: number
      revenue: number
      firstSeen: Date
      lastSeen: Date
    }
  >()

  uploads.forEach((u) => {
    if (!u.customerId) return

    const existing = customerMap.get(u.customerId)
    if (existing) {
      existing.uploads++
      if (u.orderId) existing.orders++
      existing.revenue += toNumber(u.orderTotal)
      if (u.createdAt < existing.firstSeen) existing.firstSeen = u.createdAt
      if (u.createdAt > existing.lastSeen) existing.lastSeen = u.createdAt
    } else {
      customerMap.set(u.customerId, {
        uploads: 1,
        orders: u.orderId ? 1 : 0,
        revenue: toNumber(u.orderTotal),
        firstSeen: u.createdAt,
        lastSeen: u.createdAt,
      })
    }
  })

  const uniqueCustomers = customerMap.size
  const repeatCustomers = Array.from(customerMap.values()).filter((c) => c.uploads > 1).length


  const newCustomers = Array.from(customerMap.values()).filter(
    (c) => c.firstSeen >= startDate
  ).length


  let totalUploads = 0
  let totalOrders = 0
  let totalRevenue = 0
  let topRevenue = 0

  customerMap.forEach((c) => {
    totalUploads += c.uploads
    totalOrders += c.orders
    totalRevenue += c.revenue
    if (c.revenue > topRevenue) topRevenue = c.revenue
  })

  return {
    uniqueCustomers,
    repeatCustomers,
    newCustomers,
    avgUploadsPerCustomer: uniqueCustomers > 0 ? totalUploads / uniqueCustomers : 0,
    avgOrdersPerCustomer: uniqueCustomers > 0 ? totalOrders / uniqueCustomers : 0,
    avgRevenuePerCustomer: uniqueCustomers > 0 ? totalRevenue / uniqueCustomers : 0,
    topCustomerRevenue: topRevenue,
  }
}

export async function getTopCustomersByValue(
  shopId: string,
  limit = 20
): Promise<CustomerByValue[]> {
  const uploads = await prisma.upload.findMany({
    where: {
      shopId,
      customerId: { not: null },
    },
    select: {
      customerId: true,
      customerEmail: true,
      orderId: true,
      orderTotal: true,
      orderPaidAt: true,
      createdAt: true,
    },
  })


  const customerMap = new Map<string, CustomerByValue>()

  uploads.forEach((u) => {
    if (!u.customerId) return

    const existing = customerMap.get(u.customerId)
    if (existing) {
      existing.totalUploads++
      if (u.orderId) {
        existing.totalOrders++
        existing.totalRevenue += toNumber(u.orderTotal)
        if (
          u.orderPaidAt &&
          (!existing.lastPurchaseDate || u.orderPaidAt > existing.lastPurchaseDate)
        ) {
          existing.lastPurchaseDate = u.orderPaidAt
        }
        if (
          u.orderPaidAt &&
          (!existing.firstPurchaseDate || u.orderPaidAt < existing.firstPurchaseDate)
        ) {
          existing.firstPurchaseDate = u.orderPaidAt
        }
      }

      if (u.customerEmail && !existing.customerEmail) {
        existing.customerEmail = u.customerEmail
      }
    } else {
      customerMap.set(u.customerId, {
        customerId: u.customerId,
        customerEmail: u.customerEmail,
        totalUploads: 1,
        totalOrders: u.orderId ? 1 : 0,
        totalRevenue: toNumber(u.orderTotal),
        firstPurchaseDate: u.orderPaidAt,
        lastPurchaseDate: u.orderPaidAt,
      })
    }
  })


  return Array.from(customerMap.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, limit)
}





export interface FileMetrics {
  avgFileSize: number
  medianFileSize: number
  totalDataTransferred: number
  avgUploadDuration: number
  medianUploadDuration: number
  fileSizeDistribution: {
    range: string
    count: number
    percentage: number
  }[]
  uploadSpeedAvg: number
}

export interface FileTypeBreakdown {
  mimeType: string
  count: number
  percentage: number
  avgSize: number
}

export async function getFileMetrics(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<FileMetrics> {

  const items = await prisma.uploadItem.findMany({
    where: {
      upload: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
      },
    },
  })

  if (items.length === 0) {
    return {
      avgFileSize: 0,
      medianFileSize: 0,
      totalDataTransferred: 0,
      avgUploadDuration: 0,
      medianUploadDuration: 0,
      fileSizeDistribution: [],
      uploadSpeedAvg: 0,
    }
  }


  const fileSizes = items.map((i) => i.fileSize || 0).filter((s) => s > 0)
  const uploadDurations = items
    .map((i) => (i as any).uploadDurationMs || 0)
    .filter((d: number) => d > 0)

  fileSizes.sort((a, b) => a - b)
  uploadDurations.sort((a, b) => a - b)

  const avgFileSize =
    fileSizes.length > 0 ? fileSizes.reduce((a, b) => a + b, 0) / fileSizes.length : 0
  const medianFileSize = fileSizes.length > 0 ? fileSizes[Math.floor(fileSizes.length / 2)] : 0
  const totalDataTransferred = fileSizes.reduce((a, b) => a + b, 0)

  const avgUploadDuration =
    uploadDurations.length > 0
      ? uploadDurations.reduce((a, b) => a + b, 0) / uploadDurations.length
      : 0
  const medianUploadDuration =
    uploadDurations.length > 0 ? uploadDurations[Math.floor(uploadDurations.length / 2)] : 0


  let totalSpeed = 0
  let speedCount = 0
  items.forEach((i) => {
    const durationMs = (i as any).uploadDurationMs
    if (i.fileSize && durationMs && durationMs > 0) {
      totalSpeed += (i.fileSize / durationMs) * 1000
      speedCount++
    }
  })
  const uploadSpeedAvg = speedCount > 0 ? totalSpeed / speedCount : 0


  const sizeRanges = [
    { range: '< 500 KB', min: 0, max: 500 * 1024 },
    { range: '500 KB - 1 MB', min: 500 * 1024, max: 1024 * 1024 },
    { range: '1 - 5 MB', min: 1024 * 1024, max: 5 * 1024 * 1024 },
    { range: '5 - 10 MB', min: 5 * 1024 * 1024, max: 10 * 1024 * 1024 },
    { range: '> 10 MB', min: 10 * 1024 * 1024, max: Infinity },
  ]

  const distribution = sizeRanges.map((r) => {
    const count = fileSizes.filter((s) => s >= r.min && s < r.max).length
    return {
      range: r.range,
      count,
      percentage: fileSizes.length > 0 ? (count / fileSizes.length) * 100 : 0,
    }
  })

  return {
    avgFileSize,
    medianFileSize,
    totalDataTransferred,
    avgUploadDuration,
    medianUploadDuration,
    fileSizeDistribution: distribution,
    uploadSpeedAvg,
  }
}

export async function getFileTypeBreakdown(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<FileTypeBreakdown[]> {
  const items = await prisma.uploadItem.groupBy({
    by: ['mimeType'],
    where: {
      upload: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
      },
    },
    _count: { id: true },
    _avg: { fileSize: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  const total = items.reduce((sum, i) => sum + i._count.id, 0)

  return items.map((i) => ({
    mimeType: i.mimeType || 'unknown',
    count: i._count.id,
    percentage: total > 0 ? (i._count.id / total) * 100 : 0,
    avgSize: i._avg.fileSize || 0,
  }))
}





export interface VisitorOS {
  os: string
  count: number
  percentage: number
}

export interface ScreenResolution {
  resolution: string
  count: number
  percentage: number
}

export interface VisitorTimezone {
  timezone: string
  count: number
  percentage: number
}

export interface VisitorLanguage {
  language: string
  count: number
  percentage: number
}

export async function getVisitorsByOS(shopId: string): Promise<VisitorOS[]> {
  const results = await prisma.visitor.groupBy({
    by: ['os'],
    where: { shopId, os: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  const total = results.reduce((sum, r) => sum + r._count.id, 0)

  return results.map((r) => ({
    os: r.os || 'Unknown',
    count: r._count.id,
    percentage: total > 0 ? (r._count.id / total) * 100 : 0,
  }))
}

export async function getVisitorsByScreenResolution(shopId: string): Promise<ScreenResolution[]> {
  const results = await prisma.visitor.groupBy({
    by: ['screenResolution'],
    where: { shopId, screenResolution: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  const total = results.reduce((sum, r) => sum + r._count.id, 0)

  return results.map((r) => ({
    resolution: r.screenResolution || 'Unknown',
    count: r._count.id,
    percentage: total > 0 ? (r._count.id / total) * 100 : 0,
  }))
}

export async function getVisitorsByTimezone(shopId: string): Promise<VisitorTimezone[]> {
  const results = await prisma.visitor.groupBy({
    by: ['timezone'],
    where: { shopId, timezone: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 15,
  })

  const total = results.reduce((sum, r) => sum + r._count.id, 0)

  return results.map((r) => ({
    timezone: r.timezone || 'Unknown',
    count: r._count.id,
    percentage: total > 0 ? (r._count.id / total) * 100 : 0,
  }))
}

export async function getVisitorsByLanguage(shopId: string): Promise<VisitorLanguage[]> {
  const results = await prisma.visitor.groupBy({
    by: ['language'],
    where: { shopId, language: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  const total = results.reduce((sum, r) => sum + r._count.id, 0)

  return results.map((r) => ({
    language: r.language || 'Unknown',
    count: r._count.id,
    percentage: total > 0 ? (r._count.id / total) * 100 : 0,
  }))
}





export interface RevenueStats {
  totalRevenue: number
  avgOrderValue: number
  totalOrders: number
  revenueByMode: { mode: string; revenue: number; orders: number }[]
  revenueByDay: { date: string; revenue: number; orders: number }[]
  conversionFunnel: {
    visitors: number
    uploads: number
    cartAdds: number
    orders: number
  }
}

export async function getRevenueStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<RevenueStats> {

  const uploads = await prisma.upload.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      mode: true,
      orderId: true,
      orderTotal: true,
      orderCurrency: true,
      orderPaidAt: true,
      cartAddedAt: true,
      createdAt: true,
    },
  })


  let totalRevenue = 0
  let totalOrders = 0
  const ordersSet = new Set<string>()

  uploads.forEach((u) => {
    if (u.orderId && !ordersSet.has(u.orderId)) {
      ordersSet.add(u.orderId)
      totalRevenue += toNumber(u.orderTotal)
      totalOrders++
    }
  })

  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0


  const modeMap = new Map<string, { revenue: number; orders: Set<string> }>()
  uploads.forEach((u) => {
    if (!u.orderId) return
    const existing = modeMap.get(u.mode)
    if (existing) {
      if (!existing.orders.has(u.orderId)) {
        existing.orders.add(u.orderId)
        existing.revenue += toNumber(u.orderTotal)
      }
    } else {
      const orderSet = new Set<string>()
      orderSet.add(u.orderId)
      modeMap.set(u.mode, {
        revenue: toNumber(u.orderTotal),
        orders: orderSet,
      })
    }
  })

  const revenueByMode = Array.from(modeMap.entries()).map(([mode, data]) => ({
    mode,
    revenue: data.revenue,
    orders: data.orders.size,
  }))


  const dayMap = new Map<string, { revenue: number; orders: Set<string> }>()
  uploads.forEach((u) => {
    if (!u.orderId || !u.orderPaidAt) return
    const day = u.orderPaidAt.toISOString().split('T')[0]
    const existing = dayMap.get(day)
    if (existing) {
      if (!existing.orders.has(u.orderId)) {
        existing.orders.add(u.orderId)
        existing.revenue += toNumber(u.orderTotal)
      }
    } else {
      const orderSet = new Set<string>()
      orderSet.add(u.orderId)
      dayMap.set(day, {
        revenue: toNumber(u.orderTotal),
        orders: orderSet,
      })
    }
  })

  const revenueByDay = Array.from(dayMap.entries())
    .map(([date, data]) => ({
      date,
      revenue: data.revenue,
      orders: data.orders.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))


  const [visitors, uploadsCount, cartAdds] = await Promise.all([
    prisma.visitor.count({
      where: { shopId, firstSeenAt: { gte: startDate, lte: endDate } },
    }),
    prisma.upload.count({
      where: { shopId, createdAt: { gte: startDate, lte: endDate } },
    }),
    prisma.upload.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        cartAddedAt: { not: null },
      },
    }),
  ])

  return {
    totalRevenue,
    avgOrderValue,
    totalOrders,
    revenueByMode,
    revenueByDay,
    conversionFunnel: {
      visitors,
      uploads: uploadsCount,
      cartAdds,
      orders: totalOrders,
    },
  }
}





export async function generateEnhancedAIInsights(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<AIInsight[]> {
  const insights: AIInsight[] = []


  const [
    visitorStats,
    uploadStats,
    customerSegmentation,
    customerMetrics,
    fileMetrics,
    revenueStats,
    deviceData,
  ] = await Promise.all([
    getVisitorStats(shopId, startDate, endDate),
    getUploadStats(shopId, startDate, endDate),
    getCustomerSegmentation(shopId, startDate, endDate),
    getCustomerMetrics(shopId, startDate, endDate),
    getFileMetrics(shopId, startDate, endDate),
    getRevenueStats(shopId, startDate, endDate),
    getVisitorsByDevice(shopId),
  ])


  if (
    customerSegmentation.loggedInConversionRate >
    customerSegmentation.anonymousConversionRate * 1.5
  ) {
    insights.push({
      id: 'logged-in-converts-better',
      type: 'positive',
      title: 'Logged-in Customers Convert Better',
      description: `Logged-in customers have ${customerSegmentation.loggedInConversionRate.toFixed(1)}% conversion rate vs ${customerSegmentation.anonymousConversionRate.toFixed(1)}% for anonymous visitors. Consider adding login incentives.`,
      metric: `${customerSegmentation.loggedInOrders} orders from logged-in users`,
      priority: 'high',
    })
  }


  if (customerSegmentation.anonymousVisitors > customerSegmentation.loggedInCustomers * 2) {
    insights.push({
      id: 'anonymous-opportunity',
      type: 'suggestion',
      title: 'High Anonymous Traffic',
      description: `${customerSegmentation.anonymousVisitors} anonymous uploads vs ${customerSegmentation.loggedInCustomers} logged-in customers. Implement email capture to improve conversion.`,
      metric: `${((customerSegmentation.anonymousVisitors / (customerSegmentation.anonymousVisitors + customerSegmentation.loggedInCustomers)) * 100).toFixed(0)}% anonymous`,
      priority: 'high',
    })
  }


  if (fileMetrics.avgFileSize > 5 * 1024 * 1024) {

    insights.push({
      id: 'large-files',
      type: 'suggestion',
      title: 'Large File Uploads',
      description: `Average file size is ${(fileMetrics.avgFileSize / 1024 / 1024).toFixed(1)} MB. Consider adding file compression guidance for faster uploads.`,
      metric: `Avg upload: ${(fileMetrics.avgUploadDuration / 1000).toFixed(1)}s`,
      priority: 'medium',
    })
  }


  if (fileMetrics.uploadSpeedAvg > 0 && fileMetrics.uploadSpeedAvg < 500 * 1024) {

    insights.push({
      id: 'slow-uploads',
      type: 'negative',
      title: 'Slow Upload Speeds',
      description: `Average upload speed is ${(fileMetrics.uploadSpeedAvg / 1024).toFixed(0)} KB/s. This may be affecting user experience and abandonment.`,
      metric: `Median duration: ${(fileMetrics.medianUploadDuration / 1000).toFixed(1)}s`,
      priority: 'high',
    })
  }


  if (customerMetrics.repeatCustomers > 0 && customerMetrics.avgRevenuePerCustomer > 0) {
    const repeatRate =
      customerMetrics.uniqueCustomers > 0
        ? (customerMetrics.repeatCustomers / customerMetrics.uniqueCustomers) * 100
        : 0
    if (repeatRate > 20) {
      insights.push({
        id: 'good-retention',
        type: 'positive',
        title: 'Strong Customer Retention',
        description: `${repeatRate.toFixed(0)}% of customers return for more uploads. Average customer value is $${customerMetrics.avgRevenuePerCustomer.toFixed(2)}.`,
        metric: `${customerMetrics.repeatCustomers} repeat customers`,
        priority: 'medium',
      })
    }
  }


  if (revenueStats.totalRevenue > 0) {
    insights.push({
      id: 'revenue-summary',
      type: 'positive',
      title: 'Revenue Performance',
      description: `Total revenue: $${revenueStats.totalRevenue.toFixed(2)} from ${revenueStats.totalOrders} orders. Average order value: $${revenueStats.avgOrderValue.toFixed(2)}.`,
      metric: `$${revenueStats.avgOrderValue.toFixed(2)} AOV`,
      priority: 'high',
    })
  }


  if (revenueStats.conversionFunnel.cartAdds > 0 && revenueStats.conversionFunnel.orders > 0) {
    const cartToOrderRate =
      (revenueStats.conversionFunnel.orders / revenueStats.conversionFunnel.cartAdds) * 100
    if (cartToOrderRate < 50) {
      insights.push({
        id: 'cart-abandonment',
        type: 'negative',
        title: 'High Cart Abandonment',
        description: `Only ${cartToOrderRate.toFixed(0)}% of cart additions result in orders. Consider implementing abandoned cart recovery.`,
        metric: `${revenueStats.conversionFunnel.cartAdds - revenueStats.conversionFunnel.orders} abandoned carts`,
        priority: 'high',
      })
    }
  }


  const mobileDevice = deviceData.find((d) => d.type === 'mobile')
  if (mobileDevice && mobileDevice.percentage > 50) {
    insights.push({
      id: 'mobile-majority',
      type: 'neutral',
      title: 'Mobile-First Audience',
      description: `${mobileDevice.percentage.toFixed(0)}% of visitors use mobile. Ensure upload UX is optimized for touch devices.`,
      metric: `${mobileDevice.count} mobile visitors`,
      priority: 'medium',
    })
  }


  if (uploadStats.successRate < 90 && uploadStats.totalUploads > 10) {
    insights.push({
      id: 'upload-failures',
      type: 'negative',
      title: 'Upload Success Rate Below Target',
      description: `${uploadStats.successRate.toFixed(1)}% success rate. ${uploadStats.failedUploads} uploads failed. Investigate common failure causes.`,
      metric: `${uploadStats.failedUploads} failed uploads`,
      priority: 'high',
    })
  }


  if (fileMetrics.totalDataTransferred > 1024 * 1024 * 1024) {

    insights.push({
      id: 'high-data-transfer',
      type: 'neutral',
      title: 'High Data Volume',
      description: `${(fileMetrics.totalDataTransferred / 1024 / 1024 / 1024).toFixed(2)} GB transferred. Monitor storage costs and consider CDN optimization.`,
      metric: `${(fileMetrics.totalDataTransferred / 1024 / 1024).toFixed(0)} MB total`,
      priority: 'low',
    })
  }


  const priorityOrder = { high: 0, medium: 1, low: 2 }
  insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])


  if (insights.length === 0) {
    insights.push({
      id: 'gathering-data',
      type: 'neutral',
      title: 'Building Insights',
      description: 'Continue collecting data to generate personalized recommendations.',
      priority: 'low',
    })
  }

  return insights.slice(0, 10)
}





export interface MarketingRecommendation {
  id: string
  icon: string
  title: string
  description: string
  actionText: string
  impact: 'high' | 'medium' | 'low'
  category: 'acquisition' | 'optimization' | 'budget' | 'strategy' | 'retention'
  dataPoint?: string
}

export async function generateAttributionRecommendations(
  stats: AttributionStats,
  sources: SourceBreakdown[],
  mediums: MediumBreakdown[],
  campaigns: CampaignBreakdown[],
  clickIds: ClickIdStats,
  referrers: ReferrerBreakdown[]
): Promise<MarketingRecommendation[]> {
  const recommendations: MarketingRecommendation[] = []


  const totalAdClicks = clickIds.total
  if (totalAdClicks > 0) {
    const platforms = [
      { name: 'Google Ads', clicks: clickIds.gclid, key: 'gclid' },
      { name: 'Facebook Ads', clicks: clickIds.fbclid, key: 'fbclid' },
      { name: 'Microsoft Ads', clicks: clickIds.msclkid, key: 'msclkid' },
      { name: 'TikTok Ads', clicks: clickIds.ttclid, key: 'ttclid' },
    ].sort((a, b) => b.clicks - a.clicks)

    const topPlatform = platforms[0]
    const topPlatformShare = ((topPlatform.clicks / totalAdClicks) * 100).toFixed(0)
    const activePlatforms = platforms.filter((p) => p.clicks > 0)
    const inactivePlatforms = platforms.filter((p) => p.clicks === 0)

    if (activePlatforms.length === 1) {
      recommendations.push({
        id: 'diversify-ad-platforms',
        icon: '🎯',
        title: 'Diversify Your Ad Spend',
        description: `You're only running ads on ${topPlatform.name} (${topPlatform.clicks} clicks). Depending on a single platform is risky — algorithm changes or cost increases could tank your ROAS overnight. ${inactivePlatforms.length > 0 ? `Consider testing ${inactivePlatforms.slice(0, 2).map((p) => p.name).join(' and ')} to find cheaper acquisition channels.` : ''}`,
        actionText: `Start testing ${inactivePlatforms[0]?.name || 'another platform'} with 15-20% of your ad budget`,
        impact: 'high',
        category: 'strategy',
        dataPoint: `${topPlatformShare}% of clicks from ${topPlatform.name}`,
      })
    } else if (activePlatforms.length >= 2) {
      const secondPlatform = platforms[1]
      const ratio = topPlatform.clicks > 0 && secondPlatform.clicks > 0
        ? (topPlatform.clicks / secondPlatform.clicks).toFixed(1)
        : '∞'
      recommendations.push({
        id: 'optimize-platform-mix',
        icon: '⚖️',
        title: 'Optimize Your Platform Mix',
        description: `${topPlatform.name} delivers ${topPlatform.clicks} clicks vs ${secondPlatform.name} with ${secondPlatform.clicks} clicks (${ratio}x ratio). Compare CPA across platforms — if ${secondPlatform.name} has lower CPA, scale it up. Test shifting 10% budget from the weaker performer.`,
        actionText: `Compare CPA: ${topPlatform.name} vs ${secondPlatform.name}`,
        impact: 'high',
        category: 'budget',
        dataPoint: `${activePlatforms.length} active platforms, ${totalAdClicks} total clicks`,
      })
    }
  } else {
    recommendations.push({
      id: 'start-paid-ads',
      icon: '💰',
      title: 'Launch Paid Advertising',
      description: `You have zero paid ad clicks. DTF/print customizer products are highly visual — they perform exceptionally well with Facebook/Instagram image ads and Google Shopping. Even $10/day on Facebook with product mockup creatives can drive qualified traffic.`,
      actionText: 'Start with Facebook Ads — carousel format showing DTF designs on products',
      impact: 'high',
      category: 'acquisition',
      dataPoint: '0 paid clicks detected',
    })
  }


  if (stats.totalSessions > 0) {
    const utmRate = stats.utmPercentage
    if (utmRate < 20) {
      recommendations.push({
        id: 'improve-utm-tracking',
        icon: '📊',
        title: 'Critical: Fix Your UTM Tracking',
        description: `Only ${utmRate.toFixed(1)}% of sessions have UTM tags. You're essentially flying blind — you cannot measure which channels drive revenue without proper UTM tagging. Every marketing link (ads, emails, social posts, influencer links) must have UTM parameters.`,
        actionText: 'Tag ALL marketing links: ?utm_source=X&utm_medium=Y&utm_campaign=Z',
        impact: 'high',
        category: 'optimization',
        dataPoint: `${stats.sessionsWithUTM}/${stats.totalSessions} sessions tracked`,
      })
    } else if (utmRate < 50) {
      recommendations.push({
        id: 'expand-utm-coverage',
        icon: '🔍',
        title: 'Expand UTM Coverage to 80%+',
        description: `${utmRate.toFixed(1)}% UTM coverage means ${(100 - utmRate).toFixed(0)}% of traffic is unattributed. You're likely missing UTM tags on email campaigns, social media bios, or organic social posts. Goal: 80%+ coverage for reliable ROAS calculations.`,
        actionText: 'Audit all marketing touchpoints and add UTM tags',
        impact: 'medium',
        category: 'optimization',
        dataPoint: `${utmRate.toFixed(0)}% attribution rate`,
      })
    } else {
      recommendations.push({
        id: 'utm-coverage-good',
        icon: '✅',
        title: 'Strong Attribution Setup',
        description: `${utmRate.toFixed(1)}% UTM coverage is excellent. You can trust your attribution data for budget decisions. Focus on optimizing the channels that show best conversion rates in the source breakdown below.`,
        actionText: 'Use source conversion data to reallocate budget to top performers',
        impact: 'low',
        category: 'optimization',
        dataPoint: `${stats.sessionsWithUTM} tagged sessions`,
      })
    }
  }


  const sourcesWithData = sources.filter((s) => s.sessions >= 3)
  if (sourcesWithData.length >= 2) {
    const bestConverter = sourcesWithData.reduce((a, b) =>
      a.conversionRate > b.conversionRate ? a : b
    )
    const worstConverter = sourcesWithData.reduce((a, b) =>
      a.conversionRate < b.conversionRate ? a : b
    )

    if (bestConverter.conversionRate > worstConverter.conversionRate * 2) {
      recommendations.push({
        id: 'source-roi-gap',
        icon: '🏆',
        title: `Double Down on "${bestConverter.source}" Traffic`,
        description: `"${bestConverter.source}" converts at ${bestConverter.conversionRate.toFixed(1)}% (${bestConverter.uploads} uploads from ${bestConverter.sessions} sessions) while "${worstConverter.source}" converts at only ${worstConverter.conversionRate.toFixed(1)}%. That's a ${(bestConverter.conversionRate / Math.max(worstConverter.conversionRate, 0.1)).toFixed(1)}x difference. Shift budget toward your best converter.`,
        actionText: `Increase "${bestConverter.source}" spend by 25-50%`,
        impact: 'high',
        category: 'budget',
        dataPoint: `${bestConverter.conversionRate.toFixed(1)}% vs ${worstConverter.conversionRate.toFixed(1)}% conversion`,
      })
    }
  } else if (sourcesWithData.length === 1) {
    recommendations.push({
      id: 'single-source-risk',
      icon: '⚠️',
      title: 'Single Source Dependency Risk',
      description: `"${sourcesWithData[0].source}" is your only significant traffic source (${sourcesWithData[0].sessions} sessions). If this channel stops performing, your pipeline dries up. Diversify into at least 2-3 traffic sources for stability.`,
      actionText: 'Test 2 new acquisition channels this month',
      impact: 'high',
      category: 'strategy',
      dataPoint: `${sourcesWithData[0].sessions} sessions from single source`,
    })
  }


  const paidMediums = mediums.filter(
    (m) => m.medium === 'cpc' || m.medium === 'paid' || m.medium === 'ppc'
  )
  const organicMediums = mediums.filter(
    (m) => m.medium === 'organic' || m.medium === 'none' || !m.medium
  )
  const socialMediums = mediums.filter((m) => m.medium === 'social')
  const emailMediums = mediums.filter((m) => m.medium === 'email')

  const paidSessions = paidMediums.reduce((sum, m) => sum + m.sessions, 0)
  const organicSessions = organicMediums.reduce((sum, m) => sum + m.sessions, 0)
  const socialSessions = socialMediums.reduce((sum, m) => sum + m.sessions, 0)
  const emailSessions = emailMediums.reduce((sum, m) => sum + m.sessions, 0)

  if (organicSessions > paidSessions * 3 && paidSessions > 0) {
    recommendations.push({
      id: 'organic-dominant',
      icon: '🌱',
      title: 'Leverage Your Organic Strength',
      description: `Organic traffic (${organicSessions} sessions) dwarfs paid (${paidSessions}). Your SEO/content is working — scale it. Create DTF design tutorials, "how-to" blog posts, and YouTube videos to compound this organic advantage. Consider hiring an SEO specialist.`,
      actionText: 'Create 4 SEO-optimized DTF tutorial blog posts per month',
      impact: 'medium',
      category: 'strategy',
      dataPoint: `${organicSessions}:${paidSessions} organic:paid ratio`,
    })
  } else if (paidSessions > organicSessions * 3 && organicSessions > 0) {
    recommendations.push({
      id: 'paid-dependent',
      icon: '🔄',
      title: 'Build Organic Traffic to Reduce CAC',
      description: `${((paidSessions / Math.max(stats.totalSessions, 1)) * 100).toFixed(0)}% of traffic is paid. This means high CAC (Customer Acquisition Cost). Invest in SEO, content marketing, and community building to create a sustainable free traffic engine alongside your paid strategy.`,
      actionText: 'Start a blog + social media content calendar focusing on DTF tips',
      impact: 'medium',
      category: 'strategy',
      dataPoint: `${paidSessions} paid vs ${organicSessions} organic sessions`,
    })
  }


  if (emailSessions === 0 && stats.totalSessions > 20) {
    recommendations.push({
      id: 'email-missing',
      icon: '📧',
      title: 'Untapped Gold: Email Marketing',
      description: `Zero sessions from email campaigns detected. Email marketing has the highest ROI of any channel ($36-42 per $1 spent). Collect emails via pop-ups, post-purchase flows, and abandoned cart sequences. DTF reorder reminders alone can generate 15-25% repeat revenue.`,
      actionText: 'Set up: Welcome series → Abandoned cart → Reorder reminder → Win-back',
      impact: 'high',
      category: 'acquisition',
      dataPoint: '0 email-attributed sessions',
    })
  } else if (emailSessions > 0 && emailSessions < stats.totalSessions * 0.1) {
    recommendations.push({
      id: 'scale-email',
      icon: '📧',
      title: 'Scale Your Email Channel',
      description: `Email drives only ${emailSessions} sessions (${((emailSessions / Math.max(stats.totalSessions, 1)) * 100).toFixed(1)}% of traffic). For a custom DTF business, email should be 20-30% of revenue. Segment your list: new customers, repeat buyers, cart abandoners, and inactive users. Send targeted campaigns to each.`,
      actionText: 'Segment list and launch weekly targeted campaigns',
      impact: 'medium',
      category: 'retention',
      dataPoint: `${emailSessions} email sessions`,
    })
  }


  if (socialSessions === 0 && stats.totalSessions > 20) {
    recommendations.push({
      id: 'social-missing',
      icon: '📱',
      title: 'Social Media: Your Missing Growth Engine',
      description: `No social traffic detected. DTF/custom printing is an inherently visual, shareable product. TikTok and Instagram Reels showing "before & after" DTF transfers go viral regularly. User-generated content (customer showcase) can drive massive organic reach at zero cost.`,
      actionText: 'Post 3-5 TikTok/Reels per week showing DTF application process',
      impact: 'high',
      category: 'acquisition',
      dataPoint: '0 social media sessions',
    })
  } else if (socialSessions > 0) {
    const socialPct = ((socialSessions / Math.max(stats.totalSessions, 1)) * 100).toFixed(1)
    recommendations.push({
      id: 'optimize-social',
      icon: '📱',
      title: 'Amplify Your Social Presence',
      description: `Social brings ${socialSessions} sessions (${socialPct}%). Double down on what works: identify your best-performing post types and replicate them. Run "design of the week" contests, customer spotlight posts, and limited-time DTF offers exclusive to social followers.`,
      actionText: 'Create a content calendar with 5 posts/week + stories daily',
      impact: 'medium',
      category: 'strategy',
      dataPoint: `${socialSessions} social sessions (${socialPct}%)`,
    })
  }


  const referralTraffic = referrers.find((r) => r.type === 'referral')
  const searchTraffic = referrers.find((r) => r.type === 'search')
  const directTraffic = referrers.find((r) => r.type === 'direct')

  if (directTraffic && directTraffic.percentage > 60) {
    recommendations.push({
      id: 'high-direct-suspicious',
      icon: '🔎',
      title: 'Investigate High Direct Traffic',
      description: `${directTraffic.percentage.toFixed(0)}% direct traffic is unusually high. This often means: (1) Missing UTM tags on marketing links, (2) Dark social sharing (WhatsApp, DM links), or (3) Returning brand-loyal customers. If #1, fix UTM tagging. If #3, that's great — launch a referral program to amplify word-of-mouth.`,
      actionText: 'Audit all marketing links for UTM tags; launch a referral reward program',
      impact: 'medium',
      category: 'optimization',
      dataPoint: `${directTraffic.percentage.toFixed(0)}% direct traffic`,
    })
  }

  if (searchTraffic && searchTraffic.percentage > 30) {
    recommendations.push({
      id: 'strong-seo',
      icon: '🔍',
      title: 'Maximize Your SEO Advantage',
      description: `${searchTraffic.percentage.toFixed(0)}% search traffic is a strong signal that your SEO is working. Create more content around high-intent keywords: "custom DTF transfers", "DTF printing near me", "custom t-shirt printing". Build topical authority with a comprehensive DTF knowledge base.`,
      actionText: 'Research 20 high-intent keywords and create dedicated landing pages',
      impact: 'high',
      category: 'strategy',
      dataPoint: `${searchTraffic.sessions} search-referred sessions`,
    })
  }


  if (campaigns.length > 0) {
    const topCampaign = campaigns[0]
    const lowPerformers = campaigns.filter(
      (c) => c.sessions >= 5 && c.uploads === 0
    )

    if (lowPerformers.length > 0) {
      recommendations.push({
        id: 'kill-bad-campaigns',
        icon: '💸',
        title: `Kill ${lowPerformers.length} Underperforming Campaign${lowPerformers.length > 1 ? 's' : ''}`,
        description: `${lowPerformers.map((c) => `"${c.campaign}"`).join(', ')} ${lowPerformers.length > 1 ? 'have' : 'has'} ${lowPerformers.reduce((s, c) => s + c.sessions, 0)} sessions but ZERO uploads. You're spending money driving traffic that doesn't convert. Either fix the landing page experience or reallocate that budget to "${topCampaign.campaign}" which already generates ${topCampaign.uploads} uploads.`,
        actionText: `Pause underperformers; Reallocate to "${topCampaign.campaign}"`,
        impact: 'high',
        category: 'budget',
        dataPoint: `${lowPerformers.reduce((s, c) => s + c.sessions, 0)} wasted sessions`,
      })
    }

    if (campaigns.length >= 3) {
      const uploadRates = campaigns
        .filter((c) => c.sessions >= 3)
        .map((c) => ({
          ...c,
          rate: c.sessions > 0 ? (c.uploads / c.sessions) * 100 : 0,
        }))
        .sort((a, b) => b.rate - a.rate)

      if (uploadRates.length >= 2 && uploadRates[0].rate > 0) {
        recommendations.push({
          id: 'campaign-winner',
          icon: '🏅',
          title: `Scale Your Winner: "${uploadRates[0].campaign}"`,
          description: `"${uploadRates[0].campaign}" has ${uploadRates[0].rate.toFixed(1)}% upload rate — your best performer. Analyze what makes this campaign work: Is it the audience targeting? The creative? The landing page? Replicate its formula across other campaigns. Consider increasing its budget by 50-100%.`,
          actionText: `Clone "${uploadRates[0].campaign}" targeting + creatives for new campaigns`,
          impact: 'high',
          category: 'budget',
          dataPoint: `${uploadRates[0].rate.toFixed(1)}% upload rate`,
        })
      }
    }
  } else {
    recommendations.push({
      id: 'no-campaigns',
      icon: '📣',
      title: 'Launch Your First UTM Campaign',
      description: `No campaign data found. Without campaigns, you can't A/B test messaging, audiences, or offers. Start with 2-3 campaigns: (1) "Brand Awareness" on social, (2) "High Intent" search ads targeting "custom DTF printing", (3) "Retargeting" visitors who didn't upload.`,
      actionText: 'Create 3 campaigns with proper UTM tags this week',
      impact: 'high',
      category: 'acquisition',
      dataPoint: '0 tracked campaigns',
    })
  }


  if (clickIds.ttclid === 0 && clickIds.total > 0) {
    recommendations.push({
      id: 'tiktok-opportunity',
      icon: '🎵',
      title: 'TikTok: The Underused Goldmine for DTF',
      description: `You're running ads on ${clickIds.gclid > 0 ? 'Google' : ''}${clickIds.fbclid > 0 ? (clickIds.gclid > 0 ? '/' : '') + 'Facebook' : ''}${clickIds.msclkid > 0 ? '/Bing' : ''} but not TikTok. TikTok CPMs for e-commerce are 30-50% lower than Facebook. The "satisfying DTF transfer" video format is tailor-made for TikTok's algorithm. Test with $20-30/day budget.`,
      actionText: 'Create 3-5 "satisfying process" DTF videos and launch TikTok Ads',
      impact: 'medium',
      category: 'acquisition',
      dataPoint: `${clickIds.total} clicks on other platforms, 0 on TikTok`,
    })
  }


  if (stats.totalSessions > 50) {
    const uploadConversionRate = sources.length > 0
      ? sources.reduce((sum, s) => sum + s.uploads, 0) / Math.max(stats.totalSessions, 1) * 100
      : 0

    if (uploadConversionRate < 15) {
      recommendations.push({
        id: 'retargeting-needed',
        icon: '🎯',
        title: 'Retargeting: Recover Lost Visitors',
        description: `${(100 - uploadConversionRate).toFixed(0)}% of visitors leave without uploading a design. Install Facebook Pixel and Google Remarketing tags, then create retargeting campaigns showing the exact products they viewed. Retargeting typically converts 3-5x better than cold traffic at 50-70% lower CPA.`,
        actionText: 'Set up retargeting audiences: "Visited but didn\'t upload" and "Uploaded but didn\'t buy"',
        impact: 'high',
        category: 'retention',
        dataPoint: `${uploadConversionRate.toFixed(1)}% upload rate — ${(100 - uploadConversionRate).toFixed(0)}% drop-off`,
      })
    }
  }


  const impactOrder = { high: 0, medium: 1, low: 2 }
  recommendations.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact])

  return recommendations.slice(0, 10)
}
