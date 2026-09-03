// Merchant-facing names for upload states, derived from FACTS on the upload
// row (order, payment, cart, file check) — never from the raw status string
// alone. The database keeps the technical values.
//
// Status lifecycle (who writes what):
//   draft            widget created the intent, bytes still in flight
//   processing       file landed, measurement/preflight running   (pipeline)
//   ready            file OK, auto-approve on, not ordered          (pipeline)
//   pending_approval file OK or with warnings, not ordered          (pipeline)
//   blocked          file cannot be printed                          (pipeline)
//   needs_review     ORDER placed, not paid                          (order webhook)
//   approved         paid (order webhook) or merchant approved by hand
//   printing / printed / shipped / rejected / reupload_requested   (merchant)
//   archived         order cancelled

export type BadgeTone = 'success' | 'warning' | 'critical' | 'info' | 'attention'

export interface UploadStatusFacts {
  status?: string | null
  orderId?: string | null
  orderPaidAt?: Date | string | null
  cartAddedAt?: Date | string | null
  cartToken?: string | null
}

export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  draft: 'Uploading',
  processing: 'Checking file',
  uploaded: 'Uploaded, not ordered',
  ready: 'Uploaded, not ordered',
  pending_approval: 'Uploaded, not ordered',
  in_cart: 'In cart, not ordered',
  needs_review: 'Ordered, not paid',
  approved: 'Approved',
  paid: 'Paid – ready to print',
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
  processing: 'info',
  uploaded: 'info',
  ready: 'info',
  pending_approval: 'info',
  in_cart: 'info',
  needs_review: 'attention',
  approved: 'success',
  paid: 'success',
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

const PRODUCTION_STATES = new Set(['printing', 'printed', 'shipped', 'rejected', 'reupload_requested', 'archived', 'blocked', 'error'])

/** Resolve the merchant-facing state key from the row's facts. */
export function resolveUploadState(facts: UploadStatusFacts): string {
  const status = String(facts.status || '')
  if (PRODUCTION_STATES.has(status)) return status
  if (facts.orderPaidAt) return status === 'approved' || status === 'needs_review' || !status ? 'paid' : status
  if (facts.orderId) {
    if (status === 'approved') return 'approved'
    return 'needs_review'
  }
  if (status === 'approved') return 'approved'
  if (status === 'draft' || status === 'processing') return status
  if (facts.cartAddedAt || facts.cartToken) return 'in_cart'
  return status || 'uploaded'
}

export function describeUploadStatus(facts: UploadStatusFacts): { key: string; label: string; tone: BadgeTone } {
  const key = resolveUploadState(facts)
  return { key, label: UPLOAD_STATUS_LABELS[key] || key, tone: UPLOAD_STATUS_TONES[key] || 'info' }
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
  { value: 'approved', label: 'Approved – ready to print', tone: UPLOAD_STATUS_TONES.approved },
  { value: 'printing', label: UPLOAD_STATUS_LABELS.printing, tone: UPLOAD_STATUS_TONES.printing },
  { value: 'printed', label: UPLOAD_STATUS_LABELS.printed, tone: UPLOAD_STATUS_TONES.printed },
  { value: 'shipped', label: UPLOAD_STATUS_LABELS.shipped, tone: UPLOAD_STATUS_TONES.shipped },
  { value: 'rejected', label: UPLOAD_STATUS_LABELS.rejected, tone: UPLOAD_STATUS_TONES.rejected },
  { value: 'reupload_requested', label: UPLOAD_STATUS_LABELS.reupload_requested, tone: UPLOAD_STATUS_TONES.reupload_requested },
] as const
