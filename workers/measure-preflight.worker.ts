import { DelayedError, Job, Queue, Worker } from 'bullmq'
import { runPreflightChecks } from '../app/lib/preflight.server'
import { deriveUploadItemLifecycle } from '../app/lib/uploadLifecycle.server'
import { isFastRasterUpload } from '../app/lib/fastRaster'
import { ensureStoredRasterHeaderMeasurement } from '../app/lib/storedRasterHeader.server'
import {
  isFinalUploadJobAttempt,
  MEASURE_PREFLIGHT_JOB_OPTIONS,
} from '../app/lib/uploadQueues'
import {
  buildMeasurementFailureProjection,
  clearStoredMeasurementStage,
  deriveDurablePreviewEvidence,
  resolvePreviewStatusAfterMeasurement,
} from '../app/lib/uploadQueueRecovery'
import {
  acquireLargeImageLease,
  acquireLargeUploadPrelock,
  cleanupTempDir,
  compareAndSwapUploadItemResult,
  connection,
  getResultRecord,
  LargeImageSlotBusyError,
  LARGE_IMAGE_RETRY_DELAY_MS,
  MEASURE_PREFLIGHT_QUEUE_NAME,
  prepareUploadJobContext,
  prisma,
  rasterizeFileForProcessing,
  safeLocationForLog,
  type UploadPipelineJobData,
  updateUploadAggregateStatus,
  workerLog,
} from './uploadPipeline.shared'
import { startUploadPipelineReconciler } from './upload-pipeline-reconciler'

function normalizeStageStatus(value: unknown): 'pending' | 'ready' | 'warning' | 'error' | null {
  if (value === 'pending' || value === 'ready' || value === 'warning' || value === 'error') {
    return value
  }
  return null
}

async function repairUploadAggregateStatus(uploadId: string, shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  })
  await updateUploadAggregateStatus(uploadId, shopId, shop?.settings || null)
}

export const measurePreflightQueue = new Queue<UploadPipelineJobData>(MEASURE_PREFLIGHT_QUEUE_NAME, {
  connection,
  defaultJobOptions: MEASURE_PREFLIGHT_JOB_OPTIONS,
})

const measurePreflightWorker = new Worker<UploadPipelineJobData>(
  MEASURE_PREFLIGHT_QUEUE_NAME,
  async (job: Job<UploadPipelineJobData>) => {
    const { uploadId, shopId, itemId, storageKey: queuedStorageKey } = job.data
    let storageKey = queuedStorageKey
    const jobStartedAt = Date.now()

    workerLog.info('MEASURE_JOB_STARTED', {
      jobId: job.id,
      uploadId,
      itemId,
      storageKey: safeLocationForLog(storageKey).substring(0, 80),
    })

    let tempDir = ''
    let largeImageLease: Awaited<ReturnType<typeof acquireLargeImageLease>> = null

    try {
      // Check stored state on every execution. BullMQ stalls do not increment
      // attemptsMade, and a duplicate deterministic job also starts at zero.
      const alreadyMeasured = await prisma.uploadItem.findUnique({
        where: { id: itemId },
        select: {
          preflightStatus: true,
          preflightResult: true,
          thumbnailKey: true,
          fileSize: true,
          storageKey: true,
          originalName: true,
          mimeType: true,
        },
      })
      if (alreadyMeasured?.storageKey) storageKey = alreadyMeasured.storageKey
      const alreadyMeasuredLifecycle = alreadyMeasured
        ? deriveUploadItemLifecycle(alreadyMeasured)
        : null
      if (alreadyMeasuredLifecycle?.measurementStatus === 'ready') {
        workerLog.info('MEASURE_JOB_SKIPPED_ALREADY_READY', {
          jobId: job.id,
          uploadId,
          itemId,
          attempt: job.attemptsMade,
        })
        // The previous execution may have committed the item result and then
        // died before updating the parent upload. Repairing is idempotent and
        // prevents a measured upload from remaining "processing" forever.
        await repairUploadAggregateStatus(uploadId, shopId)
        return { skipped: true }
      }

      // Drain jobs queued by an older app process without downloading or
      // decoding PNG/JPEG. The bounded stored-header validator owns this path.
      if (alreadyMeasured && isFastRasterUpload(alreadyMeasured)) {
        const validated = await ensureStoredRasterHeaderMeasurement({
          uploadId,
          shopId,
          itemId,
        })
        workerLog.info('MEASURE_JOB_REPLACED_BY_HEADER_VALIDATION', {
          jobId: job.id,
          uploadId,
          itemId,
          status: validated.item?.preflightStatus || 'missing',
        })
        return { skipped: true, headerValidated: true }
      }

      try {
        largeImageLease = await acquireLargeUploadPrelock(itemId, alreadyMeasured?.fileSize)
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

      const context = await prepareUploadJobContext(job.data, 'measure-preflight')
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

      // A legacy/random-ID execution may have completed while this job was
      // downloading or waiting for the large-image slot. Recheck immediately
      // before the expensive raster/decode phase.
      const measuredWhileWaiting = await prisma.uploadItem.findUnique({
        where: { id: itemId },
        select: { preflightStatus: true, preflightResult: true, thumbnailKey: true },
      })
      if (
        measuredWhileWaiting &&
        deriveUploadItemLifecycle(measuredWhileWaiting).measurementStatus === 'ready'
      ) {
        await repairUploadAggregateStatus(uploadId, shopId)
        return { skipped: true, measuredWhileWaiting: true }
      }

      await job.updateProgress(20)

      const rasterized = await rasterizeFileForProcessing(
        context.originalPath,
        context.tempDir,
        context.detectedType,
        context.storageKey
      )

      await job.updateProgress(45)

      let result = await runPreflightChecks(
        rasterized.processedPath,
        context.detectedType || '',
        context.fileSize,
        context.config
      )

      if (rasterized.conversionFailed) {
        result.checks.push({
          name: 'conversion',
          status: 'warning',
          message: `File preview could not be generated: ${rasterized.conversionError || 'Unknown error'}. Original file is preserved and downloadable.`,
          details: {
            fileType: rasterized.fileTypeLabel,
            reason: rasterized.conversionError,
            originalPreserved: true,
          },
        })

        if (result.overall === 'ok') {
          result.overall = 'warning'
        }

        workerLog.warn('MEASURE_CONVERSION_WARNING', {
          itemId,
          fileType: rasterized.fileTypeLabel,
          error: rasterized.conversionError,
        })
      }

      await job.updateProgress(70)

      let measurementSaved = false
      let measurementCommittedByOther = false
      for (let casAttempt = 0; casAttempt < 4; casAttempt += 1) {
        const latestItem = await prisma.uploadItem.findUnique({
          where: { id: itemId },
          select: {
            preflightStatus: true,
            preflightResult: true,
            thumbnailKey: true,
            previewKey: true,
          },
        })

        if (!latestItem) {
          throw new Error(`Upload item not found during measurement merge: ${itemId}`)
        }
        if (deriveUploadItemLifecycle(latestItem).measurementStatus === 'ready') {
          measurementCommittedByOther = true
          break
        }

        const existingResult = getResultRecord(latestItem.preflightResult)
        const existingStages =
          existingResult.stages && typeof existingResult.stages === 'object'
            ? (existingResult.stages as Record<string, unknown>)
            : {}
        const existingPreview =
          existingResult.preview && typeof existingResult.preview === 'object'
            ? (existingResult.preview as Record<string, unknown>)
            : {}
        const provisionalResult = {
          ...clearStoredMeasurementStage(existingResult),
          overall: result.overall,
          checks: result.checks,
        }
        const lifecycle = deriveUploadItemLifecycle({
          preflightStatus: result.overall,
          preflightResult: provisionalResult,
          thumbnailKey: latestItem.thumbnailKey,
        })
        const storedPreviewStage =
          existingStages.preview && typeof existingStages.preview === 'object'
            ? (existingStages.preview as Record<string, unknown>)
            : {}
        const storedPreviewStatus = normalizeStageStatus(storedPreviewStage.status)
        const {
          hasThumbnail: previewHasThumbnail,
          usedPlaceholder: previewUsedPlaceholder,
        } = deriveDurablePreviewEvidence(latestItem.thumbnailKey, existingPreview)
        // A durable thumbnail supersedes an old pending retry marker. Preserve
        // warning/error, but never leave preview pending when the asset exists.
        const previewStatus = resolvePreviewStatusAfterMeasurement({
          storedStatus: storedPreviewStatus,
          hasThumbnail: previewHasThumbnail,
          usedPlaceholder: previewUsedPlaceholder,
        })
        const nextPreflightResult = {
          ...provisionalResult,
          metadata: lifecycle.metadata,
          problems: lifecycle.problems,
          stages: {
            ...existingStages,
            measurement: { status: lifecycle.measurementStatus },
            preview: {
              status: previewStatus,
              hasThumbnail: previewHasThumbnail,
              usedPlaceholder: previewUsedPlaceholder,
            },
            orderability: { status: lifecycle.orderabilityStatus },
          },
          capabilities: {
            canAddToCart: lifecycle.canAddToCart,
            canResolveProduct: lifecycle.canResolveProduct,
            hasPreview: previewHasThumbnail,
          },
          preview: {
            ...existingPreview,
            hasThumbnail: previewHasThumbnail,
            usedPlaceholder: previewUsedPlaceholder,
          },
        }

        measurementSaved = await compareAndSwapUploadItemResult({
          itemId,
          expectedStatus: latestItem.preflightStatus,
          expectedResult: latestItem.preflightResult,
          nextStatus: result.overall,
          nextResult: nextPreflightResult,
          expectedThumbnailKey: latestItem.thumbnailKey,
          expectedPreviewKey: latestItem.previewKey,
          thumbnailKey: latestItem.thumbnailKey,
          previewKey: latestItem.previewKey || storageKey,
        })
        if (measurementSaved) break
      }

      if (measurementCommittedByOther) {
        await repairUploadAggregateStatus(uploadId, shopId)
        return { skipped: true, measurementCommittedByOther: true }
      }
      if (!measurementSaved) {
        throw new Error(`Measurement merge kept changing for item ${itemId}`)
      }

      await job.updateProgress(90)

      const uploadStatus = await updateUploadAggregateStatus(uploadId, shopId, context.shop.settings)

      await job.updateProgress(100)

      workerLog.info('MEASURE_JOB_COMPLETED', {
        jobId: job.id,
        uploadId,
        itemId,
        result: result.overall,
        uploadStatus,
        durationMs: Date.now() - jobStartedAt,
      })

      return {
        status: result.overall,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof DelayedError) throw error
      const latestItem = await prisma.uploadItem.findUnique({
        where: { id: itemId },
        select: {
          preflightStatus: true,
          thumbnailKey: true,
          previewKey: true,
          preflightResult: true,
        },
      })

      // The expensive measurement may already be committed by this execution
      // (with only a progress/aggregate update failing afterward) or by a
      // concurrent legacy/stalled execution. Never downgrade that durable
      // result to pending/error merely because a post-commit side effect failed.
      if (
        latestItem &&
        deriveUploadItemLifecycle(latestItem).measurementStatus === 'ready'
      ) {
        await repairUploadAggregateStatus(uploadId, shopId)
        workerLog.warn('MEASURE_JOB_POST_COMMIT_RECOVERED', {
          jobId: job.id,
          uploadId,
          itemId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { status: latestItem.preflightStatus, measurementCommitted: true }
      }
      if (!latestItem) throw error

      const existingResult = getResultRecord(latestItem?.preflightResult)
      const existingPreview =
        existingResult.preview && typeof existingResult.preview === 'object'
          ? (existingResult.preview as Record<string, unknown>)
          : {}
      const { hasThumbnail, usedPlaceholder } = deriveDurablePreviewEvidence(
        latestItem.thumbnailKey,
        existingPreview
      )
      const finalAttempt = isFinalUploadJobAttempt(job.attemptsMade, job.opts.attempts)
      const message = error instanceof Error ? error.message : 'Unknown error'

      if (!finalAttempt) {
        const projection = buildMeasurementFailureProjection({
          existingResult,
          hasThumbnail,
          usedPlaceholder,
          transition: {
            kind: 'retry',
            message,
            attempt: job.attemptsMade + 1,
            maxAttempts: Math.max(1, Number(job.opts.attempts) || 1),
          },
        })
        await compareAndSwapUploadItemResult({
          itemId,
          expectedStatus: latestItem.preflightStatus,
          expectedResult: latestItem.preflightResult,
          nextStatus: projection.preflightStatus,
          nextResult: projection.preflightResult,
          expectedThumbnailKey: latestItem.thumbnailKey,
          expectedPreviewKey: latestItem.previewKey,
          thumbnailKey: latestItem.thumbnailKey,
          previewKey: latestItem.previewKey || storageKey,
        })

        await updateUploadAggregateStatus(uploadId, shopId, null)

        workerLog.warn('MEASURE_JOB_RETRY_SCHEDULED', {
          jobId: job.id,
          uploadId,
          itemId,
          attempt: job.attemptsMade + 1,
          maxAttempts: Math.max(1, Number(job.opts.attempts) || 1),
          error: message,
          durationMs: Date.now() - jobStartedAt,
        })

        throw error
      }

      const projection = buildMeasurementFailureProjection({
        existingResult,
        hasThumbnail,
        usedPlaceholder,
        transition: {
          kind: 'terminal',
          code: 'processing',
          message,
          checks: [{ name: 'processing', status: 'error', message }],
        },
      })
      await compareAndSwapUploadItemResult({
        itemId,
        expectedStatus: latestItem.preflightStatus,
        expectedResult: latestItem.preflightResult,
        nextStatus: projection.preflightStatus,
        nextResult: projection.preflightResult,
        expectedThumbnailKey: latestItem.thumbnailKey,
        expectedPreviewKey: latestItem.previewKey,
        thumbnailKey: latestItem.thumbnailKey,
        previewKey: latestItem.previewKey || storageKey,
      })

      await updateUploadAggregateStatus(uploadId, shopId, null)

      workerLog.error('MEASURE_JOB_FAILED', {
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
    // Huge gang sheets (100+ MB PNGs) take minutes in ImageMagick. With the
    // default 30 s lock the job was marked stalled mid-measurement, re-queued
    // and run twice (2026-09-04, dtfprinthouse). Hold the lock for the whole run.
    lockDuration: 10 * 60 * 1000,
    stalledInterval: 5 * 60 * 1000,
    maxStalledCount: 2,
    limiter: {
      max: 20,
      duration: 60000,
    },
  }
)

measurePreflightWorker.on('completed', (job) => {
  console.log(`[Measure Preflight Worker] Job ${job.id} completed`)
})

measurePreflightWorker.on('failed', async (job, err) => {
  console.error(`[Measure Preflight Worker] Job ${job?.id} failed:`, err.message)

  if (!job) return
  const configuredAttempts = Math.max(1, Number(job.opts.attempts) || 1)
  const exhaustedAttempts = job.attemptsMade >= configuredAttempts
  const exhaustedStalls = /stalled more than allowable limit/i.test(err.message)
  if (!exhaustedAttempts && !exhaustedStalls) return

  // A killed/OOM worker never reaches the processor catch block. When BullMQ
  // finally exhausts retries/stalls, project that terminal queue state into the
  // upload lifecycle so the storefront does not spin indefinitely.
  try {
    const { uploadId, shopId, itemId, storageKey } = job.data
    const item = await prisma.uploadItem.findUnique({
      where: { id: itemId },
      select: {
        preflightStatus: true,
        preflightResult: true,
        thumbnailKey: true,
        previewKey: true,
      },
    })
    if (!item) return

    const lifecycle = deriveUploadItemLifecycle(item)
    if (lifecycle.measurementStatus !== 'pending') {
      await repairUploadAggregateStatus(uploadId, shopId)
      return
    }

    const existingResult = getResultRecord(item.preflightResult)
    const existingPreview =
      existingResult.preview && typeof existingResult.preview === 'object'
        ? (existingResult.preview as Record<string, unknown>)
        : {}
    const { hasThumbnail, usedPlaceholder } = deriveDurablePreviewEvidence(
      item.thumbnailKey,
      existingPreview
    )

    const terminalMessage = err.message || 'Measurement worker stopped before completing the file.'
    const projection = buildMeasurementFailureProjection({
      existingResult,
      hasThumbnail,
      usedPlaceholder,
      transition: {
        kind: 'terminal',
        code: 'measurement_worker_exhausted',
        message: terminalMessage,
        checks: [{ name: 'processing', status: 'error', message: terminalMessage }],
      },
    })
    const saved = await compareAndSwapUploadItemResult({
      itemId,
      expectedStatus: item.preflightStatus,
      expectedResult: item.preflightResult,
      nextStatus: projection.preflightStatus,
      nextResult: projection.preflightResult,
      expectedThumbnailKey: item.thumbnailKey,
      expectedPreviewKey: item.previewKey,
      thumbnailKey: item.thumbnailKey,
      previewKey: item.previewKey || storageKey,
    })
    if (!saved) {
      workerLog.warn('MEASURE_JOB_TERMINAL_STATE_CHANGED_BEFORE_SAVE', {
        jobId: job.id,
        uploadId,
        itemId,
      })
    }
    await updateUploadAggregateStatus(uploadId, shopId, null)
    workerLog.error('MEASURE_JOB_TERMINAL_STATE_PERSISTED', {
      jobId: job.id,
      uploadId,
      itemId,
      attemptsMade: job.attemptsMade,
      stalledCounter: job.stalledCounter,
      error: err.message,
    })
  } catch (persistError) {
    workerLog.error('MEASURE_JOB_TERMINAL_STATE_PERSIST_FAILED', {
      jobId: job.id,
      uploadId: job.data.uploadId,
      itemId: job.data.itemId,
      error: persistError instanceof Error ? persistError.message : String(persistError),
    })
  }
})

console.log('[Measure Preflight Worker] Started and waiting for jobs...')
startUploadPipelineReconciler()

export default measurePreflightWorker
