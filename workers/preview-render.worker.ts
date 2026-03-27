import { Job, Queue, Worker } from 'bullmq'
import path from 'path'
import { generateThumbnail } from '../app/lib/preflight.server'
import { deriveUploadItemLifecycle } from '../app/lib/uploadLifecycle.server'
import {
  cleanupTempDir,
  connection,
  createPlaceholderThumbnail,
  getResultRecord,
  PREVIEW_RENDER_QUEUE_NAME,
  prepareUploadJobContext,
  prisma,
  rasterizeFileForProcessing,
  type UploadPipelineJobData,
  updateUploadAggregateStatus,
  uploadGeneratedAsset,
  waitForMeasurementResolution,
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

export const previewRenderQueue = new Queue<UploadPipelineJobData>(PREVIEW_RENDER_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 1000,
  },
})

const previewRenderWorker = new Worker<UploadPipelineJobData>(
  PREVIEW_RENDER_QUEUE_NAME,
  async (job: Job<UploadPipelineJobData>) => {
    const { uploadId, shopId, itemId, storageKey } = job.data
    const jobStartedAt = Date.now()

    workerLog.info('PREVIEW_JOB_STARTED', {
      jobId: job.id,
      uploadId,
      itemId,
      storageKey: storageKey.substring(0, 80),
    })

    let tempDir = ''

    try {
      const context = await prepareUploadJobContext(job.data, 'preview-render')
      tempDir = context.tempDir

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
        generatedThumbnailKey = storageKey.replace(/\.[^.]+$/, '_thumb.webp')

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

      const measurementItem = await waitForMeasurementResolution(itemId, 20000)
      const resolvedThumbnailKey =
        thumbnailGenerated && thumbnailUploaded ? generatedThumbnailKey : measurementItem?.thumbnailKey || null

      if (!measurementItem || measurementItem.preflightStatus === 'pending') {
        await prisma.uploadItem.update({
          where: { id: itemId },
          data: {
            thumbnailKey: resolvedThumbnailKey,
            previewKey: measurementItem?.previewKey || storageKey,
          },
        })

        if ((job.data.mergeAttempt || 0) < 3) {
          await previewRenderQueue.add(
            'preview-render',
            {
              ...job.data,
              mergeAttempt: (job.data.mergeAttempt || 0) + 1,
            },
            {
              delay: 5000,
            }
          )
        }

        workerLog.warn('PREVIEW_MERGE_DEFERRED', {
          itemId,
          uploadId,
          mergeAttempt: job.data.mergeAttempt || 0,
          resolvedThumbnailKey: resolvedThumbnailKey?.substring(0, 60) || null,
        })

        return {
          status: 'pending',
          thumbnailKey: resolvedThumbnailKey,
        }
      }

      const existingResult = getResultRecord(measurementItem.preflightResult)
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

      const previewProblems: Array<Record<string, unknown>> = []
      if (!resolvedThumbnailKey) {
        previewProblems.push({
          scope: 'preview',
          code: 'thumbnail_unavailable',
          severity: 'warning',
          message:
            'Preview thumbnail is not available yet. Original file is preserved and measurement data remains usable.',
        })
      } else if (usedPlaceholder) {
        previewProblems.push({
          scope: 'preview',
          code: 'thumbnail_placeholder',
          severity: 'warning',
          message:
            'A placeholder preview was generated. Original file is preserved and measurement data remains usable.',
        })
      }

      let nextPreflightStatus = measurementItem.preflightStatus
      if (nextPreflightStatus === 'ok' && previewProblems.length) {
        nextPreflightStatus = 'warning'
      }

      const provisionalResult = {
        ...existingResult,
        problems: mergeProblems(existingProblems, previewProblems),
        preview: {
          ...existingPreview,
          hasThumbnail: Boolean(resolvedThumbnailKey),
          usedPlaceholder,
          thumbnailGenerated,
          thumbnailUploaded,
        },
      }

      const lifecycle = deriveUploadItemLifecycle({
        preflightStatus: nextPreflightStatus,
        preflightResult: provisionalResult,
        thumbnailKey: resolvedThumbnailKey,
      })

      const nextPreflightResult = {
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
            status: resolvedThumbnailKey ? (usedPlaceholder ? 'warning' : 'ready') : 'warning',
            hasThumbnail: Boolean(resolvedThumbnailKey),
            usedPlaceholder,
          },
          orderability: {
            status: lifecycle.orderabilityStatus,
          },
        },
        capabilities: {
          canAddToCart: lifecycle.canAddToCart,
          canResolveProduct: lifecycle.canResolveProduct,
          hasPreview: lifecycle.hasPreview,
        },
      }

      await prisma.uploadItem.update({
        where: { id: itemId },
        data: {
          preflightStatus: nextPreflightStatus,
          preflightResult: nextPreflightResult as any,
          thumbnailKey: resolvedThumbnailKey,
          previewKey: measurementItem.previewKey || storageKey,
        },
      })

      await job.updateProgress(90)

      const uploadStatus = await updateUploadAggregateStatus(uploadId, shopId, context.shop.settings)

      await job.updateProgress(100)

      workerLog.info('PREVIEW_JOB_COMPLETED', {
        jobId: job.id,
        uploadId,
        itemId,
        uploadStatus,
        resolvedThumbnailKey: resolvedThumbnailKey?.substring(0, 60) || null,
        usedPlaceholder,
        durationMs: Date.now() - jobStartedAt,
      })

      return {
        status: nextPreflightStatus,
        thumbnailKey: resolvedThumbnailKey,
        usedPlaceholder,
      }
    } catch (error) {
      const measurementItem = await waitForMeasurementResolution(itemId, 1000)

      if ((!measurementItem || measurementItem.preflightStatus === 'pending') && (job.data.mergeAttempt || 0) < 3) {
        await previewRenderQueue.add(
          'preview-render',
          {
            ...job.data,
            mergeAttempt: (job.data.mergeAttempt || 0) + 1,
          },
          {
            delay: 5000,
          }
        )

        workerLog.warn('PREVIEW_JOB_REQUEUED_AFTER_ERROR', {
          jobId: job.id,
          uploadId,
          itemId,
          mergeAttempt: job.data.mergeAttempt || 0,
          error: error instanceof Error ? error.message : String(error),
        })

        return {
          status: 'pending',
          requeued: true,
        }
      }

      if (measurementItem && measurementItem.preflightStatus !== 'pending') {
        const existingResult = getResultRecord(measurementItem.preflightResult)
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

        const previewProblems = mergeProblems(existingProblems, [
          {
            scope: 'preview',
            code: 'thumbnail_generation_failed',
            severity: 'warning',
            message:
              error instanceof Error ? error.message : 'Preview generation failed. Original file is preserved.',
          },
        ])

        const nextStatus = measurementItem.preflightStatus === 'ok' ? 'warning' : measurementItem.preflightStatus
        const provisionalResult = {
          ...existingResult,
          problems: previewProblems,
          preview: {
            ...existingPreview,
            hasThumbnail: Boolean(measurementItem.thumbnailKey),
            usedPlaceholder: existingPreview.usedPlaceholder === true,
            thumbnailGenerated: false,
            thumbnailUploaded: false,
          },
        }
        const lifecycle = deriveUploadItemLifecycle({
          preflightStatus: nextStatus,
          preflightResult: provisionalResult,
          thumbnailKey: measurementItem.thumbnailKey,
        })

        await prisma.uploadItem.update({
          where: { id: itemId },
          data: {
            preflightStatus: nextStatus,
            preflightResult: {
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
                  status: measurementItem.thumbnailKey ? 'warning' : 'warning',
                  hasThumbnail: Boolean(measurementItem.thumbnailKey),
                  usedPlaceholder: existingPreview.usedPlaceholder === true,
                },
                orderability: {
                  status: lifecycle.orderabilityStatus,
                },
              },
              capabilities: {
                canAddToCart: lifecycle.canAddToCart,
                canResolveProduct: lifecycle.canResolveProduct,
                hasPreview: lifecycle.hasPreview,
              },
            } as any,
          },
        })

        await updateUploadAggregateStatus(uploadId, shopId, null)
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

previewRenderWorker.on('failed', (job, err) => {
  console.error(`[Preview Render Worker] Job ${job?.id} failed:`, err.message)
})

console.log('[Preview Render Worker] Started and waiting for jobs...')

export default previewRenderWorker
