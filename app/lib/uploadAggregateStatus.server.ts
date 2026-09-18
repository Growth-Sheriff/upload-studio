import prisma from './prisma.server'
import { deriveUploadItemLifecycle } from './uploadLifecycle.server'
import {
  canPipelineUpdateUploadStatus,
  PIPELINE_MUTABLE_UPLOAD_STATUSES,
  resolvePipelineAutoApprove,
} from './uploadQueueRecovery'

export async function updateUploadAggregateStatus(
  uploadId: string,
  shopId: string,
  shopSettings: unknown
): Promise<string> {
  let effectiveShopSettings = shopSettings
  if (effectiveShopSettings == null) {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { settings: true },
    })
    effectiveShopSettings = shop?.settings || null
  }

  const items = await prisma.uploadItem.findMany({
    where: { uploadId, upload: { shopId } },
    select: {
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
    },
  })
  const itemStates = items.map((item) => deriveUploadItemLifecycle(item))
  const autoApprove = resolvePipelineAutoApprove(effectiveShopSettings)
  const hasError = items.some((item) => item.preflightStatus === 'error')
  const hasWarning = items.some((item) => item.preflightStatus === 'warning')
  const hasBlockedMeasurement =
    itemStates.some((state) => state.orderabilityStatus === 'blocked') &&
    itemStates.every((state) => state.measurementStatus !== 'pending')
  const allMeasurementsResolved = itemStates.every(
    (state) => state.measurementStatus !== 'pending'
  )

  let uploadStatus: string
  let summaryOverall: 'processing' | 'ok' | 'warning' | 'error'
  if (!items.length || !allMeasurementsResolved) {
    uploadStatus = 'processing'
    summaryOverall = 'processing'
  } else if (hasBlockedMeasurement || hasError) {
    uploadStatus = 'blocked'
    summaryOverall = 'error'
  } else if (!hasWarning && autoApprove) {
    uploadStatus = 'ready'
    summaryOverall = 'ok'
  } else if (!hasWarning) {
    uploadStatus = 'pending_approval'
    summaryOverall = 'ok'
  } else {
    uploadStatus = 'pending_approval'
    summaryOverall = 'warning'
  }

  const update = await prisma.upload.updateMany({
    where: {
      id: uploadId,
      shopId,
      status: { in: [...PIPELINE_MUTABLE_UPLOAD_STATUSES] },
    },
    data: {
      status: uploadStatus,
      preflightSummary: {
        overall: summaryOverall,
        completedAt:
          uploadStatus === 'processing' ? null : new Date().toISOString(),
        itemCount: items.length,
        autoApproved: uploadStatus === 'ready',
      },
    },
  })

  if (update.count === 0) {
    const current = await prisma.upload.findFirst({
      where: { id: uploadId, shopId },
      select: { status: true },
    })
    if (current && !canPipelineUpdateUploadStatus(current.status)) {
      console.info('[UploadPipeline:UPLOAD_STATUS_PRESERVED_AFTER_PIPELINE]', {
        uploadId,
        shopId,
        preservedStatus: current.status,
        computedPipelineStatus: uploadStatus,
      })
      return current.status
    }
  }

  return uploadStatus
}
