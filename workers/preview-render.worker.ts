import { DelayedError, Job, Worker } from 'bullmq'
import path from 'path'
import { generateThumbnail } from '../app/lib/preflight.server'
import { deriveUploadItemLifecycle } from '../app/lib/uploadLifecycle.server'
import {
  buildThumbnailStorageKey,
  handoffRenderedPreview,
  inspectPreviewMeasurementOnce,
  isFinalUploadJobAttempt,
} from '../app/lib/uploadQueues'
import {
  acquireLargeImageLease,
  acquireLargeUploadPrelock,
  cleanupTempDir,
  compareAndSwapUploadItemResult,
  connection,
  createPlaceholderThumbnail,
  getResultRecord,
  LargeImageSlotBusyError,
  LARGE_IMAGE_RETRY_DELAY_MS,
  PREVIEW_RENDER_QUEUE_NAME,
  prepareUploadJobContext,
  prisma,
  rasterizeFileForProcessing,
  safeLocationForLog,
  type UploadPipelineJobData,
  updateUploadAggregateStatus,
  uploadGeneratedAsset,
  readMeasurementResolution,
  workerLog,
} from './uploadPipeline.shared'

function mergeProblems(
  existingProblems: unknown[],
  nextProblems: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>()

  for (const problem of existingProblems) {
    if (!problem || typeof problem !== 'object') continue
    const value = problem as Record<string, unknown>
    const key = `${String(value.scope || 'processing')}:${String(value.code || 'unknown')}:${String(value.message || '')}`
    merged.set(key, value)
  }

  for (const problem of nextProblems) {
    const key = `${String(problem.scope || 'processing')}:${String(problem.code || 'unknown')}:${String(problem.message || '')}`
    merged.set(key, problem)
  }

  return Array.from(merged.values())
}

type ResolvedMeasurementItem = NonNullable<
  Awaited<ReturnType<typeof readMeasurementResolution>>
>

async function persistTerminalPreviewFailure(input: {
  itemId: string
  uploadId: string
  shopId: string
  storageKey: string
  error: unknown
  casAttempt?: number
}) {
  const item = await prisma.uploadItem.findUnique({
    where: { id: input.itemId },
    select: {
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
      previewKey: true,
    },
  })
  if (!item) return

  const storedLifecycle = deriveUploadItemLifecycle(item)
  if (
    item.thumbnailKey &&
    (storedLifecycle.previewStatus === 'ready' || storedLifecycle.previewStatus === 'warning')
  ) {
    await updateUploadAggregateStatus(input.uploadId, input.shopId, null)
    return
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
  const existingProblems = Array.isArray(existingResult.problems)
    ? (existingResult.problems as unknown[])
    : []
  const nextStatus = item.preflightStatus === 'ok' ? 'warning' : item.preflightStatus
  const provisionalResult = {
    ...existingResult,
    problems: mergeProblems(existingProblems, [
      {
        scope: 'preview',
        code: 'thumbnail_generation_failed',
        severity: 'warning',
        message:
          input.error instanceof Error
            ? input.error.message
            : 'Preview generation failed. Original file is preserved.',
      },
    ]),
    preview: {
      ...existingPreview,
      hasThumbnail: Boolean(item.thumbnailKey),
      usedPlaceholder: existingPreview.usedPlaceholder === true,
      thumbnailGenerated: false,
      thumbnailUploaded: false,
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
      preview: {
        status: 'warning',
        hasThumbnail: Boolean(item.thumbnailKey),
        usedPlaceholder: existingPreview.usedPlaceholder === true,
      },
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
  if (!saved) {
    const casAttempt = (input.casAttempt || 0) + 1
    if (casAttempt > 3) throw new Error(`Preview failure merge kept changing for item ${input.itemId}`)
    return persistTerminalPreviewFailure({ ...input, casAttempt })
  }
  await updateUploadAggregateStatus(input.uploadId, input.shopId, null)
}

async function mergeRenderedPreview(input: {
  measurementItem: ResolvedMeasurementItem
  itemId: string
  uploadId: string
  shopId: string
  storageKey: string
  resolvedThumbnailKey: string
  usedPlaceholder: boolean
  thumbnailGenerated: boolean
  thumbnailUploaded: boolean
  shopSettings?: unknown
  casAttempt?: number
}) {
  const existingResult = getResultRecord(input.measurementItem.preflightResult)
  const existingStages =
    existingResult.stages && typeof existingResult.stages === 'object'
      ? (existingResult.stages as Record<string, unknown>)
      : {}
  const existingPreview =
    existingResult.preview && typeof existingResult.preview === 'object'
      ? (existingResult.preview as Record<string, unknown>)
      : {}
  const rawExistingProblems = Array.isArray(existingResult.problems)
    ? (existingResult.problems as unknown[])
    : []
  const hadTransientPreviewFailure = rawExistingProblems.some(
    (problem) =>
      Boolean(problem) &&
      typeof problem === 'object' &&
      (problem as Record<string, unknown>).code === 'thumbnail_generation_failed'
  )
  const existingProblems = rawExistingProblems.filter(
    (problem) =>
      !problem ||
      typeof problem !== 'object' ||
      (problem as Record<string, unknown>).code !== 'thumbnail_generation_failed'
  )

  const previewProblems: Array<Record<string, unknown>> = []
  if (input.usedPlaceholder) {
    previewProblems.push({
      scope: 'preview',
      code: 'thumbnail_placeholder',
      severity: 'warning',
      message:
        'A placeholder preview was generated. Original file is preserved and measurement data remains usable.',
    })
  }

  let nextPreflightStatus = input.measurementItem.preflightStatus
  const measurementStage =
    existingStages.measurement && typeof existingStages.measurement === 'object'
      ? (existingStages.measurement as Record<string, unknown>)
      : null
  const hasRemainingWarning = existingProblems.some(
    (problem) =>
      Boolean(problem) &&
      typeof problem === 'object' &&
      ((problem as Record<string, unknown>).severity === 'warning' ||
        (problem as Record<string, unknown>).severity === 'error')
  )
  const hasWarningCheck = Array.isArray(existingResult.checks)
    ? existingResult.checks.some(
        (check) =>
          Boolean(check) &&
          typeof check === 'object' &&
          ((check as Record<string, unknown>).status === 'warning' ||
            (check as Record<string, unknown>).status === 'error')
      )
    : false
  if (
    nextPreflightStatus === 'warning' &&
    hadTransientPreviewFailure &&
    measurementStage?.status === 'ready' &&
    !hasRemainingWarning &&
    !hasWarningCheck
  ) {
    nextPreflightStatus = 'ok'
  }
  if (nextPreflightStatus === 'ok' && previewProblems.length) {
    nextPreflightStatus = 'warning'
  }

  const provisionalResult = {
    ...existingResult,
    problems: mergeProblems(existingProblems, previewProblems),
    preview: {
      ...existingPreview,
      hasThumbnail: true,
      usedPlaceholder: input.usedPlaceholder,
      thumbnailGenerated: input.thumbnailGenerated,
      thumbnailUploaded: input.thumbnailUploaded,
    },
  }
  const lifecycle = deriveUploadItemLifecycle({
    preflightStatus: nextPreflightStatus,
    preflightResult: provisionalResult,
    thumbnailKey: input.resolvedThumbnailKey,
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
      preview: {
        status: input.usedPlaceholder ? 'warning' : 'ready',
        hasThumbnail: true,
        usedPlaceholder: input.usedPlaceholder,
      },
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
    expectedStatus: input.measurementItem.preflightStatus,
    expectedResult: input.measurementItem.preflightResult,
    nextStatus: nextPreflightStatus,
    nextResult,
    expectedThumbnailKey: input.measurementItem.thumbnailKey,
    expectedPreviewKey: input.measurementItem.previewKey,
    thumbnailKey: input.resolvedThumbnailKey,
    previewKey: input.measurementItem.previewKey || input.storageKey,
  })
  if (!saved) {
    const casAttempt = (input.casAttempt || 0) + 1
    if (casAttempt > 3) throw new Error(`Preview merge kept changing for item ${input.itemId}`)
    const { item: refreshed } = await inspectPreviewMeasurementOnce(() =>
      readMeasurementResolution(input.itemId)
    )
    if (!refreshed || refreshed.preflightStatus === 'pending') {
      throw new Error(`Measurement was not ready while retrying preview merge for item ${input.itemId}`)
    }
    return mergeRenderedPreview({ ...input, measurementItem: refreshed, casAttempt })
  }

  let shopSettings = input.shopSettings
  if (shopSettings === undefined) {
    const shop = await prisma.shop.findUnique({
      where: { id: input.shopId },
      select: { settings: true },
    })
    shopSettings = shop?.settings || null
  }
  const uploadStatus = await updateUploadAggregateStatus(
    input.uploadId,
    input.shopId,
    shopSettings
  )
  return { nextPreflightStatus, uploadStatus }
}

const previewRenderWorker = new Worker<UploadPipelineJobData>(
  PREVIEW_RENDER_QUEUE_NAME,
  async (job: Job<UploadPipelineJobData>) => {
    const { uploadId, shopId, itemId, storageKey: queuedStorageKey } = job.data
    let storageKey = queuedStorageKey
    const jobStartedAt = Date.now()

    workerLog.info('PREVIEW_JOB_STARTED', {
      jobId: job.id,
      uploadId,
      itemId,
      storageKey: safeLocationForLog(storageKey).substring(0, 80),
    })

    let tempDir = ''
    let largeImageLease: Awaited<ReturnType<typeof acquireLargeImageLease>> = null

    try {
      const alreadyRendered = await prisma.uploadItem.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          preflightStatus: true,
          preflightResult: true,
          thumbnailKey: true,
          previewKey: true,
          fileSize: true,
          storageKey: true,
        },
      })
      if (alreadyRendered?.storageKey) storageKey = alreadyRendered.storageKey
      if (alreadyRendered?.thumbnailKey) {
        const lifecycle = deriveUploadItemLifecycle(alreadyRendered)
        if (lifecycle.previewStatus === 'ready' || lifecycle.previewStatus === 'warning') {
          await updateUploadAggregateStatus(uploadId, shopId, null)
          workerLog.info('PREVIEW_JOB_SKIPPED_ALREADY_READY', {
            jobId: job.id,
            uploadId,
            itemId,
          })
          return { skipped: true, thumbnailKey: alreadyRendered.thumbnailKey }
        }
      }

      // Follow-up jobs exist only to merge an already-rendered preview after a
      // slow measurement. Reuse the row read above and yield immediately while
      // measurement is pending: polling here would occupy all three preview
      // concurrency slots and starve unrelated renders.
      if ((job.data.mergeAttempt || 0) > 0) {
        const { item: measurementBeforeRender, pending: measurementPending } =
          await inspectPreviewMeasurementOnce(async () => alreadyRendered)
        if (
          measurementPending &&
          measurementBeforeRender?.thumbnailKey
        ) {
          workerLog.warn('PREVIEW_MERGE_WAITING_FOR_MEASUREMENT', {
            jobId: job.id,
            uploadId,
            itemId,
            mergeAttempt: job.data.mergeAttempt || 0,
          })
          // The rendered thumbnail is already durable. The measurement worker
          // reads and merges that key when it commits, so this legacy follow-up
          // can release its slot without scheduling another queue start.
          return {
            status: 'pending',
            deferredBeforeRender: true,
          }
        }
        if (measurementBeforeRender?.thumbnailKey) {
          const existingResult = getResultRecord(measurementBeforeRender.preflightResult)
          const existingPreview =
            existingResult.preview && typeof existingResult.preview === 'object'
              ? (existingResult.preview as Record<string, unknown>)
              : {}
          const usedPlaceholder =
            existingPreview.usedPlaceholder === true ||
            measurementBeforeRender.thumbnailKey.includes('_placeholder.webp')
          const merged = await mergeRenderedPreview({
            measurementItem: measurementBeforeRender,
            itemId,
            uploadId,
            shopId,
            storageKey,
            resolvedThumbnailKey: measurementBeforeRender.thumbnailKey,
            usedPlaceholder,
            thumbnailGenerated: true,
            thumbnailUploaded: true,
          })
          workerLog.info('PREVIEW_MERGED_WITHOUT_RERENDER', {
            jobId: job.id,
            uploadId,
            itemId,
            mergeAttempt: job.data.mergeAttempt || 0,
            uploadStatus: merged.uploadStatus,
          })
          return {
            status: merged.nextPreflightStatus,
            thumbnailKey: measurementBeforeRender.thumbnailKey,
            usedPlaceholder,
            reusedRenderedPreview: true,
          }
        }
      }

      try {
        largeImageLease = await acquireLargeUploadPrelock(itemId, alreadyRendered?.fileSize)
      } catch (error) {
        if (!(error instanceof LargeImageSlotBusyError)) throw error
        await job.moveToDelayed(Date.now() + LARGE_IMAGE_RETRY_DELAY_MS, job.token)
        workerLog.info('LARGE_IMAGE_JOB_DELAYED', {
          jobId: job.id,
          uploadId,
          itemId,
          delayMs: LARGE_IMAGE_RETRY_DELAY_MS,
        })
        throw new DelayedError()
      }

      const context = await prepareUploadJobContext(job.data, 'preview-render')
      tempDir = context.tempDir
      storageKey = context.storageKey
      if (!largeImageLease) {
        try {
          largeImageLease = await acquireLargeImageLease(
            context.originalPath,
            itemId,
            context.detectedType
          )
        } catch (error) {
          if (!(error instanceof LargeImageSlotBusyError)) throw error
          await job.moveToDelayed(Date.now() + LARGE_IMAGE_RETRY_DELAY_MS, job.token)
          workerLog.info('LARGE_IMAGE_JOB_DELAYED', {
            jobId: job.id,
            uploadId,
            itemId,
            delayMs: LARGE_IMAGE_RETRY_DELAY_MS,
          })
          throw new DelayedError()
        }
      }

      await job.updateProgress(20)

      const rasterized = await rasterizeFileForProcessing(
        context.originalPath,
        context.tempDir,
        context.detectedType,
        context.storageKey
      )

      await job.updateProgress(45)

      const thumbnailPath = path.join(context.tempDir, 'thumbnail.webp')
      let thumbnailGenerated = false
      let thumbnailUploaded = false
      let usedPlaceholder = false

      if (rasterized.conversionFailed) {
        usedPlaceholder = true
        thumbnailGenerated = await createPlaceholderThumbnail(
          thumbnailPath,
          rasterized.fileTypeLabel,
          400
        )
      } else {
        try {
          await generateThumbnail(rasterized.processedPath, thumbnailPath, 400)
          thumbnailGenerated = true
        } catch (error) {
          workerLog.warn('PREVIEW_THUMBNAIL_GENERATION_FAILED', {
            itemId,
            error: error instanceof Error ? error.message : String(error),
          })
          usedPlaceholder = true
          thumbnailGenerated = await createPlaceholderThumbnail(
            thumbnailPath,
            rasterized.fileTypeLabel,
            400
          )
        }
      }

      let generatedThumbnailKey: string | null = null
      if (thumbnailGenerated) {
        generatedThumbnailKey = buildThumbnailStorageKey(storageKey, usedPlaceholder)

        try {
          await uploadGeneratedAsset(
            context.storageProvider,
            generatedThumbnailKey,
            thumbnailPath,
            'image/webp'
          )
          thumbnailUploaded = true
        } catch (error) {
          workerLog.error('PREVIEW_THUMBNAIL_UPLOAD_FAILED', {
            itemId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      await job.updateProgress(70)

      // Rendering is the memory-heavy phase. Do not hold the cross-process
      // lease while waiting for measurement, or preview can block the measure
      // job whose result it is waiting to merge.
      if (largeImageLease) {
        await largeImageLease.release()
        largeImageLease = null
      }

      const { item: measurementItem, pending: measurementPending } =
        await inspectPreviewMeasurementOnce(() => readMeasurementResolution(itemId))
      const resolvedThumbnailKey =
        thumbnailGenerated && thumbnailUploaded ? generatedThumbnailKey : measurementItem?.thumbnailKey || null

      if (!resolvedThumbnailKey) {
        throw new Error(
          'Preview thumbnail could not be stored. Original file is preserved and measurement data remains usable.'
        )
      }

      if (!measurementItem) {
        throw new Error(`Upload item disappeared before preview could be stored: ${itemId}`)
      }

      if (measurementPending) {
        const handoff = await handoffRenderedPreview({
          initialItem: measurementItem,
          persist: async (pendingItem) => {
            return compareAndSwapUploadItemResult({
              itemId,
              expectedStatus: pendingItem.preflightStatus,
              expectedResult: pendingItem.preflightResult,
              nextStatus: pendingItem.preflightStatus,
              nextResult: getResultRecord(pendingItem.preflightResult),
              expectedThumbnailKey: pendingItem.thumbnailKey,
              expectedPreviewKey: pendingItem.previewKey,
              thumbnailKey: resolvedThumbnailKey,
              previewKey: pendingItem.previewKey || storageKey,
            })
          },
          reread: () => readMeasurementResolution(itemId),
        })

        workerLog.warn('PREVIEW_MERGE_DEFERRED', {
          itemId,
          uploadId,
          persisted: handoff.persisted,
          handoffAttempts: handoff.attempts,
          resolvedThumbnailKey: resolvedThumbnailKey?.substring(0, 60) || null,
        })

        if (handoff.persisted) {
          return {
            status: 'pending',
            thumbnailKey: resolvedThumbnailKey,
          }
        }
        if (!handoff.item) {
          throw new Error(`Upload item disappeared during preview handoff: ${itemId}`)
        }
        if (handoff.item.preflightStatus === 'pending') {
          if (handoff.item.thumbnailKey) {
            return {
              status: 'pending',
              thumbnailKey: handoff.item.thumbnailKey,
              previewPersistedByOther: true,
            }
          }
          throw new Error(`Preview handoff kept changing for item ${itemId}`)
        }

        const mergedAfterRace = await mergeRenderedPreview({
          measurementItem: handoff.item,
          itemId,
          uploadId,
          shopId,
          storageKey,
          resolvedThumbnailKey,
          usedPlaceholder,
          thumbnailGenerated,
          thumbnailUploaded,
          shopSettings: context.shop.settings,
        })
        return {
          status: mergedAfterRace.nextPreflightStatus,
          thumbnailKey: resolvedThumbnailKey,
          mergedAfterMeasurementRace: true,
        }
      }

      const merged = await mergeRenderedPreview({
        measurementItem,
        itemId,
        uploadId,
        shopId,
        storageKey,
        resolvedThumbnailKey,
        usedPlaceholder,
        thumbnailGenerated,
        thumbnailUploaded,
        shopSettings: context.shop.settings,
      })

      await job.updateProgress(90)

      await job.updateProgress(100)

      workerLog.info('PREVIEW_JOB_COMPLETED', {
        jobId: job.id,
        uploadId,
        itemId,
        uploadStatus: merged.uploadStatus,
        resolvedThumbnailKey: resolvedThumbnailKey?.substring(0, 60) || null,
        usedPlaceholder,
        durationMs: Date.now() - jobStartedAt,
      })

      return {
        status: merged.nextPreflightStatus,
        thumbnailKey: resolvedThumbnailKey,
        usedPlaceholder,
      }
    } catch (error) {
      if (error instanceof DelayedError) throw error
      const { item: measurementItem, pending: measurementPending } =
        await inspectPreviewMeasurementOnce(() => readMeasurementResolution(itemId))

      if (measurementPending && measurementItem?.thumbnailKey) {
        workerLog.warn('PREVIEW_JOB_YIELDED_AFTER_ERROR', {
          jobId: job.id,
          uploadId,
          itemId,
          error: error instanceof Error ? error.message : String(error),
        })

        return {
          status: 'pending',
          durableThumbnailPreserved: true,
        }
      }

      if (isFinalUploadJobAttempt(job.attemptsMade, job.opts.attempts)) {
        await persistTerminalPreviewFailure({ itemId, uploadId, shopId, storageKey, error })
      }

      workerLog.error('PREVIEW_JOB_FAILED', {
        jobId: job.id,
        uploadId,
        itemId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - jobStartedAt,
      })

      throw error
    } finally {
      if (largeImageLease) {
        await largeImageLease.release().catch((error) =>
          workerLog.error('LARGE_IMAGE_LOCK_RELEASE_FAILED', {
            itemId,
            error: error instanceof Error ? error.message : String(error),
          })
        )
      }
      if (tempDir) {
        await cleanupTempDir(tempDir)
      }
    }
  },
  {
    connection,
    concurrency: 3,
    limiter: {
      max: 20,
      duration: 60000,
    },
  }
)

previewRenderWorker.on('completed', (job) => {
  console.log(`[Preview Render Worker] Job ${job.id} completed`)
})

previewRenderWorker.on('failed', async (job, err) => {
  console.error(`[Preview Render Worker] Job ${job?.id} failed:`, err.message)
  if (!job) return
  const configuredAttempts = Math.max(1, Number(job.opts.attempts) || 1)
  const exhaustedAttempts = job.attemptsMade >= configuredAttempts
  const exhaustedStalls = /stalled more than allowable limit/i.test(err.message)
  if (!exhaustedAttempts && !exhaustedStalls) return
  await persistTerminalPreviewFailure({
    itemId: job.data.itemId,
    uploadId: job.data.uploadId,
    shopId: job.data.shopId,
    storageKey: job.data.storageKey,
    error: err,
  }).catch((persistError) =>
    workerLog.error('PREVIEW_JOB_TERMINAL_STATE_PERSIST_FAILED', {
      jobId: job.id,
      itemId: job.data.itemId,
      error: persistError instanceof Error ? persistError.message : String(persistError),
    })
  )
})

console.log('[Preview Render Worker] Started and waiting for jobs...')

export default previewRenderWorker
