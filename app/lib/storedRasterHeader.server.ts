import type { Prisma } from '@prisma/client'
import prisma from './prisma.server'
import { isFastRasterUpload } from './fastRaster'
import { resolveFinishedSheetSettings } from './finishedSheetMeasurement'
import { applyFinishedSheetMeasurementPolicy } from './mainProductMeasurement.server'
import {
  parsePngJpegHeader,
  PLAN_CONFIGS,
  type PreflightCheck,
  type PreflightConfig,
} from './preflight.server'
import { selectProductConfigForIdentity } from './productConfigIdentity.server'
import { metadataFromProbe } from './sheetResolution.server'
import { shopifyProductIdCandidates } from './shopifyProductIdentity'
import { readStoredObjectPrefix, type StorageConfig } from './storage.server'
import { updateUploadAggregateStatus } from './uploadAggregateStatus.server'
import { deriveUploadItemLifecycle, type UploadLifecycleMetadata } from './uploadLifecycle.server'
import { storageConfigForShop } from './uploadUrls.server'

export const STORED_RASTER_HEADER_BYTES = 64 * 1024

export interface ClientRasterHeaderProbe {
  format?: unknown
  widthPx?: unknown
  heightPx?: unknown
  dpi?: unknown
  dpiSource?: unknown
}

type PrefixReader = (
  config: StorageConfig,
  storageKey: string,
  maxBytes: number
) => Promise<Buffer>

interface HeaderProjectionInput {
  storageConfig: StorageConfig
  storageKey: string
  fileSize: number
  clientProbe?: ClientRasterHeaderProbe | null
  config: PreflightConfig
  readPrefix?: PrefixReader
}

export type StoredRasterHeaderProjection =
  | {
      kind: 'ready'
      preflightStatus: 'ok' | 'warning' | 'error'
      preflightResult: Record<string, unknown>
      metadata: UploadLifecycleMetadata
    }
  | {
      kind: 'blocked'
      preflightStatus: 'error'
      preflightResult: Record<string, unknown>
      metadata: null
    }

function numberOrZero(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function clientHeaderAudit(
  clientProbe: ClientRasterHeaderProbe | null | undefined,
  server: { width: number; height: number; dpi: number; dpiSource?: string | null }
) {
  const clientWidth = Math.round(numberOrZero(clientProbe?.widthPx))
  const clientHeight = Math.round(numberOrZero(clientProbe?.heightPx))
  const clientDpi = numberOrZero(clientProbe?.dpi)
  return {
    reported: Boolean(clientProbe),
    pixelDimensionsMatched:
      clientWidth > 0 &&
      clientHeight > 0 &&
      clientWidth === server.width &&
      clientHeight === server.height,
    client: {
      format: String(clientProbe?.format || '').slice(0, 32) || null,
      widthPx: clientWidth || null,
      heightPx: clientHeight || null,
      dpi: clientDpi || null,
      dpiSource: String(clientProbe?.dpiSource || '').slice(0, 64) || null,
    },
    server: {
      widthPx: server.width,
      heightPx: server.height,
      dpi: server.dpi || null,
      dpiSource: server.dpiSource || null,
    },
  }
}

function failedProjection(message: string, code: string): StoredRasterHeaderProjection {
  const checks: PreflightCheck[] = [
    { name: 'imageAnalysis', status: 'error', message },
  ]
  return {
    kind: 'blocked',
    preflightStatus: 'error',
    metadata: null,
    preflightResult: {
      overall: 'error',
      measurementBasis: 'full_page',
      processingMode: 'header_fast_path',
      checks,
      problems: [{ scope: 'processing', code, severity: 'error', message }],
      headerValidation: {
        version: 1,
        status: 'error',
        byteLimit: STORED_RASTER_HEADER_BYTES,
        validatedAt: new Date().toISOString(),
      },
      stages: {
        measurement: { status: 'error' },
        preview: { status: 'pending', hasThumbnail: false, usedPlaceholder: false },
        orderability: { status: 'blocked' },
      },
      capabilities: {
        canAddToCart: false,
        canResolveProduct: false,
        hasPreview: false,
      },
      preview: { hasThumbnail: false, usedPlaceholder: false },
    },
  }
}

/** Pure bounded-read validator. It never downloads the complete object and
 * never calls ImageMagick. Browser facts are retained only as an audit. */
export async function validateStoredRasterHeader(
  input: HeaderProjectionInput
): Promise<StoredRasterHeaderProjection> {
  let prefix: Buffer
  try {
    prefix = await (input.readPrefix || readStoredObjectPrefix)(
      input.storageConfig,
      input.storageKey,
      STORED_RASTER_HEADER_BYTES
    )
  } catch {
    return failedProjection(
      'The uploaded PNG/JPEG object could not be read. Please upload the file again.',
      'stored_object_missing'
    )
  }

  let header: ReturnType<typeof parsePngJpegHeader>
  try {
    header = parsePngJpegHeader(prefix)
  } catch {
    header = null
  }
  if (!header || !(header.width > 0) || !(header.height > 0)) {
    return failedProjection(
      'The uploaded PNG/JPEG header is unreadable. Please upload the file again.',
      'raster_header_unreadable'
    )
  }

  const maxPrintableWidthIn = Number(input.config.maxPrintableWidthIn) || 22.5
  const fitToleranceIn = Number(input.config.fitToleranceIn) || 0.02
  const baseMetadata = metadataFromProbe({
    widthPx: header.width,
    heightPx: header.height,
    dpi: header.dpi || null,
    dpiSource: header.dpiSource || null,
    maxPrintableWidthIn,
    fitToleranceIn,
  })
  const metadata = applyFinishedSheetMeasurementPolicy(baseMetadata, {
    measurementPolicy: 'finished_sheet',
    maxPrintableWidthIn,
    fitToleranceIn,
  }) as UploadLifecycleMetadata

  const checks: PreflightCheck[] = []
  const sizeMB = Math.max(0, input.fileSize) / (1024 * 1024)
  let overall: 'ok' | 'warning' | 'error' = 'ok'
  if (sizeMB > input.config.maxFileSizeMB) {
    overall = 'error'
    checks.push({
      name: 'fileSize',
      status: 'error',
      value: sizeMB.toFixed(2),
      message: `File size (${sizeMB.toFixed(2)}MB) exceeds limit (${input.config.maxFileSizeMB}MB)`,
    })
  } else {
    checks.push({
      name: 'fileSize',
      status: 'ok',
      value: sizeMB.toFixed(2),
      message: `File size: ${sizeMB.toFixed(2)}MB`,
    })
  }

  const detectedMime = header.format === 'PNG' ? 'image/png' : 'image/jpeg'
  checks.push({ name: 'format', status: 'ok', value: detectedMime, message: `Format: ${detectedMime}` })

  const effectiveDpi = numberOrZero(metadata.effectiveDpi)
  if (effectiveDpi < input.config.requiredDPI) {
    if (overall === 'ok') overall = 'warning'
    checks.push({
      name: 'dpi',
      status: 'warning',
      value: effectiveDpi,
      message: `Effective print DPI is ${effectiveDpi} (recommended ${input.config.requiredDPI}). Print may appear pixelated at full size.`,
      details: { source: metadata.sizingSource, sheetWidthIn: maxPrintableWidthIn },
    })
  } else {
    checks.push({
      name: 'dpi',
      status: 'ok',
      value: effectiveDpi,
      message: `Effective print DPI: ${effectiveDpi}`,
      details: { source: metadata.sizingSource, sheetWidthIn: maxPrintableWidthIn },
    })
  }

  checks.push({
    name: 'dimensions',
    status: 'ok',
    value: `${header.width}x${header.height}`,
    message: `Dimensions: ${header.width} x ${header.height} px (${metadata.widthIn}\" x ${metadata.heightIn}\")`,
    details: {
      width: header.width,
      height: header.height,
      trimmedWidth: header.width,
      trimmedHeight: header.height,
      trimmedOffsetX: 0,
      trimmedOffsetY: 0,
      measurementWidth: header.width,
      measurementHeight: header.height,
      documentDpi: header.dpi || 0,
      documentDpiSource: header.dpiSource || null,
      embeddedDpi: header.dpi || 0,
      embeddedDpiSource: header.dpiSource || null,
      effectiveDpi: metadata.effectiveDpi,
      sizingSource: metadata.sizingSource,
      sheetWidthIn: maxPrintableWidthIn,
      measurementMode: 'full',
      widthIn: metadata.widthIn,
      heightIn: metadata.heightIn,
    },
  })
  checks.push({
    name: 'transparency',
    status: header.hasAlpha ? 'ok' : 'warning',
    value: header.hasAlpha,
    message: header.hasAlpha ? 'Has transparency (alpha channel)' : 'No transparency detected',
  })
  if (!header.hasAlpha && input.config.requireTransparency && overall === 'ok') overall = 'warning'
  checks.push({
    name: 'colorProfile',
    status: 'ok',
    value: header.colorspace,
    message: `Color profile: ${header.colorspace}`,
  })

  const audit = clientHeaderAudit(input.clientProbe, header)
  return {
    kind: 'ready',
    preflightStatus: overall,
    metadata,
    preflightResult: {
      overall,
      measurementBasis: 'full_page',
      processingMode: 'header_fast_path',
      checks,
      metadata,
      headerValidation: {
        version: 1,
        status: 'validated',
        format: header.format,
        byteLimit: STORED_RASTER_HEADER_BYTES,
        bytesRead: prefix.length,
        validatedAt: new Date().toISOString(),
        ...audit,
      },
    },
  }
}

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function hasDurableHeaderMeasurement(item: {
  preflightStatus: string
  preflightResult: unknown
  thumbnailKey: string | null
}): boolean {
  const validation = resultRecord(item.preflightResult).headerValidation
  return (
    validation != null &&
    typeof validation === 'object' &&
    (validation as Record<string, unknown>).status === 'validated' &&
    deriveUploadItemLifecycle(item).measurementStatus === 'ready'
  )
}

export async function ensureStoredRasterHeaderMeasurement(input: {
  uploadId: string
  shopId: string
  itemId: string
  clientProbe?: ClientRasterHeaderProbe | null
  force?: boolean
}): Promise<{
  handled: boolean
  uploadStatus: string | null
  item: {
    id: string
    storageKey: string
    originalName: string | null
    mimeType: string | null
    fileSize: number | null
    preflightStatus: string
    preflightResult: unknown
    thumbnailKey: string | null
    previewKey: string | null
  } | null
}> {
  const item = await prisma.uploadItem.findFirst({
    where: { id: input.itemId, uploadId: input.uploadId, upload: { shopId: input.shopId } },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
      previewKey: true,
      upload: { select: { productId: true } },
    },
  })
  if (!item || !isFastRasterUpload(item)) {
    return { handled: false, uploadStatus: null, item: item || null }
  }
  if (!input.force && hasDurableHeaderMeasurement(item)) {
    return { handled: true, uploadStatus: null, item }
  }

  const shop = await prisma.shop.findUnique({
    where: { id: input.shopId },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      settings: true,
      storageProvider: true,
      storageConfig: true,
    },
  })
  if (!shop) throw new Error(`Shop not found: ${input.shopId}`)

  let builderConfig: Record<string, unknown> | null = null
  if (item.upload.productId) {
    const configs = await prisma.productConfig.findMany({
      where: {
        shopId: input.shopId,
        productId: { in: shopifyProductIdCandidates(item.upload.productId) },
      },
      select: { productId: true, builderConfig: true },
    })
    const selected = selectProductConfigForIdentity({
      rows: configs,
      productId: item.upload.productId,
      shopId: input.shopId,
      source: 'storedRasterHeader',
    })
    builderConfig = selected?.builderConfig && typeof selected.builderConfig === 'object'
      ? (selected.builderConfig as Record<string, unknown>)
      : null
  }

  const settings = resolveFinishedSheetSettings(builderConfig)
  const baseConfig = PLAN_CONFIGS[shop.plan] || PLAN_CONFIGS.free
  const projection = await validateStoredRasterHeader({
    storageConfig: storageConfigForShop(shop),
    storageKey: item.storageKey,
    fileSize: item.fileSize || 0,
    clientProbe: input.clientProbe,
    config: {
      ...baseConfig,
      measurementBasis: 'full_page',
      maxPrintableWidthIn: settings.maxPrintableWidthIn,
      fitToleranceIn: settings.fitToleranceIn,
    },
  })

  const hasThumbnail = Boolean(item.thumbnailKey)
  const previewStatus = hasThumbnail
    ? 'ready'
    : projection.kind === 'ready' && projection.preflightStatus !== 'error'
      ? 'pending'
      : 'error'
  const provisionalResult = {
    ...resultRecord(item.preflightResult),
    ...projection.preflightResult,
    preview: { hasThumbnail, usedPlaceholder: false },
  }
  const provisionalLifecycle = deriveUploadItemLifecycle({
    preflightStatus: projection.preflightStatus,
    preflightResult: provisionalResult,
    thumbnailKey: item.thumbnailKey,
  })
  const nextResult = {
    ...provisionalResult,
    metadata: projection.metadata,
    problems: provisionalLifecycle.problems,
    stages: {
      measurement: { status: projection.kind === 'ready' ? 'ready' : 'error' },
      preview: { status: previewStatus, hasThumbnail, usedPlaceholder: false },
      orderability: {
        status: projection.kind === 'ready' && provisionalLifecycle.orderabilityStatus !== 'blocked'
          ? 'ready'
          : 'blocked',
      },
    },
    capabilities: {
      canAddToCart:
        projection.kind === 'ready' && provisionalLifecycle.orderabilityStatus !== 'blocked',
      canResolveProduct: projection.kind === 'ready',
      hasPreview: hasThumbnail,
    },
  }

  await prisma.uploadItem.updateMany({
    where: { id: item.id, uploadId: input.uploadId, upload: { shopId: input.shopId } },
    data: {
      preflightStatus: projection.preflightStatus,
      preflightResult: nextResult as unknown as Prisma.InputJsonValue,
      previewKey: item.previewKey || item.storageKey,
    },
  })

  const saved = await prisma.uploadItem.findFirst({
    where: { id: item.id, uploadId: input.uploadId, upload: { shopId: input.shopId } },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
      previewKey: true,
    },
  })
  const uploadStatus = await updateUploadAggregateStatus(input.uploadId, input.shopId, shop.settings)
  return { handled: true, uploadStatus, item: saved }
}
