import { describe, expect, it } from 'vitest'
import {
  buildThumbnailStorageKey,
  EXPORT_JOB_OPTIONS,
  getExportJobOptions,
  getMeasurePreflightJobOptions,
  getPreviewRenderJobOptions,
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

  it('uses separate deterministic ids for initial preview and merge passes', () => {
    expect(getPreviewRenderJobOptions('item_123')).toEqual({
      ...PREVIEW_RENDER_JOB_OPTIONS,
      priority: 20,
      delay: 1_500,
      jobId: 'preview-item_123-v1-0',
    })
    expect(getPreviewRenderJobOptions('item_123', 2).jobId).toBe('preview-item_123-v1-2')
    expect(getPreviewRenderJobOptions('item_123', 2).delay).toBe(5_000)
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
