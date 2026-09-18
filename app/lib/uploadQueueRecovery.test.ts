import { describe, expect, it } from 'vitest'
import {
  buildMeasurementFailureProjection,
  canPipelineUpdateUploadStatus,
  clearStoredMeasurementStage,
  deriveDurablePreviewEvidence,
  getUploadQueueRecoveryPlan,
  normalizeUploadQueueJobState,
  resolvePipelineAutoApprove,
  resolvePreviewStatusAfterMeasurement,
} from './uploadQueueRecovery'

function getProjectedStages(projection: ReturnType<typeof buildMeasurementFailureProjection>) {
  return projection.preflightResult.stages as Record<string, Record<string, unknown>>
}

function getProjectedProblems(projection: ReturnType<typeof buildMeasurementFailureProjection>) {
  return projection.preflightResult.problems as Array<Record<string, unknown>>
}

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

  it('does not preserve ready when no durable thumbnail exists', () => {
    expect(
      resolvePreviewStatusAfterMeasurement({
        storedStatus: 'ready',
        hasThumbnail: false,
        usedPlaceholder: false,
      })
    ).toBe('pending')
  })
})

describe('deriveDurablePreviewEvidence', () => {
  it('does not trust a stale JSON thumbnail flag without a durable key', () => {
    expect(
      deriveDurablePreviewEvidence(null, {
        hasThumbnail: true,
        usedPlaceholder: true,
      })
    ).toEqual({ hasThumbnail: false, usedPlaceholder: false })
  })

  it('recognizes both explicit and key-derived placeholders', () => {
    expect(deriveDurablePreviewEvidence('tenant/item_thumbnail.webp', { usedPlaceholder: true }))
      .toEqual({ hasThumbnail: true, usedPlaceholder: true })
    expect(deriveDurablePreviewEvidence('tenant/item_placeholder.webp', {}))
      .toEqual({ hasThumbnail: true, usedPlaceholder: true })
  })
})

describe('buildMeasurementFailureProjection', () => {
  it('keeps independently-owned warning and error preview outcomes during retries', () => {
    const cases = [
      { storedStatus: 'warning', hasThumbnail: false },
      { storedStatus: 'error', hasThumbnail: true },
    ] as const

    for (const { storedStatus, hasThumbnail } of cases) {
      const projection = buildMeasurementFailureProjection({
        existingResult: {
          stages: {
            preview: { status: storedStatus, renderer: 'imagemagick' },
            audit: { status: 'retained', marker: storedStatus },
          },
          preview: { format: 'webp' },
        },
        hasThumbnail,
        usedPlaceholder: false,
        transition: {
          kind: 'retry',
          message: 'temporary storage failure',
          attempt: 2,
          maxAttempts: 3,
        },
      })

      expect(projection.kind).toBe('retry')
      expect(projection.preflightStatus).toBe('pending')
      expect(projection.preflightResult.overall).toBe('processing')
      expect(getProjectedStages(projection)).toMatchObject({
        measurement: {
          status: 'pending',
          retrying: true,
          attempt: 2,
          maxAttempts: 3,
          lastError: 'temporary storage failure',
        },
        preview: {
          status: storedStatus,
          renderer: 'imagemagick',
          hasThumbnail,
          usedPlaceholder: false,
        },
        audit: { status: 'retained', marker: storedStatus },
        orderability: { status: 'processing' },
      })
      expect(projection.preflightResult.capabilities).toEqual({
        canAddToCart: false,
        canResolveProduct: false,
        hasPreview: hasThumbnail,
      })
    }
  })

  it('projects no thumbnail, a real thumbnail, and a placeholder consistently', () => {
    const cases = [
      { hasThumbnail: false, usedPlaceholder: false, previewStatus: 'pending', hasPreview: false },
      { hasThumbnail: true, usedPlaceholder: false, previewStatus: 'ready', hasPreview: true },
      { hasThumbnail: true, usedPlaceholder: true, previewStatus: 'warning', hasPreview: true },
    ] as const

    for (const testCase of cases) {
      const projection = buildMeasurementFailureProjection({
        existingResult: { stages: { preview: { status: 'pending' } } },
        hasThumbnail: testCase.hasThumbnail,
        usedPlaceholder: testCase.usedPlaceholder,
        transition: {
          kind: 'terminal',
          code: 'processing',
          message: 'decode failed',
          checks: [{ name: 'processing', status: 'error', message: 'decode failed' }],
        },
      })

      expect(getProjectedStages(projection).preview).toMatchObject({
        status: testCase.previewStatus,
        hasThumbnail: testCase.hasThumbnail,
        usedPlaceholder: testCase.usedPlaceholder,
      })
      expect(projection.preflightResult.capabilities).toMatchObject({
        hasPreview: testCase.hasPreview,
      })
    }
  })

  it('terminalizes measurement without erasing unknown stages or cause-specific checks', () => {
    const projection = buildMeasurementFailureProjection({
      existingResult: {
        stages: {
          preview: { status: 'error', diagnostic: 'renderer timeout' },
          malwareScan: { status: 'ready', engine: 'example' },
        },
        problems: [
          { scope: 'preview', code: 'thumbnail_generation_failed', severity: 'warning' },
        ],
      },
      hasThumbnail: false,
      usedPlaceholder: false,
      transition: {
        kind: 'terminal',
        code: 'measurement_worker_exhausted',
        message: 'worker stalled',
        checks: [
          {
            name: 'measurement_worker',
            status: 'error',
            message: 'worker stalled',
            source: 'bullmq',
          },
        ],
      },
    })

    expect(projection.kind).toBe('terminal')
    expect(projection.preflightStatus).toBe('error')
    expect(projection.preflightResult.overall).toBe('error')
    expect(getProjectedStages(projection)).toMatchObject({
      measurement: { status: 'error' },
      preview: { status: 'error', diagnostic: 'renderer timeout' },
      malwareScan: { status: 'ready', engine: 'example' },
      orderability: { status: 'blocked' },
    })
    expect(projection.preflightResult.checks).toEqual([
      {
        name: 'measurement_worker',
        status: 'error',
        message: 'worker stalled',
        source: 'bullmq',
      },
    ])
  })

  it('keeps processor, exhausted-worker, and missing-result failures distinguishable', () => {
    const codes = ['processing', 'measurement_worker_exhausted', 'measurement_result_missing']

    const projectedCodes = codes.map((code) => {
      const projection = buildMeasurementFailureProjection({
        existingResult: {},
        hasThumbnail: false,
        usedPlaceholder: false,
        transition: {
          kind: 'terminal',
          code,
          message: `failure:${code}`,
          checks: [{ name: code, status: 'error', message: `failure:${code}` }],
        },
      })
      const matchingProblem = getProjectedProblems(projection).find(
        (problem) => problem.message === `failure:${code}`
      )
      expect(projection.preflightResult.checks).toEqual([
        { name: code, status: 'error', message: `failure:${code}` },
      ])
      return matchingProblem?.code
    })

    expect(projectedCodes).toEqual(codes)
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
    ).toEqual({ headerValidate: false, measure: true, preview: true })
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
    ).toEqual({ headerValidate: false, measure: false, preview: true })
  })

  it('does not re-render a durable thumbnail while measurement is pending', () => {
    expect(
      getUploadQueueRecoveryPlan({
        preflightStatus: 'pending',
        preflightResult: null,
        thumbnailKey: 'uploads/example_thumb.webp',
      })
    ).toEqual({ headerValidate: false, measure: true, preview: false })
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
    ).toEqual({ headerValidate: false, measure: false, preview: false })
  })

  it('uses header validation only for PNG/JPEG and keeps other formats on the worker path', () => {
    const cases = [
      {
        mimeType: 'image/png',
        originalName: 'sheet.png',
        thumbnailKey: 'uploads/sheet_thumb.webp',
        expected: { headerValidate: true, measure: false, preview: false },
      },
      {
        mimeType: 'image/jpeg',
        originalName: 'sheet.jpg',
        thumbnailKey: null,
        expected: { headerValidate: true, measure: false, preview: true },
      },
      {
        mimeType: 'application/pdf',
        originalName: 'sheet.pdf',
        thumbnailKey: null,
        expected: { headerValidate: false, measure: true, preview: true },
      },
      {
        mimeType: 'image/webp',
        originalName: 'sheet.webp',
        thumbnailKey: null,
        expected: { headerValidate: false, measure: true, preview: true },
      },
    ]

    for (const testCase of cases) {
      expect(
        getUploadQueueRecoveryPlan({
          preflightStatus: 'pending',
          preflightResult: null,
          mimeType: testCase.mimeType,
          originalName: testCase.originalName,
          thumbnailKey: testCase.thumbnailKey,
        })
      ).toEqual(testCase.expected)
    }
  })
})
