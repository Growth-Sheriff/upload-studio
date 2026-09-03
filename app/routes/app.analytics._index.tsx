import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { useLoaderData, useNavigate } from '@remix-run/react'
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Select,
  Text,
  TextField,
} from '@shopify/polaris'
import { useCallback, useState } from 'react'
import {
  getCustomerMetrics,
  getCustomerSegmentation,
  getFileMetrics,
  getFileTypeBreakdown,
  getRevenueStats,
} from '~/lib/analytics.server'
import prisma from '~/lib/prisma.server'
import { authenticate } from '~/shopify.server'

import { UploadDetailModal } from '~/components/UploadDetailModal'

import { UploadDetailModal } from '~/components/UploadDetailModal'

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || '',
        plan: 'commission',
        billingStatus: 'active',
        storageProvider: 'r2',
        settings: {},
      },
    })
  }

  const url = new URL(request.url)
  const period = url.searchParams.get('period') || '30d'
  const customStart = url.searchParams.get('startDate')
  const customEnd = url.searchParams.get('endDate')


  const now = new Date()
  let startDate: Date
  let endDate = now

  if (period === 'custom' && customStart && customEnd) {
    startDate = new Date(customStart)
    endDate = new Date(customEnd)

    endDate.setHours(23, 59, 59, 999)
  } else {
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'all':
        startDate = new Date(0)
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }
  }


  const dateRangeText =
    period === 'all'
      ? 'All time'
      : `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`


  const [
    totalUploads,
    completedUploads,
    blockedUploads,
    warningUploads,
    uploadsByMode,
    uploadsByStatus,
    recentUploads,
    uploadsByDay,

    totalOrders,
    ordersWithUploads,
    recentOrders,
  ] = await Promise.all([

    prisma.upload.count({
      where: { shopId: shop.id, createdAt: { gte: startDate } },
    }),

    prisma.upload.count({
      where: { shopId: shop.id, createdAt: { gte: startDate }, status: 'uploaded' },
    }),

    prisma.upload.count({
      where: { shopId: shop.id, createdAt: { gte: startDate }, status: 'blocked' },
    }),

    prisma.uploadItem.count({
      where: {
        upload: { shopId: shop.id, createdAt: { gte: startDate } },
        preflightStatus: 'warning',
      },
    }),

    prisma.upload.groupBy({
      by: ['mode'],
      where: { shopId: shop.id, createdAt: { gte: startDate } },
      _count: true,
    }),

    prisma.upload.groupBy({
      by: ['status'],
      where: { shopId: shop.id, createdAt: { gte: startDate } },
      _count: true,
    }),

    prisma.upload.findMany({
      where: { shopId: shop.id },
      include: {
        items: {
          select: { location: true, preflightStatus: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),

    prisma.upload.findMany({
      where: { shopId: shop.id, createdAt: { gte: startDate } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),

    prisma.orderLink
      .groupBy({
        by: ['orderId'],
        where: { shopId: shop.id, createdAt: { gte: startDate } },
      })
      .then((orders) => orders.length),

    prisma.upload.count({
      where: {
        shopId: shop.id,
        createdAt: { gte: startDate },
        orderId: { not: null },
      },
    }),

    prisma.orderLink.findMany({
      where: { shopId: shop.id },
      include: {
        upload: {
          select: { id: true, mode: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])


  const [customerSegmentation, customerMetrics, fileMetrics, fileTypeBreakdown, revenueStats] =
    await Promise.all([
      getCustomerSegmentation(shop.id, startDate, now),
      getCustomerMetrics(shop.id, startDate, now),
      getFileMetrics(shop.id, startDate, now),
      getFileTypeBreakdown(shop.id, startDate, now),
      getRevenueStats(shop.id, startDate, now),
    ])


  const dailyCounts: Record<string, number> = {}
  uploadsByDay.forEach((u: { createdAt: Date }) => {
    const day = u.createdAt.toISOString().split('T')[0]
    dailyCounts[day] = (dailyCounts[day] || 0) + 1
  })


  const locationUsage = await prisma.uploadItem.groupBy({
    by: ['location'],
    where: {
      upload: { shopId: shop.id, createdAt: { gte: startDate } },
    },
    _count: true,
  })


  const successRate = totalUploads > 0 ? Math.round((completedUploads / totalUploads) * 100) : 0

  const warningRate = totalUploads > 0 ? Math.round((warningUploads / totalUploads) * 100) : 0

  const blockedRate = totalUploads > 0 ? Math.round((blockedUploads / totalUploads) * 100) : 0


  const orderConversionRate =
    totalUploads > 0 ? Math.round((ordersWithUploads / totalUploads) * 100) : 0

  return json({
    period,
    dateRangeText,
    metrics: {
      totalUploads,
      completedUploads,
      blockedUploads,
      warningUploads,
      successRate,
      warningRate,
      blockedRate,

      totalOrders,
      ordersWithUploads,
      orderConversionRate,
    },
    modeBreakdown: uploadsByMode.map((m: { mode: string; _count: number }) => ({
      mode: m.mode,
      count: m._count,
      percentage: totalUploads > 0 ? Math.round((m._count / totalUploads) * 100) : 0,
    })),
    statusBreakdown: uploadsByStatus.map((s: { status: string; _count: number }) => ({
      status: s.status,
      count: s._count,
      percentage: totalUploads > 0 ? Math.round((s._count / totalUploads) * 100) : 0,
    })),
    locationUsage: locationUsage.map((l: { location: string; _count: number }) => ({
      location: l.location,
      count: l._count,
      percentage: totalUploads > 0 ? Math.round((l._count / totalUploads) * 100) : 0,
    })),
    dailyTrend: Object.entries(dailyCounts).map(([date, count]) => ({
      date,
      count,
    })),
    recentUploads: recentUploads.map((u: any) => ({
      id: u.id,
      mode: u.mode,
      status: u.status,
      orderId: u.orderId,
      locations: u.items.map((i: { location: string }) => i.location),
      preflightStatus: u.items.some(
        (i: { preflightStatus: string }) => i.preflightStatus === 'error'
      )
        ? 'error'
        : u.items.some((i: { preflightStatus: string }) => i.preflightStatus === 'warning')
          ? 'warning'
          : 'ok',
      createdAt: u.createdAt.toISOString(),
    })),
    recentOrders: recentOrders.map((o: any) => ({
      orderId: o.orderId,
      uploadId: o.uploadId,
      uploadMode: o.upload?.mode || 'unknown',
      uploadStatus: o.upload?.status || 'unknown',
      createdAt: o.createdAt.toISOString(),
    })),

    customerSegmentation,
    customerMetrics,
    fileMetrics,
    fileTypeBreakdown,
    revenueStats,
  })
}

import { StatCard as MetricCard } from '~/components/StatCard'

function ProgressBarCustom({ value, color }: { value: number; color: string }) {
  return (
    <Box background="bg-surface-secondary" borderRadius="200" minHeight="8px">
      <div
        style={{
          width: `${Math.min(value, 100)}%`,
          height: '8px',
          backgroundColor: color,
          borderRadius: '4px',
          transition: 'width 0.3s',
        }}
      />
    </Box>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount)
}

export default function AnalyticsPage() {
  const {
    period,
    dateRangeText,
    metrics,
    modeBreakdown,
    statusBreakdown,
    locationUsage,
    dailyTrend,
    recentUploads,
    recentOrders,
    customerSegmentation,
    customerMetrics,
    fileMetrics,
    fileTypeBreakdown,
    revenueStats,
  } = useLoaderData<typeof loader>()
  const [selectedPeriod, setSelectedPeriod] = useState(period)
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(period === 'custom')
  const navigate = useNavigate()
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null)

  const handlePeriodChange = useCallback(
    (value: string) => {
      setSelectedPeriod(value)
      if (value === 'custom') {
        setShowCustomDatePicker(true)
      } else {
        setShowCustomDatePicker(false)
        navigate(`/app/analytics?period=${value}`)
      }
    },
    [navigate]
  )

  const handleApplyCustomDate = useCallback(() => {
    if (customStartDate && customEndDate) {
      navigate(`/app/analytics?period=custom&startDate=${customStartDate}&endDate=${customEndDate}`)
    }
  }, [navigate, customStartDate, customEndDate])

  const modeColors: Record<string, string> = {
    dtf: '#5C6AC4',
    '3d_designer': '#47C1BF',
    classic: '#9C6ADE',
    quick: '#F49342',
  }

  const statusColors: Record<string, string> = {
    uploaded: '#008060',
    blocked: '#D72C0D',
    needs_review: '#B98900',
    draft: '#637381',
    processing: '#00A0AC',
  }

  const locationColors: Record<string, string> = {
    front: '#5C6AC4',
    back: '#47C1BF',
    left_sleeve: '#9C6ADE',
    right_sleeve: '#F49342',
  }


  const statusLabels: Record<string, string> = {
    uploaded: 'Received',
    blocked: 'On Hold',
    needs_review: 'Pending',
    draft: 'Draft',
    processing: 'Processing',
  }

  const recentRows = recentUploads.map((u: any) => [
    <Button variant="plain" onClick={() => setSelectedUploadId(u.id)} key={u.id}>
      {u.id.slice(0, 8) + '...'}
    </Button>,
    <Badge key={`mode-${u.id}`}>{u.mode}</Badge>,
    <Badge
      key={`status-${u.id}`}
      tone={
        u.status === 'uploaded'
          ? 'success'
          : u.status === 'blocked'
            ? 'attention'
            : u.status === 'needs_review'
              ? 'attention'
              : 'info'
      }
    >
      {statusLabels[u.status] || u.status.replace('_', ' ')}
    </Badge>,
    u.orderId ? (
      <Badge key={`order-${u.id}`} tone="success">
        #{u.orderId.slice(-6)}
      </Badge>
    ) : (
      <Text key={`no-order-${u.id}`} as="span" tone="subdued">
        -
      </Text>
    ),
    u.locations.join(', '),
    new Date(u.createdAt).toLocaleDateString(),
  ])

  const orderRows = recentOrders.map((o: any) => [
    <Text key={o.orderId} as="span" fontWeight="semibold">
      #{o.orderId.slice(-8)}
    </Text>,
    o.uploadId.slice(0, 8) + '...',
    <Badge key={`mode-${o.orderId}`}>{o.uploadMode}</Badge>,
    <Badge
      key={`status-${o.orderId}`}
      tone={
        o.uploadStatus === 'uploaded'
          ? 'success'
          : o.uploadStatus === 'blocked'
            ? 'attention'
            : o.uploadStatus === 'needs_review'
              ? 'attention'
              : 'info'
      }
    >
      {statusLabels[o.uploadStatus] || o.uploadStatus.replace('_', ' ')}
    </Badge>,
    new Date(o.createdAt).toLocaleDateString(),
  ])

  return (
    <Page
      title="Analytics"
      backAction={{ content: 'Dashboard', url: '/app' }}
      secondaryActions={[
        { content: 'Orders', url: '/app/analytics/orders' },
        { content: 'Visitors', url: '/app/analytics/visitors' },
        { content: 'Attribution', url: '/app/analytics/attribution' },
        { content: 'Production Queue', url: '/app/queue' },
      ]}
    >
      <Layout>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Upload Analytics
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    📅 {dateRangeText}
                  </Text>
                </BlockStack>
                <Select
                  label=""
                  labelHidden
                  options={[
                    { label: 'Last 7 days', value: '7d' },
                    { label: 'Last 30 days', value: '30d' },
                    { label: 'Last 90 days', value: '90d' },
                    { label: 'All time', value: 'all' },
                    { label: 'Custom range', value: 'custom' },
                  ]}
                  value={selectedPeriod}
                  onChange={handlePeriodChange}
                />
              </InlineStack>
              {showCustomDatePicker && (
                <InlineStack gap="300" align="end">
                  <TextField
                    label="Start date"
                    type="date"
                    value={customStartDate}
                    onChange={setCustomStartDate}
                    autoComplete="off"
                  />
                  <TextField
                    label="End date"
                    type="date"
                    value={customEndDate}
                    onChange={setCustomEndDate}
                    autoComplete="off"
                  />
                  <div style={{ paddingTop: '24px' }}>
                    <Button
                      variant="primary"
                      onClick={handleApplyCustomDate}
                      disabled={!customStartDate || !customEndDate}
                    >
                      Apply
                    </Button>
                  </div>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section variant="oneThird">
          <MetricCard
            title="Total Uploads"
            value={metrics.totalUploads}
            subtitle={selectedPeriod === 'all' ? 'all time' : `in selected period`}
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Success Rate"
            value={`${metrics.successRate}%`}
            subtitle={`${metrics.completedUploads} completed`}
            tone="success"
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Warning Rate"
            value={`${metrics.warningRate}%`}
            subtitle={`${metrics.warningUploads} with warnings`}
            tone="warning"
          />
        </Layout.Section>


        <Layout.Section variant="oneThird">
          <MetricCard
            title="Total Orders"
            value={metrics.totalOrders}
            subtitle={`with custom uploads`}
            tone="success"
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Conversion Rate"
            value={`${metrics.orderConversionRate}%`}
            subtitle={`${metrics.ordersWithUploads} uploads ordered`}
            tone="success"
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Blocked Rate"
            value={`${metrics.blockedRate}%`}
            subtitle={`${metrics.blockedUploads} blocked`}
            tone="critical"
          />
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  👥 Customer Segmentation
                </Text>
                <Badge tone="info">Customer Data</Badge>
              </InlineStack>
              <Divider />
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Logged-in Customers
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {customerSegmentation?.loggedInCustomers ?? 0}
                    </Text>
                    <Badge tone="success">
                      {(customerSegmentation?.loggedInPercentage ?? 0).toFixed(1)}% of uploads
                    </Badge>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Anonymous Visitors
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {customerSegmentation?.anonymousVisitors ?? 0}
                    </Text>
                    <Badge>
                      {(100 - (customerSegmentation?.loggedInPercentage ?? 0)).toFixed(1)}% of
                      uploads
                    </Badge>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Logged-in Conversion
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                      {(customerSegmentation?.loggedInConversionRate ?? 0).toFixed(1)}%
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {customerSegmentation?.loggedInOrders ?? 0} orders
                    </Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Anonymous Conversion
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {(customerSegmentation?.anonymousConversionRate ?? 0).toFixed(1)}%
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {customerSegmentation?.anonymousOrders ?? 0} orders
                    </Text>
                  </BlockStack>
                </Box>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>


        {(revenueStats?.totalRevenue ?? 0) > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    💰 Revenue Analytics
                  </Text>
                  <Badge tone="success">{formatCurrency(revenueStats?.totalRevenue ?? 0)}</Badge>
                </InlineStack>
                <Divider />
                <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                  <Box padding="300" background="bg-fill-success-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Total Revenue
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {formatCurrency(revenueStats?.totalRevenue ?? 0)}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Total Orders
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {revenueStats?.totalOrders ?? 0}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Avg Order Value
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {formatCurrency(revenueStats?.avgOrderValue ?? 0)}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Cart Conversions
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {revenueStats?.conversionFunnel?.orders ?? 0}/
                        {revenueStats?.conversionFunnel?.cartAdds ?? 0}
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineGrid>

                {(revenueStats?.revenueByMode?.length ?? 0) > 0 && (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      Revenue by Mode
                    </Text>
                    {revenueStats?.revenueByMode?.map((m: any) => (
                      <InlineStack key={m.mode} align="space-between">
                        <Text as="span" variant="bodyMd">
                          {m.mode}
                        </Text>
                        <InlineStack gap="200">
                          <Badge>{m.orders} orders</Badge>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {formatCurrency(m.revenue)}
                          </Text>
                        </InlineStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  📁 File Metrics
                </Text>
                <Badge>{formatBytes(fileMetrics?.totalDataTransferred ?? 0)} transferred</Badge>
              </InlineStack>
              <Divider />
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Avg File Size
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {formatBytes(fileMetrics?.avgFileSize ?? 0)}
                    </Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Median File Size
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {formatBytes(fileMetrics?.medianFileSize ?? 0)}
                    </Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Avg Upload Time
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {formatDuration(fileMetrics?.avgUploadDuration ?? 0)}
                    </Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Upload Speed
                    </Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {formatBytes(fileMetrics?.uploadSpeedAvg ?? 0)}/s
                    </Text>
                  </BlockStack>
                </Box>
              </InlineGrid>


              {(fileMetrics?.fileSizeDistribution?.length ?? 0) > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    File Size Distribution
                  </Text>
                  {fileMetrics?.fileSizeDistribution?.map((d: any) => (
                    <BlockStack key={d.range} gap="100">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          {d.range}
                        </Text>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {d.count} files ({d.percentage.toFixed(1)}%)
                        </Text>
                      </InlineStack>
                      <ProgressBar progress={d.percentage} size="small" />
                    </BlockStack>
                  ))}
                </BlockStack>
              )}


              {(fileTypeBreakdown?.length ?? 0) > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    File Types
                  </Text>
                  <InlineStack gap="200" wrap>
                    {fileTypeBreakdown?.slice(0, 5).map((t: any) => (
                      <Badge key={t.mimeType}>
                        {t.mimeType.split('/')[1] || t.mimeType}: {t.count} (
                        {t.percentage.toFixed(0)}%)
                      </Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        {(customerMetrics?.uniqueCustomers ?? 0) > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  🎯 Customer Lifetime Value
                </Text>
                <Divider />
                <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Unique Customers
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {customerMetrics?.uniqueCustomers ?? 0}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Repeat Customers
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {customerMetrics?.repeatCustomers ?? 0}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {(
                          ((customerMetrics?.repeatCustomers ?? 0) /
                            (customerMetrics?.uniqueCustomers ?? 1)) *
                          100
                        ).toFixed(0)}
                        % retention
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Avg Revenue/Customer
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {formatCurrency(customerMetrics?.avgRevenuePerCustomer ?? 0)}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Top Customer Value
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {formatCurrency(customerMetrics?.topCustomerRevenue ?? 0)}
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}


        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Uploads by Mode
              </Text>

              {modeBreakdown.length > 0 ? (
                <BlockStack gap="300">
                  {modeBreakdown.map((m: any) => (
                    <BlockStack key={m.mode} gap="100">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          {m.mode}
                        </Text>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {m.count} ({m.percentage}%)
                        </Text>
                      </InlineStack>
                      <ProgressBarCustom
                        value={m.percentage}
                        color={modeColors[m.mode] || '#637381'}
                      />
                    </BlockStack>
                  ))}
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">
                  No data available
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Location Usage
              </Text>

              {locationUsage.length > 0 ? (
                <BlockStack gap="300">
                  {locationUsage.map((l: any) => (
                    <BlockStack key={l.location} gap="100">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          {l.location.replace('_', ' ')}
                        </Text>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {l.count} ({l.percentage}%)
                        </Text>
                      </InlineStack>
                      <ProgressBarCustom
                        value={l.percentage}
                        color={locationColors[l.location] || '#637381'}
                      />
                    </BlockStack>
                  ))}
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">
                  No data available
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Status Distribution
              </Text>

              <InlineStack gap="400" wrap>
                {statusBreakdown.map((s: any) => (
                  <Box
                    key={s.status}
                    background="bg-surface-secondary"
                    padding="300"
                    borderRadius="200"
                    minWidth="120px"
                  >
                    <BlockStack gap="100" inlineAlign="center">
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: statusColors[s.status] || '#637381',
                        }}
                      />
                      <Text as="p" variant="headingMd" alignment="center">
                        {s.count}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        {s.status.replace('_', ' ')}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Daily Trend
              </Text>

              {dailyTrend.length > 0 ? (
                <Box minHeight="200px">
                  <InlineStack gap="100" align="end" blockAlign="end">
                    {dailyTrend.slice(-14).map((d, i) => {
                      const maxCount = Math.max(...dailyTrend.map((x) => x.count))
                      const height = maxCount > 0 ? (d.count / maxCount) * 150 : 0
                      return (
                        <Box key={i} minWidth="20px">
                          <BlockStack gap="050" inlineAlign="center">
                            <div
                              style={{
                                width: 16,
                                height: Math.max(height, 4),
                                backgroundColor: '#5C6AC4',
                                borderRadius: '2px 2px 0 0',
                              }}
                              title={`${d.date}: ${d.count} uploads`}
                            />
                            <Text as="span" variant="bodySm" tone="subdued">
                              {d.date.slice(-2)}
                            </Text>
                          </BlockStack>
                        </Box>
                      )
                    })}
                  </InlineStack>
                </Box>
              ) : (
                <Text as="p" tone="subdued">
                  No data available
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Recent Uploads
                </Text>
                <a href="/app/uploads">View All</a>
              </InlineStack>

              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                headings={['ID', 'Mode', 'Status', 'Order', 'Locations', 'Date']}
                rows={recentRows}
              />
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Recent Orders with Custom Uploads
                </Text>
                <a href="/app/queue">View Queue</a>
              </InlineStack>

              {orderRows.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['Order', 'Upload ID', 'Mode', 'Status', 'Date']}
                  rows={orderRows}
                />
              ) : (
                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" tone="subdued" alignment="center">
                      No orders with custom uploads yet
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      When customers place orders with uploaded designs, they'll appear here
                    </Text>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <UploadDetailModal
            uploadId={selectedUploadId}
            onClose={() => setSelectedUploadId(null)}
        />
      </Layout>
    </Page>
  )
}

