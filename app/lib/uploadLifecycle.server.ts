type LegacyPreflightStatus = 'pending' | 'ok' | 'warning' | 'error'
type UploadStatusValue =
  | 'draft'
  | 'uploaded'
  | 'processing'
  | 'needs_review'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'blocked'
  | 'printed'
  | 'archived'
  | string

export type UploadStageStatus = 'pending' | 'ready' | 'warning' | 'error'
export type UploadOrderabilityStatus = 'processing' | 'ready' | 'blocked'

export interface UploadLifecycleProblem {
  scope: 'measurement' | 'preview' | 'policy' | 'processing'
  code: string
  severity: 'warning' | 'error'
  message: string
}

export interface UploadLifecycleMetadata {
  widthPx: number
  heightPx: number
  dpi: number
  trimmedWidthPx: number
  trimmedHeightPx: number
  trimmedOffsetXPx: number
  trimmedOffsetYPx: number
  measurementWidthPx: number
  measurementHeightPx: number
  effectiveDpi: number
  sizingSource: string | null
  widthIn: number
  heightIn: number
  measurementMode: string | null
}

export interface UploadLifecycleState {
  measurementStatus: UploadStageStatus
  previewStatus: UploadStageStatus
  orderabilityStatus: UploadOrderabilityStatus
  metadata: UploadLifecycleMetadata | null
  problems: UploadLifecycleProblem[]
  warnings: string[]
  errors: string[]
  hasPreview: boolean
  canAddToCart: boolean
  canResolveProduct: boolean
}

interface UploadItemLike {
  preflightStatus?: string | null
  preflightResult?: unknown
  thumbnailKey?: string | null
}

const DEFAULT_EFFECTIVE_DPI = 200

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeSizingSource(value: unknown): string | null {
  const raw = String(value || '').trim()
  return raw || null
}

function resolveMeasurementSizing(metadata: {
  dpi?: unknown
  effectiveDpi?: unknown
  sizingSource?: unknown
}): { effectiveDpi: number; sizingSource: string } {
  const documentDpi = parsePositiveNumber(metadata.dpi)
  const storedEffectiveDpi = parsePositiveNumber(metadata.effectiveDpi)
  const storedSizingSource = normalizeSizingSource(metadata.sizingSource)

  if (storedSizingSource === 'document_dpi') {
    return {
      effectiveDpi: storedEffectiveDpi || documentDpi || DEFAULT_EFFECTIVE_DPI,
      sizingSource: 'document_dpi',
    }
  }

  if (storedSizingSource === 'fallback_200dpi') {
    return {
      effectiveDpi: storedEffectiveDpi || DEFAULT_EFFECTIVE_DPI,
      sizingSource: 'fallback_200dpi',
    }
  }

  if (documentDpi > 0) {
    return {
      effectiveDpi: documentDpi,
      sizingSource: 'document_dpi',
    }
  }

  return {
    effectiveDpi: DEFAULT_EFFECTIVE_DPI,
    sizingSource: 'fallback_200dpi',
  }
}

function normalizeStageStatus(value: unknown): UploadStageStatus | null {
  if (value === 'pending' || value === 'ready' || value === 'warning' || value === 'error') {
    return value
  }
  return null
}

function getChecks(preflightResult: unknown): Array<Record<string, unknown>> {
  const result =
    preflightResult && typeof preflightResult === 'object'
      ? (preflightResult as Record<string, unknown>)
      : {}

  if (!Array.isArray(result.checks)) {
    return []
  }

  return result.checks.filter(
    (value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'
  )
}

function getResultRecord(preflightResult: unknown): Record<string, unknown> {
  return preflightResult && typeof preflightResult === 'object'
    ? (preflightResult as Record<string, unknown>)
    : {}
}

function extractMetadataFromChecks(checks: Array<Record<string, unknown>>): UploadLifecycleMetadata | null {
  let widthPx = 0
  let heightPx = 0
  let dpi = 0
  let trimmedWidthPx = 0
  let trimmedHeightPx = 0
  let trimmedOffsetXPx = 0
  let trimmedOffsetYPx = 0
  let measurementWidthPx = 0
  let measurementHeightPx = 0
  let effectiveDpi = DEFAULT_EFFECTIVE_DPI
  let sizingSource: string | null = null
  let measurementMode: string | null = null

  for (const check of checks) {
    if (check.name === 'dimensions' && check.details && typeof check.details === 'object') {
      const details = check.details as Record<string, unknown>
      widthPx = parsePositiveNumber(details.width)
      heightPx = parsePositiveNumber(details.height)
      trimmedWidthPx = parsePositiveNumber(details.trimmedWidth)
      trimmedHeightPx = parsePositiveNumber(details.trimmedHeight)
      trimmedOffsetXPx = parsePositiveNumber(details.trimmedOffsetX)
      trimmedOffsetYPx = parsePositiveNumber(details.trimmedOffsetY)
      measurementWidthPx = parsePositiveNumber(details.measurementWidth)
      measurementHeightPx = parsePositiveNumber(details.measurementHeight)
      const resolvedSizing = resolveMeasurementSizing(details)
      effectiveDpi = resolvedSizing.effectiveDpi
      sizingSource = resolvedSizing.sizingSource
      measurementMode =
        typeof details.measurementMode === 'string' && details.measurementMode
          ? details.measurementMode
          : null
    }

    if (check.name === 'dpi') {
      dpi = parsePositiveNumber(check.value)
    }
  }

  if (!(widthPx > 0) || !(heightPx > 0)) {
    return null
  }

  if (!(measurementWidthPx > 0) || !(measurementHeightPx > 0)) {
    measurementWidthPx = widthPx
    measurementHeightPx = heightPx
  }

  return {
    widthPx,
    heightPx,
    dpi,
    trimmedWidthPx,
    trimmedHeightPx,
    trimmedOffsetXPx,
    trimmedOffsetYPx,
    measurementWidthPx,
    measurementHeightPx,
    effectiveDpi,
    sizingSource,
    widthIn: Number((measurementWidthPx / effectiveDpi).toFixed(2)),
    heightIn: Number((measurementHeightPx / effectiveDpi).toFixed(2)),
    measurementMode,
  }
}

function extractMetadata(preflightResult: unknown, checks: Array<Record<string, unknown>>): UploadLifecycleMetadata | null {
  const result = getResultRecord(preflightResult)
  const metadata =
    result.metadata && typeof result.metadata === 'object'
      ? (result.metadata as Record<string, unknown>)
      : null

  if (metadata) {
    const widthPx = parsePositiveNumber(metadata.widthPx)
    const heightPx = parsePositiveNumber(metadata.heightPx)
    if (widthPx > 0 && heightPx > 0) {
      const measurementWidthPx = parsePositiveNumber(metadata.measurementWidthPx) || widthPx
      const measurementHeightPx = parsePositiveNumber(metadata.measurementHeightPx) || heightPx
      const resolvedSizing = resolveMeasurementSizing(metadata)
      const effectiveDpi = resolvedSizing.effectiveDpi

      return {
        widthPx,
        heightPx,
        dpi: parsePositiveNumber(metadata.dpi),
        trimmedWidthPx: parsePositiveNumber(metadata.trimmedWidthPx),
        trimmedHeightPx: parsePositiveNumber(metadata.trimmedHeightPx),
        trimmedOffsetXPx: parsePositiveNumber(metadata.trimmedOffsetXPx),
        trimmedOffsetYPx: parsePositiveNumber(metadata.trimmedOffsetYPx),
        measurementWidthPx,
        measurementHeightPx,
        effectiveDpi,
        sizingSource: resolvedSizing.sizingSource,
        widthIn: Number((measurementWidthPx / effectiveDpi).toFixed(2)),
        heightIn: Number((measurementHeightPx / effectiveDpi).toFixed(2)),
        measurementMode:
          typeof metadata.measurementMode === 'string' && metadata.measurementMode
            ? metadata.measurementMode
            : null,
      }
    }
  }

  return extractMetadataFromChecks(checks)
}

export function applyFullCanvasMeasurementMetadata(
  metadata: UploadLifecycleMetadata | null
): UploadLifecycleMetadata | null {
  if (!metadata) return null

  const resolvedSizing = resolveMeasurementSizing(metadata)
  const effectiveDpi = resolvedSizing.effectiveDpi

  return {
    ...metadata,
    measurementWidthPx: metadata.widthPx > 0 ? metadata.widthPx : metadata.measurementWidthPx,
    measurementHeightPx: metadata.heightPx > 0 ? metadata.heightPx : metadata.measurementHeightPx,
    effectiveDpi,
    sizingSource: resolvedSizing.sizingSource,
    widthIn: Number(((metadata.widthPx > 0 ? metadata.widthPx : metadata.measurementWidthPx) / effectiveDpi).toFixed(2)),
    heightIn: Number(((metadata.heightPx > 0 ? metadata.heightPx : metadata.measurementHeightPx) / effectiveDpi).toFixed(2)),
    measurementMode: 'full',
  }
}

function deriveProblems(preflightResult: unknown, checks: Array<Record<string, unknown>>): UploadLifecycleProblem[] {
  const result = getResultRecord(preflightResult)
  const storedProblems = Array.isArray(result.problems) ? result.problems : null
  const derivedProblems: UploadLifecycleProblem[] = checks
    .filter((check) => check.status === 'warning' || check.status === 'error')
    .map((check): UploadLifecycleProblem => {
      const scope =
        check.name === 'conversion' || check.name === 'thumbnail' || check.name === 'preview'
          ? 'preview'
          : check.name === 'format' || check.name === 'fileSize' || check.name === 'pageCount'
            ? 'policy'
            : check.name === 'processing'
              ? 'processing'
              : 'measurement'

      return {
        scope,
        code: String(check.name || 'unknown'),
        severity: check.status === 'warning' ? 'warning' : 'error',
        message: String(check.message || 'Upload processing issue'),
      }
    })

  const normalizedStoredProblems: UploadLifecycleProblem[] = storedProblems
    ? storedProblems
        .filter(
          (value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'
        )
        .map((problem): UploadLifecycleProblem => ({
          scope:
            problem.scope === 'preview' ||
            problem.scope === 'policy' ||
            problem.scope === 'processing' ||
            problem.scope === 'measurement'
              ? problem.scope
              : 'processing',
          code: String(problem.code || 'unknown'),
          severity: problem.severity === 'warning' ? 'warning' : 'error',
          message: String(problem.message || 'Upload processing issue'),
        }))
    : []

  const deduped = new Map<string, UploadLifecycleProblem>()
  for (const problem of [...derivedProblems, ...normalizedStoredProblems]) {
    deduped.set(`${problem.scope}:${problem.code}:${problem.message}`, problem)
  }

  return Array.from(deduped.values())
}

export function deriveUploadItemLifecycle(item: UploadItemLike): UploadLifecycleState {
  const legacyStatus = (item.preflightStatus || 'pending') as LegacyPreflightStatus
  const result = getResultRecord(item.preflightResult)
  const checks = getChecks(item.preflightResult)
  const metadata = extractMetadata(item.preflightResult, checks)
  const problems = deriveProblems(item.preflightResult, checks)

  const storedStages =
    result.stages && typeof result.stages === 'object'
      ? (result.stages as Record<string, unknown>)
      : {}

  const storedMeasurementStatus = normalizeStageStatus(
    storedStages.measurement &&
      typeof storedStages.measurement === 'object' &&
      storedStages.measurement
      ? (storedStages.measurement as Record<string, unknown>).status
      : null
  )
  const storedPreviewStatus = normalizeStageStatus(
    storedStages.preview && typeof storedStages.preview === 'object' && storedStages.preview
      ? (storedStages.preview as Record<string, unknown>).status
      : null
  )

  const previewRecord =
    result.preview && typeof result.preview === 'object'
      ? (result.preview as Record<string, unknown>)
      : {}
  const hasPreviewAsset =
    Boolean(item.thumbnailKey) ||
    previewRecord.hasThumbnail === true ||
    previewRecord.hasPreview === true

  let measurementStatus: UploadStageStatus = 'pending'
  if (storedMeasurementStatus) {
    measurementStatus = storedMeasurementStatus
  } else if (legacyStatus === 'pending') {
    measurementStatus = 'pending'
  } else if (metadata) {
    measurementStatus = 'ready'
  } else {
    measurementStatus = 'error'
  }

  let previewStatus: UploadStageStatus = 'pending'
  if (storedPreviewStatus) {
    previewStatus = storedPreviewStatus
  } else if (legacyStatus === 'pending') {
    previewStatus = 'pending'
  } else if (item.thumbnailKey) {
    previewStatus = 'ready'
  } else if (measurementStatus === 'ready') {
    previewStatus = 'warning'
  } else {
    previewStatus = 'error'
  }

  const orderabilityStatus: UploadOrderabilityStatus =
    measurementStatus === 'pending'
      ? 'processing'
      : measurementStatus === 'error'
        ? 'blocked'
        : 'ready'

  const warnings = problems
    .filter((problem) => problem.severity === 'warning')
    .map((problem) => problem.message)
  const errors = problems
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message)

  return {
    measurementStatus,
    previewStatus,
    orderabilityStatus,
    metadata,
    problems,
    warnings,
    errors,
    hasPreview: hasPreviewAsset,
    canAddToCart: orderabilityStatus === 'ready',
    canResolveProduct: measurementStatus === 'ready',
  }
}

export function deriveUploadClientStatus(
  uploadStatus: UploadStatusValue,
  itemStates: UploadLifecycleState[]
): 'processing' | 'ready' | 'error' {
  if (!itemStates.length) {
    return uploadStatus === 'blocked' || uploadStatus === 'rejected' ? 'error' : 'processing'
  }

  if (itemStates.every((itemState) => itemState.orderabilityStatus === 'ready')) {
    return 'ready'
  }

  if (itemStates.some((itemState) => itemState.orderabilityStatus === 'blocked')) {
    return 'error'
  }

  if (uploadStatus === 'blocked' || uploadStatus === 'rejected') {
    return 'error'
  }

  return 'processing'
}

export function deriveUploadOrderabilityStatus(
  itemStates: UploadLifecycleState[]
): UploadOrderabilityStatus {
  if (!itemStates.length) return 'processing'
  if (itemStates.some((itemState) => itemState.orderabilityStatus === 'blocked')) return 'blocked'
  if (itemStates.every((itemState) => itemState.orderabilityStatus === 'ready')) return 'ready'
  return 'processing'
}
