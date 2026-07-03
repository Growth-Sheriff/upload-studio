




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
  Icon,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  Text,
  TextField,
  Thumbnail,
  Tooltip,
} from '@shopify/polaris'
import { NoteIcon } from '@shopify/polaris-icons'
import { useCallback, useState } from 'react'
import prisma from '~/lib/prisma.server'
import { authenticate } from '~/shopify.server'


const ORDERS_QUERY = `
  query getOrders($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          email
          customer {
            email
            firstName
            lastName
          }
          shippingAddress {
            city
            provinceCode
            country
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                quantity
                customAttributes {
                  key
                  value
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request)
  const shopDomain = session.shop

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
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


  const orderLinks = await prisma.orderLink.findMany({
    where: {
      shopId: shop.id,
      createdAt: { gte: startDate },
    },
    include: {
      upload: {
        select: {
          id: true,
          mode: true,
          status: true,
          customerEmail: true,
          orderTotal: true,
          orderCurrency: true,
          orderPaidAt: true,
          createdAt: true,
          items: {
            select: {
              location: true,
              originalName: true,
              fileSize: true,
              preflightStatus: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })


  const uniqueOrderIds = [...new Set(orderLinks.map((ol) => ol.orderId))]


  const ordersFromDB = uniqueOrderIds.map((orderId) => {
    const relatedLinks = orderLinks.filter((ol) => ol.orderId === orderId)
    const uploads = relatedLinks.map((ol) => ol.upload)
    const firstUpload = uploads[0]

    return {
      orderId,
      uploadCount: uploads.length,
      uploads: uploads.map((u) => ({
        id: u?.id,
        mode: u?.mode,
        status: u?.status,
        locations: u?.items?.map((i) => i.location) || [],
        files:
          u?.items?.map((i) => ({
            name: i.originalName,
            size: i.fileSize,
            preflightStatus: i.preflightStatus,
          })) || [],
      })),
      customerEmail: firstUpload?.customerEmail || null,
      orderTotal: firstUpload?.orderTotal ? Number(firstUpload.orderTotal) : null,
      orderCurrency: firstUpload?.orderCurrency || 'USD',
      orderPaidAt: firstUpload?.orderPaidAt?.toISOString() || null,
      createdAt: relatedLinks[0]?.createdAt?.toISOString(),
    }
  })


  let shopifyOrders: any[] = []
  try {
    const orderIdsForQuery = uniqueOrderIds.slice(0, 50)

    if (orderIdsForQuery.length > 0) {


      const queryStr = orderIdsForQuery.map((id) => `id:${id}`).join(' OR ')
      console.log('[Analytics] Shopify orders query:', queryStr)

      const response = await admin.graphql(ORDERS_QUERY, {
        variables: {
          first: 50,
          query: queryStr,
        },
      })

      const data = await response.json()
      shopifyOrders = data.data?.orders?.edges?.map((e: any) => e.node) || []
    }
  } catch (error) {
    console.error('[Analytics] Failed to fetch Shopify orders:', error)
  }


  const enrichedOrders = ordersFromDB.map((dbOrder) => {

    const numericId = dbOrder.orderId
    const shopifyOrder = shopifyOrders.find((so) => {
      const soId = so.id.replace('gid://shopify/Order/', '')
      return soId === numericId || so.id === numericId
    })

    return {
      ...dbOrder,
      shopifyData: shopifyOrder
        ? {
            name: shopifyOrder.name,
            financialStatus: shopifyOrder.displayFinancialStatus,
            fulfillmentStatus: shopifyOrder.displayFulfillmentStatus,
            totalPrice: parseFloat(shopifyOrder.totalPriceSet?.shopMoney?.amount || '0'),
            currency: shopifyOrder.totalPriceSet?.shopMoney?.currencyCode || 'USD',
            customer: shopifyOrder.customer
              ? {
                  email: shopifyOrder.customer.email || shopifyOrder.email,
                  name: [shopifyOrder.customer.firstName, shopifyOrder.customer.lastName]
                    .filter(Boolean)
                    .join(' '),
                }
              : shopifyOrder.email
                ? { email: shopifyOrder.email, name: '' }
                : null,
            shipping: shopifyOrder.shippingAddress
              ? {
                  city: shopifyOrder.shippingAddress.city,
                  state: shopifyOrder.shippingAddress.provinceCode,
                  country: shopifyOrder.shippingAddress.country,
                }
              : null,
            createdAt: shopifyOrder.createdAt,
            lineItemsWithUploads:
              shopifyOrder.lineItems?.edges
                ?.filter((li: any) =>
                  li.node.customAttributes?.some((attr: any) => attr.key === '_ul_upload_id')
                )
                .map((li: any) => ({
                  title: li.node.title,
                  quantity: li.node.quantity,
                  uploadId: li.node.customAttributes?.find((a: any) => a.key === '_ul_upload_id')
                    ?.value,
                })) || [],
          }
        : null,
    }
  })


  const totalOrders = enrichedOrders.length
  const totalRevenue = enrichedOrders.reduce((sum, o) => {
    const price = o.shopifyData?.totalPrice || o.orderTotal || 0
    return sum + price
  }, 0)
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0


  const totalUploadsInOrders = enrichedOrders.reduce((sum, o) => sum + o.uploadCount, 0)
  const avgUploadsPerOrder = totalOrders > 0 ? totalUploadsInOrders / totalOrders : 0


  const paidOrders = enrichedOrders.filter(
    (o) => o.shopifyData?.financialStatus === 'PAID' || o.orderPaidAt
  ).length
  const fulfilledOrders = enrichedOrders.filter(
    (o) => o.shopifyData?.fulfillmentStatus === 'FULFILLED'
  ).length


  const locationCounts: Record<string, number> = {}
  enrichedOrders.forEach((order) => {
    order.uploads.forEach((upload) => {
      upload.locations.forEach((loc) => {
        locationCounts[loc] = (locationCounts[loc] || 0) + 1
      })
    })
  })


  const modeCounts: Record<string, number> = {}
  enrichedOrders.forEach((order) => {
    order.uploads.forEach((upload) => {
      if (upload.mode) {
        modeCounts[upload.mode] = (modeCounts[upload.mode] || 0) + 1
      }
    })
  })


  const dailyCounts: Record<string, { orders: number; revenue: number }> = {}
  enrichedOrders.forEach((order) => {
    const date = (order.shopifyData?.createdAt || order.createdAt || '').split('T')[0]
    if (date) {
      if (!dailyCounts[date]) {
        dailyCounts[date] = { orders: 0, revenue: 0 }
      }
      dailyCounts[date].orders++
      dailyCounts[date].revenue += order.shopifyData?.totalPrice || order.orderTotal || 0
    }
  })

  return json({
    period,
    dateRangeText,
    summary: {
      totalOrders,
      totalRevenue,
      avgOrderValue,
      totalUploadsInOrders,
      avgUploadsPerOrder,
      paidOrders,
      fulfilledOrders,
      paidRate: totalOrders > 0 ? Math.round((paidOrders / totalOrders) * 100) : 0,
      fulfillmentRate: totalOrders > 0 ? Math.round((fulfilledOrders / totalOrders) * 100) : 0,
    },
    locationBreakdown: Object.entries(locationCounts).map(([location, count]) => ({
      location,
      count,
      percentage: totalUploadsInOrders > 0 ? Math.round((count / totalUploadsInOrders) * 100) : 0,
    })),
    modeBreakdown: Object.entries(modeCounts).map(([mode, count]) => ({
      mode,
      count,
      percentage: totalUploadsInOrders > 0 ? Math.round((count / totalUploadsInOrders) * 100) : 0,
    })),
    dailyTrend: Object.entries(dailyCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data })),
    orders: enrichedOrders.slice(0, 50), // Limit for UI
  })
}

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount)
}

function MetricCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string
  value: string | number
  subtitle?: string
  tone?: 'success' | 'critical' | 'warning' | 'info'
}) {
  const colorMap = {
    success: '#008060',
    critical: '#D72C0D',
    warning: '#B98900',
    info: '#5C6AC4',
  }

  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="headingXl" fontWeight="bold">
          {tone ? <span style={{ color: colorMap[tone] }}>{value}</span> : value}
        </Text>
        {subtitle && (
          <Text as="p" variant="bodySm" tone="subdued">
            {subtitle}
          </Text>
        )}
      </BlockStack>
    </Card>
  )
}

export default function OrderAnalyticsPage() {
  const data = useLoaderData<typeof loader>()

  if ('error' in data) {
    return (
      <Page title="Order Analytics">
        <Card>
          <Text as="p" tone="critical">
            {data.error}
          </Text>
        </Card>
      </Page>
    )
  }

  const [selectedPeriod, setSelectedPeriod] = useState(data.period)
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(data.period === 'custom')


  const [selectedOrder, setSelectedOrder] = useState<any>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const navigate = useNavigate()

  const handlePeriodChange = useCallback(
    (value: string) => {
      setSelectedPeriod(value)
      if (value === 'custom') {
        setShowCustomDatePicker(true)
      } else {
        setShowCustomDatePicker(false)
        navigate(`/app/analytics/orders?period=${value}`)
      }
    },
    [navigate]
  )

  const handleApplyCustomDate = useCallback(() => {
    if (customStartDate && customEndDate) {
      navigate(
        `/app/analytics/orders?period=custom&startDate=${customStartDate}&endDate=${customEndDate}`
      )
    }
  }, [navigate, customStartDate, customEndDate])

  const { summary, locationBreakdown, modeBreakdown, dailyTrend, orders, dateRangeText } = data

  const locationColors: Record<string, string> = {
    front: '#5C6AC4',
    back: '#47C1BF',
    left_sleeve: '#9C6ADE',
    right_sleeve: '#F49342',
    full: '#008060',
  }

  const statusTone = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PAID':
        return 'success'
      case 'PENDING':
        return 'warning'
      case 'REFUNDED':
        return 'critical'
      case 'FULFILLED':
        return 'success'
      case 'UNFULFILLED':
        return 'warning'
      default:
        return 'info'
    }
  }

  const orderRows = orders.map((order: any) => [
    <Text key={`name-${order.orderId}`} as="span" fontWeight="semibold">
      {order.shopifyData?.name || `#${order.orderId.slice(-8)}`}
    </Text>,
    order.shopifyData?.customer?.email || order.customerEmail || '-',
    <Badge key={`pay-${order.orderId}`} tone={statusTone(order.shopifyData?.financialStatus)}>
      {order.shopifyData?.financialStatus || (order.orderPaidAt ? 'PAID' : 'PENDING')}
    </Badge>,
    <Badge key={`ful-${order.orderId}`} tone={statusTone(order.shopifyData?.fulfillmentStatus)}>
      {order.shopifyData?.fulfillmentStatus || 'UNFULFILLED'}
    </Badge>,
    formatCurrency(
      order.shopifyData?.totalPrice || order.orderTotal || 0,
      order.shopifyData?.currency || order.orderCurrency
    ),
    order.uploadCount,
    <Button
      key={`btn-${order.orderId}`}
      variant="plain"
      onClick={() => {
        setSelectedOrder(order)
        setIsModalOpen(true)
      }}
    >
      Upload Files
    </Button>,
    new Date(order.shopifyData?.createdAt || order.createdAt).toLocaleDateString(),
  ])

  return (
    <Page
      title="Order Analytics"
      subtitle="Orders placed through the customizer system"
      backAction={{ content: 'Analytics', url: '/app/analytics' }}
    >
      <Layout>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    📦 Orders with Custom Uploads
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
            title="Total Orders"
            value={summary.totalOrders}
            subtitle="with custom uploads"
            tone="info"
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Total Revenue"
            value={formatCurrency(summary.totalRevenue)}
            subtitle="from custom orders"
            tone="success"
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Avg Order Value"
            value={formatCurrency(summary.avgOrderValue)}
            subtitle="per order"
          />
        </Layout.Section>


        <Layout.Section variant="oneThird">
          <MetricCard
            title="Uploads in Orders"
            value={summary.totalUploadsInOrders}
            subtitle={`~${summary.avgUploadsPerOrder.toFixed(1)} per order`}
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Payment Rate"
            value={`${summary.paidRate}%`}
            subtitle={`${summary.paidOrders} paid orders`}
            tone="success"
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <MetricCard
            title="Fulfillment Rate"
            value={`${summary.fulfillmentRate}%`}
            subtitle={`${summary.fulfilledOrders} fulfilled`}
            tone={summary.fulfillmentRate > 80 ? 'success' : 'warning'}
          />
        </Layout.Section>


        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Print Location Usage
              </Text>
              <Divider />
              {locationBreakdown.length > 0 ? (
                <BlockStack gap="300">
                  {locationBreakdown.map((loc: any) => (
                    <Box key={loc.location}>
                      <InlineStack align="space-between">
                        <InlineStack gap="200">
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 2,
                              backgroundColor: locationColors[loc.location] || '#637381',
                            }}
                          />
                          <Text as="span">{loc.location.replace('_', ' ')}</Text>
                        </InlineStack>
                        <Text as="span" tone="subdued">
                          {loc.count} ({loc.percentage}%)
                        </Text>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">
                  No location data yet
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Upload Mode Breakdown
              </Text>
              <Divider />
              {modeBreakdown.length > 0 ? (
                <BlockStack gap="300">
                  {modeBreakdown.map((m: any) => (
                    <Box key={m.mode}>
                      <InlineStack align="space-between">
                        <Badge>{m.mode}</Badge>
                        <Text as="span" tone="subdued">
                          {m.count} ({m.percentage}%)
                        </Text>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">
                  No mode data yet
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        {dailyTrend.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Daily Order Trend
                </Text>
                <Divider />
                <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                  <InlineStack gap="100" align="end" blockAlign="end">
                    {dailyTrend.slice(-30).map((d: any, i: number) => {
                      const maxOrders = Math.max(...dailyTrend.map((x: any) => x.orders), 1)
                      const height = (d.orders / maxOrders) * 60
                      return (
                        <Box key={i} minWidth="16px">
                          <BlockStack gap="050" inlineAlign="center">
                            <Tooltip
                              content={`${d.date}: ${d.orders} orders, ${formatCurrency(d.revenue)}`}
                            >
                              <div
                                style={{
                                  width: 14,
                                  height: Math.max(height, 4),
                                  backgroundColor: '#008060',
                                  borderRadius: '2px 2px 0 0',
                                  cursor: 'pointer',
                                }}
                              />
                            </Tooltip>
                          </BlockStack>
                        </Box>
                      )
                    })}
                  </InlineStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Recent Orders
                </Text>
                <Button url="/app/queue" variant="plain">
                  View Production Queue
                </Button>
              </InlineStack>

              {orderRows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    'text',
                    'text',
                    'text',
                    'text',
                    'numeric',
                    'numeric',
                    'text',
                    'text',
                  ]}
                  headings={[
                    'Order',
                    'Customer',
                    'Payment',
                    'Fulfillment',
                    'Total',
                    'Uploads',
                    'Files',
                    'Date',
                  ]}
                  rows={orderRows}
                />
              ) : (
                <Box padding="600" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="headingMd" alignment="center">
                      No orders yet
                    </Text>
                    <Text as="p" tone="subdued" alignment="center">
                      When customers place orders with custom uploads, they'll appear here with full
                      analytics.
                    </Text>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>


      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`Uploads for Order #${selectedOrder?.shopifyData?.name || selectedOrder?.orderId}`}
        large
      >
        <Modal.Section>
          {selectedOrder && (
            <BlockStack gap="400">
              {selectedOrder.uploads.map((upload: any) => (
                <Card key={upload.id}>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingSm">
                        Upload ID: {upload.id}
                      </Text>
                      <Badge tone={upload.status === 'approved' ? 'success' : 'attention'}>
                        {upload.status}
                      </Badge>
                    </InlineStack>
                    <Divider />
                    {upload.items?.map((item: any) => (
                      <InlineStack key={item.id} gap="400" blockAlign="center">
                        {item.thumbnailUrl ? (
                          <Thumbnail source={item.thumbnailUrl} alt={item.location} size="medium" />
                        ) : (
                          <Box
                            background="bg-surface-secondary"
                            padding="300"
                            borderRadius="200"
                            minWidth="60px"
                            minHeight="60px"
                          >
                            <InlineStack align="center" blockAlign="center">
                              <Icon source={NoteIcon} tone="subdued" />
                            </InlineStack>
                          </Box>
                        )}
                        <BlockStack gap="100">
                          <Text as="span" fontWeight="bold">
                            {item.location}
                          </Text>
                          <Text as="span" tone="subdued" variant="bodySm">
                            {item.originalName || 'No filename'}
                          </Text>
                          <Button url={`/app/uploads/${upload.id}`} variant="plain" size="micro">
                            View Details
                          </Button>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  )
}
