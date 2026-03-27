import { Job, Queue, Worker } from 'bullmq'
import { runPreflightChecks } from '../app/lib/preflight.server'
import { deriveUploadItemLifecycle } from '../app/lib/uploadLifecycle.server'
import {
  cleanupTempDir,
  connection,
  getResultRecord,
  MEASURE_PREFLIGHT_QUEUE_NAME,
  prepareUploadJobContext,
  prisma,
  rasterizeFileForProcessing,
  type UploadPipelineJobData,
  updateUploadAggregateStatus,
  workerLog,
} from './uploadPipeline.shared'

function normalizeStageStatus(value: unknown): 'pending' | 'ready' | 'warning' | 'error' | null {
  if (value === 'pending' || value === 'ready' || value === 'warning' || value === 'error') {
    return value
  }
  return null
}

function mergeProblems(
  existingProblems: Array<Record<string, unknown>>,
  nextProblems: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>()

  for (const problem of [...existingProblems, ...nextProblems]) {
    const key = `${String(problem.scope || 'processing')}:${String(problem.code || 'unknown')}:${String(problem.message || '')}`
    merged.set(key, problem)
  }

  return Array.from(merged.values())
}

export const measurePreflightQueue = new Queue<UploadPipelineJobData>(MEASURE_PREFLIGHT_QUEUE_NAME, {
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

const measurePreflightWorker = new Worker<UploadPipelineJobData>(
  MEASURE_PREFLIGHT_QUEUE_NAME,
  async (job: Job<UploadPipelineJobData>) => {
    const { uploadId, shopId, itemId, storageKey } = job.data
    const jobStartedAt = Date.now()

    workerLog.info('MEASURE_JOB_STARTED', {
      jobId: job.id,
      uploadId,
      itemId,
      storageKey: storageKey.substring(0, 80),
    })

    let tempDir = ''

    try {
      const context = await prepareUploadJobContext(job.data, 'measure-preflight')
      tempDir = context.tempDir

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
        ...existingResult,
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
      const previewHasThumbnail = Boolean(latestItem.thumbnailKey) || existingPreview.hasThumbnail === true
      const previewUsedPlaceholder = existingPreview.usedPlaceholder === true
      const previewStatus =
        normalizeStageStatus(storedPreviewStage.status) ||
        (previewHasThumbnail ? (previewUsedPlaceholder ? 'warning' : 'ready') : 'pending')

      const nextPreflightResult = {
        ...provisionalResult,
        metadata: lifecycle.metadata,
        problems: lifecycle.problems,
        stages: {
          ...existingStages,
          measurement: {
            status: lifecycle.measurementStatus,
          },
          preview: {
            status: previewStatus,
            hasThumbnail: previewHasThumbnail,
            usedPlaceholder: previewUsedPlaceholder,
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
        preview: {
          ...existingPreview,
          hasThumbnail: previewHasThumbnail,
          usedPlaceholder: previewUsedPlaceholder,
        },
      }

      await prisma.uploadItem.update({
        where: { id: itemId },
        data: {
          preflightStatus: result.overall,
          preflightResult: nextPreflightResult as any,
          previewKey: latestItem.previewKey || storageKey,
        },
      })

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
      const latestItem = await prisma.uploadItem.findUnique({
        where: { id: itemId },
        select: {
          thumbnailKey: true,
          previewKey: true,
          preflightResult: true,
        },
      })

      const existingResult = getResultRecord(latestItem?.preflightResult)
      const existingPreview =
        existingResult.preview && typeof existingResult.preview === 'object'
          ? (existingResult.preview as Record<string, unknown>)
          : {}
      const existingProblems = Array.isArray(existingResult.problems)
        ? (existingResult.problems as unknown[]).filter(
            (problem): problem is Record<string, unknown> =>
              Boolean(problem) && typeof problem === 'object'
          )
        : []
      const hasThumbnail = Boolean(latestItem?.thumbnailKey) || existingPreview.hasThumbnail === true
      const usedPlaceholder = existingPreview.usedPlaceholder === true

      await prisma.uploadItem.update({
        where: { id: itemId },
        data: {
          preflightStatus: 'error',
          preflightResult: {
            ...existingResult,
            overall: 'error',
            problems: mergeProblems(existingProblems, [
              {
                scope: 'processing',
                code: 'processing',
                severity: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
              },
            ]),
            stages: {
              measurement: { status: 'error' },
              preview: {
                status: hasThumbnail ? (usedPlaceholder ? 'warning' : 'ready') : 'pending',
                hasThumbnail,
                usedPlaceholder,
              },
              orderability: { status: 'blocked' },
            },
            capabilities: {
              canAddToCart: false,
              canResolveProduct: false,
              hasPreview: hasThumbnail,
            },
            preview: {
              ...existingPreview,
              hasThumbnail,
              usedPlaceholder,
            },
            checks: [
              {
                name: 'processing',
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
              },
            ],
          },
          previewKey: latestItem?.previewKey || storageKey,
        },
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

measurePreflightWorker.on('completed', (job) => {
  console.log(`[Measure Preflight Worker] Job ${job.id} completed`)
})

measurePreflightWorker.on('failed', (job, err) => {
  console.error(`[Measure Preflight Worker] Job ${job?.id} failed:`, err.message)
})

console.log('[Measure Preflight Worker] Started and waiting for jobs...')

export default measurePreflightWorker
