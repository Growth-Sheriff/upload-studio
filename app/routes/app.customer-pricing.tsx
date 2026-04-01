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
  FormLayout,
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
    customers(first: 10, query: $query) {
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
    try {
      const customerQuery = search.includes('@') ? `email:${search}` : search
      const response = await admin.graphql(CUSTOMER_SEARCH_QUERY, {
        variables: { query: search.includes(':') ? search : customerQuery },
      })
      const payload = await response.json()
      const edges = payload?.data?.customers?.edges || []
      searchResults = edges.map((edge: { node: { id: string; legacyResourceId?: string | number | null; displayName?: string; email?: string | null } }) => ({
        id: customerIdFromGraphql(edge.node),
        displayName: edge.node.displayName || edge.node.email || customerIdFromGraphql(edge.node),
        email: edge.node.email || null,
      }))
    } catch (error) {
      console.error('[Customer Pricing] Customer search failed:', error)
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

    const nextConfig = normalizeCustomerPricingSettings({
      customerPricing: {
        enabled: formData.get('enabled') === 'true',
        businessPricePerInch: Number(formData.get('businessPricePerInch') || 0.2),
        statuses: parsedStatuses,
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
    const pricePerInchOverrideRaw = String(formData.get('pricePerInchOverride') || '').trim()
    const pricePerInchOverride =
      pricePerInchOverrideRaw && Number(pricePerInchOverrideRaw) > 0
        ? Number(pricePerInchOverrideRaw)
        : null

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
        pricePerInchOverride,
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
  const [businessPricePerInch, setBusinessPricePerInch] = useState(String(config.businessPricePerInch || 0.2))
  const [statuses, setStatuses] = useState(
    config.statuses.map((status) => ({
      id: status.id,
      key: status.key,
      label: status.label,
      active: status.active,
      pricePerInch: String(status.pricePerInch || ''),
    }))
  )

  function updateStatus(index: number, field: string, value: string | boolean) {
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
                    pricePerInch: Number(status.pricePerInch || 0),
                  }))
                )}
              />
              <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Pricing Rules
                </Text>
                <Checkbox
                  label="Enable customer-specific pricing"
                  checked={enabled}
                  onChange={setEnabled}
                />
                <TextField
                  label="Business price per inch"
                  type="number"
                  step={0.0001}
                  min={0}
                  autoComplete="off"
                  value={businessPricePerInch}
                  onChange={setBusinessPricePerInch}
                  name="businessPricePerInch"
                  helpText="Default rate for business and guest customers."
                />
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingSm">
                      VIP Statuses
                    </Text>
                    <Button onClick={addStatus}>Add Status</Button>
                  </InlineStack>
                  {statuses.map((status, index) => (
                    <Box
                      key={status.id}
                      padding="300"
                      borderWidth="025"
                      borderColor="border"
                      borderRadius="200"
                    >
                      <FormLayout>
                        <InlineStack gap="300" wrap={false} align="space-between">
                          <div style={{ minWidth: 240, flex: '1 1 240px' }}>
                            <TextField
                              label="Label"
                              autoComplete="off"
                              value={status.label}
                              onChange={(value) => updateStatus(index, 'label', value)}
                            />
                          </div>
                          <div style={{ minWidth: 220, flex: '1 1 220px' }}>
                            <TextField
                              label="Key"
                              autoComplete="off"
                              value={status.key}
                              onChange={(value) => updateStatus(index, 'key', value)}
                            />
                          </div>
                          <div style={{ minWidth: 220, flex: '1 1 220px' }}>
                            <TextField
                              label="Price per inch"
                              type="number"
                              step={0.0001}
                              min={0}
                              autoComplete="off"
                              value={status.pricePerInch}
                              onChange={(value) => updateStatus(index, 'pricePerInch', value)}
                            />
                          </div>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Checkbox
                            label="Active"
                            checked={status.active}
                            onChange={(value) => updateStatus(index, 'active', value)}
                          />
                          <Button variant="plain" tone="critical" onClick={() => removeStatus(index)}>
                            Remove
                          </Button>
                        </InlineStack>
                      </FormLayout>
                    </Box>
                  ))}
                </BlockStack>
                <InlineStack align="end">
                  <Button submit variant="primary" loading={isSubmitting}>
                    Save Pricing Rules
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Find Customers
              </Text>
              <Form method="get">
                <InlineStack gap="300" align="start">
                  <div style={{ minWidth: 320, flex: '1 1 320px' }}>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                      Search by email or name
                    </label>
                    <input
                      type="text"
                      name="q"
                      defaultValue={search}
                      style={{ width: '100%', minHeight: 36, padding: '8px 12px' }}
                    />
                  </div>
                  <Box paddingBlockStart="500">
                    <Button submit>Search</Button>
                  </Box>
                </InlineStack>
              </Form>

              {searchResults.length ? (
                <BlockStack gap="300">
                  {searchResults.map((customer) => (
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
                        <FormLayout>
                          <Text as="p" variant="bodyMd">
                            {customer.displayName} {customer.email ? `(${customer.email})` : ''}
                          </Text>
                          <InlineStack gap="300" align="start">
                            <div style={{ minWidth: 220, flex: '1 1 220px' }}>
                              <select name="statusKey" style={{ width: '100%', minHeight: 36 }}>
                                {config.statuses.map((status) => (
                                  <option key={status.key} value={status.key}>
                                    {status.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ minWidth: 220, flex: '1 1 220px' }}>
                              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                                Override price per inch
                              </label>
                              <input
                                type="number"
                                name="pricePerInchOverride"
                                step="0.0001"
                                min="0"
                                style={{ width: '100%', minHeight: 36, padding: '8px 12px' }}
                              />
                            </div>
                            <Box paddingBlockStart="500">
                              <Button submit variant="primary" loading={isSubmitting}>
                                Assign
                              </Button>
                            </Box>
                          </InlineStack>
                        </FormLayout>
                      </Form>
                    </Box>
                  ))}
                </BlockStack>
              ) : search ? (
                <Banner tone="info">No customers matched that search.</Banner>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Existing Assignments
              </Text>
              {config.assignments.length ? (
                <BlockStack gap="300">
                  {config.assignments.map((assignment) => (
                    <Box
                      key={assignment.customerId}
                      padding="300"
                      borderWidth="025"
                      borderColor="border"
                      borderRadius="200"
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd">
                            {assignment.customerName || assignment.customerEmail || assignment.customerId}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Customer ID: {assignment.customerId}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Status: {assignment.statusKey}
                            {assignment.pricePerInchOverride
                              ? ` · Override: ${assignment.pricePerInchOverride.toFixed(4)}/in`
                              : ''}
                          </Text>
                        </BlockStack>
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete-assignment" />
                          <input type="hidden" name="customerId" value={assignment.customerId} />
                          <Button submit tone="critical" variant="plain" loading={isSubmitting}>
                            Remove
                          </Button>
                        </Form>
                      </InlineStack>
                    </Box>
                  ))}
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
