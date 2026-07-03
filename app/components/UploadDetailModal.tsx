import { useEffect, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineStack,
  Modal,
  Spinner,
  Text,
  Thumbnail,
  FormLayout,
  TextField
} from '@shopify/polaris';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon } from '@shopify/polaris-icons';



function getStorageProviderLabel(storageKey: string): { label: string; tone: 'success' | 'info' | 'warning' } {
  if (storageKey?.startsWith('r2:')) return { label: 'Cloudflare R2', tone: 'info' }
  if (storageKey?.startsWith('local:')) return { label: 'Local Server', tone: 'warning' }
  if (storageKey?.startsWith('bunny:')) return { label: 'Bunny CDN', tone: 'success' }
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

  if (name.includes('dpi') || name.includes('resolution')) {
    if (status === 'ok') return { title: 'Resolution', detail: 'Excellent quality for printing ✓' }
    if (status === 'warning') return { title: 'Resolution', detail: 'Good quality - may be slightly improved' }
    return { title: 'Resolution', detail: 'Lower resolution detected' }
  }
  if (name.includes('size') || name.includes('filesize')) {
    if (status === 'ok') return { title: 'File Size', detail: 'Within optimal range ✓' }
    if (status === 'warning') return { title: 'File Size', detail: 'Larger file - upload may take longer' }
    return { title: 'File Size', detail: 'File may be too large' }
  }
  if (name.includes('format') || name.includes('type')) {
    if (status === 'ok') return { title: 'File Format', detail: 'Compatible format ✓' }
    return { title: 'File Format', detail: check.message || 'Format check needed' }
  }
  if (name.includes('transparency') || name.includes('alpha')) {
    if (status === 'ok') return { title: 'Transparency', detail: 'Ready for printing ✓' }
    if (status === 'warning') return { title: 'Transparency', detail: 'Transparent areas detected' }
    return { title: 'Transparency', detail: 'Transparency settings may affect print' }
  }
  if (name.includes('color') || name.includes('profile')) {
    if (status === 'ok') return { title: 'Colors', detail: 'Color profile ready ✓' }
    if (status === 'warning') return { title: 'Colors', detail: 'Colors will be optimized for printing' }
    return { title: 'Colors', detail: 'Color conversion may be applied' }
  }
  if (name.includes('dimension') || name.includes('width') || name.includes('height')) {
    if (status === 'ok') return { title: 'Dimensions', detail: 'Perfect size for print area ✓' }
    if (status === 'warning') return { title: 'Dimensions', detail: 'Will be scaled to fit' }
    return { title: 'Dimensions', detail: 'May need resizing' }
  }

  const friendlyName = check.name?.replace(/_/g, ' ').replace(/^\w/, (c: string) => c.toUpperCase()) || 'Check'
  if (status === 'ok') return { title: friendlyName, detail: 'Passed ✓' }
  if (status === 'warning') return { title: friendlyName, detail: check.message || 'May need review' }
  return { title: friendlyName, detail: check.message || 'Attention needed' }
}

export function UploadDetailModal({ uploadId, onClose }: { uploadId: string | null; onClose: () => void }) {
  const fetcher = useFetcher<any>();
  const actionFetcher = useFetcher<any>();
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');


  useEffect(() => {
    if (uploadId) {

      fetcher.load(`/app/uploads/${uploadId}`);
      setRejectMode(false);
      setRejectReason('');
    }
  }, [uploadId]);


  useEffect(() => {
    if (actionFetcher.data?.success) {
      onClose();
    }
  }, [actionFetcher.data]);

  const handleAction = (actionName: string) => {
    if (!uploadId) return;

    const formData = new FormData();
    formData.append('_action', actionName);
    if (actionName === 'reject') {
        formData.append('reason', rejectReason);
    }

    actionFetcher.submit(formData, {
        method: 'post',
        action: `/app/uploads/${uploadId}`
    });
  };

  if (!uploadId) return null;

  const data = fetcher.data;
  const isLoading = fetcher.state === 'loading';

  if (isLoading && !data) {
    return (
        <Modal open={!!uploadId} onClose={onClose} title="Loading Upload..." loading>
            <Modal.Section>
                <div style={{display: 'flex', justifyContent: 'center', padding: '2rem'}}>
                    <Spinner size="large" />
                </div>
            </Modal.Section>
        </Modal>
    )
  }

  if (!data || data.error) {
     return (
        <Modal open={!!uploadId} onClose={onClose} title="Error">
            <Modal.Section>
                <Banner tone="critical">
                    {data?.error || 'Failed to load upload details.'}
                </Banner>
            </Modal.Section>
        </Modal>
     )
  }

  const { upload } = data;
  const overallStatus = (upload.preflightSummary as any)?.overall || 'pending';
  const hasWarnings = upload.items.some((i: any) => i.preflightStatus === 'warning');
  const hasErrors = upload.items.some((i: any) => i.preflightStatus === 'error');


  const primaryAction = !rejectMode && upload.status === 'needs_review' && !hasErrors
      ? {
          content: hasWarnings ? 'Approve with Warnings' : 'Approve',
          onAction: () => handleAction(hasWarnings ? 'continue_with_warnings' : 'approve'),
          loading: actionFetcher.state === 'submitting'
        }
      : rejectMode
        ? {
            content: 'Confirm Reject',
            destructive: true,
            onAction: () => handleAction('reject'),
            loading: actionFetcher.state === 'submitting'
        }
        : undefined;

  const secondaryActions = [] as any[];

  if (!rejectMode && upload.status === 'needs_review') {
      secondaryActions.push({
          content: 'Reject',
          destructive: true,
          onAction: () => setRejectMode(true)
      });
  } else if (rejectMode) {
      secondaryActions.push({
          content: 'Cancel',
          onAction: () => setRejectMode(false)
      });
  }


  if (!primaryAction && secondaryActions.length === 0) {
      secondaryActions.push({ content: 'Close', onAction: onClose });
  }


  return (
    <Modal
      open={!!uploadId}
      onClose={onClose}
      title={rejectMode ? "Reject Upload" : `Upload: ${upload.id.substring(0, 8)}`}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
      size="large"
    >
        {rejectMode ? (
            <Modal.Section>
                <Text as="p" tone="subdued">Provide a reason for rejection (optional):</Text>
                <div style={{ marginTop: '1rem' }}>
                    <TextField
                        label="Reason"
                        value={rejectReason}
                        onChange={setRejectReason}
                        multiline={4}
                        autoComplete="off"
                    />
                </div>
            </Modal.Section>
        ) : (
            <>
                <Modal.Section>

                    <BlockStack gap="400">
                        {hasErrors && (
                            <Banner title="Attention Needed" tone="warning">
                                <p>Customer attention needed before approval.</p>
                            </Banner>
                        )}
                        {hasWarnings && !hasErrors && (
                            <Banner title="Ready for Review" tone="info">
                                <p>Minor suggestions, but ready for print.</p>
                            </Banner>
                        )}
                        {!hasWarnings && !hasErrors && overallStatus === 'ok' && (
                            <Banner title="Excellent Quality! ✓" tone="success">
                                <p>Ready for production.</p>
                            </Banner>
                        )}


                        <InlineStack gap="400" wrap={false}>
                             <Card>
                                <BlockStack gap="200">
                                    <Text as="h2" variant="headingSm">Details</Text>
                                    <Text as="p" variant="bodySm">ID: {upload.id}</Text>
                                    <Text as="p" variant="bodySm">Mode: {upload.mode}</Text>
                                    <Text as="p" variant="bodySm">Date: {new Date(upload.createdAt).toLocaleDateString()}</Text>
                                </BlockStack>
                             </Card>
                             <Card>
                                 <BlockStack gap="200">
                                     <Text as="h2" variant="headingSm">Status</Text>
                                     <Badge tone={upload.status === 'approved' ? 'success' : upload.status === 'rejected' ? 'critical' : 'attention'}>
                                         {upload.status}
                                     </Badge>
                                 </BlockStack>
                             </Card>
                        </InlineStack>
                    </BlockStack>
                </Modal.Section>


                <Modal.Section>
                     <BlockStack gap="400">
                         <Text as="h3" variant="headingMd">Files ({upload.items.length})</Text>
                         {upload.items.map((item: any) => (
                             <Card key={item.id}>
                                 <InlineStack gap="400" align="start" wrap={false}>

                                     {item.thumbnailUrl ? (
                                         <Thumbnail source={item.thumbnailUrl} alt={item.originalName || 'Upload'} size="large" />
                                     ) : (
                                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                                            <Icon source={AlertCircleIcon} />
                                        </Box>
                                     )}


                                     <BlockStack gap="200" align="start">
                                         <Text as="h4" variant="headingSm">{item.originalName || 'Unknown File'}</Text>
                                         <InlineStack gap="200">
                                             <PreflightBadge status={item.preflightStatus} />
                                             <Badge>{item.location}</Badge>
                                             <Badge tone={getStorageProviderLabel(item.storageKey).tone}>
                                                {getStorageProviderLabel(item.storageKey).label}
                                             </Badge>
                                         </InlineStack>

                                         {item.fileSize && (
                                             <Text as="p" variant="bodySm" tone="subdued">
                                                 {(item.fileSize / 1024 / 1024).toFixed(2)} MB
                                             </Text>
                                         )}


                                         {item.preflightResult?.checks && (
                                            <Box padding="200" background="bg-surface-secondary" borderRadius="200" width="100%">
                                                <BlockStack gap="200">
                                                    {(item.preflightResult.checks as any[]).map((check, idx) => {
                                                        const { title, detail } = getPreflightMessage(check);
                                                        return (
                                                            <InlineStack key={idx} gap="200">
                                                                <StatusIcon status={check.status} />
                                                                <Text as="p" variant="bodySm"><strong>{title}:</strong> {detail}</Text>
                                                            </InlineStack>
                                                        )
                                                    })}
                                                </BlockStack>
                                            </Box>
                                         )}

                                         {item.previewUrl && (
                                             <Button url={item.previewUrl} external variant="plain">View Original</Button>
                                         )}
                                     </BlockStack>
                                 </InlineStack>
                             </Card>
                         ))}
                     </BlockStack>
                </Modal.Section>
            </>
        )}
    </Modal>
  );
}
