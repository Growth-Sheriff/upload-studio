import { describe, expect, it } from 'vitest'
import {
  buildThumbnailStorageKey,
  EXPORT_JOB_OPTIONS,
  getExportJobOptions,
  getMeasurePreflightJobOptions,
  getPreviewRenderJobOptions,
  handoffRenderedPreview,
  inspectPreviewMeasurementOnce,
  isFinalUploadJobAttempt,
  MEASURE_PREFLIGHT_JOB_OPTIONS,
  PREVIEW_RENDER_JOB_OPTIONS,
  shouldPrelockLargeUpload,
  shouldSerializeLargeImage,
} from './uploadQueues'

describe('upload queue contracts', () => {
  it('gives every initial measurement a deterministic id and the shared retry policy', () => {
    expect(getMeasurePreflightJobOptions('item_123')).toEqual({
      ...MEASURE_PREFLIGHT_JOB_OPTIONS,
      priority: 1,
      jobId: 'measure-item_123-v1',
    })
    expect(MEASURE_PREFLIGHT_JOB_OPTIONS.attempts).toBe(3)
    expect(MEASURE_PREFLIGHT_JOB_OPTIONS.backoff.delay).toBe(60_000)
  })

  it('keeps deterministic initial ids and legacy merge-job compatibility', () => {
    expect(getPreviewRenderJobOptions('item_123')).toEqual({
      ...PREVIEW_RENDER_JOB_OPTIONS,
      priority: 20,
      delay: 1_500,
      jobId: 'preview-item_123-v1-0',
    })
    expect(getPreviewRenderJobOptions('item_123', 2).jobId).toBe('preview-item_123-v1-2')
    expect(getPreviewRenderJobOptions('item_123', 2).delay).toBe(5_000)
  })

  it('re-reads a measurement race instead of rendering the source again', async () => {
    const pending = { preflightStatus: 'pending', thumbnailKey: null }
    const ready = { preflightStatus: 'ok', thumbnailKey: null }
    let reads = 0

    const result = await handoffRenderedPreview({
      initialItem: pending,
      persist: async () => false,
      reread: async () => {
        reads += 1
        return ready
      },
    })

    expect(result).toEqual({ item: ready, persisted: false, attempts: 1 })
    expect(reads).toBe(1)
  })

  it('retries a pending compare-and-swap with the refreshed row', async () => {
    const versions = [
      { preflightStatus: 'pending', version: 1 },
      { preflightStatus: 'pending', version: 2 },
    ]
    const persistedVersions: number[] = []

    const result = await handoffRenderedPreview({
      initialItem: versions[0],
      persist: async (item) => {
        persistedVersions.push(item.version)
        return item.version === 2
      },
      reread: async () => versions[1],
    })

    expect(result).toEqual({ item: versions[1], persisted: true, attempts: 2 })
    expect(persistedVersions).toEqual([1, 2])
  })

  it('lets three pending probes yield their slots so a fourth probe can start', async () => {
    const readCounts = [0, 0, 0, 0]
    const started: number[] = []
    const tasks = readCounts.map((_, index) => async () => {
      started.push(index)
      return inspectPreviewMeasurementOnce(async () => {
        readCounts[index] += 1
        return { preflightStatus: index === 3 ? 'ok' : 'pending' }
      })
    })

    let nextTask = 0
    const runSlot = async () => {
      while (nextTask < tasks.length) {
        const taskIndex = nextTask
        nextTask += 1
        await tasks[taskIndex]()
      }
    }

    await Promise.all([runSlot(), runSlot(), runSlot()])

    expect(started).toEqual([0, 1, 2, 3])
    expect(readCounts).toEqual([1, 1, 1, 1])
  })

  it('does not expose a retryable execution as the final failure', () => {
    expect(isFinalUploadJobAttempt(0, 3)).toBe(false)
    expect(isFinalUploadJobAttempt(1, 3)).toBe(false)
    expect(isFinalUploadJobAttempt(2, 3)).toBe(true)
    expect(isFinalUploadJobAttempt(0, undefined)).toBe(true)
  })

  it('gives exports a typed deterministic id and a conservative retry policy', () => {
    expect(getExportJobOptions('export_123')).toEqual({
      ...EXPORT_JOB_OPTIONS,
      jobId: 'export-export_123',
    })
    expect(EXPORT_JOB_OPTIONS.attempts).toBe(2)
    expect(EXPORT_JOB_OPTIONS.backoff.delay).toBe(120_000)
  })

  it('never reuses an extensionless original object key for a thumbnail', () => {
    expect(buildThumbnailStorageKey('r2:shop/upload/item/artwork', false)).toBe(
      'r2:shop/upload/item/artwork_thumb.webp'
    )
    expect(buildThumbnailStorageKey('bunny:shop/upload/item/artwork.png', true)).toBe(
      'bunny:shop/upload/item/artwork_placeholder.webp'
    )
  })
})

describe('large image serialization', () => {
  it('serializes the observed 475 MP gang sheet', () => {
    expect(shouldSerializeLargeImage(6678, 71116)).toBe(true)
  })

  it('keeps ordinary images on the normal concurrent path', () => {
    expect(shouldSerializeLargeImage(6000, 9000)).toBe(false)
    expect(shouldSerializeLargeImage(0, 9000)).toBe(false)
  })

  it('reserves the cross-worker slot before re-downloading a known-large object', () => {
    expect(shouldPrelockLargeUpload(81_300_000)).toBe(true)
    expect(shouldPrelockLargeUpload(49 * 1024 * 1024)).toBe(false)
    expect(shouldPrelockLargeUpload(null)).toBe(false)
  })
})
