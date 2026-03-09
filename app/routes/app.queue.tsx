import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from '@remix-run/react'
import {
  ActionList,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  InlineStack,
  Layout,
  Modal,
  Page,
  Pagination,
  Popover,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
} from '@shopify/polaris'
import { useCallback, useState } from 'react'
import prisma from '~/lib/prisma.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'

import { UploadDetailModal } from '~/components/UploadDetailModal'

// Production Queue Statuses
const QUEUE_STATUSES = [
  { value: 'needs_review', label: 'Needs Review', tone: 'attention' as const },
  { value: 'approved', label: 'Approved', tone: 'success' as const },
  { value: 'printing', label: 'Printing', tone: 'info' as const },
  { value: 'printed', label: 'Printed', tone: 'success' as const },
  { value: 'shipped', label: 'Shipped', tone: 'success' as const },
  { value: 'rejected', label: 'Rejected', tone: 'critical' as const },
  { value: 'reupload_requested', label: 'Reupload Requested', tone: 'warning' as const },
]

const STATUS_OPTIONS = QUEUE_STATUSES.map((s) => ({ label: s.label, value: s.value }))

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
        plan: 'starter',
        billingStatus: 'active',
        storageProvider: 'r2',
        settings: {},
      },
    })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || ''
  const mode = url.searchParams.get('mode') || ''
  const dateFrom = url.searchParams.get('dateFrom') || ''
  const dateTo = url.searchParams.get('dateTo') || ''
  const search = url.searchParams.get('search') || ''
  const page = parseInt(url.searchParams.get('page') || '1')
  const pageSize = 20

  // Build where clause
  const where: any = { shopId: shop.id }

  // Only show uploads that have passed initial upload (not draft)
  where.status = status ? status : { notIn: ['draft', 'uploaded', 'processing'] }

  if (mode) {
    where.mode = mode
  }

  if (dateFrom) {
    where.createdAt = { ...where.createdAt, gte: new Date(dateFrom) }
  }
  if (dateTo) {
    where.createdAt = { ...where.createdAt, lte: new Date(dateTo + 'T23:59:59') }
  }

  if (search) {
    where.OR = [
      { customerEmail: { contains: search, mode: 'insensitive' } },
      { id: { contains: search } },
      { orderId: { contains: search } },
    ]
  }

  // Get uploads with pagination
  const [uploads, total] = await Promise.all([
    prisma.upload.findMany({
      where,
      include: {
        items: {
          select: {
            id: true,
            location: true,
            preflightStatus: true,
            thumbnailKey: true,
            originalName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.upload.count({ where }),
  ])

  // Get status counts for tabs
  const statusCounts = await prisma.upload.groupBy({
    by: ['status'],
    where: {
      shopId: shop.id,
      status: { notIn: ['draft', 'uploaded', 'processing'] },
    },
    _count: true,
  })

  const countsMap = new Map(
    statusCounts.map((s: { status: string; _count: number }) => [s.status, s._count])
  )

  // Generate signed URLs for thumbnails
  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })
  const uploadsWithThumbnails = await Promise.all(
    uploads.map(async (u) => {
      let thumbnailUrl: string | null = null
      const firstItem = u.items[0]

      if (firstItem?.thumbnailKey) {
        try {
          thumbnailUrl = await getDownloadSignedUrl(storageConfig, firstItem.thumbnailKey, 3600)
        } catch (e) {
          console.warn(`[Queue] Failed to get thumbnail URL for ${u.id}:`, e)
        }
      }

      return {
        id: u.id,
        mode: u.mode,
        status: u.status,
        orderId: u.orderId,
        customerEmail: u.customerEmail,
        itemCount: u.items.length,
        locations: u.items.map((i: { location: string }) => i.location),
        preflightStatus: u.items.some(
          (i: { preflightStatus: string }) => i.preflightStatus === 'error'
        )
          ? 'error'
          : u.items.some((i: { preflightStatus: string }) => i.preflightStatus === 'warning')
            ? 'warning'
            : 'ok',
        thumbnailUrl,
        createdAt: u.createdAt.toISOString(),
        approvedAt: u.approvedAt?.toISOString() || null,
      }
    })
  )

  return json({
    uploads: uploadsWithThumbnails,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
    statusCounts: Object.fromEntries(countsMap),
    filters: { status, mode, dateFrom, dateTo, search },
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const formData = await request.formData()
  const action = formData.get('_action')

  if (action === 'update_status') {
    const uploadId = formData.get('uploadId') as string
    const newStatus = formData.get('status') as string
    const notes = formData.get('notes') as string

    const upload = await prisma.upload.findFirst({
      where: { id: uploadId, shopId: shop.id },
    })

    if (!upload) {
      return json({ error: 'Upload not found' })
    }

    const updateData: any = { status: newStatus }

    if (newStatus === 'approved') {
      updateData.approvedAt = new Date()
    } else if (newStatus === 'rejected') {
      updateData.rejectedAt = new Date()
    }

    // SECURITY: Compound where prevents TOCTOU race condition
    await prisma.upload.update({
      where: { id: uploadId, shopId: shop.id },
      data: updateData,
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: `status_${newStatus}`,
        resourceType: 'upload',
        resourceId: uploadId,
        metadata: { previousStatus: upload.status, notes },
      },
    })

    return json({ success: true, message: `Status updated to ${newStatus}` })
  }

  if (action === 'bulk_update') {
    const uploadIds = JSON.parse(formData.get('uploadIds') as string) as string[]
    const newStatus = formData.get('status') as string

    if (!uploadIds.length) {
      return json({ error: 'No uploads selected' })
    }

    const updateData: any = { status: newStatus }

    if (newStatus === 'approved') {
      updateData.approvedAt = new Date()
    } else if (newStatus === 'rejected') {
      updateData.rejectedAt = new Date()
    }

    await prisma.upload.updateMany({
      where: {
        id: { in: uploadIds },
        shopId: shop.id,
      },
      data: updateData,
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: `bulk_${newStatus}`,
        resourceType: 'upload',
        resourceId: uploadIds.join(','),
        metadata: { count: uploadIds.length },
      },
    })

    return json({ success: true, message: `${uploadIds.length} uploads updated to ${newStatus}` })
  }

  if (action === 'create_export') {
    const uploadIds = JSON.parse(formData.get('uploadIds') as string) as string[]

    if (!uploadIds.length) {
      return json({ error: 'No uploads selected for export' })
    }

    // Verify all uploadIds belong to this shop
    const validUploads = await prisma.upload.findMany({
      where: { id: { in: uploadIds }, shopId: shop.id },
      select: { id: true },
    })
    const validIds = validUploads.map(u => u.id)

    if (validIds.length === 0) {
      return json({ error: 'No valid uploads found for this shop' })
    }

    // Create export job
    const exportJob = await prisma.exportJob.create({
      data: {
        shopId: shop.id,
        uploadIds: validIds,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    })

    // Enqueue export worker job
    try {
      const { Queue } = await import('bullmq')
      const Redis = (await import('ioredis')).default
      const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      })
      const queue = new Queue('export', { connection })
      await queue.add('process-export', {
        exportId: exportJob.id,
        shopId: shop.id,
        uploadIds: validIds,
      })
      await queue.close()
      console.log(`[Queue] Export job ${exportJob.id} queued successfully`)
    } catch (error) {
      console.error('[Queue] Failed to enqueue export job:', error)
      // Don't fail - export will be picked up by cron
    }

    return json({
      success: true,
      message: 'Export job created. Check Exports page for download.',
      exportJobId: exportJob.id,
    })
  }

  return json({ error: 'Unknown action' }, { status: 400 })
}

function StatusBadge({ status }: { status: string }) {
  const config = QUEUE_STATUSES.find((s) => s.value === status)
  return <Badge tone={config?.tone || 'info'}>{config?.label || status}</Badge>
}

function PreflightBadge({ status }: { status: string }) {
  // Merchant-friendly labels with softer tones
  const config: Record<string, { tone: 'success' | 'info' | 'attention'; label: string }> = {
    ok: { tone: 'success', label: 'Ready ✓' },
    warning: { tone: 'info', label: 'Review' },
    error: { tone: 'attention', label: 'Check' },
  }
  const { tone, label } = config[status] || { tone: 'info' as const, label: status }
  return <Badge tone={tone}>{label}</Badge>
}

export default function ProductionQueuePage() {
  const { uploads, pagination, statusCounts, filters } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const [searchParams, setSearchParams] = useSearchParams()
  const isLoading = navigation.state === 'loading'
  const isSubmitting = navigation.state === 'submitting'

  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null)
  const [selectedUploads, setSelectedUploads] = useState<string[]>([])
  const [bulkActionOpen, setBulkActionOpen] = useState(false)
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [selectedUploadForStatus, setSelectedUploadForStatus] = useState<
    (typeof uploads)[0] | null
  >(null)
  const [newStatus, setNewStatus] = useState('')
  const [notes, setNotes] = useState('')

  // Tab counts
  const totalCount = Object.values(statusCounts as Record<string, number>).reduce(
    (a, b) => a + b,
    0
  )
  const tabs = [
    { id: 'all', content: `All (${totalCount})`, panelID: 'all' },
    {
      id: 'needs_review',
      content: `Needs Review (${(statusCounts as Record<string, number>).needs_review || 0})`,
      panelID: 'needs_review',
    },
    {
      id: 'approved',
      content: `Approved (${(statusCounts as Record<string, number>).approved || 0})`,
      panelID: 'approved',
    },
    {
      id: 'printing',
      content: `Printing (${(statusCounts as Record<string, number>).printing || 0})`,
      panelID: 'printing',
    },
    {
      id: 'shipped',
      content: `Shipped (${(statusCounts as Record<string, number>).shipped || 0})`,
      panelID: 'shipped',
    },
  ]

  const selectedTab = tabs.findIndex((t) => t.id === (filters.status || 'all'))

  const handleTabChange = useCallback(
    (index: number) => {
      const tab = tabs[index]
      const params = new URLSearchParams(searchParams)
      if (tab.id === 'all') {
        params.delete('status')
      } else {
        params.set('status', tab.id)
      }
      params.set('page', '1')
      setSearchParams(params)
    },
    [searchParams, setSearchParams, tabs]
  )

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedUploads(checked ? uploads.map((u: { id: string }) => u.id) : [])
    },
    [uploads]
  )

  const handleSelectUpload = useCallback((id: string, checked: boolean) => {
    setSelectedUploads((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))
  }, [])

  const openStatusModal = useCallback((upload: (typeof uploads)[0]) => {
    setSelectedUploadForStatus(upload)
    setNewStatus(upload.status)
    setNotes('')
    setStatusModalOpen(true)
  }, [])

  const rows = uploads.map((upload: any) => [
    <Checkbox
      key={`check-${upload.id}`}
      label=""
      labelHidden
      checked={selectedUploads.includes(upload.id)}
      onChange={(checked) => handleSelectUpload(upload.id, checked)}
    />,
    <InlineStack key={upload.id} gap="200" align="start">
      {upload.thumbnailUrl ? (
        <img
          src={upload.thumbnailUrl}
          alt="Preview"
          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
        />
      ) : (
        <Box background="bg-surface-secondary" padding="200" borderRadius="100">
          <Text as="span" tone="subdued">
            —
          </Text>
        </Box>
      )}
      <BlockStack gap="050">
        <Text as="span" variant="bodySm" fontWeight="semibold">
          {upload.id.slice(0, 8)}...
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {upload.customerEmail || 'Guest'}
        </Text>
      </BlockStack>
    </InlineStack>,
    upload.orderId ? (
      <Text as="span" variant="bodySm">
        #{upload.orderId.slice(-6)}
      </Text>
    ) : (
      <Text as="span" tone="subdued">
        —
      </Text>
    ),
    <Badge key={`mode-${upload.id}`}>{upload.mode}</Badge>,
    <StatusBadge key={`status-${upload.id}`} status={upload.status} />,
    <PreflightBadge key={`preflight-${upload.id}`} status={upload.preflightStatus} />,
    <Text key={`loc-${upload.id}`} as="span" variant="bodySm">
      {upload.locations.join(', ')}
    </Text>,
    new Date(upload.createdAt).toLocaleDateString(),
    <InlineStack key={`actions-${upload.id}`} gap="100">
      <Button size="slim" onClick={() => openStatusModal(upload)}>
        Update
      </Button>
      <Button size="slim" onClick={() => setSelectedUploadId(upload.id)}>
        View
      </Button>
    </InlineStack>,
  ])

  return (
    <Page
      title="Production Queue"
      backAction={{ content: 'Dashboard', url: '/app' }}
      secondaryActions={[
        {
          content: `Export Selected (${selectedUploads.length})`,
          disabled: selectedUploads.length === 0,
          onAction: () => {
            const form = document.getElementById('export-form') as HTMLFormElement
            if (form) form.submit()
          },
        },
        { content: 'View Exports', url: '/app/exports' },
        { content: 'Analytics', url: '/app/analytics' },
      ]}
    >
      <Layout>
        {/* Action result banner */}
        {actionData && 'success' in actionData && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              {actionData.message}
            </Banner>
          </Layout.Section>
        )}
        {actionData && 'error' in actionData && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => {}}>
              {actionData.error}
            </Banner>
          </Layout.Section>
        )}

        {/* Tabs */}
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
              <Box padding="400">
                {/* Bulk Actions */}
                {selectedUploads.length > 0 && (
                  <Box paddingBlockEnd="400">
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {selectedUploads.length} selected
                      </Text>
                      <Popover
                        active={bulkActionOpen}
                        activator={
                          <Button onClick={() => setBulkActionOpen(true)} disclosure>
                            Bulk Actions
                          </Button>
                        }
                        onClose={() => setBulkActionOpen(false)}
                      >
                        <ActionList
                          items={[
                            {
                              content: 'Approve All',
                              onAction: () => {
                                const form = document.getElementById('bulk-form') as HTMLFormElement
                                ;(form.querySelector('[name="status"]') as HTMLInputElement).value =
                                  'approved'
                                form.submit()
                              },
                            },
                            {
                              content: 'Mark as Printing',
                              onAction: () => {
                                const form = document.getElementById('bulk-form') as HTMLFormElement
                                ;(form.querySelector('[name="status"]') as HTMLInputElement).value =
                                  'printing'
                                form.submit()
                              },
                            },
                            {
                              content: 'Mark as Printed',
                              onAction: () => {
                                const form = document.getElementById('bulk-form') as HTMLFormElement
                                ;(form.querySelector('[name="status"]') as HTMLInputElement).value =
                                  'printed'
                                form.submit()
                              },
                            },
                            {
                              content: 'Mark as Shipped',
                              onAction: () => {
                                const form = document.getElementById('bulk-form') as HTMLFormElement
                                ;(form.querySelector('[name="status"]') as HTMLInputElement).value =
                                  'shipped'
                                form.submit()
                              },
                            },
                            {
                              content: 'Reject All',
                              destructive: true,
                              onAction: () => {
                                const form = document.getElementById('bulk-form') as HTMLFormElement
                                ;(form.querySelector('[name="status"]') as HTMLInputElement).value =
                                  'rejected'
                                form.submit()
                              },
                            },
                            {
                              content: 'Export Selected',
                              onAction: () => {
                                const form = document.getElementById(
                                  'export-form'
                                ) as HTMLFormElement
                                form.submit()
                              },
                            },
                          ]}
                        />
                      </Popover>
                      <Button onClick={() => setSelectedUploads([])}>Clear Selection</Button>
                    </InlineStack>
                  </Box>
                )}

                {/* Hidden forms for bulk actions */}
                <Form method="post" id="bulk-form" style={{ display: 'none' }}>
                  <input type="hidden" name="_action" value="bulk_update" />
                  <input type="hidden" name="uploadIds" value={JSON.stringify(selectedUploads)} />
                  <input type="hidden" name="status" value="" />
                </Form>

                <Form method="post" id="export-form" style={{ display: 'none' }}>
                  <input type="hidden" name="_action" value="create_export" />
                  <input type="hidden" name="uploadIds" value={JSON.stringify(selectedUploads)} />
                </Form>

                {/* Table */}
                {isLoading ? (
                  <Box padding="400">
                    <InlineStack align="center">
                      <Spinner size="large" />
                    </InlineStack>
                  </Box>
                ) : uploads.length > 0 ? (
                  <>
                    <DataTable
                      columnContentTypes={[
                        'text',
                        'text',
                        'text',
                        'text',
                        'text',
                        'text',
                        'text',
                        'text',
                        'text',
                      ]}
                      headings={[
                        <Checkbox
                          key="select-all"
                          label=""
                          labelHidden
                          checked={selectedUploads.length === uploads.length && uploads.length > 0}
                          onChange={handleSelectAll}
                        />,
                        'Upload',
                        'Order',
                        'Mode',
                        'Status',
                        'Preflight',
                        'Locations',
                        'Date',
                        'Actions',
                      ]}
                      rows={rows}
                    />

                    {/* Pagination */}
                    <Box paddingBlockStart="400">
                      <InlineStack align="center">
                        <Pagination
                          hasPrevious={pagination.page > 1}
                          onPrevious={() => {
                            const params = new URLSearchParams(searchParams)
                            params.set('page', String(pagination.page - 1))
                            setSearchParams(params)
                          }}
                          hasNext={pagination.page < pagination.totalPages}
                          onNext={() => {
                            const params = new URLSearchParams(searchParams)
                            params.set('page', String(pagination.page + 1))
                            setSearchParams(params)
                          }}
                        />
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                      </Text>
                    </Box>
                  </>
                ) : (
                  <EmptyState
                    heading="No uploads in queue"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Uploads will appear here when customers submit designs.</p>
                  </EmptyState>
                )}
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Hidden Export Form */}
      <Form method="post" id="export-form" style={{ display: 'none' }}>
        <input type="hidden" name="_action" value="create_export" />
        <input type="hidden" name="uploadIds" value={JSON.stringify(selectedUploads)} />
      </Form>

      {/* Status Update Modal */}
      <Modal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title={`Update Status: ${selectedUploadForStatus?.id.slice(0, 8)}...`}
        primaryAction={{
          content: 'Update',
          loading: isSubmitting,
          onAction: () => {
            const form = document.getElementById('status-form') as HTMLFormElement
            form?.submit()
          },
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setStatusModalOpen(false) }]}
      >
        <Modal.Section>
          <Form method="post" id="status-form">
            <input type="hidden" name="_action" value="update_status" />
            <input type="hidden" name="uploadId" value={selectedUploadForStatus?.id || ''} />

            <BlockStack gap="400">
              <Select
                label="New Status"
                options={STATUS_OPTIONS}
                value={newStatus}
                onChange={setNewStatus}
                name="status"
              />

              <TextField
                label="Notes (optional)"
                value={notes}
                onChange={setNotes}
                name="notes"
                multiline={3}
                autoComplete="off"
              />

              {selectedUploadForStatus && (
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm">
                      <strong>Current Status:</strong> {selectedUploadForStatus.status}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Mode:</strong> {selectedUploadForStatus.mode}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Locations:</strong> {selectedUploadForStatus.locations.join(', ')}
                    </Text>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Form>
        </Modal.Section>
      </Modal>
      <UploadDetailModal 
          uploadId={selectedUploadId} 
          onClose={() => setSelectedUploadId(null)} 
      />
    </Page>
  )
}
