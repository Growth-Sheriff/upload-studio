import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Form, useActionData, useLoaderData } from '@remix-run/react'
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineStack,
  Layout,
  Modal,
  Page,
  Text,
  Thumbnail,
} from '@shopify/polaris'
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon } from '@shopify/polaris-icons'
import { useState } from 'react'
import prisma from '~/lib/prisma.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  let shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || '',
        plan: 'commission',
        billingStatus: 'active',
        storageProvider: 'r2',
        settings: {},
      },
    })
  }

  const uploadId = params.id
  if (!uploadId) {
    return json({ error: 'Missing uploadId' }, { status: 400 })
  }

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    include: {
      items: true,
    },
  })

  if (!upload) {
    return json({ error: 'Upload not found' }, { status: 404 })
  }


  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })
  const itemsWithUrls = await Promise.all(
    upload.items.map(async (item) => {
      let thumbnailUrl = null
      let previewUrl = null


      const thumbnailSource = item.thumbnailKey || item.storageKey
      if (thumbnailSource) {
        try {
          thumbnailUrl = await getDownloadSignedUrl(storageConfig, thumbnailSource, 3600)
        } catch {}
      }


      const previewSource = item.previewKey || item.storageKey
      if (previewSource) {
        try {
          previewUrl = await getDownloadSignedUrl(storageConfig, previewSource, 3600)
        } catch {}
      }

      return {
        ...item,
        thumbnailUrl,
        previewUrl,
        preflightResult: item.preflightResult as any,
      }
    })
  )

  return json({
    upload: {
      ...upload,
      items: itemsWithUrls,
    },
    shopPlan: shop.plan,
  })
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  const shop = await prisma.shop.findUnique({ where: { shopDomain } })
  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const uploadId = params.id


  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
  })

  if (!upload) {
    return json({ error: 'Upload not found' }, { status: 404 })
  }

  const formData = await request.formData()
  const action = formData.get('_action')

  if (action === 'approve') {

    await prisma.upload.update({
      where: { id: uploadId, shopId: shop.id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
      },
    })


    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'upload_approved',
        entityType: 'upload',
        entityId: uploadId!,
        changes: { previousStatus: upload.status },
      },
    })

    return json({ success: true, action: 'approved' })
  }

  if (action === 'reject') {
    const reason = formData.get('reason') as string

    await prisma.upload.update({
      where: { id: uploadId, shopId: shop.id },
      data: {
        status: 'rejected',
        rejectedAt: new Date(),
        preflightSummary: {
          ...(upload.preflightSummary as any),
          rejectionReason: reason,
        },
      },
    })


    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'upload_rejected',
        entityType: 'upload',
        entityId: uploadId!,
        changes: { reason, previousStatus: upload.status },
      },
    })

    return json({ success: true, action: 'rejected' })
  }

  if (action === 'continue_with_warnings') {

    await prisma.upload.update({
      where: { id: uploadId, shopId: shop.id },
      data: { status: 'approved', approvedAt: new Date() },
    })


    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'upload_approved_with_warnings',
        entityType: 'upload',
        entityId: uploadId!,
        changes: { previousStatus: upload.status },
      },
    })

    return json({ success: true, action: 'approved_with_warnings' })
  }

  return json({ error: 'Unknown action' }, { status: 400 })
}

function getStorageProviderLabel(storageKey: string): { label: string; tone: 'success' | 'info' | 'warning' } {
  if (storageKey.startsWith('r2:')) return { label: 'Cloudflare R2', tone: 'info' }
  if (storageKey.startsWith('local:')) return { label: 'Local Server', tone: 'warning' }
  if (storageKey.startsWith('bunny:')) return { label: 'Bunny CDN', tone: 'success' }
  return { label: 'Bunny CDN', tone: 'success' }
}

function PreflightBadge({ status }: { status: string }) {

  const config: Record<
    string,
    { tone: 'success' | 'warning' | 'critical' | 'info'; label: string }
  > = {
    ok: { tone: 'success', label: 'Print Ready ✓' },
    warning: { tone: 'info', label: 'Review Suggested' },
    error: { tone: 'warning', label: 'Needs Attention' },
    pending: { tone: 'info', label: 'Processing...' },
  }
  const { tone, label } = config[status] || config.pending
  return <Badge tone={tone}>{label}</Badge>
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <Icon source={CheckCircleIcon} tone="success" />
  if (status === 'warning') return <Icon source={AlertTriangleIcon} tone="base" />
  if (status === 'error') return <Icon source={AlertCircleIcon} tone="warning" />
  return null
}


function getPreflightMessage(check: {
  name: string
  status: string
  message?: string
  value?: unknown
}): { title: string; detail: string } {
  const name = check.name?.toLowerCase() || ''
  const status = check.status
  const value = check.value


  if (name.includes('dpi') || name.includes('resolution')) {
    if (status === 'ok') {
      return { title: 'Resolution', detail: 'Excellent quality for printing ✓' }
    } else if (status === 'warning') {
      return {
        title: 'Resolution',
        detail: 'Good quality - may be slightly improved with higher resolution',
      }
    } else {
      return { title: 'Resolution', detail: 'Lower resolution detected - results may vary' }
    }
  }


  if (name.includes('size') || name.includes('filesize')) {
    if (status === 'ok') {
      return { title: 'File Size', detail: 'Within optimal range ✓' }
    } else if (status === 'warning') {
      return { title: 'File Size', detail: 'Larger file - upload may take longer' }
    } else {
      return { title: 'File Size', detail: 'File may be too large' }
    }
  }


  if (name.includes('format') || name.includes('type')) {
    if (status === 'ok') {
      return { title: 'File Format', detail: 'Compatible format ✓' }
    } else {
      return { title: 'File Format', detail: check.message || 'Format check needed' }
    }
  }


  if (name.includes('transparency') || name.includes('alpha')) {
    if (status === 'ok') {
      return { title: 'Transparency', detail: 'Ready for printing ✓' }
    } else if (status === 'warning') {
      return {
        title: 'Transparency',
        detail: 'Transparent areas detected - will be handled automatically',
      }
    } else {
      return { title: 'Transparency', detail: 'Transparency settings may affect print' }
    }
  }


  if (
    name.includes('color') ||
    name.includes('profile') ||
    name.includes('cmyk') ||
    name.includes('rgb')
  ) {
    if (status === 'ok') {
      return { title: 'Colors', detail: 'Color profile ready ✓' }
    } else if (status === 'warning') {
      return { title: 'Colors', detail: 'Colors will be optimized for printing' }
    } else {
      return { title: 'Colors', detail: 'Color conversion may be applied' }
    }
  }


  if (name.includes('dimension') || name.includes('width') || name.includes('height')) {
    if (status === 'ok') {
      return { title: 'Dimensions', detail: 'Perfect size for print area ✓' }
    } else if (status === 'warning') {
      return { title: 'Dimensions', detail: 'Will be scaled to fit - quality preserved' }
    } else {
      return { title: 'Dimensions', detail: 'May need resizing' }
    }
  }


  const friendlyName =
    check.name?.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'Check'
  if (status === 'ok') {
    return { title: friendlyName, detail: 'Passed ✓' }
  } else if (status === 'warning') {
    return { title: friendlyName, detail: check.message || 'May need review' }
  } else {
    return { title: friendlyName, detail: check.message || 'Attention needed' }
  }
}

export default function UploadDetail() {
  const data = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const [rejectModalOpen, setRejectModalOpen] = useState(false)

  if ('error' in data) {
    return (
      <Page title="Error">
        <Banner tone="critical">{data.error}</Banner>
      </Page>
    )
  }

  const { upload, shopPlan } = data
  const overallStatus = (upload.preflightSummary as any)?.overall || 'pending'
  const hasWarnings = upload.items.some((i) => i.preflightStatus === 'warning')
  const hasErrors = upload.items.some((i) => i.preflightStatus === 'error')

  return (
    <Page
      title={`Upload: ${upload.id.slice(0, 8)}...`}
      backAction={{ content: 'Uploads', url: '/app/uploads' }}
      primaryAction={
        upload.status === 'needs_review' && !hasErrors
          ? {
              content: hasWarnings ? 'Approve with Warnings' : 'Approve',
              onAction: () => {
                const form = document.getElementById('approve-form') as HTMLFormElement
                form?.submit()
              },
            }
          : undefined
      }
      secondaryActions={
        upload.status === 'needs_review'
          ? [{ content: 'Reject', destructive: true, onAction: () => setRejectModalOpen(true) }]
          : []
      }
    >
      <Layout>

        {actionData && 'success' in actionData && (
          <Layout.Section>
            <Banner tone="success">
              Upload{' '}
              {actionData.action === 'approved'
                ? 'approved'
                : actionData.action === 'rejected'
                  ? 'rejected'
                  : 'updated'}{' '}
              successfully.
            </Banner>
          </Layout.Section>
        )}


        <Layout.Section>
          {hasErrors && (
            <Banner title="Attention Needed" tone="warning">
              <p>
                This upload needs customer attention before it can be approved. The customer will be
                notified to make adjustments.
              </p>
            </Banner>
          )}
          {hasWarnings && !hasErrors && (
            <Banner title="Ready for Review" tone="info">
              <p>
                This upload is ready! There are some minor suggestions that won't affect the final
                print. You can safely approve it.
              </p>
            </Banner>
          )}
          {!hasWarnings && !hasErrors && overallStatus === 'ok' && (
            <Banner title="Excellent Quality! ✓" tone="success">
              <p>This upload passed all quality checks and is ready for production.</p>
            </Banner>
          )}
        </Layout.Section>


        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Upload Info
              </Text>
              <Text as="p">ID: {upload.id}</Text>
              <Text as="p">Mode: {upload.mode}</Text>
              <InlineStack gap="200" align="start">
                <Text as="span">Status:</Text>
                <Badge
                  tone={
                    upload.status === 'approved'
                      ? 'success'
                      : upload.status === 'rejected'
                        ? 'critical'
                        : upload.status === 'blocked'
                          ? 'critical'
                          : 'attention'
                  }
                >
                  {upload.status}
                </Badge>
              </InlineStack>
              <InlineStack gap="200" align="start">
                <Text as="span">Preflight:</Text>
                <PreflightBadge status={overallStatus} />
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Created: {new Date(upload.createdAt).toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Upload Items ({upload.items.length})
              </Text>

              {upload.items.map((item) => (
                <Card key={item.id}>
                  <InlineStack gap="400" align="start" blockAlign="start">

                    <Box>
                      {item.thumbnailUrl ? (
                        <Thumbnail
                          source={item.thumbnailUrl}
                          alt={item.originalName || 'Upload'}
                          size="large"
                        />
                      ) : (
                        <Box background="bg-surface-secondary" padding="400">
                          <Text as="p" tone="subdued">
                            No preview
                          </Text>
                        </Box>
                      )}
                    </Box>


                    <BlockStack gap="200">
                      <InlineStack gap="200" align="start">
                        <Text as="h3" variant="headingSm">
                          {item.originalName || item.id}
                        </Text>
                        <PreflightBadge status={item.preflightStatus} />
                      </InlineStack>
                      <Text as="p" variant="bodySm">
                        Location: {item.location}
                      </Text>
                      <InlineStack gap="200" align="start">
                        <Text as="p" variant="bodySm">
                          Size:{' '}
                          {item.fileSize
                            ? `${(item.fileSize / 1024 / 1024).toFixed(2)} MB`
                            : 'Unknown'}
                        </Text>
                        <Badge tone={getStorageProviderLabel(item.storageKey).tone}>
                          {getStorageProviderLabel(item.storageKey).label}
                        </Badge>
                      </InlineStack>


                      {item.preflightResult?.checks && (
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            Quality Check:
                          </Text>

                          {item.preflightStatus === 'ok' && (
                            <Box padding="200" background="bg-surface-success" borderRadius="100">
                              <InlineStack gap="100">
                                <Icon source={CheckCircleIcon} tone="success" />
                                <Text as="span" variant="bodySm" tone="success">
                                  All checks passed - ready for production!
                                </Text>
                              </InlineStack>
                            </Box>
                          )}
                          {item.preflightStatus === 'warning' && (
                            <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                              <Text as="span" variant="bodySm" tone="subdued">
                                Good quality - minor suggestions below
                              </Text>
                            </Box>
                          )}

                          <BlockStack gap="100">
                            {(item.preflightResult.checks as any[]).map((check, idx) => {
                              const { title, detail } = getPreflightMessage(check)
                              return (
                                <InlineStack key={idx} gap="100" align="start">
                                  <StatusIcon status={check.status} />
                                  <Text as="span" variant="bodySm">
                                    <Text as="span" fontWeight="semibold">
                                      {title}:
                                    </Text>{' '}
                                    {detail}
                                  </Text>
                                </InlineStack>
                              )
                            })}
                          </BlockStack>
                        </BlockStack>
                      )}


                      {item.previewUrl && (
                        <Button url={item.previewUrl} external variant="plain">
                          View Full Size
                        </Button>
                      )}
                    </BlockStack>
                  </InlineStack>
                </Card>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Form method="post" id="approve-form">
          <input
            type="hidden"
            name="_action"
            value={hasWarnings ? 'continue_with_warnings' : 'approve'}
          />
        </Form>
      </Layout>


      <Modal
        open={rejectModalOpen}
        onClose={() => setRejectModalOpen(false)}
        title="Reject Upload"
        primaryAction={{
          content: 'Reject',
          destructive: true,
          onAction: () => {
            const form = document.getElementById('reject-form') as HTMLFormElement
            form?.submit()
          },
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setRejectModalOpen(false) }]}
      >
        <Modal.Section>
          <Form method="post" id="reject-form">
            <input type="hidden" name="_action" value="reject" />
            <BlockStack gap="200">
              <Text as="p">Provide a reason for rejection (optional):</Text>
              <textarea
                name="reason"
                style={{ width: '100%', minHeight: '100px', padding: '8px' }}
                placeholder="Enter rejection reason..."
              />
            </BlockStack>
          </Form>
        </Modal.Section>
      </Modal>
    </Page>
  )
}
