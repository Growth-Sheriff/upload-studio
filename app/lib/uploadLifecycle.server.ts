import {
  DEFAULT_MAX_PRINTABLE_WIDTH_IN,
  isWithinFinishedSheetLimit,
  normalizeFinishedSheet,
} from './finishedSheetMeasurement'

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
  documentDpi?: number
  documentDpiSource?: string | null
  trimmedWidthPx: number
  trimmedHeightPx: number
  trimmedOffsetXPx: number
  trimmedOffsetYPx: number
  measurementWidthPx: number
  measurementHeightPx: number
  effectiveDpi: number
  sizingSource: string | null


  sheetWidthIn?: number



  sheetLengthIn?: number
  widthIn: number
  heightIn: number
  measurementMode: string | null
  measurementProjectionVersion?: number
  measurementProjectionPolicy?: string | null
  /** Runtime provenance flag: the preflight row already contained physical
   * dimensions. Keep those facts for historical/admin display; an active
   * finished-sheet resolve may still apply today's explicit product settings. */
  usesStoredPhysicalDimensions?: boolean
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

export interface UploadItemLike {
  preflightStatus?: string | null
  preflightResult?: unknown
  thumbnailKey?: string | null
}

const DEFAULT_PRINTABLE_WIDTH_IN = DEFAULT_MAX_PRINTABLE_WIDTH_IN

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

























export function computeSheetAnchoredInches(
  widthPx: number,
  heightPx: number,
  sheetWidthInArg?: number,
  sheetLengthInArg?: number
): {
  widthIn: number
  heightIn: number
  effectiveDpi: number
  sheetWidthIn: number
  sheetLengthIn?: number
} {
  const sheetWidthIn =
    typeof sheetWidthInArg === 'number' && sheetWidthInArg > 0
      ? sheetWidthInArg
      : DEFAULT_PRINTABLE_WIDTH_IN
  const sheetLengthIn =
    typeof sheetLengthInArg === 'number' && sheetLengthInArg > 0
      ? sheetLengthInArg
      : undefined

  if (!(widthPx > 0) || !(heightPx > 0)) {
    return { widthIn: 0, heightIn: 0, effectiveDpi: 0, sheetWidthIn, sheetLengthIn }
  }




  const shortSheetIn =
    sheetLengthIn !== undefined ? Math.min(sheetWidthIn, sheetLengthIn) : sheetWidthIn

  const shortSidePx = Math.min(widthPx, heightPx)
  const longSidePx = Math.max(widthPx, heightPx)
  const isPortrait = heightPx >= widthPx
  const longSideIn = (longSidePx / shortSidePx) * shortSheetIn
  const widthIn = Number((isPortrait ? shortSheetIn : longSideIn).toFixed(4))
  const heightIn = Number((isPortrait ? longSideIn : shortSheetIn).toFixed(4))
  const effectiveDpi = Math.round(shortSidePx / shortSheetIn)
  return { widthIn, heightIn, effectiveDpi, sheetWidthIn, sheetLengthIn }
}

export function computeDocumentDpiInches(
  widthPx: number,
  heightPx: number,
  documentDpiArg?: number
): {
  widthIn: number
  heightIn: number
  effectiveDpi: number
} | null {
  const documentDpi = parsePositiveNumber(documentDpiArg)
  if (!(widthPx > 0) || !(heightPx > 0) || !(documentDpi > 1) || documentDpi > 10000) {
    return null
  }

  return {
    widthIn: Number((widthPx / documentDpi).toFixed(4)),
    heightIn: Number((heightPx / documentDpi).toFixed(4)),
    effectiveDpi: Number(documentDpi.toFixed(4)),
  }
}

export interface FinishedSheetSize {
  widthIn: number
  heightIn: number
}

export interface ResolvedDimensions {
  widthIn: number
  heightIn: number
  effectiveDpi: number
  sheetWidthIn: number
  sheetLengthIn?: number
  sizingSource: string
}

// Adobe Photoshop/Illustrator assign 72 DPI when opening a PNG that has no
// embedded resolution (pHYs/JFIF). Mirroring that behavior gives us the same
// inch dimensions the user sees in their design tool — which is what they
// expect when picking a sheet variant.
const ADOBE_DEFAULT_DPI = 72

export function resolveBestDimensions(
  widthPx: number,
  heightPx: number,
  documentDpi: number,
  anchored: {
    widthIn: number
    heightIn: number
    effectiveDpi: number
    sheetWidthIn: number
    sheetLengthIn?: number
  },
  fallbackSizingSource: string,
  fitToleranceIn = 0
): ResolvedDimensions {
  const documentSized = computeDocumentDpiInches(widthPx, heightPx, documentDpi || undefined)
  if (documentSized) {
    return {
      widthIn: documentSized.widthIn,
      heightIn: documentSized.heightIn,
      effectiveDpi: documentSized.effectiveDpi,
      sheetWidthIn: anchored.sheetWidthIn,
      sheetLengthIn: anchored.sheetLengthIn,
      sizingSource: 'document_dpi',
    }
  }

  // No embedded DPI. Try Adobe's 72 DPI default first — if the resulting size
  // fits within the roll width, the file is almost certainly a smaller design
  // (like a web-export from ImageReady at 72 DPI) and should map to a smaller
  // variant. Only fall through to anchoring when even the 72 DPI reading is
  // wider than the roll, which means the file genuinely is a full-width gang
  // sheet design that needs to be sized to the roll.
  const maxPrintableWidthIn =
    anchored.sheetWidthIn > 0 ? anchored.sheetWidthIn : DEFAULT_MAX_PRINTABLE_WIDTH_IN
  const adobeSized = computeDocumentDpiInches(widthPx, heightPx, ADOBE_DEFAULT_DPI)
  if (adobeSized) {
    const shortEdgeIn = Math.min(adobeSized.widthIn, adobeSized.heightIn)
    if (isWithinFinishedSheetLimit(shortEdgeIn, maxPrintableWidthIn, fitToleranceIn)) {
      return {
        widthIn: adobeSized.widthIn,
        heightIn: adobeSized.heightIn,
        effectiveDpi: adobeSized.effectiveDpi,
        sheetWidthIn: anchored.sheetWidthIn,
        sheetLengthIn: anchored.sheetLengthIn,
        sizingSource: 'adobe_default_dpi',
      }
    }
  }

  return {
    widthIn: anchored.widthIn,
    heightIn: anchored.heightIn,
    effectiveDpi: anchored.effectiveDpi,
    sheetWidthIn: anchored.sheetWidthIn,
    sheetLengthIn: anchored.sheetLengthIn,
    sizingSource: fallbackSizingSource,
  }
}

export function computePrintableWidthAnchoredInches(
  widthPx: number,
  heightPx: number,
  maxPrintableWidthInArg?: number,
  sheetSizes: FinishedSheetSize[] = [],
  fitToleranceIn = 0
): {
  widthIn: number
  heightIn: number
  effectiveDpi: number
  sheetWidthIn: number
  sheetLengthIn?: number
} {
  const maxPrintableWidthIn =
    typeof maxPrintableWidthInArg === 'number' && maxPrintableWidthInArg > 0
      ? maxPrintableWidthInArg
      : DEFAULT_PRINTABLE_WIDTH_IN

  if (!(widthPx > 0) || !(heightPx > 0)) {
    return {
      widthIn: 0,
      heightIn: 0,
      effectiveDpi: 0,
      sheetWidthIn: maxPrintableWidthIn,
    }
  }

  // A no-DPI export can still encode a merchant-sold sheet size in its pixel
  // aspect ratio (for example 6600x3600 is 22x12 at 300 DPI). The nominal
  // variant width is checked against the same visible press limit before its
  // ratio can calibrate a no-DPI file. The same visible fit tolerance used at
  // checkout absorbs one-pixel export rounding here as well.
  const pixelRatio = Math.max(widthPx, heightPx) / Math.min(widthPx, heightPx)
  const exactSheet = sheetSizes
    .map((sheet) => {
      const configuredWidthIn = Number(sheet.widthIn)
      const configuredLengthIn = Number(sheet.heightIn)
      const normalized = normalizeFinishedSheet(configuredWidthIn, configuredLengthIn)
      if (!normalized) return null
      if (
        !isWithinFinishedSheetLimit(
          configuredWidthIn,
          maxPrintableWidthIn,
          fitToleranceIn
        )
      ) {
        return null
      }
      const projectedLengthIn = pixelRatio * normalized.widthIn
      const differenceIn = Math.abs(projectedLengthIn - normalized.lengthIn)
      return differenceIn <= fitToleranceIn + Number.EPSILON * 16
        ? { sheet: { widthIn: configuredWidthIn, heightIn: configuredLengthIn }, normalized, differenceIn }
        : null
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort(
      (left, right) =>
        left.differenceIn - right.differenceIn ||
        left.sheet.heightIn - right.sheet.heightIn ||
        left.sheet.widthIn - right.sheet.widthIn
    )[0]

  if (exactSheet) {
    const shortEdge = exactSheet.normalized.widthIn
    const longEdge = exactSheet.normalized.lengthIn
    const landscape = widthPx >= heightPx
    return {
      widthIn: Number((landscape ? longEdge : shortEdge).toFixed(4)),
      heightIn: Number((landscape ? shortEdge : longEdge).toFixed(4)),
      effectiveDpi: Math.round(Math.min(widthPx, heightPx) / shortEdge),
      sheetWidthIn: maxPrintableWidthIn,
      // Keep the commercial width x length contract here too: the second
      // configured variant dimension is its sold film length.
      sheetLengthIn: Number(exactSheet.sheet.heightIn.toFixed(4)),
    }
  }

  return computeSheetAnchoredInches(widthPx, heightPx, maxPrintableWidthIn)
}

function normalizeSizingSource(value: unknown): string | null {
  const raw = String(value || '').trim()
  return raw || null
}

function parseEmbeddedDpiFromSizingDetail(value: unknown): number {
  const match = String(value || '').match(/embedded_dpi=([0-9.]+)/i)
  return match ? parsePositiveNumber(match[1]) : 0
}

function parseEmbeddedDpiSourceFromSizingDetail(value: unknown): string | null {
  const match = String(value || '').match(/\bsource=([^) ,]+)/i)
  return match ? normalizeSizingSource(match[1]) : null
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
  let documentDpi = 0
  let documentDpiSource: string | null = null
  let trimmedWidthPx = 0
  let trimmedHeightPx = 0
  let trimmedOffsetXPx = 0
  let trimmedOffsetYPx = 0
  let measurementWidthPx = 0
  let measurementHeightPx = 0
  let sizingSource: string | null = null
  let measurementMode: string | null = null
  let sheetWidthInFromDetails = 0
  let sheetLengthInFromDetails = 0

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
      sheetLengthInFromDetails = parsePositiveNumber(details.sheetLengthIn)
      documentDpi =
        parsePositiveNumber(details.documentDpi) ||
        parsePositiveNumber(details.embeddedDpi) ||
        parseEmbeddedDpiFromSizingDetail(details.sizingSourceDetail) ||
        documentDpi
      documentDpiSource =
        normalizeSizingSource(details.documentDpiSource) ||
        normalizeSizingSource(details.embeddedDpiSource) ||
        parseEmbeddedDpiSourceFromSizingDetail(details.sizingSourceDetail) ||
        documentDpiSource
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


  const anchored = computeSheetAnchoredInches(
    measurementWidthPx,
    measurementHeightPx,
    sheetWidthInFromDetails,
    sheetLengthInFromDetails || undefined
  )
  const resolved = resolveBestDimensions(
    measurementWidthPx,
    measurementHeightPx,
    documentDpi,
    anchored,
    sizingSource || 'sheet_width_anchor'
  )

  return {
    widthPx,
    heightPx,
    dpi: documentDpi || dpi,
    documentDpi,
    documentDpiSource,
    trimmedWidthPx,
    trimmedHeightPx,
    trimmedOffsetXPx,
    trimmedOffsetYPx,
    measurementWidthPx,
    measurementHeightPx,
    effectiveDpi: resolved.effectiveDpi,
    sizingSource: resolved.sizingSource,
    sheetWidthIn: resolved.sheetWidthIn,
    sheetLengthIn: resolved.sheetLengthIn,
    widthIn: resolved.widthIn,
    heightIn: resolved.heightIn,
    measurementMode,
  }
}

function extractMetadata(preflightResult: unknown, checks: Array<Record<string, unknown>>): UploadLifecycleMetadata | null {
  const result = getResultRecord(preflightResult)
  const projection =
    result.measurementProjection && typeof result.measurementProjection === 'object'
      ? (result.measurementProjection as Record<string, unknown>)
      : null
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
      const sheetLengthInStored = parsePositiveNumber(metadata.sheetLengthIn)
      const documentDpi =
        parsePositiveNumber(metadata.documentDpi) ||
        parsePositiveNumber(metadata.embeddedDpi)
      const documentDpiSource =
        normalizeSizingSource(metadata.documentDpiSource) ||
        normalizeSizingSource(metadata.embeddedDpiSource) ||
        normalizeSizingSource(metadata.dpiSource)
      const anchored = computeSheetAnchoredInches(
        measurementWidthPx,
        measurementHeightPx,
        sheetWidthInStored,
        sheetLengthInStored || undefined
      )
      const storedSizingSource = normalizeSizingSource(metadata.sizingSource)
      const projectionVersion = Number(projection?.version)
      const projectionPolicy =
        typeof projection?.policy === 'string' ? projection.policy : null
      const storedWidthIn = parsePositiveNumber(metadata.widthIn)
      const storedHeightIn = parsePositiveNumber(metadata.heightIn)
      const storedEffectiveDpi = parsePositiveNumber(metadata.effectiveDpi)
      const hasStoredPhysicalDimensions = storedWidthIn > 0 && storedHeightIn > 0
      const hasCanonicalProjection =
        hasStoredPhysicalDimensions &&
        ((projectionVersion === 1 && projectionPolicy === 'main_product_roll_width') ||
          (projectionVersion === 2 && projectionPolicy === 'finished_sheet'))
      const resolved = resolveBestDimensions(
        measurementWidthPx,
        measurementHeightPx,
        documentDpi,
        anchored,
        storedSizingSource || 'sheet_width_anchor'
      )

      return {
        widthPx,
        heightPx,
        dpi: documentDpi || parsePositiveNumber(metadata.dpi),
        documentDpi,
        documentDpiSource,
        trimmedWidthPx: parsePositiveNumber(metadata.trimmedWidthPx),
        trimmedHeightPx: parsePositiveNumber(metadata.trimmedHeightPx),
        trimmedOffsetXPx: parsePositiveNumber(metadata.trimmedOffsetXPx),
        trimmedOffsetYPx: parsePositiveNumber(metadata.trimmedOffsetYPx),
        measurementWidthPx,
        measurementHeightPx,
        effectiveDpi: hasStoredPhysicalDimensions
          ? storedEffectiveDpi || resolved.effectiveDpi
          : resolved.effectiveDpi,
        sizingSource: hasStoredPhysicalDimensions
          ? storedSizingSource || resolved.sizingSource
          : resolved.sizingSource,
        sheetWidthIn: hasStoredPhysicalDimensions
          ? sheetWidthInStored || resolved.sheetWidthIn
          : resolved.sheetWidthIn,
        sheetLengthIn: hasStoredPhysicalDimensions
          ? sheetLengthInStored || resolved.sheetLengthIn
          : resolved.sheetLengthIn,
        widthIn: hasStoredPhysicalDimensions ? storedWidthIn : resolved.widthIn,
        heightIn: hasStoredPhysicalDimensions ? storedHeightIn : resolved.heightIn,
        measurementMode:
          typeof metadata.measurementMode === 'string' && metadata.measurementMode
            ? metadata.measurementMode
            : null,
        usesStoredPhysicalDimensions: hasStoredPhysicalDimensions,
        ...(hasCanonicalProjection
          ? {
              measurementProjectionVersion: projectionVersion,
              measurementProjectionPolicy: projectionPolicy,
            }
          : {}),
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
  const storedDimensionsCoverFullCanvas =
    metadata.usesStoredPhysicalDimensions === true &&
    metadata.widthIn > 0 &&
    metadata.heightIn > 0 &&
    (metadata.measurementMode === 'full' ||
      (metadata.measurementWidthPx === fullWidthPx &&
        metadata.measurementHeightPx === fullHeightPx))

  if (
    storedDimensionsCoverFullCanvas ||
    (((metadata.measurementProjectionVersion === 1 &&
      metadata.measurementProjectionPolicy === 'main_product_roll_width') ||
      (metadata.measurementProjectionVersion === 2 &&
        metadata.measurementProjectionPolicy === 'finished_sheet')) &&
      metadata.widthIn > 0 &&
      metadata.heightIn > 0)
  ) {
    return { ...metadata, measurementMode: 'full' }
  }

  const anchored = computeSheetAnchoredInches(
    fullWidthPx,
    fullHeightPx,
    metadata.sheetWidthIn,
    metadata.sheetLengthIn
  )
  const documentDpi = parsePositiveNumber(metadata.documentDpi)
  const resolved = resolveBestDimensions(
    fullWidthPx,
    fullHeightPx,
    documentDpi,
    anchored,
    'sheet_width_anchor'
  )

  return {
    ...metadata,
    measurementWidthPx: fullWidthPx,
    measurementHeightPx: fullHeightPx,
    effectiveDpi: resolved.effectiveDpi,
    sizingSource: resolved.sizingSource,
    sheetWidthIn: resolved.sheetWidthIn,
    sheetLengthIn: resolved.sheetLengthIn,
    widthIn: resolved.widthIn,
    heightIn: resolved.heightIn,
    measurementMode: 'full',
  }
}

export function applyArtworkBoundsMeasurementMetadata(
  metadata: UploadLifecycleMetadata | null
): UploadLifecycleMetadata | null {
  if (!metadata) return null

  const fullWidthPx = metadata.widthPx > 0 ? metadata.widthPx : metadata.measurementWidthPx
  const fullHeightPx = metadata.heightPx > 0 ? metadata.heightPx : metadata.measurementHeightPx
  const trimmedWidthPx = metadata.trimmedWidthPx > 0 ? metadata.trimmedWidthPx : fullWidthPx
  const trimmedHeightPx = metadata.trimmedHeightPx > 0 ? metadata.trimmedHeightPx : fullHeightPx

  // Preserve the physical scale established by the base measurement. In
  // particular, a no-DPI file is first anchored using its full page; trimming
  // whitespace must not stretch the remaining artwork back out to roll width.
  const baseWidthPx = metadata.measurementWidthPx > 0 ? metadata.measurementWidthPx : fullWidthPx
  const baseHeightPx = metadata.measurementHeightPx > 0 ? metadata.measurementHeightPx : fullHeightPx
  const widthInPerPixel = baseWidthPx > 0 && metadata.widthIn > 0 ? metadata.widthIn / baseWidthPx : 0
  const heightInPerPixel = baseHeightPx > 0 && metadata.heightIn > 0 ? metadata.heightIn / baseHeightPx : 0
  const fallbackDpi = parsePositiveNumber(metadata.documentDpi) || parsePositiveNumber(metadata.effectiveDpi)

  const widthIn = widthInPerPixel > 0
    ? trimmedWidthPx * widthInPerPixel
    : fallbackDpi > 0
      ? trimmedWidthPx / fallbackDpi
      : 0
  const heightIn = heightInPerPixel > 0
    ? trimmedHeightPx * heightInPerPixel
    : fallbackDpi > 0
      ? trimmedHeightPx / fallbackDpi
      : 0

  return {
    ...metadata,
    measurementWidthPx: trimmedWidthPx,
    measurementHeightPx: trimmedHeightPx,
    widthIn: Number(widthIn.toFixed(2)),
    heightIn: Number(heightIn.toFixed(2)),
    measurementMode:
      trimmedWidthPx !== fullWidthPx || trimmedHeightPx !== fullHeightPx ? 'trimmed' : 'full',
  }
}

export function applyMeasurementBasisMetadata(
  metadata: UploadLifecycleMetadata | null,
  basis: 'full_page' | 'artwork_bounds'
): UploadLifecycleMetadata | null {
  return basis === 'artwork_bounds'
    ? applyArtworkBoundsMeasurementMetadata(metadata)
    : applyFullCanvasMeasurementMetadata(metadata)
}

export function getStoredMeasurementBasis(
  preflightResult: unknown,
  _fallback: 'full_page' | 'artwork_bounds'
): 'full_page' | 'artwork_bounds' {
  const result = getResultRecord(preflightResult)
  return result.measurementBasis === 'full_page' || result.measurementBasis === 'artwork_bounds'
    ? result.measurementBasis
    : 'full_page'
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

  const hasBlockingProblem = problems.some((problem) => problem.severity === 'error')
  const orderabilityStatus: UploadOrderabilityStatus =
    measurementStatus === 'pending'
      ? 'processing'
      : measurementStatus === 'error' || legacyStatus === 'error' || hasBlockingProblem
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

  if (uploadStatus === 'blocked' || uploadStatus === 'rejected') {
    return 'error'
  }

  if (itemStates.every((itemState) => itemState.orderabilityStatus === 'ready')) {
    return 'ready'
  }

  if (itemStates.some((itemState) => itemState.orderabilityStatus === 'blocked')) {
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
