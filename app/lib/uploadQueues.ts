export const MEASURE_PREFLIGHT_QUEUE_NAME = 'measure-preflight'
export const PREVIEW_RENDER_QUEUE_NAME = 'preview-render'

export interface UploadPipelineJobData {
  uploadId: string
  shopId: string
  itemId: string
  storageKey: string
  mergeAttempt?: number
}
