import { deriveUploadItemLifecycle, type UploadItemLike } from './uploadLifecycle.server'
import { isFastRasterUpload } from './fastRaster'

export interface UploadQueueRecoveryPlan {
  headerValidate: boolean
  measure: boolean
  preview: boolean
}

export interface RecoverableUploadItem extends UploadItemLike {
  mimeType?: string | null
  originalName?: string | null
}

export type UploadStageStatus = 'pending' | 'ready' | 'warning' | 'error'
export type UploadQueueJobState = 'missing' | 'running' | 'failed' | 'completed'

// Pipeline workers own only the pre-order lifecycle. Order ingestion and the
// merchant queue own every later state, so a delayed worker must preserve it.
export const PIPELINE_MUTABLE_UPLOAD_STATUSES = [
  'draft',
  'completing',
  'uploaded',
  'processing',
  'ready',
  'pending_approval',
  'blocked',
] as const

export function canPipelineUpdateUploadStatus(status: string): boolean {
  return (PIPELINE_MUTABLE_UPLOAD_STATUSES as readonly string[]).includes(status)
}

export function resolvePipelineAutoApprove(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return true
  return (settings as Record<string, unknown>).autoApprove !== false
}

export function normalizeUploadQueueJobState(value: unknown): Exclude<UploadQueueJobState, 'missing'> {
  if (value === 'failed') return 'failed'
  if (value === 'completed') return 'completed'
  // Unknown BullMQ states are treated as in-flight. Enqueuing a duplicate is
  // less safe than waiting for the next reconciliation pass.
  return 'running'
}

export function resolvePreviewStatusAfterMeasurement(input: {
  storedStatus: UploadStageStatus | null
  hasThumbnail: boolean
  usedPlaceholder: boolean
}): UploadStageStatus {
  if (!input.hasThumbnail) {
    return input.storedStatus === 'warning' || input.storedStatus === 'error'
      ? input.storedStatus
      : 'pending'
  }
  if (input.usedPlaceholder || input.storedStatus === 'warning') return 'warning'
  if (input.storedStatus === 'error') return 'error'
  return 'ready'
}

export function deriveDurablePreviewEvidence(
  thumbnailKey: string | null | undefined,
  storedPreview: unknown
): { hasThumbnail: boolean; usedPlaceholder: boolean } {
  const hasThumbnail = typeof thumbnailKey === 'string' && thumbnailKey.trim().length > 0
  const preview =
    storedPreview && typeof storedPreview === 'object'
      ? (storedPreview as Record<string, unknown>)
      : {}
  return {
    hasThumbnail,
    // JSON flags are descriptive, not proof that an asset still has a durable
    // location. A stale flag must never manufacture preview capability.
    usedPlaceholder:
      hasThumbnail &&
      (preview.usedPlaceholder === true || thumbnailKey.includes('_placeholder.webp')),
  }
}

export type MeasurementFailureTransition =
  | {
      kind: 'retry'
      message: string
      attempt: number
      maxAttempts: number
    }
  | {
      kind: 'terminal'
      code: string
      message: string
      checks: Array<Record<string, unknown>>
    }

export type MeasurementFailureProjection =
  | {
      kind: 'retry'
      preflightStatus: 'pending'
      preflightResult: Record<string, unknown>
    }
  | {
      kind: 'terminal'
      preflightStatus: 'error'
      preflightResult: Record<string, unknown>
    }

function normalizeStageStatus(value: unknown): UploadStageStatus | null {
  if (value === 'pending' || value === 'ready' || value === 'warning' || value === 'error') {
    return value
  }
  return null
}

function mergeMeasurementProblems(
  existing: unknown,
  next: Record<string, unknown>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>()
  const candidates = Array.isArray(existing) ? [...existing, next] : [next]

  for (const problem of candidates) {
    if (!problem || typeof problem !== 'object') continue
    const value = problem as Record<string, unknown>
    const key = `${String(value.scope || 'processing')}:${String(value.code || 'unknown')}:${String(value.message || '')}`
    merged.set(key, value)
  }

  return Array.from(merged.values())
}

/**
 * Projects a failed measurement execution into the durable upload shape.
 *
 * The processor catch, BullMQ failed event, and queue reconciler all converge
 * here so retries and terminal failures cannot disagree about preview state,
 * capabilities, or preservation of independently-owned stage records.
 */
export function buildMeasurementFailureProjection(input: {
  existingResult: Record<string, unknown>
  hasThumbnail: boolean
  usedPlaceholder: boolean
  transition: MeasurementFailureTransition
}): MeasurementFailureProjection {
  const existingStages =
    input.existingResult.stages && typeof input.existingResult.stages === 'object'
      ? (input.existingResult.stages as Record<string, unknown>)
      : {}
  const existingPreviewStage =
    existingStages.preview && typeof existingStages.preview === 'object'
      ? (existingStages.preview as Record<string, unknown>)
      : {}
  const existingPreview =
    input.existingResult.preview && typeof input.existingResult.preview === 'object'
      ? (input.existingResult.preview as Record<string, unknown>)
      : {}
  const previewStatus = resolvePreviewStatusAfterMeasurement({
    storedStatus: normalizeStageStatus(existingPreviewStage.status),
    hasThumbnail: input.hasThumbnail,
    usedPlaceholder: input.usedPlaceholder,
  })
  const previewStage = {
    ...existingPreviewStage,
    status: previewStatus,
    hasThumbnail: input.hasThumbnail,
    usedPlaceholder: input.usedPlaceholder,
  }
  const preview = {
    ...existingPreview,
    hasThumbnail: input.hasThumbnail,
    usedPlaceholder: input.usedPlaceholder,
  }
  const capabilities = {
    canAddToCart: false,
    canResolveProduct: false,
    hasPreview: input.hasThumbnail,
  }

  if (input.transition.kind === 'retry') {
    return {
      kind: 'retry',
      preflightStatus: 'pending',
      preflightResult: {
        ...input.existingResult,
        overall: 'processing',
        stages: {
          ...existingStages,
          measurement: {
            status: 'pending',
            retrying: true,
            attempt: input.transition.attempt,
            maxAttempts: input.transition.maxAttempts,
            lastError: input.transition.message,
          },
          preview: previewStage,
          orderability: { status: 'processing' },
        },
        capabilities,
        preview,
      },
    }
  }

  return {
    kind: 'terminal',
    preflightStatus: 'error',
    preflightResult: {
      ...input.existingResult,
      overall: 'error',
      problems: mergeMeasurementProblems(input.existingResult.problems, {
        scope: 'processing',
        code: input.transition.code,
        severity: 'error',
        message: input.transition.message,
      }),
      stages: {
        ...existingStages,
        measurement: { status: 'error' },
        preview: previewStage,
        orderability: { status: 'blocked' },
      },
      capabilities,
      preview,
      checks: input.transition.checks.map((check) => ({ ...check })),
    },
  }
}

/** A fresh ImageMagick result supersedes the retry marker written by an
 * earlier failed attempt. Preview state is preserved because that worker may
 * have completed independently. */
export function clearStoredMeasurementStage(
  preflightResult: unknown
): Record<string, unknown> {
  const result =
    preflightResult && typeof preflightResult === 'object'
      ? { ...(preflightResult as Record<string, unknown>) }
      : {}
  const stages =
    result.stages && typeof result.stages === 'object'
      ? { ...(result.stages as Record<string, unknown>) }
      : {}
  delete stages.measurement
  return { ...result, stages }
}

/**
 * Database lifecycle state is the durable source for queue recovery. Only a
 * genuinely pending stage is replayed; warning/error are terminal outcomes and
 * must not become an unbounded retry loop outside BullMQ's attempt policy.
 */
export function getUploadQueueRecoveryPlan(item: RecoverableUploadItem): UploadQueueRecoveryPlan {
  const lifecycle = deriveUploadItemLifecycle(item)
  const measurementPending = lifecycle.measurementStatus === 'pending'
  const headerValidate = measurementPending && isFastRasterUpload(item)
  return {
    headerValidate,
    measure: measurementPending && !headerValidate,
    // A stored thumbnail is already durable. The measurement worker will
    // merge it when measurement resolves; re-rendering would duplicate the
    // largest decode in the pipeline.
    preview: !item.thumbnailKey && lifecycle.previewStatus === 'pending',
  }
}
