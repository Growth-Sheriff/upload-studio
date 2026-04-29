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
  // Physical printable sheet width (inches) used to anchor inch dimensions
  // from the artwork's pixel ratio. Set per-product from builder config.
  sheetWidthIn?: number
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

const DEFAULT_SHEET_WIDTH_IN = 22

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Compute physical inch dimensions from pixel size by anchoring the shorter
 * pixel side to the printable sheet width. This is how gang-sheet presses
 * actually output: the press width is fixed (e.g. 22") and the length scales.
 *
 * IMPORTANT: pricing depends on these values. Do not multiply, round, or
 * alter the returned widthIn/heightIn except where explicitly required.
 */
export function computeSheetAnchoredInches(
  widthPx: number,
  heightPx: number,
  sheetWidthInArg?: number
): { widthIn: number; heightIn: number; effectiveDpi: number; sheetWidthIn: number } {
  const sheetWidthIn =
    typeof sheetWidthInArg === 'number' && sheetWidthInArg > 0
      ? sheetWidthInArg
      : DEFAULT_SHEET_WIDTH_IN

  if (!(widthPx > 0) || !(heightPx > 0)) {
    return { widthIn: 0, heightIn: 0, effectiveDpi: 0, sheetWidthIn }
  }

  const shortSidePx = Math.min(widthPx, heightPx)
  const longSidePx = Math.max(widthPx, heightPx)
  const isPortrait = heightPx >= widthPx
  const longSideIn = (longSidePx / shortSidePx) * sheetWidthIn
  const widthIn = Number((isPortrait ? sheetWidthIn : longSideIn).toFixed(2))
  const heightIn = Number((isPortrait ? longSideIn : sheetWidthIn).toFixed(2))
  const effectiveDpi = Math.round(shortSidePx / sheetWidthIn)
  return { widthIn, heightIn, effectiveDpi, sheetWidthIn }
}

function normalizeSizingSource(value: unknown): string | null {
  const raw = String(value || '').trim()
  return raw || null
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
  let sizingSource: string | null = null
  let measurementMode: string | null = null
  let sheetWidthInFromDetails = 0

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
      sheetWidthInFromDetails = parsePositiveNumber(details.sheetWidthIn)
      const storedSizingSource = normalizeSizingSource(details.sizingSource)
      sizingSource = storedSizingSource
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

  // Sheet-anchored physical size — pricing source of truth.
  const anchored = computeSheetAnchoredInches(
    measurementWidthPx,
    measurementHeightPx,
    sheetWidthInFromDetails
  )

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
    effectiveDpi: anchored.effectiveDpi,
    sizingSource: sizingSource || 'sheet_width_anchor',
    sheetWidthIn: anchored.sheetWidthIn,
    widthIn: anchored.widthIn,
    heightIn: anchored.heightIn,
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
      const sheetWidthInStored = parsePositiveNumber(metadata.sheetWidthIn)
      const anchored = computeSheetAnchoredInches(
        measurementWidthPx,
        measurementHeightPx,
        sheetWidthInStored
      )
      const storedSizingSource = normalizeSizingSource(metadata.sizingSource)

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
        effectiveDpi: anchored.effectiveDpi,
        sizingSource: storedSizingSource || 'sheet_width_anchor',
        sheetWidthIn: anchored.sheetWidthIn,
        widthIn: anchored.widthIn,
        heightIn: anchored.heightIn,
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

  const fullWidthPx = metadata.widthPx > 0 ? metadata.widthPx : metadata.measurementWidthPx
  const fullHeightPx = metadata.heightPx > 0 ? metadata.heightPx : metadata.measurementHeightPx
  const anchored = computeSheetAnchoredInches(fullWidthPx, fullHeightPx, metadata.sheetWidthIn)

  return {
    ...metadata,
    measurementWidthPx: fullWidthPx,
    measurementHeightPx: fullHeightPx,
    effectiveDpi: anchored.effectiveDpi,
    sizingSource: 'sheet_width_anchor',
    sheetWidthIn: anchored.sheetWidthIn,
    widthIn: anchored.widthIn,
    heightIn: anchored.heightIn,
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
