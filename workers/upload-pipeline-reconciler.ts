import { Queue } from 'bullmq'
import {
  getUploadQueueRecoveryPlan,
  normalizeUploadQueueJobState,
  resolvePreviewStatusAfterMeasurement,
  type UploadQueueJobState,
} from '../app/lib/uploadQueueRecovery'
import { deriveUploadItemLifecycle } from '../app/lib/uploadLifecycle.server'
import {
  getMeasurePreflightJobOptions,
  getPreviewRenderJobOptions,
  MEASURE_PREFLIGHT_JOB_OPTIONS,
  MEASURE_PREFLIGHT_QUEUE_NAME,
  PREVIEW_RENDER_JOB_OPTIONS,
  PREVIEW_RENDER_QUEUE_NAME,
  type UploadPipelineJobData,
} from '../app/lib/uploadQueues'
import {
  compareAndSwapUploadItemResult,
  connection,
  getResultRecord,
  prisma,
  updateUploadAggregateStatus,
  workerLog,
} from './uploadPipeline.shared'

const RECONCILE_INTERVAL_MS = 60_000
const RECONCILE_BATCH_SIZE = 100
let reconciliationCursor: string | undefined

async function ensureQueueJob(
  queue: Queue<UploadPipelineJobData>,
  name: string,
  payload: UploadPipelineJobData,
  options: ReturnType<typeof getMeasurePreflightJobOptions>
): Promise<{
  state: Exclude<UploadQueueJobState, 'missing'> | 'enqueued'
  failedReason?: string
}> {
  const jobId = options.jobId ? String(options.jobId) : ''
  const existing = jobId ? await queue.getJob(jobId) : null
  if (existing) {
    const state = normalizeUploadQueueJobState(await existing.getState())
    if (state === 'running') return { state }

    // Preview merge follow-ups and pre-rollout random-ID jobs can still be in
    // flight after the deterministic base job completes. Never terminalize
    // the database while one of those executions can still commit.
    const inFlight = await queue.getJobs(
      ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'],
      0,
      999,
      true
    )
    if (
      inFlight.some(
        (job) => job.id !== existing.id && job.name === name && job.data?.itemId === payload.itemId
      )
    ) {
      return { state: 'running' }
    }

    return {
      state,
      ...(state === 'failed' && existing.failedReason
        ? { failedReason: existing.failedReason }
        : {}),
    }
  }

  // During rollout, jobs produced by the previous release have random IDs.
  // Detect them by item payload before adding the deterministic replacement.
  const legacyJobs = await queue.getJobs(
    ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'],
    0,
    999,
    true
  )
  if (
    legacyJobs.some(
      (job) => job.name === name && job.data?.itemId === payload.itemId
    )
  ) {
    return { state: 'running' }
  }

  await queue.add(name, payload, options)
  return { state: 'enqueued' }
}

function mergeProblems(
  existing: unknown,
  next: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>()
  const candidates = Array.isArray(existing) ? existing : []
  for (const problem of [...candidates, ...next]) {
    if (!problem || typeof problem !== 'object') continue
    const value = problem as Record<string, unknown>
    const key = `${String(value.scope || 'processing')}:${String(value.code || 'unknown')}`
    merged.set(key, value)
  }
  return Array.from(merged.values())
}

async function repairUploadAggregateStatus(uploadId: string, shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  })
  await updateUploadAggregateStatus(uploadId, shopId, shop?.settings || null)
}

async function persistReconciledMeasurementFailure(input: {
  uploadId: string
  shopId: string
  itemId: string
  storageKey: string
  queueState: 'failed' | 'completed'
  failedReason?: string
}): Promise<boolean> {
  const code =
    input.queueState === 'failed' ? 'measurement_worker_exhausted' : 'measurement_result_missing'
  const message =
    input.queueState === 'failed'
      ? 'We could not finish measuring this file after multiple attempts. Please upload it again.'
      : 'Measurement ended without a durable result. Please upload the file again.'

  for (let casAttempt = 0; casAttempt < 4; casAttempt += 1) {
    const item = await prisma.uploadItem.findUnique({
      where: { id: input.itemId },
      select: {
        preflightStatus: true,
        preflightResult: true,
        thumbnailKey: true,
        previewKey: true,
      },
    })
    if (!item) return false
    if (deriveUploadItemLifecycle(item).measurementStatus !== 'pending') {
      await repairUploadAggregateStatus(input.uploadId, input.shopId)
      return false
    }

    const existingResult = getResultRecord(item.preflightResult)
    const existingStages =
      existingResult.stages && typeof existingResult.stages === 'object'
        ? (existingResult.stages as Record<string, unknown>)
        : {}
    const existingPreview =
      existingResult.preview && typeof existingResult.preview === 'object'
        ? (existingResult.preview as Record<string, unknown>)
        : {}
    const hasThumbnail = Boolean(item.thumbnailKey) || existingPreview.hasThumbnail === true
    const usedPlaceholder =
      existingPreview.usedPlaceholder === true ||
      Boolean(item.thumbnailKey?.includes('_placeholder.webp'))
    const previewStage =
      existingStages.preview && typeof existingStages.preview === 'object'
        ? (existingStages.preview as Record<string, unknown>)
        : {}
    const previewStatus = resolvePreviewStatusAfterMeasurement({
      storedStatus:
        previewStage.status === 'pending' ||
        previewStage.status === 'ready' ||
        previewStage.status === 'warning' ||
        previewStage.status === 'error'
          ? previewStage.status
          : null,
      hasThumbnail,
      usedPlaceholder,
    })
    const nextResult = {
      ...existingResult,
      overall: 'error',
      problems: mergeProblems(existingResult.problems, [
        { scope: 'processing', code, severity: 'error', message },
      ]),
      stages: {
        ...existingStages,
        measurement: { status: 'error' },
        preview: { status: previewStatus, hasThumbnail, usedPlaceholder },
        orderability: { status: 'blocked' },
      },
      capabilities: {
        canAddToCart: false,
        canResolveProduct: false,
        hasPreview: hasThumbnail,
      },
      preview: { ...existingPreview, hasThumbnail, usedPlaceholder },
      checks: [{ name: 'processing', status: 'error', message }],
    }
    const saved = await compareAndSwapUploadItemResult({
      itemId: input.itemId,
      expectedStatus: item.preflightStatus,
      expectedResult: item.preflightResult,
      nextStatus: 'error',
      nextResult,
      expectedThumbnailKey: item.thumbnailKey,
      expectedPreviewKey: item.previewKey,
      thumbnailKey: item.thumbnailKey,
      previewKey: item.previewKey || input.storageKey,
    })
    if (!saved) continue

    await repairUploadAggregateStatus(input.uploadId, input.shopId)
    workerLog.error('MEASURE_JOB_TERMINAL_STATE_RECONCILED', {
      ...input,
      failedReason: input.failedReason || null,
    })
    return true
  }

  throw new Error(`Measurement terminal state kept changing for item ${input.itemId}`)
}

async function persistReconciledPreviewState(input: {
  uploadId: string
  shopId: string
  itemId: string
  storageKey: string
  queueState: 'failed' | 'completed'
  failedReason?: string
}): Promise<boolean> {
  for (let casAttempt = 0; casAttempt < 4; casAttempt += 1) {
    const item = await prisma.uploadItem.findUnique({
      where: { id: input.itemId },
      select: {
        preflightStatus: true,
        preflightResult: true,
        thumbnailKey: true,
        previewKey: true,
      },
    })
    if (!item) return false
    const currentLifecycle = deriveUploadItemLifecycle(item)
    if (currentLifecycle.previewStatus !== 'pending') {
      await repairUploadAggregateStatus(input.uploadId, input.shopId)
      return false
    }

    const existingResult = getResultRecord(item.preflightResult)
    const existingStages =
      existingResult.stages && typeof existingResult.stages === 'object'
        ? (existingResult.stages as Record<string, unknown>)
        : {}
    const existingPreview =
      existingResult.preview && typeof existingResult.preview === 'object'
        ? (existingResult.preview as Record<string, unknown>)
        : {}
    const hasThumbnail = Boolean(item.thumbnailKey)
    const usedPlaceholder =
      existingPreview.usedPlaceholder === true ||
      Boolean(item.thumbnailKey?.includes('_placeholder.webp'))
    const previewStatus = hasThumbnail ? (usedPlaceholder ? 'warning' : 'ready') : 'warning'
    const shouldWarn = previewStatus === 'warning'
    const nextStatus = item.preflightStatus === 'ok' && shouldWarn ? 'warning' : item.preflightStatus
    const message = 'Preview generation did not finish. The original file is still preserved.'
    const provisionalResult = {
      ...existingResult,
      problems: hasThumbnail
        ? existingResult.problems
        : mergeProblems(existingResult.problems, [
            {
              scope: 'preview',
              code: 'thumbnail_generation_failed',
              severity: 'warning',
              message,
            },
          ]),
      preview: {
        ...existingPreview,
        hasThumbnail,
        usedPlaceholder,
        thumbnailGenerated: hasThumbnail && !usedPlaceholder,
        thumbnailUploaded: hasThumbnail,
      },
    }
    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: nextStatus,
      preflightResult: provisionalResult,
      thumbnailKey: item.thumbnailKey,
    })
    const nextResult = {
      ...provisionalResult,
      metadata: lifecycle.metadata,
      problems: lifecycle.problems,
      stages: {
        ...existingStages,
        measurement:
          existingStages.measurement && typeof existingStages.measurement === 'object'
            ? existingStages.measurement
            : { status: lifecycle.measurementStatus },
        preview: { status: previewStatus, hasThumbnail, usedPlaceholder },
        orderability: { status: lifecycle.orderabilityStatus },
      },
      capabilities: {
        canAddToCart: lifecycle.canAddToCart,
        canResolveProduct: lifecycle.canResolveProduct,
        hasPreview: lifecycle.hasPreview,
      },
    }
    const saved = await compareAndSwapUploadItemResult({
      itemId: input.itemId,
      expectedStatus: item.preflightStatus,
      expectedResult: item.preflightResult,
      nextStatus,
      nextResult,
      expectedThumbnailKey: item.thumbnailKey,
      expectedPreviewKey: item.previewKey,
      thumbnailKey: item.thumbnailKey,
      previewKey: item.previewKey || input.storageKey,
    })
    if (!saved) continue

    await repairUploadAggregateStatus(input.uploadId, input.shopId)
    workerLog.warn('PREVIEW_JOB_TERMINAL_STATE_RECONCILED', {
      ...input,
      repairedFromStoredThumbnail: hasThumbnail,
      failedReason: input.failedReason || null,
    })
    return true
  }

  throw new Error(`Preview terminal state kept changing for item ${input.itemId}`)
}

export async function reconcileUploadPipelineQueues(): Promise<{
  inspected: number
  measureEnqueued: number
  previewEnqueued: number
  measureTerminalized: number
  previewTerminalized: number
}> {
  const uploads = await prisma.upload.findMany({
    where: {
      status: { in: ['uploaded', 'processing', 'ready', 'pending_approval'] },
      items: {
        some: {
          OR: [
            { preflightStatus: 'pending' },
            { thumbnailKey: null },
          ],
        },
      },
    },
    select: {
      id: true,
      shopId: true,
      items: {
        select: {
          id: true,
          storageKey: true,
          preflightStatus: true,
          preflightResult: true,
          thumbnailKey: true,
          previewKey: true,
        },
      },
    },
    orderBy: { id: 'asc' },
    ...(reconciliationCursor ? { cursor: { id: reconciliationCursor }, skip: 1 } : {}),
    take: RECONCILE_BATCH_SIZE,
  })

  if (uploads.length < RECONCILE_BATCH_SIZE) {
    reconciliationCursor = undefined
  } else {
    reconciliationCursor = uploads[uploads.length - 1]?.id
  }

  if (uploads.length === 0) {
    return {
      inspected: 0,
      measureEnqueued: 0,
      previewEnqueued: 0,
      measureTerminalized: 0,
      previewTerminalized: 0,
    }
  }

  const measureQueue = new Queue<UploadPipelineJobData>(MEASURE_PREFLIGHT_QUEUE_NAME, {
    connection,
    defaultJobOptions: MEASURE_PREFLIGHT_JOB_OPTIONS,
  })
  const previewQueue = new Queue<UploadPipelineJobData>(PREVIEW_RENDER_QUEUE_NAME, {
    connection,
    defaultJobOptions: PREVIEW_RENDER_JOB_OPTIONS,
  })

  let inspected = 0
  let measureEnqueued = 0
  let previewEnqueued = 0
  let measureTerminalized = 0
  let previewTerminalized = 0

  try {
    for (const upload of uploads) {
      for (const item of upload.items) {
        inspected += 1
        const plan = getUploadQueueRecoveryPlan(item)
        if (!plan.measure && !plan.preview) continue

        const payload: UploadPipelineJobData = {
          uploadId: upload.id,
          shopId: upload.shopId,
          itemId: item.id,
          storageKey: item.storageKey,
        }

        if (plan.preview) {
          const result = await ensureQueueJob(
            previewQueue,
            'preview-render',
            payload,
            getPreviewRenderJobOptions(item.id)
          )
          if (result.state === 'enqueued') {
            previewEnqueued += 1
          } else if (result.state === 'failed' || result.state === 'completed') {
            const saved = await persistReconciledPreviewState({
              ...payload,
              queueState: result.state,
              failedReason: result.failedReason,
            })
            if (saved) previewTerminalized += 1
          }
        }

        if (plan.measure) {
          const result = await ensureQueueJob(
            measureQueue,
            'measure-preflight',
            payload,
            getMeasurePreflightJobOptions(item.id)
          )
          if (result.state === 'enqueued') {
            measureEnqueued += 1
          } else if (result.state === 'failed' || result.state === 'completed') {
            const saved = await persistReconciledMeasurementFailure({
              ...payload,
              queueState: result.state,
              failedReason: result.failedReason,
            })
            if (saved) measureTerminalized += 1
          }
        }
      }
    }
  } finally {
    await Promise.allSettled([measureQueue.close(), previewQueue.close()])
  }

  return {
    inspected,
    measureEnqueued,
    previewEnqueued,
    measureTerminalized,
    previewTerminalized,
  }
}

export function startUploadPipelineReconciler(): NodeJS.Timeout {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const result = await reconcileUploadPipelineQueues()
      if (
        result.measureEnqueued ||
        result.previewEnqueued ||
        result.measureTerminalized ||
        result.previewTerminalized
      ) {
        workerLog.info('UPLOAD_QUEUE_GAPS_REPAIRED', result)
      }
    } catch (error) {
      workerLog.error('UPLOAD_QUEUE_RECONCILE_FAILED', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  const initialTimer = setTimeout(() => void run(), 10_000)
  initialTimer.unref()
  const interval = setInterval(() => void run(), RECONCILE_INTERVAL_MS)
  interval.unref()
  return interval
}
