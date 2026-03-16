/**
 * Telemetry Data Collector
 *
 * Gathers shop info, usage metrics, commissions, config, and health
 * from the local database for the central billing panel.
 *
 * Used by:
 *   - workers/telemetry.worker.ts (push every 60s)
 *   - app/routes/api.internal.telemetry.tsx (on-demand GET)
 */

import { PrismaClient, Prisma } from '@prisma/client'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TelemetryPayload {
  tenant: TenantInfo
  usage: UsageMetrics
  commissions: CommissionMetrics
  config: ConfigSummary
  health: HealthInfo
  timestamp: string
}

export interface TenantInfo {
  slug: string
  shopDomain: string
  plan: string
  billingStatus: string
  storageProvider: string
  installedAt: string
  paymentMethod: 'paypal' | 'stripe' | 'both' | 'none'
  autoCharge: boolean
  paypalEmail: string | null
  stripeEmail: string | null
  stripeCustomerId: string | null
  onboardingCompleted: boolean
  onboardingStep: number
  appUrl: string
}

export interface UsageMetrics {
  periodStart: string
  periodEnd: string
  uploads: {
    total: number
    thisMonth: number
    byStatus: Record<string, number>
    byMode: Record<string, number>
  }
  storage: {
    totalBytes: number
    totalFiles: number
    averageFileSizeBytes: number
  }
  orders: {
    total: number
    thisMonth: number
    totalRevenue: number
    thisMonthRevenue: number
    currency: string
  }
  exports: {
    total: number
    byStatus: Record<string, number>
  }
  visitors: {
    unique: number
    thisMonth: number
    totalSessions: number
    thisMonthSessions: number
  }
  apiCalls: {
    totalKeys: number
    totalUsage: number
  }
  flowTriggers: {
    total: number
    thisMonth: number
    byStatus: Record<string, number>
  }
  supportTickets: {
    total: number
    open: number
  }
}

export interface CommissionMetrics {
  pending: { count: number; total: number }
  paid: { count: number; total: number }
  waived: { count: number; total: number }
  thisMonth: { count: number; total: number }
  commissionRate: number
}

export interface ConfigSummary {
  productsConfigured: number
  uploadEnabled: number
  tshirtEnabled: number
  builderEnabled: number
  assetSets: number
  teamMembers: { total: number; byRole: Record<string, number> }
  whiteLabel: boolean
  apiKeysActive: number
}

export interface HealthInfo {
  containerUptime: number
  nodeVersion: string
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number }
  lastUploadAt: string | null
  lastOrderAt: string | null
  lastExportAt: string | null
}

// ─────────────────────────────────────────────────────────────
// Collector
// ─────────────────────────────────────────────────────────────

const processStartTime = Date.now()

export async function collectTelemetry(prisma: PrismaClient): Promise<TelemetryPayload> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [tenant, usage, commissions, config, health] = await Promise.all([
    collectTenantInfo(prisma),
    collectUsageMetrics(prisma, monthStart, now),
    collectCommissionMetrics(prisma, monthStart),
    collectConfigSummary(prisma),
    collectHealthInfo(prisma),
  ])

  return {
    tenant,
    usage,
    commissions,
    config,
    health,
    timestamp: now.toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────
// Tenant Info
// ─────────────────────────────────────────────────────────────

async function collectTenantInfo(prisma: PrismaClient): Promise<TenantInfo> {
  const shop = await prisma.shop.findFirst({
    select: {
      shopDomain: true,
      plan: true,
      billingStatus: true,
      storageProvider: true,
      installedAt: true,
      paypalAutoCharge: true,
      paypalPayerEmail: true,
      paypalVaultId: true,
      stripeAutoCharge: true,
      stripeEmail: true,
      stripeCustomerId: true,
      onboardingCompleted: true,
      onboardingStep: true,
    },
  })

  if (!shop) {
    return {
      slug: process.env.TENANT_SLUG || 'unknown',
      shopDomain: 'unknown',
      plan: 'unknown',
      billingStatus: 'unknown',
      storageProvider: 'unknown',
      installedAt: new Date().toISOString(),
      paymentMethod: 'none',
      autoCharge: false,
      paypalEmail: null,
      stripeEmail: null,
      stripeCustomerId: null,
      onboardingCompleted: false,
      onboardingStep: 0,
      appUrl: process.env.SHOPIFY_APP_URL || '',
    }
  }

  const hasPaypal = !!shop.paypalVaultId
  const hasStripe = !!shop.stripeCustomerId
  let paymentMethod: TenantInfo['paymentMethod'] = 'none'
  if (hasPaypal && hasStripe) paymentMethod = 'both'
  else if (hasPaypal) paymentMethod = 'paypal'
  else if (hasStripe) paymentMethod = 'stripe'

  return {
    slug: process.env.TENANT_SLUG || 'unknown',
    shopDomain: shop.shopDomain,
    plan: shop.plan,
    billingStatus: shop.billingStatus,
    storageProvider: shop.storageProvider,
    installedAt: shop.installedAt.toISOString(),
    paymentMethod,
    autoCharge: shop.paypalAutoCharge || shop.stripeAutoCharge,
    paypalEmail: shop.paypalPayerEmail,
    stripeEmail: shop.stripeEmail,
    stripeCustomerId: shop.stripeCustomerId,
    onboardingCompleted: shop.onboardingCompleted,
    onboardingStep: shop.onboardingStep,
    appUrl: process.env.SHOPIFY_APP_URL || '',
  }
}

// ─────────────────────────────────────────────────────────────
// Usage Metrics
// ─────────────────────────────────────────────────────────────

async function collectUsageMetrics(
  prisma: PrismaClient,
  monthStart: Date,
  now: Date
): Promise<UsageMetrics> {
  const [
    uploadsTotal,
    uploadsThisMonth,
    uploadsByStatus,
    uploadsByMode,
    storageAgg,
    storageCount,
    ordersTotal,
    ordersThisMonth,
    revenueAll,
    revenueMonth,
    exportsByStatus,
    visitorsTotal,
    visitorsMonth,
    sessionsTotal,
    sessionsMonth,
    apiKeysAgg,
    flowTotal,
    flowMonth,
    flowByStatus,
    ticketsTotal,
    ticketsOpen,
  ] = await Promise.all([
    // Uploads
    prisma.upload.count(),
    prisma.upload.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.upload.groupBy({ by: ['status'], _count: true }),
    prisma.upload.groupBy({ by: ['mode'], _count: true }),
    // Storage
    prisma.uploadItem.aggregate({ _sum: { fileSize: true }, _avg: { fileSize: true } }),
    prisma.uploadItem.count(),
    // Orders
    prisma.orderLink.count(),
    prisma.orderLink.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.upload.aggregate({
      _sum: { orderTotal: true },
      where: { orderPaidAt: { not: null } },
    }),
    prisma.upload.aggregate({
      _sum: { orderTotal: true },
      where: { orderPaidAt: { gte: monthStart } },
    }),
    // Exports
    prisma.exportJob.groupBy({ by: ['status'], _count: true }),
    // Visitors
    prisma.visitor.count(),
    prisma.visitor.count({ where: { firstSeenAt: { gte: monthStart } } }),
    prisma.visitorSession.count(),
    prisma.visitorSession.count({ where: { startedAt: { gte: monthStart } } }),
    // API Keys
    prisma.apiKey.aggregate({
      _count: true,
      _sum: { usageCount: true },
      where: { status: 'active' },
    }),
    // Flow Triggers
    prisma.flowTrigger.count(),
    prisma.flowTrigger.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.flowTrigger.groupBy({ by: ['status'], _count: true }),
    // Support
    prisma.supportTicket.count(),
    prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
  ])

  const byStatus: Record<string, number> = {}
  for (const row of uploadsByStatus) byStatus[row.status] = row._count

  const byMode: Record<string, number> = {}
  for (const row of uploadsByMode) byMode[row.mode] = row._count

  const exportStatus: Record<string, number> = {}
  for (const row of exportsByStatus) exportStatus[row.status] = row._count

  const flowStatus: Record<string, number> = {}
  for (const row of flowByStatus) flowStatus[row.status] = row._count

  return {
    periodStart: monthStart.toISOString(),
    periodEnd: now.toISOString(),
    uploads: {
      total: uploadsTotal,
      thisMonth: uploadsThisMonth,
      byStatus,
      byMode,
    },
    storage: {
      totalBytes: storageAgg._sum.fileSize || 0,
      totalFiles: storageCount,
      averageFileSizeBytes: Math.round(storageAgg._avg.fileSize || 0),
    },
    orders: {
      total: ordersTotal,
      thisMonth: ordersThisMonth,
      totalRevenue: Number(revenueAll._sum.orderTotal || 0),
      thisMonthRevenue: Number(revenueMonth._sum.orderTotal || 0),
      currency: 'USD',
    },
    exports: {
      total: exportsByStatus.reduce((sum, r) => sum + r._count, 0),
      byStatus: exportStatus,
    },
    visitors: {
      unique: visitorsTotal,
      thisMonth: visitorsMonth,
      totalSessions: sessionsTotal,
      thisMonthSessions: sessionsMonth,
    },
    apiCalls: {
      totalKeys: apiKeysAgg._count,
      totalUsage: apiKeysAgg._sum.usageCount || 0,
    },
    flowTriggers: {
      total: flowTotal,
      thisMonth: flowMonth,
      byStatus: flowStatus,
    },
    supportTickets: {
      total: ticketsTotal,
      open: ticketsOpen,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Commission Metrics
// ─────────────────────────────────────────────────────────────

async function collectCommissionMetrics(
  prisma: PrismaClient,
  monthStart: Date
): Promise<CommissionMetrics> {
  const [pending, paid, waived, thisMonth, rateRow] = await Promise.all([
    prisma.commission.aggregate({
      _count: true,
      _sum: { commissionAmount: true },
      where: { status: 'pending' },
    }),
    prisma.commission.aggregate({
      _count: true,
      _sum: { commissionAmount: true },
      where: { status: 'paid' },
    }),
    prisma.commission.aggregate({
      _count: true,
      _sum: { commissionAmount: true },
      where: { status: 'waived' },
    }),
    prisma.commission.aggregate({
      _count: true,
      _sum: { commissionAmount: true },
      where: { createdAt: { gte: monthStart } },
    }),
    prisma.commission.findFirst({
      select: { commissionRate: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return {
    pending: { count: pending._count, total: Number(pending._sum.commissionAmount || 0) },
    paid: { count: paid._count, total: Number(paid._sum.commissionAmount || 0) },
    waived: { count: waived._count, total: Number(waived._sum.commissionAmount || 0) },
    thisMonth: { count: thisMonth._count, total: Number(thisMonth._sum.commissionAmount || 0) },
    commissionRate: Number(rateRow?.commissionRate || 0.015),
  }
}

// ─────────────────────────────────────────────────────────────
// Config Summary
// ─────────────────────────────────────────────────────────────

async function collectConfigSummary(prisma: PrismaClient): Promise<ConfigSummary> {
  const [
    productsConfigured,
    uploadEnabled,
    tshirtEnabled,
    builderEnabled,
    assetSets,
    teamByRole,
    whiteLabel,
    apiKeysActive,
  ] = await Promise.all([
    prisma.productConfig.count({ where: { enabled: true } }),
    prisma.productConfig.count({ where: { uploadEnabled: true } }),
    prisma.productConfig.count({ where: { tshirtEnabled: true } }),
    prisma.productConfig.count({ where: { builderConfig: { not: Prisma.DbNull } } }),
    prisma.assetSet.count({ where: { status: 'active' } }),
    prisma.teamMember.groupBy({ by: ['role'], _count: true, where: { status: 'active' } }),
    prisma.whiteLabelConfig.findFirst({ select: { enabled: true } }),
    prisma.apiKey.count({ where: { status: 'active' } }),
  ])

  const byRole: Record<string, number> = {}
  let totalTeam = 0
  for (const row of teamByRole) {
    byRole[row.role] = row._count
    totalTeam += row._count
  }

  return {
    productsConfigured,
    uploadEnabled,
    tshirtEnabled,
    builderEnabled,
    assetSets,
    teamMembers: { total: totalTeam, byRole },
    whiteLabel: whiteLabel?.enabled || false,
    apiKeysActive,
  }
}

// ─────────────────────────────────────────────────────────────
// Health Info
// ─────────────────────────────────────────────────────────────

async function collectHealthInfo(prisma: PrismaClient): Promise<HealthInfo> {
  const [lastUpload, lastOrder, lastExport] = await Promise.all([
    prisma.upload.findFirst({ select: { createdAt: true }, orderBy: { createdAt: 'desc' } }),
    prisma.orderLink.findFirst({ select: { createdAt: true }, orderBy: { createdAt: 'desc' } }),
    prisma.exportJob.findFirst({ select: { createdAt: true }, orderBy: { createdAt: 'desc' } }),
  ])

  const mem = process.memoryUsage()

  return {
    containerUptime: Math.floor((Date.now() - processStartTime) / 1000),
    nodeVersion: process.version,
    memoryUsage: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    },
    lastUploadAt: lastUpload?.createdAt.toISOString() || null,
    lastOrderAt: lastOrder?.createdAt.toISOString() || null,
    lastExportAt: lastExport?.createdAt.toISOString() || null,
  }
}
