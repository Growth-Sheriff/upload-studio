import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { Prisma } from '@prisma/client'
import { json } from '@remix-run/node'
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from '@shopify/polaris'
import { useState } from 'react'
import prisma from '~/lib/prisma.server'
import { normalizeCustomerPricingSettings } from '~/lib/customerPricing.server'
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

interface SearchCustomer {
  id: string
  displayName: string
  email: string | null
}

interface StatusFormState {
  id: string
  key: string
  label: string
  active: boolean
  pricePerInch: string
}

type CustomerPricingActionData = {
  success: boolean
  message?: string
  error?: string
}

function buildShopSettingsUpdate(
  existingSettings: Record<string, unknown>,
  nextConfig: ReturnType<typeof normalizeCustomerPricingSettings>
) {
  return {
    ...existingSettings,
    customerPricing: nextConfig as unknown as Prisma.InputJsonValue,
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
  if (!Number.isFinite(value) || value == null) return 'Rate not set'
  const normalized = Number(value)
  const formatted = normalized.toFixed(normalized % 0.01 === 0 ? 2 : 4).replace(/\.?0+$/, '')
  return `$${formatted} / in`
}

function buildCustomerSearchQueries(search: string): string[] {
  if (!search) return []
  if (search.includes(':')) return [search]
  if (search.includes('@')) return [`email:${search}`, search]
  return [search]
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request)

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: {
      settings: true,
    },
  })

  const config = normalizeCustomerPricingSettings(shop?.settings || {})
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

  return json({
    config,
    search,
    searchResults,
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const formData = await request.formData()
  const intent = String(formData.get('intent') || '')

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      settings: true,
    },
  })

  if (!shop) {
    return json({ success: false, error: 'Shop not found' }, { status: 404 })
  }

  const existingSettings = (shop.settings as Record<string, unknown> | null) || {}
  const existingConfig = normalizeCustomerPricingSettings(existingSettings)

  if (intent === 'save-config') {
    let parsedStatuses: unknown[] = []
    try {
      parsedStatuses = JSON.parse(String(formData.get('statusesJson') || '[]'))
    } catch {
      return json({ success: false, error: 'Invalid status payload' }, { status: 400 })
    }

    const businessPricePerInch = parseLocalizedPositiveNumber(
      formData.get('businessPricePerInch'),
      existingConfig.businessPricePerInch || 0.2
    )

    const nextConfig = normalizeCustomerPricingSettings({
      customerPricing: {
        enabled: formData.get('enabled') === 'true',
        businessPricePerInch,
        statuses: parsedStatuses.map((entry) => {
          const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
          return {
            ...value,
            pricePerInch: parseLocalizedPositiveNumber(value.pricePerInch, businessPricePerInch),
          }
        }),
        assignments: existingConfig.assignments,
      },
    })

    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: {
        settings: buildShopSettingsUpdate(existingSettings, nextConfig),
      },
    })

    return json({ success: true, message: 'Customer pricing settings saved.' })
  }

  if (intent === 'add-assignment') {
    const customerId = String(formData.get('customerId') || '').trim()
    const customerEmail = String(formData.get('customerEmail') || '').trim() || null
    const customerName = String(formData.get('customerName') || '').trim() || null
    const statusKey = String(formData.get('statusKey') || '').trim()
    const pricePerInchOverride = parseLocalizedPositiveNumber(formData.get('pricePerInchOverride'), -1)

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
        pricePerInchOverride: pricePerInchOverride > 0 ? pricePerInchOverride : null,
      })

    const nextConfig = normalizeCustomerPricingSettings({
      customerPricing: {
        enabled: existingConfig.enabled,
        businessPricePerInch: existingConfig.businessPricePerInch,
        statuses: existingConfig.statuses,
        assignments: nextAssignments,
      },
    })

    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: {
        settings: buildShopSettingsUpdate(existingSettings, nextConfig),
      },
    })

    return json({ success: true, message: 'Customer assignment saved.' })
  }

  if (intent === 'delete-assignment') {
    const customerId = String(formData.get('customerId') || '').trim()
    const nextConfig = normalizeCustomerPricingSettings({
      customerPricing: {
        enabled: existingConfig.enabled,
        businessPricePerInch: existingConfig.businessPricePerInch,
        statuses: existingConfig.statuses,
        assignments: existingConfig.assignments.filter((assignment) => assignment.customerId !== customerId),
      },
    })

    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: {
        settings: buildShopSettingsUpdate(existingSettings, nextConfig),
      },
    })

    return json({ success: true, message: 'Customer assignment removed.' })
  }

  return json({ success: false, error: 'Unsupported action' }, { status: 400 })
}

export default function CustomerPricingPage() {
  const { config, search, searchResults } = useLoaderData<typeof loader>()
  const actionData = useActionData<CustomerPricingActionData>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'
  const actionMessage = actionData?.message || null
  const actionError = actionData?.error || null
  const [enabled, setEnabled] = useState(config.enabled)
  const [businessPricePerInch, setBusinessPricePerInch] = useState(
    formatEditableRate(config.businessPricePerInch || 0.2) || '0.2'
  )
  const [assignmentFilter, setAssignmentFilter] = useState('')
  const [statuses, setStatuses] = useState<StatusFormState[]>(
    config.statuses.map((status) => ({
      id: status.id,
      key: status.key,
      label: status.label,
      active: status.active,
      pricePerInch: formatEditableRate(status.pricePerInch),
    }))
  )

  const savedStatusMap = config.statuses.reduce<Record<string, (typeof config.statuses)[number]>>((acc, status) => {
    acc[status.key] = status
    return acc
  }, {})
  const savedAssignableStatuses = config.statuses.filter((status) => status.active)
  const assignmentLookup = config.assignments.reduce<Record<string, (typeof config.assignments)[number]>>((acc, assignment) => {
    acc[assignment.customerId] = assignment
    return acc
  }, {})
  const normalizedBusinessRate = parseLocalizedPositiveNumber(
    businessPricePerInch,
    config.businessPricePerInch || 0.2
  )
  const sampleBusinessPrice = (60 * normalizedBusinessRate).toFixed(2)
  const activeStatusCount = statuses.filter((status) => status.active && status.label.trim()).length
  const filteredAssignments = config.assignments.filter((assignment) => {
    const searchValue = assignmentFilter.trim().toLowerCase()
    if (!searchValue) return true
    const status = savedStatusMap[assignment.statusKey]
    const haystack = [
      assignment.customerName || '',
      assignment.customerEmail || '',
      assignment.customerId,
      assignment.statusKey,
      status?.label || '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(searchValue)
  })

  function updateStatus(index: number, field: keyof StatusFormState, value: string | boolean) {
    setStatuses((current) =>
      current.map((status, currentIndex) =>
        currentIndex === index ? { ...status, [field]: value } : status
      )
    )
  }

  function addStatus() {
    setStatuses((current) =>
      current.concat({
        id: `status_${Date.now()}`,
        key: '',
        label: '',
        active: true,
        pricePerInch: '',
      })
    )
  }

  function removeStatus(index: number) {
    setStatuses((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }

  return (
    <Page title="Customer Pricing" backAction={{ content: 'Settings', url: '/app/settings' }}>
      <Layout>
        <Layout.Section>
          {actionMessage ? <Banner tone="success">{actionMessage}</Banner> : null}
          {actionError ? <Banner tone="critical">{actionError}</Banner> : null}
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Pricing overview
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Guests and standard customers stay on the normal sheet variants. VIP customers
                    skip the variant table and check out from the exact measured page length.
                  </Text>
                </BlockStack>
              </InlineStack>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '12px',
                }}
              >
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Pricing mode
                  </Text>
                  <Text as="p" variant="headingMd">
                    {enabled ? 'Customer pricing enabled' : 'Customer pricing disabled'}
                  </Text>
                </Box>

                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Standard fallback rate
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatRate(normalizedBusinessRate)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    60&quot; sample = ${sampleBusinessPrice}
                  </Text>
                </Box>

                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    VIP statuses
                  </Text>
                  <Text as="p" variant="headingMd">
                    {activeStatusCount} active
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {config.statuses.length} saved status profiles
                  </Text>
                </Box>

                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Assigned customers
                  </Text>
                  <Text as="p" variant="headingMd">
                    {config.assignments.length}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Customers currently using a saved VIP rule
                  </Text>
                </Box>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="save-config" />
              <input
                type="hidden"
                name="statusesJson"
                value={JSON.stringify(
                  statuses.map((status) => ({
                    id: status.id,
                    key: status.key,
                    label: status.label,
                    active: status.active,
                    pricePerInch: parseLocalizedPositiveNumber(status.pricePerInch, 0),
                  }))
                )}
              />
              <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />

              <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Pricing rules
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Keep the default fallback rate stable, then define named VIP statuses with
                      their own per-inch rate.
                    </Text>
                  </BlockStack>
                  <Button submit variant="primary" loading={isSubmitting}>
                    Save Pricing Rules
                  </Button>
                </InlineStack>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '16px',
                  }}
                >
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="300">
                      <Checkbox
                        label="Enable customer-specific pricing"
                        checked={enabled}
                        onChange={setEnabled}
                      />
                      <TextField
                        label="Standard fallback rate"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={businessPricePerInch}
                        onChange={setBusinessPricePerInch}
                        name="businessPricePerInch"
                        helpText="Internal fallback for VIP rules without a custom rate. Standard customers still pay the normal Shopify variant price."
                      />
                    </BlockStack>
                  </Box>

                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        How checkout works
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Standard customers pay the normal Shopify variant price. VIP customers log
                        in, upload a PNG, and the server charges their exact page length with their
                        assigned rate.
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Reference example: 60&quot; x {formatRate(normalizedBusinessRate)} = ${sampleBusinessPrice}
                      </Text>
                    </BlockStack>
                  </Box>
                </div>

                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">
                        VIP status catalog
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        These labels are what logged-in customers will see on the product page.
                      </Text>
                    </BlockStack>
                    <Button onClick={addStatus}>Add Status</Button>
                  </InlineStack>

                  {statuses.length ? (
                    <BlockStack gap="300">
                      {statuses.map((status, index) => (
                        <Box
                          key={status.id}
                          padding="300"
                          borderWidth="025"
                          borderColor="border"
                          borderRadius="200"
                        >
                          <BlockStack gap="300">
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                gap: '12px',
                              }}
                            >
                              <TextField
                                label="Status label"
                                autoComplete="off"
                                value={status.label}
                                onChange={(value) => updateStatus(index, 'label', value)}
                                placeholder="VIP Gold"
                              />
                              <TextField
                                label="Internal key"
                                autoComplete="off"
                                value={status.key}
                                onChange={(value) => updateStatus(index, 'key', value)}
                                placeholder="vip-gold"
                                helpText="Leave blank to auto-generate from the label."
                              />
                              <TextField
                                label="VIP price per inch"
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={status.pricePerInch}
                                onChange={(value) => updateStatus(index, 'pricePerInch', value)}
                                placeholder={formatEditableRate(normalizedBusinessRate) || '0.2'}
                                helpText="Used when no customer-level override is set."
                              />
                            </div>

                            <InlineStack align="space-between" blockAlign="center">
                              <Checkbox
                                label="Status is active"
                                checked={status.active}
                                onChange={(value) => updateStatus(index, 'active', value)}
                              />
                              <Button variant="plain" tone="critical" onClick={() => removeStatus(index)}>
                                Remove
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  ) : (
                    <Banner tone="info">
                      Add at least one VIP status before assigning customers.
                    </Banner>
                  )}
                </BlockStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Find and assign customers
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Search Shopify customers by email or name, then assign or update their VIP status in
                    one step.
                  </Text>
                </BlockStack>
              </InlineStack>

              <Form method="get">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(280px, 1fr) auto',
                    gap: '12px',
                    alignItems: 'end',
                  }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                      Search by customer email or name
                    </label>
                    <input
                      type="text"
                      name="q"
                      defaultValue={search}
                      placeholder="jane@example.com or Jane"
                      style={{
                        width: '100%',
                        minHeight: 40,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #c9cccf',
                      }}
                    />
                  </div>
                  <Button submit>Search Customers</Button>
                </div>
              </Form>

              {!savedAssignableStatuses.length ? (
                <Banner tone="warning">
                  Save at least one active VIP status before assigning customers.
                </Banner>
              ) : null}

              {searchResults.length ? (
                <BlockStack gap="300">
                  {searchResults.map((customer) => {
                    const currentAssignment = assignmentLookup[customer.id] || null
                    const currentStatus = currentAssignment ? savedStatusMap[currentAssignment.statusKey] : null
                    const currentRate =
                      currentAssignment?.pricePerInchOverride ??
                      currentStatus?.pricePerInch ??
                      config.businessPricePerInch

                    return (
                      <Box
                        key={customer.id}
                        padding="300"
                        borderWidth="025"
                        borderColor="border"
                        borderRadius="200"
                      >
                        <Form method="post">
                          <input type="hidden" name="intent" value="add-assignment" />
                          <input type="hidden" name="customerId" value={customer.id} />
                          <input type="hidden" name="customerEmail" value={customer.email || ''} />
                          <input type="hidden" name="customerName" value={customer.displayName} />

                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="start" wrap>
                              <BlockStack gap="050">
                                <Text as="p" variant="bodyMd">
                                  {customer.displayName}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {customer.email || 'No email on file'}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Customer ID: {customer.id}
                                </Text>
                              </BlockStack>

                              <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Current status
                                </Text>
                                <Text as="p" variant="bodyMd">
                                  {currentAssignment
                                    ? `${currentStatus?.label || currentAssignment.statusKey} (${formatRate(currentRate)})`
                                    : 'Standard customer (no assigned VIP status)'}
                                </Text>
                              </Box>
                            </InlineStack>

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, 1fr) auto',
                                gap: '12px',
                                alignItems: 'end',
                              }}
                            >
                              <div>
                                <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                                  VIP status
                                </label>
                                <select
                                  name="statusKey"
                                  defaultValue={currentAssignment?.statusKey || savedAssignableStatuses[0]?.key || ''}
                                  disabled={!savedAssignableStatuses.length}
                                  style={{
                                    width: '100%',
                                    minHeight: 40,
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    border: '1px solid #c9cccf',
                                    background: savedAssignableStatuses.length ? '#fff' : '#f3f4f6',
                                  }}
                                >
                                  {savedAssignableStatuses.map((status) => (
                                    <option key={status.key} value={status.key}>
                                      {status.label} ({formatRate(status.pricePerInch)})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                                  Customer override price per inch
                                </label>
                                <input
                                  type="text"
                                  name="pricePerInchOverride"
                                  inputMode="decimal"
                                  defaultValue={formatEditableRate(currentAssignment?.pricePerInchOverride)}
                                  placeholder="Optional"
                                  style={{
                                    width: '100%',
                                    minHeight: 40,
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    border: '1px solid #c9cccf',
                                  }}
                                />
                              </div>

                              <Button submit variant="primary" loading={isSubmitting} disabled={!savedAssignableStatuses.length}>
                                {currentAssignment ? 'Update Assignment' : 'Assign Customer'}
                              </Button>
                            </div>
                          </BlockStack>
                        </Form>
                      </Box>
                    )
                  })}
                </BlockStack>
              ) : search ? (
                <Banner tone="info">No customers matched that search.</Banner>
              ) : (
                <Banner tone="info">Search for a customer to assign a VIP status.</Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Existing assignments
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Review who is assigned, what rate they get, and remove outdated mappings quickly.
                  </Text>
                </BlockStack>
                <div style={{ minWidth: 260 }}>
                  <TextField
                    label="Filter assignments"
                    labelHidden
                    autoComplete="off"
                    value={assignmentFilter}
                    onChange={setAssignmentFilter}
                    placeholder="Filter by name, email, ID, or status"
                  />
                </div>
              </InlineStack>

              {config.assignments.length ? (
                filteredAssignments.length ? (
                  <BlockStack gap="300">
                    {filteredAssignments.map((assignment) => {
                      const status = savedStatusMap[assignment.statusKey]
                      const effectiveRate =
                        assignment.pricePerInchOverride ??
                        status?.pricePerInch ??
                        config.businessPricePerInch

                      return (
                        <Box
                          key={assignment.customerId}
                          padding="300"
                          borderWidth="025"
                          borderColor="border"
                          borderRadius="200"
                        >
                          <InlineStack align="space-between" blockAlign="start" wrap>
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyMd">
                                {assignment.customerName || assignment.customerEmail || assignment.customerId}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {assignment.customerEmail || 'No email on file'}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Customer ID: {assignment.customerId}
                              </Text>
                            </BlockStack>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                              <BlockStack gap="050">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Assigned status
                                </Text>
                                <Text as="p" variant="bodyMd">
                                  {status?.label || assignment.statusKey}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Effective rate: {formatRate(effectiveRate)}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {assignment.pricePerInchOverride
                                    ? `Customer override: ${formatRate(assignment.pricePerInchOverride)}`
                                    : `Status default: ${formatRate(status?.pricePerInch ?? config.businessPricePerInch)}`}
                                </Text>
                              </BlockStack>
                            </Box>

                            <Form method="post">
                              <input type="hidden" name="intent" value="delete-assignment" />
                              <input type="hidden" name="customerId" value={assignment.customerId} />
                              <Button submit tone="critical" variant="plain" loading={isSubmitting}>
                                Remove
                              </Button>
                            </Form>
                          </InlineStack>
                        </Box>
                      )
                    })}
                  </BlockStack>
                ) : (
                  <Banner tone="info">No assignments matched that filter.</Banner>
                )
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
