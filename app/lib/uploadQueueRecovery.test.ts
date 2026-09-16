import { describe, expect, it } from 'vitest'
import {
  canPipelineUpdateUploadStatus,
  clearStoredMeasurementStage,
  getUploadQueueRecoveryPlan,
  normalizeUploadQueueJobState,
  resolvePipelineAutoApprove,
  resolvePreviewStatusAfterMeasurement,
} from './uploadQueueRecovery'

describe('pipeline upload status ownership', () => {
  it('preserves an explicit manual-approval setting', () => {
    expect(resolvePipelineAutoApprove({ autoApprove: false })).toBe(false)
    expect(resolvePipelineAutoApprove({ autoApprove: true })).toBe(true)
    expect(resolvePipelineAutoApprove(null)).toBe(true)
  })

  it('allows recovery of pre-order states only', () => {
    for (const status of [
      'draft',
      'completing',
      'uploaded',
      'processing',
      'ready',
      'pending_approval',
      'blocked',
    ]) {
      expect(canPipelineUpdateUploadStatus(status)).toBe(true)
    }
  })

  it('preserves order and merchant workflow states from late jobs', () => {
    for (const status of [
      'needs_review',
      'approved',
      'rejected',
      'printed',
      'shipped',
      'archived',
    ]) {
      expect(canPipelineUpdateUploadStatus(status)).toBe(false)
    }
  })
})

describe('clearStoredMeasurementStage', () => {
  it('lets a successful retry replace pending measurement state without losing preview state', () => {
    expect(
      clearStoredMeasurementStage({
        stages: {
          measurement: { status: 'pending', retrying: true },
          preview: { status: 'ready', hasThumbnail: true },
        },
      })
    ).toEqual({
      stages: {
        preview: { status: 'ready', hasThumbnail: true },
      },
    })
  })
})

describe('resolvePreviewStatusAfterMeasurement', () => {
  it('lets a durable thumbnail supersede an old pending retry marker', () => {
    expect(
      resolvePreviewStatusAfterMeasurement({
        storedStatus: 'pending',
        hasThumbnail: true,
        usedPlaceholder: false,
      })
    ).toBe('ready')
  })

  it('keeps placeholder and prior failure states visible', () => {
    expect(
      resolvePreviewStatusAfterMeasurement({
        storedStatus: 'pending',
        hasThumbnail: true,
        usedPlaceholder: true,
      })
    ).toBe('warning')
    expect(
      resolvePreviewStatusAfterMeasurement({
        storedStatus: 'error',
        hasThumbnail: true,
        usedPlaceholder: false,
      })
    ).toBe('error')
  })
})

describe('normalizeUploadQueueJobState', () => {
  it('distinguishes terminal jobs from work that may still run', () => {
    expect(normalizeUploadQueueJobState('failed')).toBe('failed')
    expect(normalizeUploadQueueJobState('completed')).toBe('completed')
    expect(normalizeUploadQueueJobState('active')).toBe('running')
    expect(normalizeUploadQueueJobState('delayed')).toBe('running')
    expect(normalizeUploadQueueJobState('unknown')).toBe('running')
  })
})

describe('getUploadQueueRecoveryPlan', () => {
  it('repairs both jobs when completion committed before either enqueue', () => {
    expect(
      getUploadQueueRecoveryPlan({
        preflightStatus: 'pending',
        preflightResult: null,
        thumbnailKey: null,
      })
    ).toEqual({ measure: true, preview: true })
  })

  it('repairs only preview after measurement committed', () => {
    expect(
      getUploadQueueRecoveryPlan({
        preflightStatus: 'ok',
        preflightResult: {
          metadata: { width: 3000, height: 6000, widthIn: 10, heightIn: 20, dpi: 300 },
          stages: {
            measurement: { status: 'ready' },
            preview: { status: 'pending' },
          },
        },
        thumbnailKey: null,
      })
    ).toEqual({ measure: false, preview: true })
  })

  it('does not re-render a durable thumbnail while measurement is pending', () => {
    expect(
      getUploadQueueRecoveryPlan({
        preflightStatus: 'pending',
        preflightResult: null,
        thumbnailKey: 'uploads/example_thumb.webp',
      })
    ).toEqual({ measure: true, preview: false })
  })

  it('does not bypass BullMQ limits for terminal failures', () => {
    expect(
      getUploadQueueRecoveryPlan({
        preflightStatus: 'error',
        preflightResult: {
          stages: {
            measurement: { status: 'error' },
            preview: { status: 'warning' },
          },
        },
        thumbnailKey: null,
      })
    ).toEqual({ measure: false, preview: false })
  })
})
