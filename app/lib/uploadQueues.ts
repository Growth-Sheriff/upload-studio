import type { DefaultJobOptions, JobsOptions } from 'bullmq'

export const MEASURE_PREFLIGHT_QUEUE_NAME = 'auto-gang-sheet-measure-preflight'
export const PREVIEW_RENDER_QUEUE_NAME = 'auto-gang-sheet-preview-render'
export const EXPORT_QUEUE_NAME = 'auto-gang-sheet-export'
export const LARGE_IMAGE_PIXEL_THRESHOLD = 300_000_000
export const LARGE_UPLOAD_PRELOCK_BYTES = 50 * 1024 * 1024
// Vector pages are small on disk however large they render, so the byte
// prelock never catches them; only pages up to ~22x24in at 300 DPI skip the
// large-image slot (gs + ImageMagick stay well under 1 GB each).
export const VECTOR_UNSERIALIZED_MAX_PIXELS = 50_000_000

// Upload jobs can spend minutes in ImageMagick. Keep the retry contract next
// to the queue names so every producer and worker uses the same policy. The
// longer, jittered backoff prevents a memory-starved tenant container from
// immediately starting the same large image again.
export const MEASURE_PREFLIGHT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60_000,
    jitter: 0.25,
  },
  removeOnComplete: 100,
  removeOnFail: 1000,
} satisfies DefaultJobOptions

export const PREVIEW_RENDER_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30_000,
    jitter: 0.25,
  },
  removeOnComplete: 100,
  removeOnFail: 1000,
} satisfies DefaultJobOptions

export const EXPORT_JOB_OPTIONS = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 120_000,
    jitter: 0.25,
  },
  removeOnComplete: 100,
  removeOnFail: 1000,
} satisfies DefaultJobOptions

export interface UploadPipelineJobData {
  uploadId: string
  shopId: string
  itemId: string
  storageKey: string
  mergeAttempt?: number
}

export interface PreviewMeasurementSnapshot {
  preflightStatus: string
}

/**
 * Preview workers inspect measurement state once and yield their BullMQ slot.
 * The measurement writer merges any durable thumbnail later; this helper has
 * no polling or timer so three pending previews cannot starve a fourth job.
 */
export async function inspectPreviewMeasurementOnce<T extends PreviewMeasurementSnapshot>(
  readMeasurement: () => Promise<T | null>
): Promise<{ item: T | null; pending: boolean }> {
  const item = await readMeasurement()
  return {
    item,
    pending: item?.preflightStatus === 'pending',
  }
}

/** Persist a rendered asset while measurement is pending. A failed compare-
 * and-swap means measurement or another preview changed the row, so re-read
 * instead of downloading and decoding the source again. */
export async function handoffRenderedPreview<T extends PreviewMeasurementSnapshot>(input: {
  initialItem: T | null
  persist: (item: T) => Promise<boolean>
  reread: () => Promise<T | null>
  maxAttempts?: number
}): Promise<{ item: T | null; persisted: boolean; attempts: number }> {
  const maxAttempts = Math.max(1, Math.floor(Number(input.maxAttempts) || 4))
  let item = input.initialItem

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!item || item.preflightStatus !== 'pending') {
      return { item, persisted: false, attempts: attempt - 1 }
    }
    if (await input.persist(item)) {
      return { item, persisted: true, attempts: attempt }
    }
    item = await input.reread()
  }

  return { item, persisted: false, attempts: maxAttempts }
}

export interface ExportJobData {
  exportId: string
  shopId: string
}

export function shouldSerializeLargeImage(widthPx: unknown, heightPx: unknown): boolean {
  const width = Number(widthPx)
  const height = Number(heightPx)
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width * height > LARGE_IMAGE_PIXEL_THRESHOLD
  )
}

export function shouldSerializeVectorRaster(widthPx: unknown, heightPx: unknown): boolean {
  const width = Number(widthPx)
  const height = Number(heightPx)
  const known = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  return !known || width * height > VECTOR_UNSERIALIZED_MAX_PIXELS
}

export function shouldPrelockLargeUpload(fileSize: unknown): boolean {
  const bytes = Number(fileSize)
  return Number.isFinite(bytes) && bytes >= LARGE_UPLOAD_PRELOCK_BYTES
}

export function getMeasurePreflightJobOptions(itemId: string): JobsOptions {
  return {
    ...MEASURE_PREFLIGHT_JOB_OPTIONS,
    priority: 1,
    jobId: `measure-${itemId}-v1`,
  }
}

export function getPreviewRenderJobOptions(itemId: string, mergeAttempt = 0): JobsOptions {
  return {
    ...PREVIEW_RENDER_JOB_OPTIONS,
    priority: 20,
    delay: mergeAttempt > 0 ? 5_000 : 1_500,
    jobId: `preview-${itemId}-v1-${mergeAttempt}`,
  }
}

export function getExportJobOptions(exportId: string): JobsOptions {
  return {
    ...EXPORT_JOB_OPTIONS,
    jobId: `export-${exportId}`,
  }
}

export function buildThumbnailStorageKey(
  storageKey: string,
  usedPlaceholder: boolean
): string {
  const suffix = usedPlaceholder ? '_placeholder.webp' : '_thumb.webp'
  const slashIndex = Math.max(storageKey.lastIndexOf('/'), storageKey.lastIndexOf('\\'))
  const extensionIndex = storageKey.lastIndexOf('.')
  return extensionIndex > slashIndex
    ? `${storageKey.slice(0, extensionIndex)}${suffix}`
    : `${storageKey}${suffix}`
}

/** BullMQ increments attemptsMade after the processor rejects, so the current
 * execution is final when the next value reaches the configured total. */
export function isFinalUploadJobAttempt(attemptsMade: number, configuredAttempts: unknown): boolean {
  const totalAttempts = Math.max(1, Math.floor(Number(configuredAttempts) || 1))
  return Math.max(0, Math.floor(Number(attemptsMade) || 0)) + 1 >= totalAttempts
}
