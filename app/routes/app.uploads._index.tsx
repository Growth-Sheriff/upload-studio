import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Link, useLoaderData, useSearchParams } from '@remix-run/react'
import {
  Badge,
  Button,
  BlockStack,
  Box,
  Card,
  ChoiceList,
  DataTable,
  Filters,
  InlineStack,
  Layout,
  Page,
  Pagination,
  Text,
} from '@shopify/polaris'
import { useCallback, useState } from 'react'
import prisma from '~/lib/prisma.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'
import { UploadDetailModal } from '~/components/UploadDetailModal'

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) {
    throw new Response('Shop installation not found. Reinstall the app to continue.', { status: 404 })
  }

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const status = url.searchParams.get('status') || undefined
  const mode = url.searchParams.get('mode') || undefined
  const limit = 20
  const skip = (page - 1) * limit


  const where: any = { shopId: shop.id }
  if (status) where.status = status
  if (mode) where.mode = mode

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
            storageKey: true,
            fileSize: true,
            uploadDurationMs: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.upload.count({ where }),
  ])

  const totalPages = Math.ceil(total / limit)


  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })
  const uploadsWithThumbnails = await Promise.all(
    uploads.map(async (u) => {
      let thumbnailUrl: string | null = null
      const firstItem = u.items[0]


      const thumbnailSource = firstItem?.thumbnailKey || firstItem?.storageKey
      if (thumbnailSource) {
        try {
          thumbnailUrl = await getDownloadSignedUrl(storageConfig, thumbnailSource, 3600)
        } catch (e) {
          console.warn(`[Uploads] Failed to get thumbnail URL for ${u.id}:`, e)
        }
      }


      const totalFileSize = u.items.reduce((sum, item) => sum + (item.fileSize || 0), 0)


      const totalUploadDurationMs = u.items.reduce(
        (sum, item) => sum + (item.uploadDurationMs || 0),
        0
      )


      return {
        id: u.id,
        mode: u.mode,
        status: u.status,
        orderId: u.orderId,
        orderPaidAt: u.orderPaidAt?.toISOString() || null,
        cartAddedAt: u.cartAddedAt?.toISOString() || null,
        productId: u.productId,
        itemCount: u.items.length,
        thumbnailUrl,
        totalFileSize,
        totalUploadDurationMs,
        preflightStatus: u.items.some((i) => i.preflightStatus === 'error')
          ? 'error'
          : u.items.some((i) => i.preflightStatus === 'warning')
            ? 'warning'
            : u.items.every((i) => i.preflightStatus === 'ok')
              ? 'ok'
              : 'pending',
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      }
    })
  )

  return json({
    uploads: uploadsWithThumbnails,
    pagination: {
      page,
      totalPages,
      total,
      limit,
    },
    filters: {
      status,
      mode,
    },
  })
}

import {
  UPLOAD_STATUS_LABELS,
  describeUploadStatus,
  preflightLabel,
  preflightTone,
  type UploadStatusFacts,
} from '~/lib/uploadStatus'

function StatusBadge({ facts }: { facts: UploadStatusFacts }) {
  const { label, tone } = describeUploadStatus(facts)
  return <Badge tone={tone}>{label}</Badge>
}

function PreflightBadge({ status }: { status: string }) {
  return <Badge tone={preflightTone(status)}>{preflightLabel(status)}</Badge>
}


function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}


function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '-'
  const seconds = ms / 1000
  if (seconds < 1) return `${Math.round(ms)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}


export default function UploadsPage() {
  const data = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null)

  if ('error' in data) {
    return (
      <Page title="Error">
        <Card>
          <Text as="p">{String(data.error)}</Text>
        </Card>
      </Page>
    )
  }

  const { uploads, pagination, filters } = data

  const handleStatusChange = useCallback(
    (value: string[]) => {
      const newParams = new URLSearchParams(searchParams)
      if (value.length > 0) {
        newParams.set('status', value[0])
      } else {
        newParams.delete('status')
      }
      newParams.set('page', '1')
      setSearchParams(newParams)
    },
    [searchParams, setSearchParams]
  )

  const handleModeChange = useCallback(
    (value: string[]) => {
      const newParams = new URLSearchParams(searchParams)
      if (value.length > 0) {
        newParams.set('mode', value[0])
      } else {
        newParams.delete('mode')
      }
      newParams.set('page', '1')
      setSearchParams(newParams)
    },
    [searchParams, setSearchParams]
  )

  const handleClearFilters = useCallback(() => {
    setSearchParams({ page: '1' })
  }, [setSearchParams])

  const rows = uploads.map((upload) => [

    <InlineStack key={upload.id} gap="200" align="start">
      {upload.thumbnailUrl ? (
        <img
          src={upload.thumbnailUrl}
          alt="Preview"
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }}
        />
      ) : (
        <Box
          background="bg-surface-secondary"
          padding="200"
          borderRadius="100"
          minWidth="36px"
          minHeight="36px"
        >
          <Text as="span" tone="subdued">
            —
          </Text>
        </Box>
      )}
      <Button variant="plain" onClick={() => setSelectedUploadId(upload.id)}>
        {upload.id.slice(0, 10)}...
      </Button>
    </InlineStack>,

    upload.mode,

    <StatusBadge key={`${upload.id}-status`} facts={upload} />,

    <PreflightBadge key={`${upload.id}-preflight`} status={upload.preflightStatus} />,

    <Text key={`${upload.id}-size`} as="span" variant="bodySm">
      {formatBytes(upload.totalFileSize)}
    </Text>,

    <Text
      key={`${upload.id}-duration`}
      as="span"
      variant="bodySm"
      tone={upload.totalUploadDurationMs > 10000 ? 'caution' : 'subdued'}
    >
      {formatDuration(upload.totalUploadDurationMs)}
    </Text>,

    upload.itemCount,

    new Date(upload.createdAt).toLocaleDateString(),
  ])

  const appliedFilters = []
  if (filters.status) {
    appliedFilters.push({
      key: 'status',
      label: `Status: ${filters.status}`,
      onRemove: () => handleStatusChange([]),
    })
  }
  if (filters.mode) {
    appliedFilters.push({
      key: 'mode',
      label: `Mode: ${filters.mode}`,
      onRemove: () => handleModeChange([]),
    })
  }

  return (
    <Page
      title="Uploads"
      subtitle={`${pagination.total} total uploads`}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">

              <Filters
                queryValue=""
                onQueryChange={() => {}}
                onQueryClear={() => {}}
                onClearAll={handleClearFilters}
                filters={[
                  {
                    key: 'status',
                    label: 'Status',
                    filter: (
                      <ChoiceList
                        title="Status"
                        titleHidden
                        choices={[
                          { label: UPLOAD_STATUS_LABELS.draft, value: 'draft' },
                          { label: UPLOAD_STATUS_LABELS.processing, value: 'processing' },
                          { label: 'Uploaded, not ordered (needs a look)', value: 'pending_approval' },
                          { label: 'Uploaded, not ordered (file OK)', value: 'ready' },
                          { label: UPLOAD_STATUS_LABELS.needs_review, value: 'needs_review' },
                          { label: 'Approved / paid', value: 'approved' },
                          { label: UPLOAD_STATUS_LABELS.printed, value: 'printed' },
                          { label: UPLOAD_STATUS_LABELS.shipped, value: 'shipped' },
                          { label: UPLOAD_STATUS_LABELS.rejected, value: 'rejected' },
                          { label: UPLOAD_STATUS_LABELS.blocked, value: 'blocked' },
                        ]}
                        selected={filters.status ? [filters.status] : []}
                        onChange={handleStatusChange}
                      />
                    ),
                    shortcut: true,
                  },
                  {
                    key: 'mode',
                    label: 'Mode',
                    filter: (
                      <ChoiceList
                        title="Mode"
                        titleHidden
                        choices={[
                          { label: '3D Designer', value: '3d_designer' },
                          { label: 'Classic', value: 'classic' },
                          { label: 'Quick', value: 'quick' },
                        ]}
                        selected={filters.mode ? [filters.mode] : []}
                        onChange={handleModeChange}
                      />
                    ),
                    shortcut: true,
                  },
                ]}
                appliedFilters={appliedFilters}
              />


              {uploads.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    'text',
                    'text',
                    'text',
                    'text',
                    'text',
                    'text',
                    'numeric',
                    'text',
                  ]}
                  headings={[
                    'Upload',
                    'Mode',
                    'Status',
                    'Quality',
                    'File size',
                    'Time',
                    'Items',
                    'Date',
                  ]}
                  rows={rows}
                />
              ) : (
                <Box padding="400">
                  <Text as="p" tone="subdued" alignment="center">
                    No uploads found matching your filters.
                  </Text>
                </Box>
              )}


              {pagination.totalPages > 1 && (
                <InlineStack align="center">
                  <Pagination
                    hasPrevious={pagination.page > 1}
                    hasNext={pagination.page < pagination.totalPages}
                    onPrevious={() => {
                      const newParams = new URLSearchParams(searchParams)
                      newParams.set('page', String(pagination.page - 1))
                      setSearchParams(newParams)
                    }}
                    onNext={() => {
                      const newParams = new URLSearchParams(searchParams)
                      newParams.set('page', String(pagination.page + 1))
                      setSearchParams(newParams)
                    }}
                  />
                </InlineStack>
              )}

              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                Showing {uploads.length} of {pagination.total} uploads
              </Text>
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
