import { deriveUploadItemLifecycle, type UploadItemLike } from './uploadLifecycle.server'

export interface UploadQueueRecoveryPlan {
  measure: boolean
  preview: boolean
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
  if (!input.hasThumbnail) return input.storedStatus || 'pending'
  if (input.usedPlaceholder || input.storedStatus === 'warning') return 'warning'
  if (input.storedStatus === 'error') return 'error'
  return 'ready'
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
export function getUploadQueueRecoveryPlan(item: UploadItemLike): UploadQueueRecoveryPlan {
  const lifecycle = deriveUploadItemLifecycle(item)
  return {
    measure: lifecycle.measurementStatus === 'pending',
    // A stored thumbnail is already durable. The measurement worker will
    // merge it when measurement resolves; re-rendering would duplicate the
    // largest decode in the pipeline.
    preview: !item.thumbnailKey && lifecycle.previewStatus === 'pending',
  }
}
