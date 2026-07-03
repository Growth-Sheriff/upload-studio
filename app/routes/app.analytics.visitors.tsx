




import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Badge,
  DataTable,
  ProgressBar,
  Icon,
  Divider,
  InlineGrid,
  Tooltip,
  Select,
  TextField,
  Button,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import {
  PersonIcon,
  GlobeIcon,
  MobileIcon,
  DesktopIcon,
  RefreshIcon,
  ChartVerticalIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "~/shopify.server";
import {
  getShopIdFromDomain,
  getVisitorStats,
  getVisitorsByCountry,
  getVisitorsByDevice,
  getVisitorsByBrowser,
  getDailyVisitors,
  getTopVisitors,
  getVisitorsByOS,
  getVisitorsByScreenResolution,
  getVisitorsByTimezone,
  getVisitorsByLanguage,
  getCustomerMetrics,
  type VisitorStats,
  type VisitorGeo,
  type VisitorDevice,
  type VisitorBrowser,
  type DailyVisitors,
  type TopVisitor,
  type VisitorOS,
  type ScreenResolution,
  type VisitorTimezone,
  type VisitorLanguage,
  type CustomerMetrics,
} from "~/lib/analytics.server";

interface LoaderData {
  stats: VisitorStats;
  customerMetrics: CustomerMetrics;
  geoData: VisitorGeo[];
  deviceData: VisitorDevice[];
  browserData: VisitorBrowser[];
  osData: VisitorOS[];
  screenData: ScreenResolution[];
  timezoneData: VisitorTimezone[];
  languageData: VisitorLanguage[];
  dailyData: DailyVisitors[];
  topVisitors: TopVisitor[];
  period: string;
  dateRangeText: string;
  error?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = await getShopIdFromDomain(session.shop);

  if (!shopId) {
    return json<LoaderData>({
      stats: {
        totalVisitors: 0,
        newVisitors: 0,
        returningVisitors: 0,
        totalSessions: 0,
        avgSessionsPerVisitor: 0,
        visitorsWithUploads: 0,
        visitorsWithOrders: 0,
        uploadConversionRate: 0,
        orderConversionRate: 0,
      },
      customerMetrics: {
        uniqueCustomers: 0,
        repeatCustomers: 0,
        newCustomers: 0,
        avgUploadsPerCustomer: 0,
        avgOrdersPerCustomer: 0,
        avgRevenuePerCustomer: 0,
        topCustomerRevenue: 0,
      },
      geoData: [],
      deviceData: [],
      browserData: [],
      osData: [],
      screenData: [],
      timezoneData: [],
      languageData: [],
      dailyData: [],
      topVisitors: [],
      period: "30d",
      dateRangeText: "",
      error: "Shop not found",
    });
  }


  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30d";
  const customStart = url.searchParams.get("startDate");
  const customEnd = url.searchParams.get("endDate");


  let endDate = new Date();
  let startDate: Date;

  if (period === "custom" && customStart && customEnd) {
    startDate = new Date(customStart);
    endDate = new Date(customEnd);
    endDate.setHours(23, 59, 59, 999);
  } else {
    switch (period) {
      case "7d":
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "all":
        startDate = new Date(0);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  const dateRangeText = period === "all"
    ? "All time"
    : `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} - ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  try {
    const [stats, geoData, deviceData, browserData, osData, screenData, timezoneData, languageData, dailyData, topVisitors, customerMetrics] = await Promise.all([
      getVisitorStats(shopId, startDate, endDate),
      getVisitorsByCountry(shopId),
      getVisitorsByDevice(shopId),
      getVisitorsByBrowser(shopId),
      getVisitorsByOS(shopId),
      getVisitorsByScreenResolution(shopId),
      getVisitorsByTimezone(shopId),
      getVisitorsByLanguage(shopId),
      getDailyVisitors(shopId, startDate, endDate),
      getTopVisitors(shopId, 15),
      getCustomerMetrics(shopId, startDate, endDate),
    ]);

    return json<LoaderData>({
      stats,
      customerMetrics,
      geoData,
      deviceData,
      browserData,
      osData,
      screenData,
      timezoneData,
      languageData,
      dailyData,
      topVisitors,
      period,
      dateRangeText,
    });
  } catch (error) {
    console.error("Visitors analytics error:", error);
    return json<LoaderData>({
      stats: {
        totalVisitors: 0,
        newVisitors: 0,
        returningVisitors: 0,
        totalSessions: 0,
        avgSessionsPerVisitor: 0,
        visitorsWithUploads: 0,
        visitorsWithOrders: 0,
        uploadConversionRate: 0,
        orderConversionRate: 0,
      },
      customerMetrics: {
        uniqueCustomers: 0,
        repeatCustomers: 0,
        newCustomers: 0,
        avgUploadsPerCustomer: 0,
        avgOrdersPerCustomer: 0,
        avgRevenuePerCustomer: 0,
        topCustomerRevenue: 0,
      },
      geoData: [],
      deviceData: [],
      browserData: [],
      osData: [],
      screenData: [],
      timezoneData: [],
      languageData: [],
      dailyData: [],
      topVisitors: [],
      period: "30d",
      dateRangeText: "",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendUp,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <Text as="p" variant="bodyMd" tone="subdued">
            {title}
          </Text>
          {icon && <Box>{icon}</Box>}
        </InlineStack>
        <InlineStack gap="200" blockAlign="end">
          <Text as="p" variant="headingXl" fontWeight="bold">
            {typeof value === "number" ? value.toLocaleString() : value}
          </Text>
          {trend && (
            <Badge tone={trendUp ? "success" : trendUp === false ? "critical" : undefined}>
              {`${trendUp !== undefined ? (trendUp ? "↑ " : "↓ ") : ""}${trend}`}
            </Badge>
          )}
        </InlineStack>
        {subtitle && (
          <Text as="p" variant="bodySm" tone="subdued">
            {subtitle}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function ProgressCard({
  title,
  items,
  colorScheme = "default",
}: {
  title: string;
  items: { label: string; value: number; percentage: number }[];
  colorScheme?: "default" | "success" | "info";
}) {
  const toneMap: Record<string, "highlight" | "success"> = {
    default: "highlight",
    success: "success",
    info: "highlight",
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingSm">
          {title}
        </Text>
        <BlockStack gap="300">
          {items.map((item, index) => (
            <BlockStack gap="200" key={index}>
              <InlineStack align="space-between">
                <Text as="span" variant="bodyMd">
                  {item.label}
                </Text>
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {item.value.toLocaleString()} ({item.percentage.toFixed(1)}%)
                </Text>
              </InlineStack>
              <ProgressBar progress={item.percentage} size="small" tone={toneMap[colorScheme]} />
            </BlockStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

export default function AnalyticsVisitors() {
  const { stats, customerMetrics, geoData, deviceData, browserData, osData, screenData, timezoneData, languageData, dailyData, topVisitors, period, dateRangeText, error } =
    useLoaderData<typeof loader>();
  const [selectedPeriod, setSelectedPeriod] = useState(period);
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(period === "custom");
  const navigate = useNavigate();

  const handlePeriodChange = useCallback((value: string) => {
    setSelectedPeriod(value);
    if (value === "custom") {
      setShowCustomDatePicker(true);
    } else {
      setShowCustomDatePicker(false);
      navigate(`/app/analytics/visitors?period=${value}`);
    }
  }, [navigate]);

  const handleApplyCustomDate = useCallback(() => {
    if (customStartDate && customEndDate) {
      navigate(`/app/analytics/visitors?period=custom&startDate=${customStartDate}&endDate=${customEndDate}`);
    }
  }, [navigate, customStartDate, customEndDate]);

  if (error) {
    return (
      <Page
        title="Visitor Analytics"
        backAction={{ url: "/app/analytics" }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Text as="p" variant="bodyLg" tone="critical">
                  Error loading analytics: {error}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }


  const visitorRows = topVisitors.map((v) => [
    v.id.slice(0, 8) + "...",
    v.email || "-",
    v.country || "Unknown",
    v.deviceType || "Unknown",
    v.totalSessions.toString(),
    v.totalUploads.toString(),
    v.totalOrders.toString(),
    new Date(v.lastSeenAt).toLocaleDateString(),
  ]);

  return (
    <Page
      title="Visitor Analytics"
      subtitle="Comprehensive visitor insights and behavior patterns"
      backAction={{ url: "/app/analytics" }}
    >
      <Layout>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">👥 Visitor Analytics</Text>
                  <Text as="p" variant="bodySm" tone="subdued">📅 {dateRangeText}</Text>
                </BlockStack>
                <Select
                  label=""
                  labelHidden
                  options={[
                    { label: "Last 7 days", value: "7d" },
                    { label: "Last 30 days", value: "30d" },
                    { label: "Last 90 days", value: "90d" },
                    { label: "All time", value: "all" },
                    { label: "Custom range", value: "custom" },
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
                  <div style={{ paddingTop: "24px" }}>
                    <Button variant="primary" onClick={handleApplyCustomDate} disabled={!customStartDate || !customEndDate}>
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
            <MetricCard
              title="Total Visitors"
              value={stats.totalVisitors}
              subtitle="All time unique visitors"
              icon={<Icon source={PersonIcon} tone="base" />}
            />
            <MetricCard
              title="New Visitors"
              value={stats.newVisitors}
              subtitle="Last 30 days"
              icon={<Icon source={PersonIcon} tone="success" />}
              trend={stats.totalVisitors > 0 ? `${((stats.newVisitors / stats.totalVisitors) * 100).toFixed(0)}% of total` : undefined}
            />
            <MetricCard
              title="Returning Visitors"
              value={stats.returningVisitors}
              subtitle="Multiple sessions"
              icon={<Icon source={RefreshIcon} tone="info" />}
            />
            <MetricCard
              title="Total Sessions"
              value={stats.totalSessions}
              subtitle={`Avg ${stats.avgSessionsPerVisitor.toFixed(1)} per visitor`}
              icon={<Icon source={ChartVerticalIcon} tone="base" />}
            />
          </InlineGrid>
        </Layout.Section>


        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <MetricCard
              title="Upload Conversion"
              value={`${stats.uploadConversionRate.toFixed(1)}%`}
              subtitle={`${stats.visitorsWithUploads} visitors uploaded`}
              trendUp={stats.uploadConversionRate > 10}
              trend={stats.uploadConversionRate > 10 ? "Good" : stats.uploadConversionRate > 5 ? "Average" : "Low"}
            />
            <MetricCard
              title="Order Conversion"
              value={`${stats.orderConversionRate.toFixed(1)}%`}
              subtitle={`${stats.visitorsWithOrders} visitors ordered`}
              trendUp={stats.orderConversionRate > 5}
              trend={stats.orderConversionRate > 5 ? "Good" : stats.orderConversionRate > 2 ? "Average" : "Low"}
            />
            <MetricCard
              title="With Uploads"
              value={stats.visitorsWithUploads}
              subtitle="Visitors who uploaded designs"
            />
            <MetricCard
              title="With Orders"
              value={stats.visitorsWithOrders}
              subtitle="Visitors who placed orders"
            />
          </InlineGrid>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    🆕 Customer Overview
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Customers who interacted with your customizer
                  </Text>
                </BlockStack>
                {customerMetrics.newCustomers > 0 && (
                  <Badge tone="success">
                    {`+${customerMetrics.newCustomers} new`}
                  </Badge>
                )}
              </InlineStack>
              <Divider />
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                <Box padding="300" background="bg-surface-success" borderRadius="300">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="span" variant="headingLg">🆕</Text>
                    <Text as="p" variant="bodySm" tone="subdued">New Customers</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {customerMetrics.newCustomers.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      First time in this period
                    </Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="300">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="span" variant="headingLg">🔄</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Repeat Customers</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {customerMetrics.repeatCustomers.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Multiple uploads
                    </Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="300">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="span" variant="headingLg">👥</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Unique Customers</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {customerMetrics.uniqueCustomers.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Total identified
                    </Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="300">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="span" variant="headingLg">💰</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Avg Revenue/Customer</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      ${customerMetrics.avgRevenuePerCustomer.toFixed(2)}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Top: ${customerMetrics.topCustomerRevenue.toFixed(2)}
                    </Text>
                  </BlockStack>
                </Box>
              </InlineGrid>
              {customerMetrics.uniqueCustomers > 0 && (
                <>
                  <Divider />
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    <Box padding="200">
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">Avg Uploads/Customer</Text>
                        <Text as="p" variant="headingMd" fontWeight="bold">
                          {customerMetrics.avgUploadsPerCustomer.toFixed(1)}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box padding="200">
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">Avg Orders/Customer</Text>
                        <Text as="p" variant="headingMd" fontWeight="bold">
                          {customerMetrics.avgOrdersPerCustomer.toFixed(1)}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box padding="200">
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">Repeat Rate</Text>
                        <Text as="p" variant="headingMd" fontWeight="bold">
                          {customerMetrics.uniqueCustomers > 0
                            ? `${((customerMetrics.repeatCustomers / customerMetrics.uniqueCustomers) * 100).toFixed(1)}%`
                            : '0%'}
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineGrid>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <ProgressCard
              title="📱 Device Distribution"
              items={deviceData.map((d) => ({
                label: d.type === "mobile" ? "📱 Mobile" : d.type === "desktop" ? "🖥️ Desktop" : d.type === "tablet" ? "📱 Tablet" : d.type,
                value: d.count,
                percentage: d.percentage,
              }))}
            />
            <ProgressCard
              title="🌐 Browser Usage"
              items={browserData.slice(0, 5).map((b) => ({
                label: b.name,
                value: b.count,
                percentage: b.percentage,
              }))}
              colorScheme="info"
            />
          </InlineGrid>
        </Layout.Section>


        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <ProgressCard
              title="💻 Operating System"
              items={osData.slice(0, 5).map((os) => ({
                label: os.os,
                value: os.count,
                percentage: os.percentage,
              }))}
              colorScheme="success"
            />
            <ProgressCard
              title="📐 Screen Resolution"
              items={screenData.slice(0, 5).map((s) => ({
                label: s.resolution,
                value: s.count,
                percentage: s.percentage,
              }))}
            />
          </InlineGrid>
        </Layout.Section>


        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm">🌐 Languages</Text>
                  <Badge>{`${languageData.length} languages`}</Badge>
                </InlineStack>
                <InlineStack gap="200" wrap>
                  {languageData.slice(0, 8).map((l, i) => (
                    <Badge key={i} tone={i === 0 ? "success" : undefined}>
                      {`${l.language}: ${l.count} (${l.percentage.toFixed(0)}%)`}
                    </Badge>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm">🕐 Top Timezones</Text>
                  <Badge>{`${timezoneData.length} timezones`}</Badge>
                </InlineStack>
                <BlockStack gap="200">
                  {timezoneData.slice(0, 5).map((tz, i) => (
                    <InlineStack key={i} align="space-between">
                      <Text as="span" variant="bodySm">{tz.timezone}</Text>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {tz.count} ({tz.percentage.toFixed(0)}%)
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingMd">
                  🌍 Geographic Distribution
                </Text>
                <Badge>{`${geoData.length} countries`}</Badge>
              </InlineStack>
              <Divider />
              <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
                {geoData.slice(0, 9).map((geo, i) => (
                  <Box
                    key={i}
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="headingSm">
                          {i + 1}.
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {geo.country}
                        </Text>
                      </InlineStack>
                      <BlockStack gap="100" inlineAlign="end">
                        <Text as="span" variant="bodySm" fontWeight="bold">
                          {geo.count.toLocaleString()}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {geo.percentage.toFixed(1)}%
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </Box>
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>


        {dailyData.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  📊 Daily Activity (Last 30 Days)
                </Text>
                <Divider />
                <Box padding="200">
                  <InlineStack gap="100" wrap={false}>
                    {dailyData.slice(-14).map((day, i) => {
                      const maxVisitors = Math.max(...dailyData.map((d) => d.visitors), 1);
                      const height = Math.max(8, (day.visitors / maxVisitors) * 80);
                      return (
                        <Tooltip
                          key={i}
                          content={`${day.date}: ${day.visitors} visitors, ${day.sessions} sessions`}
                        >
                          <div
                            style={{
                              minWidth: "24px",
                              height: `${height}px`,
                              backgroundColor: "#5C6AC4",
                              borderRadius: "4px",
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      {dailyData[dailyData.length - 14]?.date || "Start"}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {dailyData[dailyData.length - 1]?.date || "End"}
                    </Text>
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
                <Text as="h3" variant="headingMd">
                  🏆 Top Visitors
                </Text>
                <Badge tone="info">{`${topVisitors.length} visitors`}</Badge>
              </InlineStack>
              {visitorRows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "numeric", "numeric", "numeric", "text"]}
                  headings={["ID", "Email", "Country", "Device", "Sessions", "Uploads", "Orders", "Last Seen"]}
                  rows={visitorRows}
                  footerContent={`Showing top ${topVisitors.length} visitors by activity`}
                />
              ) : (
                <Box padding="400">
                  <Text as="p" tone="subdued" alignment="center">
                    No visitor data available yet
                  </Text>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
