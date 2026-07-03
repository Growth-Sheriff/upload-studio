




import { json, type LoaderFunctionArgs } from '@remix-run/node'
import { useLoaderData, useNavigate } from '@remix-run/react'
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from '@shopify/polaris'
import { useCallback, useState } from 'react'
import { getShopIdFromDomain, getWeeklyCohorts, type WeeklyCohort } from '~/lib/analytics.server'
import { authenticate } from '~/shopify.server'

interface LoaderData {
  cohorts: WeeklyCohort[]
  weeks: number
  error?: string
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopId = await getShopIdFromDomain(session.shop)

  if (!shopId) {
    return json<LoaderData>({
      cohorts: [],
      weeks: 8,
      error: 'Shop not found',
    })
  }


  const url = new URL(request.url)
  const weeksParam = url.searchParams.get('weeks')
  const weeks = weeksParam ? parseInt(weeksParam, 10) : 8

  try {
    const cohorts = await getWeeklyCohorts(shopId, weeks)
    return json<LoaderData>({ cohorts, weeks })
  } catch (error) {
    console.error('Cohorts analytics error:', error)
    return json<LoaderData>({
      cohorts: [],
      weeks: 8,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function getHeatmapColor(value: number): string {
  if (value === 0) return 'bg-surface-secondary'
  if (value >= 80) return 'bg-fill-success'
  if (value >= 60) return 'bg-fill-success-secondary'
  if (value >= 40) return 'bg-fill-warning'
  if (value >= 20) return 'bg-fill-warning-secondary'
  if (value >= 10) return 'bg-fill-critical-secondary'
  return 'bg-fill-critical-secondary'
}

function getTextTone(value: number): 'text-inverse' | 'base' | 'subdued' {
  if (value >= 60) return 'text-inverse'
  if (value >= 20) return 'base'
  return 'subdued'
}

function CohortCell({ value, isHeader }: { value: number | string; isHeader?: boolean }) {
  if (isHeader) {
    return (
      <Box padding="200" background="bg-surface-secondary" borderRadius="100" minWidth="60px">
        <Text as="span" variant="bodySm" fontWeight="semibold" alignment="center">
          {value}
        </Text>
      </Box>
    )
  }

  const numValue = typeof value === 'number' ? value : 0
  const bgColor = getHeatmapColor(numValue)

  return (
    <Box padding="200" background={bgColor as any} borderRadius="100" minWidth="60px">
      <Text
        as="span"
        variant="bodySm"
        fontWeight="semibold"
        alignment="center"
        tone={getTextTone(numValue)}
      >
        {numValue > 0 ? `${numValue}%` : '-'}
      </Text>
    </Box>
  )
}

export default function AnalyticsCohorts() {
  const { cohorts, weeks, error } = useLoaderData<typeof loader>()
  const [selectedWeeks, setSelectedWeeks] = useState(weeks.toString())
  const [customWeeks, setCustomWeeks] = useState('')
  const [showCustomWeeksPicker, setShowCustomWeeksPicker] = useState(false)
  const navigate = useNavigate()

  const handleWeeksChange = useCallback(
    (value: string) => {
      setSelectedWeeks(value)
      if (value === 'custom') {
        setShowCustomWeeksPicker(true)
      } else {
        setShowCustomWeeksPicker(false)
        navigate(`/app/analytics/cohorts?weeks=${value}`)
      }
    },
    [navigate]
  )

  const handleApplyCustomWeeks = useCallback(() => {
    const weeksNum = parseInt(customWeeks, 10)
    if (weeksNum && weeksNum > 0 && weeksNum <= 52) {
      navigate(`/app/analytics/cohorts?weeks=${weeksNum}`)
    }
  }, [navigate, customWeeks])

  if (error) {
    return (
      <Page title="Retention Cohorts" backAction={{ url: '/app/analytics' }}>
        <Layout>
          <Layout.Section>
            <Banner tone="critical">
              <p>Error loading cohorts: {error}</p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    )
  }

  const hasData = cohorts.some((c) => c.totalVisitors > 0)

  return (
    <Page
      title="Retention Cohorts"
      subtitle="Track visitor retention week over week"
      backAction={{ url: '/app/analytics' }}
    >
      <Layout>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    📈 Retention Cohorts
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Analyzing {cohorts.length} weeks of data
                  </Text>
                </BlockStack>
                <Select
                  label=""
                  labelHidden
                  options={[
                    { label: 'Last 4 weeks', value: '4' },
                    { label: 'Last 8 weeks', value: '8' },
                    { label: 'Last 12 weeks', value: '12' },
                    { label: 'Last 24 weeks', value: '24' },
                    { label: 'Custom weeks', value: 'custom' },
                  ]}
                  value={showCustomWeeksPicker ? 'custom' : selectedWeeks}
                  onChange={handleWeeksChange}
                />
              </InlineStack>
              {showCustomWeeksPicker && (
                <InlineStack gap="300" align="end">
                  <TextField
                    label="Number of weeks"
                    type="number"
                    value={customWeeks}
                    onChange={setCustomWeeks}
                    autoComplete="off"
                    min={1}
                    max={52}
                    placeholder="1-52"
                  />
                  <div style={{ paddingTop: '24px' }}>
                    <Button variant="primary" onClick={handleApplyCustomWeeks} disabled={!customWeeks || parseInt(customWeeks) < 1 || parseInt(customWeeks) > 52}>
                      Apply
                    </Button>
                  </div>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                📊 How to Read This Chart
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Each row represents visitors who first arrived in a specific week. The columns show
                what percentage returned in subsequent weeks.
              </Text>
              <Divider />
              <InlineStack gap="300" wrap>
                <InlineStack gap="100" blockAlign="center">
                  <Box
                    padding="100"
                    background="bg-fill-success"
                    borderRadius="100"
                    minWidth="20px"
                    minHeight="20px"
                  />
                  <Text as="span" variant="bodySm">
                    80%+ (Excellent)
                  </Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <Box
                    padding="100"
                    background="bg-fill-success-secondary"
                    borderRadius="100"
                    minWidth="20px"
                    minHeight="20px"
                  />
                  <Text as="span" variant="bodySm">
                    60-79% (Good)
                  </Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <Box
                    padding="100"
                    background="bg-fill-warning"
                    borderRadius="100"
                    minWidth="20px"
                    minHeight="20px"
                  />
                  <Text as="span" variant="bodySm">
                    40-59% (Average)
                  </Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <Box
                    padding="100"
                    background="bg-fill-warning-secondary"
                    borderRadius="100"
                    minWidth="20px"
                    minHeight="20px"
                  />
                  <Text as="span" variant="bodySm">
                    20-39% (Low)
                  </Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <Box
                    padding="100"
                    background="bg-fill-critical-secondary"
                    borderRadius="100"
                    minWidth="20px"
                    minHeight="20px"
                  />
                  <Text as="span" variant="bodySm">
                    &lt;20% (Poor)
                  </Text>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingMd">
                  📅 Weekly Cohort Analysis
                </Text>
                <Badge tone="info">{cohorts.length} weeks</Badge>
              </InlineStack>
              <Divider />

              {hasData ? (
                <Box overflowX="auto">
                  <BlockStack gap="200">

                    <InlineStack gap="200" wrap={false}>
                      <Box minWidth="100px" padding="200">
                        <Text as="span" variant="bodySm" fontWeight="bold">
                          Week Start
                        </Text>
                      </Box>
                      <Box minWidth="70px" padding="200">
                        <Text as="span" variant="bodySm" fontWeight="bold">
                          Visitors
                        </Text>
                      </Box>
                      <CohortCell value="Week 0" isHeader />
                      <CohortCell value="Week 1" isHeader />
                      <CohortCell value="Week 2" isHeader />
                      <CohortCell value="Week 3" isHeader />
                      <CohortCell value="Week 4" isHeader />
                    </InlineStack>


                    {cohorts.map((cohort, i) => (
                      <InlineStack key={i} gap="200" wrap={false}>
                        <Box minWidth="100px" padding="200">
                          <Text as="span" variant="bodySm">
                            {cohort.weekStart}
                          </Text>
                        </Box>
                        <Box minWidth="70px" padding="200">
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {cohort.totalVisitors.toLocaleString()}
                          </Text>
                        </Box>
                        <CohortCell value={cohort.week0} />
                        <CohortCell value={cohort.week1} />
                        <CohortCell value={cohort.week2} />
                        <CohortCell value={cohort.week3} />
                        <CohortCell value={cohort.week4} />
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Box>
              ) : (
                <Box padding="800">
                  <BlockStack gap="400" inlineAlign="center">
                    <Text as="span" variant="heading2xl">
                      📊
                    </Text>
                    <Text as="h3" variant="headingMd" alignment="center">
                      No Cohort Data Yet
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      Cohort analysis requires at least one week of visitor data. As visitors return
                      over time, you'll see retention patterns here.
                    </Text>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        {hasData && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  📈 Retention Summary
                </Text>
                <Divider />
                <InlineStack gap="400" wrap>
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100" inlineAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Avg Week 1 Retention
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {cohorts.length > 0
                          ? `${(cohorts.reduce((sum, c) => sum + c.week1, 0) / cohorts.filter((c) => c.totalVisitors > 0).length || 0).toFixed(0)}%`
                          : 'N/A'}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100" inlineAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Avg Week 2 Retention
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {cohorts.length > 0
                          ? `${(cohorts.reduce((sum, c) => sum + c.week2, 0) / cohorts.filter((c) => c.totalVisitors > 0).length || 0).toFixed(0)}%`
                          : 'N/A'}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100" inlineAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Best Performing Week
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {cohorts.reduce((best, c) => (c.week1 > best.week1 ? c : best), cohorts[0])
                          ?.weekStart || 'N/A'}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100" inlineAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Total Tracked Visitors
                      </Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {cohorts.reduce((sum, c) => sum + c.totalVisitors, 0).toLocaleString()}
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}


        <Layout.Section>
          <Banner title="Improving Retention" tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                💡 <strong>Week 1 drop-off:</strong> Improve first-visit experience and upload
                success
              </Text>
              <Text as="p" variant="bodySm">
                💡 <strong>Week 2+ drop-off:</strong> Send follow-up emails or retargeting ads
              </Text>
              <Text as="p" variant="bodySm">
                💡 <strong>High retention weeks:</strong> Analyze what campaigns drove traffic that
                week
              </Text>
            </BlockStack>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  )
}
