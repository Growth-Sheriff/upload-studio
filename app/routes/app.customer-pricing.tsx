import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { Prisma } from '@prisma/client'
import { json } from '@remix-run/node'
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from '@shopify/polaris'
import { useEffect, useState } from 'react'
import prisma from '~/lib/prisma.server'
import type {
  CustomerPricingAssignment,
  CustomerPricingProductRule,
  CustomerPricingSettings,
  CustomerPricingStatus,
  ProductRuleCatalogItem,
} from '~/lib/customerPricing.server'
import { authenticate } from '~/shopify.server'

const CUSTOMER_SEARCH_QUERY = `#graphql
  query CustomerPricingSearch($query: String!) {
    customers(first: 25, query: $query) {
      edges {
        node {
          id
          legacyResourceId
          displayName
          email
        }
      }
    }
  }
`

const PRODUCT_TITLES_QUERY = `#graphql
  query CustomerPricingProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
      }
    }
  }
`

interface SearchCustomer {
  id: string
  displayName: string
  email: string | null
}

interface ProductRuleEditor {
  id: string
  productId: string
  productLabel: string
  active: boolean
  pricingMode: 'standard_variant' | 'variant_length' | 'measured_length'
  pricePerInch: string
}

interface StatusEditor {
  id: string
  key: string
  label: string
  type: 'standard' | 'business' | 'vip'
  active: boolean
  pricePerInch: string
  productRules: ProductRuleEditor[]
}

type CustomerPricingActionData = {
  success: boolean
  message?: string
  error?: string
}

function buildShopSettingsUpdate(
  existingSettings: Record<string, unknown>,
  nextPricingPayload: Record<string, unknown>
) {
  return {
    ...existingSettings,
    customerPricing: nextPricingPayload as unknown as Prisma.InputJsonValue,
  } as Prisma.InputJsonObject
}

function customerIdFromGraphql(node: { legacyResourceId?: string | number | null; id: string }): string {
  if (node.legacyResourceId != null && node.legacyResourceId !== '') {
    return String(node.legacyResourceId)
  }
  const parts = String(node.id || '').split('/')
  return parts[parts.length - 1] || String(node.id || '')
}

function parseLocalizedPositiveNumber(value: unknown, fallback = 0): number {
  const normalized = String(value ?? '')
    .trim()
    .replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function formatEditableRate(value: number | null | undefined): string {
  if (!Number.isFinite(value) || Number(value) <= 0) return ''
  return Number(value).toFixed(4).replace(/\.?0+$/, '')
}

function formatRate(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value == null) return 'Not set'
  const normalized = Number(value)
  const formatted = normalized.toFixed(normalized % 0.01 === 0 ? 2 : 4).replace(/\.?0+$/, '')
  return `$${formatted} / in`
}

function normalizeProductIdLocal(value: string | number | null | undefined): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  return raw.startsWith('gid://') ? raw : `gid://shopify/Product/${raw}`
}

function buildCustomerSearchQueries(search: string): string[] {
  if (!search) return []
  if (search.includes(':')) return [search]
  if (search.includes('@')) return [`email:${search}`, search]
  return [search]
}

function toStatusEditor(status: CustomerPricingStatus, productCatalog: ProductRuleCatalogItem[]): StatusEditor {
  const existingRuleMap = status.productRules.reduce<Record<string, CustomerPricingProductRule>>((acc, rule) => {
    acc[normalizeProductIdLocal(rule.productId) || rule.productId] = rule
    return acc
  }, {})

  return {
    id: status.id,
    key: status.key,
    label: status.label,
    type: status.type,
    active: status.active,
    pricePerInch: formatEditableRate(status.pricePerInch),
    productRules: productCatalog.map((product) => {
      const existingRule = existingRuleMap[product.productId]
      return {
        id: existingRule?.id || `${status.key}_${product.productId.split('/').pop()}`,
        productId: product.productId,
        productLabel: existingRule?.productLabel || product.label,
        active: existingRule?.active ?? false,
        pricingMode:
          existingRule?.pricingMode ||
          (status.type === 'business' ? 'variant_length' : status.type === 'vip' ? 'measured_length' : 'standard_variant'),
        pricePerInch: formatEditableRate(existingRule?.pricePerInch ?? status.pricePerInch),
      }
    }),
  }
}

function serializeStatusesForSave(statuses: StatusEditor[]) {
  return statuses.map((status) => ({
    id: status.id,
    key: status.key,
    label: status.label,
    type: status.type,
    active: status.active,
    pricePerInch: parseLocalizedPositiveNumber(status.pricePerInch, 0),
    productRules: status.productRules.map((rule) => ({
      id: rule.id,
      productId: rule.productId,
      productLabel: rule.productLabel,
      active: rule.active,
      pricingMode: rule.pricingMode,
      pricePerInch: parseLocalizedPositiveNumber(rule.pricePerInch, 0),
    })),
  }))
}

async function loadProductCatalog(
  admin: Awaited<ReturnType<typeof authenticate.admin>>['admin'],
  config: CustomerPricingSettings,
  forceDtfCatalog: boolean
): Promise<ProductRuleCatalogItem[]> {
  if (forceDtfCatalog) {
    return getDtfPrintHouseProductCatalog()
  }

  const productIds = Array.from(
    new Set(
      config.statuses.flatMap((status) =>
        status.productRules
          .map((rule) => normalizeProductIdLocal(rule.productId))
          .filter((productId): productId is string => Boolean(productId) && productId !== '*')
      )
    )
  )

  if (!productIds.length) {
    return []
  }

  try {
    const response = await admin.graphql(PRODUCT_TITLES_QUERY, {
      variables: { ids: productIds },
    })
    const payload = await response.json()
    const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : []
    return nodes
      .filter((node: { id?: string; title?: string } | null) => Boolean(node?.id))
      .map((node: { id: string; title?: string | null }) => ({
        productId: node.id,
        label: String(node.title || node.id),
      }))
  } catch (error) {
    console.error('[Customer Pricing] Product title lookup failed:', error)
    return productIds.map((productId) => ({ productId, label: productId }))
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const {
    applyCustomerPricingDefaultsForShop,
    getDtfPrintHouseProductCatalog,
    isDtfPrintHouseShop,
  } = await import('~/lib/customerPricing.server')
  const { session, admin } = await authenticate.admin(request)
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { settings: true },
  })

  const isDtf = isDtfPrintHouseShop(session.shop)
  const config = applyCustomerPricingDefaultsForShop(session.shop, shop?.settings || {})
  const productCatalog = await loadProductCatalog(admin, config, isDtf)
  const url = new URL(request.url)
  const search = String(url.searchParams.get('q') || '').trim()
  let searchResults: SearchCustomer[] = []

  if (search) {
    const attemptedQueries = Array.from(new Set(buildCustomerSearchQueries(search)))
    for (const customerQuery of attemptedQueries) {
      try {
        const response = await admin.graphql(CUSTOMER_SEARCH_QUERY, {
          variables: { query: customerQuery },
        })
        const payload = await response.json()
        const edges = payload?.data?.customers?.edges || []
        const nextResults = edges.map(
          (edge: {
            node: {
              id: string
              legacyResourceId?: string | number | null
              displayName?: string
              email?: string | null
            }
          }) => ({
            id: customerIdFromGraphql(edge.node),
            displayName: edge.node.displayName || edge.node.email || customerIdFromGraphql(edge.node),
            email: edge.node.email || null,
          })
        )
        if (nextResults.length) {
          searchResults = nextResults
          break
        }
      } catch (error) {
        console.error('[Customer Pricing] Customer search failed:', error)
      }
    }
  }

  return json({ isDtf, config, productCatalog, search, searchResults })
}

export async function action({ request }: ActionFunctionArgs) {
  const {
    applyCustomerPricingDefaultsForShop,
    buildCustomerPricingSettingsPayload,
    normalizeCustomerId,
    normalizeCustomerPricingSettings,
  } = await import('~/lib/customerPricing.server')
  const { session } = await authenticate.admin(request)
  const formData = await request.formData()
  const intent = String(formData.get('intent') || '')

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { settings: true },
  })

  if (!shop) {
    return json({ success: false, error: 'Shop not found' }, { status: 404 })
  }

  const existingSettings = (shop.settings as Record<string, unknown> | null) || {}
  const existingConfig = applyCustomerPricingDefaultsForShop(session.shop, existingSettings)

  if (intent === 'save-config') {
    let parsedStatuses: unknown[] = []
    try {
      parsedStatuses = JSON.parse(String(formData.get('statusesJson') || '[]'))
    } catch {
      return json({ success: false, error: 'Invalid status payload' }, { status: 400 })
    }

    const nextConfig = normalizeCustomerPricingSettings({
      customerPricing: {
        version: 2,
        enabled: formData.get('enabled') === 'true',
        businessPricePerInch: existingConfig.businessPricePerInch,
        statuses: parsedStatuses,
        assignments: existingConfig.assignments,
      },
    })

    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: {
        settings: buildShopSettingsUpdate(
          existingSettings,
          buildCustomerPricingSettingsPayload(nextConfig)
        ),
      },
    })

    return json({ success: true, message: 'Customer pricing rules saved.' })
  }

  if (intent === 'save-assignment') {
    const customerId = normalizeCustomerId(String(formData.get('customerId') || '').trim())
    const customerEmail = String(formData.get('customerEmail') || '').trim() || null
    const customerName = String(formData.get('customerName') || '').trim() || null
    const statusKey = String(formData.get('statusKey') || '').trim()
    let productOverrides: Array<{ productId: string; pricePerInch: number }> = []

    try {
      const parsedOverrides = JSON.parse(String(formData.get('productOverridesJson') || '[]'))
      if (Array.isArray(parsedOverrides)) {
        productOverrides = parsedOverrides
          .map((entry) => {
            const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
            const productId = normalizeProductIdLocal(value.productId)
            const pricePerInch = parseLocalizedPositiveNumber(value.pricePerInch, 0)
            if (!productId || !(pricePerInch > 0)) return null
            return { productId, pricePerInch }
          })
          .filter((entry): entry is { productId: string; pricePerInch: number } => Boolean(entry))
      }
    } catch {
      return json({ success: false, error: 'Invalid override payload' }, { status: 400 })
    }

    if (!customerId || !statusKey) {
      return json({ success: false, error: 'Customer and status are required.' }, { status: 400 })
    }

    const nextAssignments = existingConfig.assignments
      .filter((assignment) => assignment.customerId !== customerId)
      .concat({
        customerId,
        customerEmail,
        customerName,
        statusKey,
        active: true,
        pricePerInchOverride: productOverrides[0]?.pricePerInch || null,
        productOverrides,
      })

    const nextConfig = normalizeCustomerPricingSettings({
      customerPricing: {
        version: 2,
        enabled: existingConfig.enabled,
        businessPricePerInch: existingConfig.businessPricePerInch,
        statuses: existingConfig.statuses,
        assignments: nextAssignments,
      },
    })

    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: {
        settings: buildShopSettingsUpdate(
          existingSettings,
          buildCustomerPricingSettingsPayload(nextConfig)
        ),
      },
    })

    return json({ success: true, message: 'Customer assignment saved.' })
  }

  if (intent === 'delete-assignment') {
    const customerId = normalizeCustomerId(String(formData.get('customerId') || '').trim())
    if (!customerId) {
      return json({ success: false, error: 'Missing customer ID.' }, { status: 400 })
    }

    const nextConfig = normalizeCustomerPricingSettings({
      customerPricing: {
        version: 2,
        enabled: existingConfig.enabled,
        businessPricePerInch: existingConfig.businessPricePerInch,
        statuses: existingConfig.statuses,
        assignments: existingConfig.assignments.filter((assignment) => assignment.customerId !== customerId),
      },
    })

    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: {
        settings: buildShopSettingsUpdate(
          existingSettings,
          buildCustomerPricingSettingsPayload(nextConfig)
        ),
      },
    })

    return json({ success: true, message: 'Customer assignment removed.' })
  }

  return json({ success: false, error: 'Unsupported action' }, { status: 400 })
}

export default function CustomerPricingPage() {
  const { isDtf, config, productCatalog, search, searchResults } = useLoaderData<typeof loader>()
  const actionData = useActionData<CustomerPricingActionData>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'
  const [enabled, setEnabled] = useState(config.enabled)
  const [assignmentFilter, setAssignmentFilter] = useState('')
  const [searchInput, setSearchInput] = useState(search)
  const [statuses, setStatuses] = useState<StatusEditor[]>(
    config.statuses.map((status) => toStatusEditor(status, productCatalog))
  )

  useEffect(() => {
    setEnabled(config.enabled)
    setSearchInput(search)
    setStatuses(config.statuses.map((status) => toStatusEditor(status, productCatalog)))
  }, [config, productCatalog, search])

  const actionMessage = actionData?.message || null
  const actionError = actionData?.error || null
  const statusMap = statuses.reduce<Record<string, StatusEditor>>((acc, status) => {
    acc[status.key] = status
    return acc
  }, {})
  const assignableStatuses = statuses.filter((status) => status.type !== 'standard' && status.active)
  const assignments = config.assignments
  const assignmentLookup = assignments.reduce<Record<string, CustomerPricingAssignment>>((acc, assignment) => {
    acc[assignment.customerId] = assignment
    return acc
  }, {})

  const filteredAssignments = assignments.filter((assignment) => {
    const needle = assignmentFilter.trim().toLowerCase()
    if (!needle) return true
    const status = statusMap[assignment.statusKey]
    return [
      assignment.customerName || '',
      assignment.customerEmail || '',
      assignment.customerId,
      status?.label || assignment.statusKey,
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  function updateStatusLabel(statusKey: string, label: string) {
    setStatuses((current) =>
      current.map((status) => (status.key === statusKey ? { ...status, label } : status))
    )
  }

  function updateStatusRule(
    statusKey: string,
    productId: string,
    field: keyof ProductRuleEditor,
    value: string | boolean
  ) {
    setStatuses((current) =>
      current.map((status) => {
        if (status.key !== statusKey) return status
        return {
          ...status,
          productRules: status.productRules.map((rule) =>
            rule.productId === productId ? { ...rule, [field]: value } : rule
          ),
        }
      })
    )
  }

  return (
    <Page title="Customer Pricing" backAction={{ content: 'Settings', url: '/app/settings' }}>
      <Layout>
        <Layout.Section>
          {actionMessage ? <Banner tone="success">{actionMessage}</Banner> : null}
          {actionError ? <Banner tone="critical">{actionError}</Banner> : null}
          {isDtf ? (
            <Banner tone="info">
              DTF Print House uses the simplified model: Standard customers use normal variant prices,
              Business customers use per-inch pricing on upload DTF/UV products, and VIP customers use
              measured pricing on the DTF upload product.
            </Banner>
          ) : null}
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            <Card>
              <BlockStack gap="150">
                <Text as="h2" variant="headingMd">Standard Customer</Text>
                <Badge tone="info">Fallback</Badge>
                <Text as="p" variant="bodyMd" tone="subdued">
                  No assignment needed. Standard customers always see and pay the normal Shopify variant price.
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="h2" variant="headingMd">Business</Text>
                <Badge tone="success">{assignments.filter((item) => item.statusKey === 'business').length} assigned</Badge>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Business customers keep upload sheet fitting, but checkout uses your per-inch rate on the selected sheet length.
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="h2" variant="headingMd">VIP</Text>
                <Badge tone="attention">{assignments.filter((item) => item.statusKey === 'vip').length} assigned</Badge>
                <Text as="p" variant="bodyMd" tone="subdued">
                  VIP customers skip variant pricing and pay from the exact measured uploaded page length.
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="save-config" />
              <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
              <input
                type="hidden"
                name="statusesJson"
                value={JSON.stringify(serializeStatusesForSave(statuses))}
              />

              <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Status Rules</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Turn each product rule on or off and set the exact per-inch rate that applies to
                      that customer status.
                    </Text>
                  </BlockStack>
                  <Button submit variant="primary" loading={isSubmitting}>Save Rules</Button>
                </InlineStack>

                <Checkbox
                  label="Enable customer-specific pricing"
                  checked={enabled}
                  onChange={setEnabled}
                />

                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  {statuses
                    .filter((status) => status.type !== 'standard')
                    .map((status) => (
                      <Card key={status.key} background="bg-surface-secondary">
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="050">
                              <Text as="h3" variant="headingSm">
                                {status.type === 'business' ? 'Business status' : 'VIP status'}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {status.type === 'business'
                                  ? 'Charges from the resolved upload sheet length.'
                                  : 'Charges from the exact measured uploaded page length.'}
                              </Text>
                            </BlockStack>
                            <Badge tone={status.type === 'business' ? 'success' : 'attention'}>
                              {status.type.toUpperCase()}
                            </Badge>
                          </InlineStack>

                          <TextField
                            label="Storefront label"
                            autoComplete="off"
                            value={status.label}
                            onChange={(value) => updateStatusLabel(status.key, value)}
                          />

                          <BlockStack gap="300">
                            {status.productRules.map((rule) => (
                              <Box
                                key={`${status.key}_${rule.productId}`}
                                padding="300"
                                borderWidth="025"
                                borderColor="border"
                                borderRadius="200"
                              >
                                <BlockStack gap="250">
                                  <InlineStack align="space-between" blockAlign="center">
                                    <Text as="p" variant="bodyMd" fontWeight="medium">
                                      {rule.productLabel}
                                    </Text>
                                    <Badge tone={rule.active ? 'success' : undefined}>
                                      {rule.active ? 'Enabled' : 'Disabled'}
                                    </Badge>
                                  </InlineStack>

                                  <Checkbox
                                    label="Rule is active"
                                    checked={rule.active}
                                    onChange={(value) => updateStatusRule(status.key, rule.productId, 'active', value)}
                                  />

                                  <TextField
                                    label="Price per inch"
                                    autoComplete="off"
                                    type="text"
                                    inputMode="decimal"
                                    prefix="$"
                                    value={rule.pricePerInch}
                                    onChange={(value) => updateStatusRule(status.key, rule.productId, 'pricePerInch', value)}
                                  />

                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {rule.pricingMode === 'variant_length'
                                      ? 'Checkout total = selected sheet length x sheets needed x this rate.'
                                      : 'Checkout total = measured uploaded page length x this rate.'}
                                  </Text>
                                </BlockStack>
                              </Box>
                            ))}
                          </BlockStack>
                        </BlockStack>
                      </Card>
                    ))}
                </InlineGrid>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Search Customers</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Search by email or name, then assign Business or VIP without leaving this page.
                  </Text>
                </BlockStack>
              </InlineStack>

              <Form method="get">
                <InlineStack gap="300" align="start">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Search by email or name"
                      autoComplete="off"
                      name="q"
                      value={searchInput}
                      placeholder="houseofddm@hotmail.com"
                      onChange={setSearchInput}
                    />
                  </div>
                  <Button submit>Search</Button>
                </InlineStack>
              </Form>

              {searchResults.length ? (
                <BlockStack gap="300">
                  {searchResults.map((customer) => {
                    const currentAssignment = assignmentLookup[customer.id]
                    const currentStatus = currentAssignment ? statusMap[currentAssignment.statusKey] : null

                    return (
                      <Card key={customer.id} background="bg-surface-secondary">
                        <AssignmentForm
                          customer={customer}
                          currentAssignment={currentAssignment || null}
                          currentStatusLabel={currentStatus?.label || 'Standard'}
                          assignableStatuses={assignableStatuses}
                          productCatalog={productCatalog}
                          isSubmitting={isSubmitting}
                        />
                      </Card>
                    )
                  })}
                </BlockStack>
              ) : search ? (
                <Banner tone="info">No customers found for "{search}".</Banner>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Existing Assignments</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Review which customers are currently using Business or VIP pricing and remove them when needed.
                  </Text>
                </BlockStack>
              </InlineStack>

              <TextField
                label="Filter assignments"
                autoComplete="off"
                value={assignmentFilter}
                onChange={setAssignmentFilter}
                placeholder="Search by name, email, or status"
              />

              {filteredAssignments.length ? (
                <BlockStack gap="300">
                  {filteredAssignments.map((assignment) => {
                    const status = statusMap[assignment.statusKey]
                    return (
                      <Card key={assignment.customerId} background="bg-surface-secondary">
                        <InlineGrid columns={{ xs: 1, md: '2fr 1fr auto' }} gap="300">
                          <BlockStack gap="050">
                            <Text as="p" variant="bodyMd" fontWeight="medium">
                              {assignment.customerName || assignment.customerEmail || assignment.customerId}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {assignment.customerEmail || 'No email'} | Customer ID {assignment.customerId}
                            </Text>
                          </BlockStack>

                          <BlockStack gap="100">
                            <Badge tone={status?.type === 'vip' ? 'attention' : 'success'}>
                              {status?.label || assignment.statusKey}
                            </Badge>
                            {assignment.productOverrides.length ? (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {assignment.productOverrides
                                  .map((override) => {
                                    const product = productCatalog.find(
                                      (item) => item.productId === normalizeProductIdLocal(override.productId)
                                    )
                                    return `${product?.label || override.productId}: ${formatRate(override.pricePerInch)}`
                                  })
                                  .join(' | ')}
                              </Text>
                            ) : (
                              <Text as="p" variant="bodySm" tone="subdued">
                                Using the default rates from the assigned status.
                              </Text>
                            )}
                          </BlockStack>

                          <Form method="post">
                            <input type="hidden" name="intent" value="delete-assignment" />
                            <input type="hidden" name="customerId" value={assignment.customerId} />
                            <Button submit tone="critical" loading={isSubmitting}>Remove</Button>
                          </Form>
                        </InlineGrid>
                      </Card>
                    )
                  })}
                </BlockStack>
              ) : (
                <Banner tone="info">No customer assignments yet.</Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  )
}

function AssignmentForm({
  customer,
  currentAssignment,
  currentStatusLabel,
  assignableStatuses,
  productCatalog,
  isSubmitting,
}: {
  customer: SearchCustomer
  currentAssignment: CustomerPricingAssignment | null
  currentStatusLabel: string
  assignableStatuses: StatusEditor[]
  productCatalog: ProductRuleCatalogItem[]
  isSubmitting: boolean
}) {
  const [selectedStatusKey, setSelectedStatusKey] = useState(
    currentAssignment?.statusKey || assignableStatuses[0]?.key || 'business'
  )
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>(() =>
    productCatalog.reduce<Record<string, string>>((acc, product) => {
      const currentOverride = currentAssignment?.productOverrides.find(
        (override) => normalizeProductIdLocal(override.productId) === product.productId
      )
      acc[product.productId] = formatEditableRate(currentOverride?.pricePerInch)
      return acc
    }, {})
  )

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save-assignment" />
      <input type="hidden" name="customerId" value={customer.id} />
      <input type="hidden" name="customerEmail" value={customer.email || ''} />
      <input type="hidden" name="customerName" value={customer.displayName} />
      <input
        type="hidden"
        name="productOverridesJson"
        value={JSON.stringify(
          productCatalog.map((product) => ({
            productId: product.productId,
            pricePerInch: overrideValues[product.productId] || '',
          }))
        )}
      />

      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">{customer.displayName}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {customer.email || 'No email'} | Customer ID {customer.id}
            </Text>
          </BlockStack>
          <Badge tone={currentAssignment?.statusKey === 'vip' ? 'attention' : currentAssignment ? 'success' : 'info'}>
            {currentStatusLabel}
          </Badge>
        </InlineStack>

        <Select
          label="Assigned status"
          name="statusKey"
          options={assignableStatuses.map((status) => ({
            label: status.label,
            value: status.key,
          }))}
          value={selectedStatusKey}
          onChange={setSelectedStatusKey}
        />

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
          {productCatalog.map((product) => (
            <TextField
              key={`${customer.id}_${product.productId}`}
              label={`${product.label} override`}
              autoComplete="off"
              type="text"
              inputMode="decimal"
              placeholder="Use status default"
              value={overrideValues[product.productId] || ''}
              onChange={(value) =>
                setOverrideValues((current) => ({
                  ...current,
                  [product.productId]: value,
                }))
              }
            />
          ))}
        </InlineGrid>

        <Text as="p" variant="bodySm" tone="subdued">
          Leave overrides blank to use the default rate from the selected status.
        </Text>

        <InlineStack align="end">
          <Button submit variant="primary" loading={isSubmitting}>Save Assignment</Button>
        </InlineStack>
      </BlockStack>
    </Form>
  )
}
