// Merchant-facing names for upload and file-check states. The database keeps
// the technical values; every admin screen renders through this map so a
// print shop reads "Ordered – check file" instead of "needs_review".

export type BadgeTone = 'success' | 'warning' | 'critical' | 'info' | 'attention'

export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  draft: 'Uploading',
  uploaded: 'Uploaded, not ordered',
  processing: 'Checking file',
  needs_review: 'Ordered – check file',
  approved: 'Paid – ready to print',
  printing: 'Printing',
  printed: 'Printed',
  shipped: 'Shipped',
  rejected: 'Rejected',
  reupload_requested: 'New file requested',
  blocked: 'File problem',
  archived: 'Cancelled',
  error: 'Failed',
}

export const UPLOAD_STATUS_TONES: Record<string, BadgeTone> = {
  draft: 'info',
  uploaded: 'info',
  processing: 'info',
  needs_review: 'attention',
  approved: 'success',
  printing: 'info',
  printed: 'success',
  shipped: 'success',
  rejected: 'critical',
  reupload_requested: 'warning',
  blocked: 'critical',
  archived: 'info',
  error: 'critical',
}

export const PREFLIGHT_LABELS: Record<string, string> = {
  ok: 'File OK',
  warning: 'Check file',
  error: 'File problem',
  pending: 'Checking',
}

export const PREFLIGHT_TONES: Record<string, BadgeTone> = {
  ok: 'success',
  warning: 'attention',
  error: 'critical',
  pending: 'info',
}

export function uploadStatusLabel(status: string | null | undefined): string {
  return UPLOAD_STATUS_LABELS[String(status || '')] || String(status || 'Unknown')
}

export function uploadStatusTone(status: string | null | undefined): BadgeTone {
  return UPLOAD_STATUS_TONES[String(status || '')] || 'info'
}

export function preflightLabel(status: string | null | undefined): string {
  return PREFLIGHT_LABELS[String(status || '')] || String(status || 'Unknown')
}

export function preflightTone(status: string | null | undefined): BadgeTone {
  return PREFLIGHT_TONES[String(status || '')] || 'info'
}

/** Production-queue states a merchant can set by hand, in workflow order. */
export const QUEUE_STATUSES = [
  { value: 'needs_review', label: UPLOAD_STATUS_LABELS.needs_review, tone: UPLOAD_STATUS_TONES.needs_review },
  { value: 'approved', label: UPLOAD_STATUS_LABELS.approved, tone: UPLOAD_STATUS_TONES.approved },
  { value: 'printing', label: UPLOAD_STATUS_LABELS.printing, tone: UPLOAD_STATUS_TONES.printing },
  { value: 'printed', label: UPLOAD_STATUS_LABELS.printed, tone: UPLOAD_STATUS_TONES.printed },
  { value: 'shipped', label: UPLOAD_STATUS_LABELS.shipped, tone: UPLOAD_STATUS_TONES.shipped },
  { value: 'rejected', label: UPLOAD_STATUS_LABELS.rejected, tone: UPLOAD_STATUS_TONES.rejected },
  { value: 'reupload_requested', label: UPLOAD_STATUS_LABELS.reupload_requested, tone: UPLOAD_STATUS_TONES.reupload_requested },
] as const
