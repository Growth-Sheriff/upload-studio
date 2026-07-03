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
  Icon,
  InlineStack,
  Layout,
  Page,
  Pagination,
  Text,
  Tooltip,
} from '@shopify/polaris'
import { PersonIcon } from '@shopify/polaris-icons'
import { useCallback, useState } from 'react'
import prisma from '~/lib/prisma.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'
import { UploadDetailModal } from '~/components/UploadDetailModal'

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  let shop = await prisma.shop.findUnique({ where: { shopDomain } })
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
        visitor: {
          select: {
            id: true,
            customerEmail: true,
            shopifyCustomerId: true,
            deviceType: true,
            browser: true,
            country: true,
          },
        },
        session: {
          select: {
            id: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            referrerType: true,
            referrerDomain: true,
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


      const utmInfo = u.session
        ? {
            source: u.session.utmSource,
            medium: u.session.utmMedium,
            campaign: u.session.utmCampaign,
            referrerType: u.session.referrerType,
            referrerDomain: u.session.referrerDomain,
          }
        : null


      const visitorInfo = u.visitor
        ? {
            email: u.visitor.customerEmail,
            customerId: u.visitor.shopifyCustomerId,
            deviceType: u.visitor.deviceType,
            browser: u.visitor.browser,
            country: u.visitor.country,
          }
        : null

      return {
        id: u.id,
        mode: u.mode,
        status: u.status,
        productId: u.productId,
        customerId: u.customerId,
        customerEmail: u.customerEmail,
        itemCount: u.items.length,
        thumbnailUrl,
        totalFileSize,
        totalUploadDurationMs,
        utmInfo,
        visitorInfo,
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

function StatusBadge({ status }: { status: string }) {

  const labelMap: Record<string, string> = {
    ok: 'Ready ✓',
    warning: 'Review',
    error: 'Check',
    pending: 'Processing',
    draft: 'Draft',
    uploaded: 'Received',
    processing: 'Processing',
    needs_review: 'Pending',
    approved: 'Approved ✓',
    rejected: 'Rejected',
    blocked: 'On Hold',
    printed: 'Completed ✓',
  }

  const toneMap: Record<string, 'success' | 'warning' | 'critical' | 'info' | 'attention'> = {
    ok: 'success',
    warning: 'info',
    error: 'attention',
    pending: 'info',
    draft: 'info',
    uploaded: 'success',
    processing: 'info',
    needs_review: 'info',
    approved: 'success',
    rejected: 'critical',
    blocked: 'attention',
    printed: 'success',
  }
  return <Badge tone={toneMap[status] || 'info'}>{labelMap[status] || status}</Badge>
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


function UTMBadge({
  utmInfo,
}: {
  utmInfo: {
    source?: string | null
    medium?: string | null
    campaign?: string | null
    referrerType?: string | null
    referrerDomain?: string | null
  } | null
}) {
  if (!utmInfo)
    return (
      <Text as="span" tone="subdued">
        -
      </Text>
    )

  const { source, medium, campaign, referrerType, referrerDomain } = utmInfo


  let displayText = ''
  let tooltipContent = ''

  if (source) {
    displayText = source
    tooltipContent = `Source: ${source}`
    if (medium) tooltipContent += `\nMedium: ${medium}`
    if (campaign) tooltipContent += `\nCampaign: ${campaign}`
  } else if (referrerType) {
    displayText = referrerType.replace('_', ' ')
    tooltipContent = `Referrer Type: ${referrerType}`
    if (referrerDomain) tooltipContent += `\nDomain: ${referrerDomain}`
  } else {
    return (
      <Text as="span" tone="subdued">
        Direct
      </Text>
    )
  }

  const toneMap: Record<string, 'success' | 'info' | 'warning' | 'attention'> = {
    google: 'success',
    facebook: 'info',
    instagram: 'info',
    tiktok: 'attention',
    organic_search: 'success',
    paid_search: 'warning',
    social: 'info',
    email: 'attention',
  }

  return (
    <Tooltip content={tooltipContent}>
      <Badge tone={toneMap[source || referrerType || ''] || 'info'}>{displayText}</Badge>
    </Tooltip>
  )
}


function VisitorInfo({
  visitorInfo,
  customerEmail,
  customerId: uploadCustomerId,
}: {
  visitorInfo: {
    email?: string | null
    customerId?: string | null
    deviceType?: string | null
    browser?: string | null
    country?: string | null
  } | null
  customerEmail?: string | null
  customerId?: string | null
}) {

  const email = customerEmail || visitorInfo?.email

  const customerId = uploadCustomerId || visitorInfo?.customerId


  const isLoggedInCustomer = !!email

  if (!email && !customerId && !visitorInfo) {
    return (
      <Text as="span" tone="subdued">
        Anonymous
      </Text>
    )
  }

  const tooltipParts = []
  if (email) tooltipParts.push(`Email: ${email}`)
  if (customerId) tooltipParts.push(`Customer ID: ${customerId}`)
  if (visitorInfo?.deviceType) tooltipParts.push(`Device: ${visitorInfo.deviceType}`)
  if (visitorInfo?.browser) tooltipParts.push(`Browser: ${visitorInfo.browser}`)
  if (visitorInfo?.country) tooltipParts.push(`Country: ${visitorInfo.country}`)


  const displayText = email
    ? email.length > 20
      ? email.slice(0, 17) + '...'
      : email
    : visitorInfo?.deviceType || 'Visitor'

  return (
    <Tooltip content={tooltipParts.join('\n')}>
      <InlineStack gap="100" blockAlign="center">
        <Icon source={PersonIcon} tone={isLoggedInCustomer ? 'magic' : 'subdued'} />
        <Text as="span" variant="bodySm">
          {displayText}
        </Text>
        {isLoggedInCustomer && (
          <Badge tone="success" size="small">
            Customer
          </Badge>
        )}
      </InlineStack>
    </Tooltip>
  )
}

export default function UploadsPage() {
  const data = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null)

  if ('error' in data) {
    return (
      <Page title="Error">
        <Card>
          <Text as="p">{data.error}</Text>
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

    <StatusBadge key={`${upload.id}-status`} status={upload.status} />,

    <StatusBadge key={`${upload.id}-preflight`} status={upload.preflightStatus} />,

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

    <UTMBadge key={`${upload.id}-utm`} utmInfo={upload.utmInfo} />,

    <VisitorInfo
      key={`${upload.id}-visitor`}
      visitorInfo={upload.visitorInfo}
      customerEmail={upload.customerEmail}
      customerId={upload.customerId}
    />,

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
      primaryAction={{
        content: 'Export All',
        url: '/app/exports',
      }}
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
                          { label: 'Draft', value: 'draft' },
                          { label: 'Uploaded', value: 'uploaded' },
                          { label: 'Processing', value: 'processing' },
                          { label: 'Needs Review', value: 'needs_review' },
                          { label: 'Approved', value: 'approved' },
                          { label: 'Rejected', value: 'rejected' },
                          { label: 'Blocked', value: 'blocked' },
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
                    'text',
                    'text',
                  ]}
                  headings={[
                    'Upload',
                    'Mode',
                    'Status',
                    'Quality',
                    'Size',
                    'Time',
                    'Items',
                    'Source',
                    'Customer',
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

