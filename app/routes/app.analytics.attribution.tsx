




import { json, type LoaderFunctionArgs } from '@remix-run/node'
import { useLoaderData, useNavigate } from '@remix-run/react'
import {
  Badge,
  Banner,
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
  getAttributionStats,
  getCampaignBreakdown,
  getClickIdStats,
  getMediumBreakdown,
  getReferrerBreakdown,
  getShopIdFromDomain,
  getSourceBreakdown,
  generateAttributionRecommendations,
  type AttributionStats,
  type CampaignBreakdown,
  type ClickIdStats,
  type MarketingRecommendation,
  type MediumBreakdown,
  type ReferrerBreakdown,
  type SourceBreakdown,
} from '~/lib/analytics.server'
import { authenticate } from '~/shopify.server'

interface LoaderData {
  stats: AttributionStats
  sources: SourceBreakdown[]
  mediums: MediumBreakdown[]
  campaigns: CampaignBreakdown[]
  clickIds: ClickIdStats
  referrers: ReferrerBreakdown[]
  recommendations: MarketingRecommendation[]
  period: string
  dateRangeText: string
  error?: string
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopId = await getShopIdFromDomain(session.shop)

  if (!shopId) {
    return json<LoaderData>({
      stats: {
        totalSessions: 0,
        sessionsWithUTM: 0,
        utmPercentage: 0,
        topSource: 'N/A',
        topMedium: 'N/A',
        paidClicks: 0,
      },
      sources: [],
      mediums: [],
      campaigns: [],
      clickIds: { gclid: 0, fbclid: 0, msclkid: 0, ttclid: 0, total: 0 },
      referrers: [],
      recommendations: [],
      period: '30d',
      dateRangeText: '',
      error: 'Shop not found',
    })
  }


  const url = new URL(request.url)
  const period = url.searchParams.get('period') || '30d'
  const customStart = url.searchParams.get('startDate')
  const customEnd = url.searchParams.get('endDate')


  let endDate = new Date()
  let startDate: Date

  if (period === 'custom' && customStart && customEnd) {
    startDate = new Date(customStart)
    endDate = new Date(customEnd)
    endDate.setHours(23, 59, 59, 999)
  } else {
    switch (period) {
      case '7d':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'all':
        startDate = new Date(0)
        break
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
    }
  }

  const dateRangeText =
    period === 'all'
      ? 'All time'
      : `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  try {
    const [stats, sources, mediums, campaigns, clickIds, referrers] = await Promise.all([
      getAttributionStats(shopId, startDate, endDate),
      getSourceBreakdown(shopId, startDate, endDate),
      getMediumBreakdown(shopId, startDate, endDate),
      getCampaignBreakdown(shopId, startDate, endDate),
      getClickIdStats(shopId, startDate, endDate),
      getReferrerBreakdown(shopId, startDate, endDate),
    ])

    const recommendations = await generateAttributionRecommendations(
      stats, sources, mediums, campaigns, clickIds, referrers
    )

    return json<LoaderData>({
      stats,
      sources,
      mediums,
      campaigns,
      clickIds,
      referrers,
      recommendations,
      period,
      dateRangeText,
    })
  } catch (error) {
    console.error('Attribution analytics error:', error)
    return json<LoaderData>({
      stats: {
        totalSessions: 0,
        sessionsWithUTM: 0,
        utmPercentage: 0,
        topSource: 'N/A',
        topMedium: 'N/A',
        paidClicks: 0,
      },
      sources: [],
      mediums: [],
      campaigns: [],
      clickIds: { gclid: 0, fbclid: 0, msclkid: 0, ttclid: 0, total: 0 },
      referrers: [],
      recommendations: [],
      period: '30d',
      dateRangeText: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function StatCard({
  title,
  value,
  subtitle,
  badge,
  badgeTone,
}: {
  title: string
  value: string | number
  subtitle?: string
  badge?: string
  badgeTone?: 'success' | 'info' | 'warning' | 'critical'
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="bodyMd" tone="subdued">
            {title}
          </Text>
          {badge && <Badge tone={badgeTone}>{badge}</Badge>}
        </InlineStack>
        <Text as="p" variant="headingXl" fontWeight="bold">
          {typeof value === 'number' ? value.toLocaleString() : value}
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

function PlatformCard({
  platform,
  icon,
  clicks,
  color,
}: {
  platform: string
  icon: string
  clicks: number
  color: string
}) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="300">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="span" variant="headingLg">
          {icon}
        </Text>
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {platform}
        </Text>
        <Text as="p" variant="headingMd" fontWeight="bold">
          {clicks.toLocaleString()}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          ad clicks
        </Text>
      </BlockStack>
    </Box>
  )
}

export default function AnalyticsAttribution() {
  const { stats, sources, mediums, campaigns, clickIds, referrers, recommendations, period, dateRangeText, error } =
    useLoaderData<typeof loader>()
  const [selectedPeriod, setSelectedPeriod] = useState(period)
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(period === 'custom')
  const navigate = useNavigate()

  const handlePeriodChange = useCallback(
    (value: string) => {
      setSelectedPeriod(value)
      if (value === 'custom') {
        setShowCustomDatePicker(true)
      } else {
        setShowCustomDatePicker(false)
        navigate(`/app/analytics/attribution?period=${value}`)
      }
    },
    [navigate]
  )

  const handleApplyCustomDate = useCallback(() => {
    if (customStartDate && customEndDate) {
      navigate(
        `/app/analytics/attribution?period=custom&startDate=${customStartDate}&endDate=${customEndDate}`
      )
    }
  }, [navigate, customStartDate, customEndDate])

  if (error) {
    return (
      <Page title="Attribution Analytics" backAction={{ url: '/app/analytics' }}>
        <Layout>
          <Layout.Section>
            <Banner tone="critical">
              <p>Error loading analytics: {error}</p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    )
  }


  const sourceRows = sources.map((s) => [
    s.source,
    s.sessions.toString(),
    s.uploads.toString(),
    `${s.conversionRate.toFixed(1)}%`,
  ])

  const campaignRows = campaigns.map((c) => [
    c.campaign,
    c.source || '-',
    c.sessions.toString(),
    c.uploads.toString(),
  ])

  return (
    <Page
      title="Attribution Analytics"
      subtitle="Track traffic sources, UTM campaigns, and ad performance"
      backAction={{ url: '/app/analytics' }}
    >
      <Layout>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    🎯 Attribution Analytics
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


        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <StatCard title="Total Sessions" value={stats.totalSessions} subtitle="Last 30 days" />
            <StatCard
              title="UTM Tagged"
              value={stats.sessionsWithUTM}
              subtitle={`${stats.utmPercentage.toFixed(1)}% of sessions`}
              badge={stats.utmPercentage > 30 ? 'Good tracking' : 'Low tracking'}
              badgeTone={stats.utmPercentage > 30 ? 'success' : 'warning'}
            />
            <StatCard
              title="Top Source"
              value={stats.topSource}
              subtitle="Most common traffic source"
              badge="UTM Source"
              badgeTone="info"
            />
            <StatCard
              title="Paid Ad Clicks"
              value={stats.paidClicks}
              subtitle="Google, Facebook, Microsoft, TikTok"
              badge={stats.paidClicks > 0 ? 'Active' : 'None'}
              badgeTone={stats.paidClicks > 0 ? 'success' : undefined}
            />
          </InlineGrid>
        </Layout.Section>


        {recommendations.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      🧠 AI Marketing Recommendations
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Data-driven insights to optimize your marketing spend and grow revenue
                    </Text>
                  </BlockStack>
                  <Badge tone="success">{`${recommendations.length} insights`}</Badge>
                </InlineStack>
                <Divider />
                <BlockStack gap="400">
                  {recommendations.map((rec, index) => {
                    const impactTone =
                      rec.impact === 'high' ? 'critical' : rec.impact === 'medium' ? 'warning' : 'info'
                    const categoryLabel =
                      rec.category === 'acquisition'
                        ? '🚀 Acquisition'
                        : rec.category === 'optimization'
                          ? '⚙️ Optimization'
                          : rec.category === 'budget'
                            ? '💰 Budget'
                            : rec.category === 'strategy'
                              ? '🎯 Strategy'
                              : '🔄 Retention'

                    return (
                      <Box
                        key={rec.id}
                        padding="400"
                        background={
                          rec.impact === 'high' ? 'bg-surface-warning' : 'bg-surface-secondary'
                        }
                        borderRadius="300"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="start">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="headingMd">
                                {rec.icon}
                              </Text>
                              <BlockStack gap="100">
                                <Text as="h3" variant="headingSm" fontWeight="bold">
                                  {index + 1}. {rec.title}
                                </Text>
                                <InlineStack gap="200">
                                  <Badge tone={impactTone}>
                                    {`${rec.impact.toUpperCase()} IMPACT`}
                                  </Badge>
                                  <Badge>{categoryLabel}</Badge>
                                </InlineStack>
                              </BlockStack>
                            </InlineStack>
                            {rec.dataPoint && (
                              <Box
                                padding="200"
                                background="bg-surface"
                                borderRadius="200"
                              >
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  📈 {rec.dataPoint}
                                </Text>
                              </Box>
                            )}
                          </InlineStack>
                          <Text as="p" variant="bodyMd">
                            {rec.description}
                          </Text>
                          <Box
                            padding="300"
                            background="bg-surface"
                            borderRadius="200"
                          >
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodySm" fontWeight="bold" tone="success">
                                ✅ Action:
                              </Text>
                              <Text as="span" variant="bodySm">
                                {rec.actionText}
                              </Text>
                            </InlineStack>
                          </Box>
                        </BlockStack>
                      </Box>
                    )
                  })}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingMd">
                    🎯 Ad Platform Performance
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Click tracking from major ad platforms
                  </Text>
                </BlockStack>
                <Badge tone="info">{`${clickIds.total} total clicks`}</Badge>
              </InlineStack>
              <Divider />
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                <PlatformCard
                  platform="Google Ads"
                  icon="🔵"
                  clicks={clickIds.gclid}
                  color="blue"
                />
                <PlatformCard
                  platform="Facebook Ads"
                  icon="🔷"
                  clicks={clickIds.fbclid}
                  color="blue"
                />
                <PlatformCard
                  platform="Microsoft Ads"
                  icon="🟢"
                  clicks={clickIds.msclkid}
                  color="green"
                />
                <PlatformCard
                  platform="TikTok Ads"
                  icon="⬛"
                  clicks={clickIds.ttclid}
                  color="black"
                />
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">

            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  🔗 Traffic Sources
                </Text>
                {sourceRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'numeric', 'numeric', 'text']}
                    headings={['Source', 'Sessions', 'Uploads', 'Conv Rate']}
                    rows={sourceRows}
                  />
                ) : (
                  <Box padding="400">
                    <Text as="p" tone="subdued" alignment="center">
                      No UTM source data yet
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>


            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  📊 Traffic Medium
                </Text>
                <BlockStack gap="300">
                  {mediums.length > 0 ? (
                    mediums.map((m, i) => (
                      <BlockStack gap="200" key={i}>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodyMd">
                            {m.medium === 'none' ? 'Direct' : m.medium}
                          </Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {m.sessions.toLocaleString()} ({m.percentage.toFixed(1)}%)
                          </Text>
                        </InlineStack>
                        <ProgressBar progress={m.percentage} size="small" tone="highlight" />
                      </BlockStack>
                    ))
                  ) : (
                    <Box padding="400">
                      <Text as="p" tone="subdued" alignment="center">
                        No medium data yet
                      </Text>
                    </Box>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                🌐 Referrer Types
              </Text>
              <Divider />
              <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="300">
                {referrers.map((r, i) => (
                  <Box key={i} padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100" inlineAlign="center">
                      <Text as="span" variant="headingLg">
                        {r.type === 'direct'
                          ? '🏠'
                          : r.type === 'search'
                            ? '🔍'
                            : r.type === 'social'
                              ? '📱'
                              : r.type === 'email'
                                ? '📧'
                                : r.type === 'referral'
                                  ? '🔗'
                                  : '❓'}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {r.type || 'Unknown'}
                      </Text>
                      <Text as="p" variant="bodyMd" fontWeight="bold">
                        {r.sessions.toLocaleString()}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {r.percentage.toFixed(1)}%
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingMd">
                  📣 Campaign Performance
                </Text>
                <Badge>{`${campaigns.length} campaigns`}</Badge>
              </InlineStack>
              {campaignRows.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                  headings={['Campaign', 'Source', 'Sessions', 'Uploads']}
                  rows={campaignRows}
                  footerContent={`Showing ${campaigns.length} campaigns with UTM tracking`}
                />
              ) : (
                <Box padding="600">
                  <BlockStack gap="300" inlineAlign="center">
                    <Text as="span" variant="headingLg">
                      📊
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No campaign data yet
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Add UTM parameters to your marketing links to track campaigns
                    </Text>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Banner title="UTM Tracking Guide" tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                Add these parameters to your marketing URLs:
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale
              </Text>
            </BlockStack>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  )
}
