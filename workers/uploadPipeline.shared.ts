import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import Redis from 'ioredis'
import os from 'os'
import path from 'path'
import {
  convertEpsToPng,
  convertPdfToPng,
  convertPsdToPng,
  convertTiffToPng,
  detectFileType,
  PLAN_CONFIGS,
  type PreflightConfig,
} from '../app/lib/preflight.server'
import { deriveUploadItemLifecycle } from '../app/lib/uploadLifecycle.server'
import {
  MEASURE_PREFLIGHT_QUEUE_NAME,
  PREVIEW_RENDER_QUEUE_NAME,
  type UploadPipelineJobData,
} from '../app/lib/uploadQueues'

export interface PreparedUploadJobContext {
  uploadId: string
  shopId: string
  itemId: string
  storageKey: string
  shop: {
    id: string
    plan: string
    settings: unknown
    storageProvider: string
  }
  item: {
    id: string
    uploadId: string
    preflightStatus: string
    preflightResult: unknown
    thumbnailKey: string | null
    previewKey: string | null
  }
  config: PreflightConfig
  storageProvider: ActualStorageProvider
  storageObjectKey: string
  tempDir: string
  originalPath: string
  detectedType: string | null
  fileSize: number
}

interface ConversionResult {
  success: boolean
  processedPath: string
  usedPlaceholder: boolean
  error?: string
}

export interface RasterizedFileResult {
  processedPath: string
  conversionFailed: boolean
  conversionError?: string
  usedPlaceholder: boolean
  fileTypeLabel: string
}

type UploadStatusValue =
  | 'processing'
  | 'ready'
  | 'pending_approval'
  | 'needs_review'
  | 'blocked'

type ActualStorageProvider = 'local' | 'bunny' | 'r2'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const prisma = new PrismaClient()

export const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

export const workerLog = {
  info: (event: string, ctx: Record<string, unknown>) => {
    console.log(`[UploadPipeline:${event}]`, JSON.stringify(ctx))
  },
  warn: (event: string, ctx: Record<string, unknown>) => {
    console.warn(`[UploadPipeline:${event}]`, JSON.stringify(ctx))
  },
  error: (event: string, ctx: Record<string, unknown>) => {
    console.error(`[UploadPipeline:${event}]`, JSON.stringify(ctx))
  },
}

connection.on('error', (error) => {
  workerLog.error('REDIS_CONNECTION_ERROR', {
    error: error instanceof Error ? error.message : String(error),
  })
})

export { MEASURE_PREFLIGHT_QUEUE_NAME, PREVIEW_RENDER_QUEUE_NAME, type UploadPipelineJobData }

function getShopSettingsValue(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== 'object') return undefined
  return (settings as Record<string, unknown>)[key]
}

function normalizeResultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {}
}

async function validatePngFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const stats = await fs.stat(filePath)
    if (stats.size < 100) {
      return { valid: false, error: `File too small: ${stats.size} bytes` }
    }

    const fd = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(8)
    await fd.read(buffer, 0, 8, 0)
    await fd.close()

    if (!buffer.equals(PNG_MAGIC)) {
      return { valid: false, error: 'Invalid PNG magic bytes (IHDR corruption)' }
    }

    return { valid: true }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function validateDownloadedFile(
  filePath: string,
  expectedMinSize: number = 100
): Promise<{ valid: boolean; size: number; error?: string }> {
  try {
    const stats = await fs.stat(filePath)
    if (stats.size < expectedMinSize) {
      return {
        valid: false,
        size: stats.size,
        error: `Downloaded file too small: ${stats.size} bytes (expected >= ${expectedMinSize})`,
      }
    }
    return { valid: true, size: stats.size }
  } catch (error) {
    return {
      valid: false,
      size: 0,
      error: `File not found or unreadable: ${error instanceof Error ? error.message : 'Unknown'}`,
    }
  }
}

export function getResultRecord(value: unknown): Record<string, unknown> {
  return normalizeResultRecord(value)
}

export function getFileTypeLabel(detectedType: string | null, storageKey: string): string {
  if (detectedType === 'application/postscript') {
    const ext = path.extname(storageKey).toLowerCase()
    return ext === '.ai' ? 'AI' : 'EPS'
  }
  if (detectedType === 'application/pdf') return 'PDF'
  if (
    detectedType === 'image/vnd.adobe.photoshop' ||
    detectedType === 'application/x-photoshop'
  ) {
    return 'PSD'
  }
  if (detectedType === 'image/tiff') return 'TIFF'
  return path.extname(storageKey).replace('.', '').toUpperCase() || 'FILE'
}

export async function createPlaceholderThumbnail(
  outputPath: string,
  fileType: string,
  size: number = 400
): Promise<boolean> {
  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const cmd = `convert -size ${size}x${size} xc:"#f3f4f6" -gravity center -pointsize 64 -fill "#6b7280" -font "DejaVu-Sans-Bold" -annotate 0 "${fileType}" -quality 85 "${outputPath}"`

    await execAsync(cmd, { timeout: 10000 })

    const stats = await fs.stat(outputPath).catch(() => null)
    if (stats && stats.size > 100) {
      workerLog.info('PLACEHOLDER_CREATED', { fileType, outputPath: outputPath.substring(0, 80) })
      return true
    }
    return false
  } catch (error) {
    workerLog.warn('PLACEHOLDER_FAILED', {
      fileType,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function safeConvertFile(
  originalPath: string,
  tempDir: string,
  detectedType: string | null,
  storageKey: string,
  convertFn: () => Promise<void>
): Promise<ConversionResult> {
  const pngPath = path.join(tempDir, 'converted.png')
  const fileTypeLabel = getFileTypeLabel(detectedType, storageKey)

  try {
    workerLog.info('CONVERSION_STARTED', { fileType: fileTypeLabel, detectedType })
    await convertFn()

    const validation = await validatePngFile(pngPath)
    if (!validation.valid) {
      workerLog.warn('CONVERSION_INVALID_PNG', {
        fileType: fileTypeLabel,
        error: validation.error,
      })
      return {
        success: false,
        processedPath: originalPath,
        usedPlaceholder: false,
        error: validation.error,
      }
    }

    workerLog.info('CONVERSION_SUCCESS', { fileType: fileTypeLabel })
    return {
      success: true,
      processedPath: pngPath,
      usedPlaceholder: false,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    workerLog.warn('CONVERSION_FAILED', {
      fileType: fileTypeLabel,
      error: errorMessage,
    })
    return {
      success: false,
      processedPath: originalPath,
      usedPlaceholder: false,
      error: errorMessage,
    }
  }
}

export async function rasterizeFileForProcessing(
  originalPath: string,
  tempDir: string,
  detectedType: string | null,
  storageKey: string
): Promise<RasterizedFileResult> {
  const fileTypeLabel = getFileTypeLabel(detectedType, storageKey)

  if (detectedType === 'application/pdf') {
    const result = await safeConvertFile(originalPath, tempDir, detectedType, storageKey, async () => {
      await convertPdfToPng(originalPath, path.join(tempDir, 'converted.png'), 300)
    })
    return {
      processedPath: result.processedPath,
      conversionFailed: !result.success,
      conversionError: result.error,
      usedPlaceholder: result.usedPlaceholder,
      fileTypeLabel,
    }
  }

  if (detectedType === 'application/postscript') {
    const result = await safeConvertFile(originalPath, tempDir, detectedType, storageKey, async () => {
      await convertEpsToPng(originalPath, path.join(tempDir, 'converted.png'), 300)
    })
    return {
      processedPath: result.processedPath,
      conversionFailed: !result.success,
      conversionError: result.error,
      usedPlaceholder: result.usedPlaceholder,
      fileTypeLabel,
    }
  }

  if (detectedType === 'image/tiff') {
    const result = await safeConvertFile(originalPath, tempDir, detectedType, storageKey, async () => {
      await convertTiffToPng(originalPath, path.join(tempDir, 'converted.png'))
    })
    return {
      processedPath: result.processedPath,
      conversionFailed: !result.success,
      conversionError: result.error,
      usedPlaceholder: result.usedPlaceholder,
      fileTypeLabel,
    }
  }

  if (
    detectedType === 'image/vnd.adobe.photoshop' ||
    detectedType === 'application/x-photoshop'
  ) {
    const result = await safeConvertFile(originalPath, tempDir, detectedType, storageKey, async () => {
      await convertPsdToPng(originalPath, path.join(tempDir, 'converted.png'))
    })
    return {
      processedPath: result.processedPath,
      conversionFailed: !result.success,
      conversionError: result.error,
      usedPlaceholder: result.usedPlaceholder,
      fileTypeLabel,
    }
  }

  return {
    processedPath: originalPath,
    conversionFailed: false,
    usedPlaceholder: false,
    fileTypeLabel,
  }
}

function resolveStorageProvider(
  storageKey: string,
  fallbackProvider: string | null | undefined
): ActualStorageProvider {
  if (
    storageKey.startsWith('bunny:') ||
    storageKey.includes('.b-cdn.net') ||
    storageKey.includes('bunnycdn.com')
  ) {
    return 'bunny'
  }
  if (
    storageKey.startsWith('r2:') ||
    storageKey.includes('.r2.dev') ||
    storageKey.includes('r2.cloudflarestorage.com')
  ) {
    return 'r2'
  }
  if (storageKey.startsWith('local:')) {
    return 'local'
  }
  if (fallbackProvider === 'bunny' || fallbackProvider === 'r2') {
    return fallbackProvider
  }
  return 'local'
}

export function stripStoragePrefix(storageKey: string): string {
  return storageKey.replace(/^(bunny|r2|local):/, '')
}

function getStorageClient(provider: string): S3Client | null {
  if (provider === 'local') {
    return null
  }

  if (provider === 'r2') {
    if (!process.env.R2_ACCOUNT_ID) {
      console.warn('[UploadPipeline] R2_ACCOUNT_ID not set, cannot use R2 storage')
      return null
    }
    return new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    })
  }

  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
  })
}

async function downloadLocalFile(storageKey: string, localPath: string): Promise<void> {
  const uploadsDir = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads')
  const cleanKey = storageKey.startsWith('local:') ? storageKey.replace('local:', '') : storageKey
  const dir = path.join(uploadsDir, path.dirname(cleanKey))
  const expectedFileName = path.basename(cleanKey)

  const files = await fs.readdir(dir)
  const matchingFile = files.find((value) => value.normalize('NFC') === expectedFileName.normalize('NFC'))

  if (!matchingFile) {
    throw new Error(`File not found: ${storageKey}`)
  }

  const sourcePath = path.join(dir, matchingFile)
  await fs.copyFile(sourcePath, localPath)
}

async function uploadLocalFile(storageKey: string, localPath: string): Promise<void> {
  const uploadsDir = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads')
  const cleanKey = storageKey.startsWith('local:') ? storageKey.replace('local:', '') : storageKey
  const normalizedKey = cleanKey.normalize('NFC')
  const destinationPath = path.join(uploadsDir, normalizedKey)
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.copyFile(localPath, destinationPath)
}

async function downloadFromBunny(storageKey: string, localPath: string): Promise<void> {
  const cdnUrl = process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'
  let url: string

  if (storageKey.startsWith('http://') || storageKey.startsWith('https://')) {
    url = storageKey
  } else if (storageKey.startsWith('bunny:')) {
    url = `${cdnUrl}/${storageKey.replace('bunny:', '')}`
  } else {
    url = `${cdnUrl}/${storageKey}`
  }

  const startTime = Date.now()
  workerLog.info('DOWNLOAD_STARTED', {
    provider: 'bunny',
    storageKey: storageKey.substring(0, 100),
    url: url.substring(0, 100),
  })

  const response = await fetch(url)
  if (!response.ok) {
    const durationMs = Date.now() - startTime
    workerLog.error('DOWNLOAD_FAILED', {
      provider: 'bunny',
      status: response.status,
      statusText: response.statusText,
      durationMs,
      storageKey: storageKey.substring(0, 100),
    })
    throw new Error(`Failed to download from Bunny: ${response.status} ${response.statusText}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(localPath, buffer)

  workerLog.info('DOWNLOAD_SUCCESS', {
    provider: 'bunny',
    durationMs: Date.now() - startTime,
    fileSize: buffer.length,
  })
}

async function uploadToBunny(
  storageKey: string,
  localPath: string,
  contentType: string
): Promise<void> {
  const zone = process.env.BUNNY_STORAGE_ZONE || 'customizerappdev'
  const apiKey = process.env.BUNNY_API_KEY || ''
  const key = storageKey.startsWith('bunny:') ? storageKey.replace('bunny:', '') : storageKey
  const url = `https://storage.bunnycdn.com/${zone}/${key}`
  const content = await fs.readFile(localPath)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        AccessKey: apiKey,
        'Content-Type': contentType,
      },
      body: content,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Bunny upload timed out after 15000ms')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to upload to Bunny: ${response.status} ${response.statusText} - ${errorText}`
    )
  }
}

function isBunnyStorage(storageKey: string): boolean {
  return (
    storageKey.startsWith('bunny:') ||
    storageKey.includes('.b-cdn.net') ||
    storageKey.includes('bunnycdn.com')
  )
}

async function downloadFile(client: S3Client, key: string, localPath: string): Promise<void> {
  const bucket = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'product-3d-customizer'
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  )

  if (!response.Body) {
    throw new Error('Empty response body')
  }

  const chunks: Uint8Array[] = []
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }

  await fs.writeFile(localPath, Buffer.concat(chunks))
}

async function uploadFile(
  client: S3Client,
  key: string,
  localPath: string,
  contentType: string
): Promise<void> {
  const bucket = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'product-3d-customizer'
  const content = await fs.readFile(localPath)

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    })
  )
}

export async function uploadGeneratedAsset(
  storageProvider: ActualStorageProvider,
  storageKey: string,
  localPath: string,
  contentType: string
): Promise<void> {
  const uploadPath = stripStoragePrefix(storageKey)

  if (storageProvider === 'bunny' || storageKey.startsWith('bunny:')) {
    await uploadToBunny(uploadPath, localPath, contentType)
    return
  }

  if (storageProvider === 'local') {
    await uploadLocalFile(uploadPath, localPath)
    return
  }

  const client = getStorageClient(storageProvider)
  if (!client) {
    throw new Error(`Cannot initialize storage client for provider: ${storageProvider}`)
  }

  await uploadFile(client, uploadPath, localPath, contentType)
}

export async function prepareUploadJobContext(
  jobData: UploadPipelineJobData,
  tempPrefix: string
): Promise<PreparedUploadJobContext> {
  const { uploadId, shopId, itemId, storageKey } = jobData
  const tempDir = path.join(os.tmpdir(), `${tempPrefix}-${itemId}`)
  await fs.mkdir(tempDir, { recursive: true })

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      plan: true,
      settings: true,
      storageProvider: true,
    },
  })

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`)
  }

  const item = await prisma.uploadItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      uploadId: true,
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
      previewKey: true,
    },
  })

  if (!item) {
    throw new Error(`Upload item not found: ${itemId}`)
  }

  if (item.uploadId !== uploadId) {
    throw new Error(
      `Upload item ${itemId} does not belong to upload ${uploadId} (actual: ${item.uploadId})`
    )
  }

  const storageProvider = resolveStorageProvider(storageKey, shop.storageProvider)
  const storageObjectKey = stripStoragePrefix(storageKey)
  const ext = path.extname(storageObjectKey) || '.tmp'
  const originalPath = path.join(tempDir, `original${ext}`)

  if (storageProvider === 'bunny' || isBunnyStorage(storageKey)) {
    await downloadFromBunny(storageKey, originalPath)
  } else if (storageProvider === 'local' || storageKey.startsWith('local:')) {
    await downloadLocalFile(storageKey, originalPath)
  } else {
    const client = getStorageClient(storageProvider)
    if (!client) {
      throw new Error(`Cannot initialize storage client for provider: ${storageProvider}`)
    }
    await downloadFile(client, storageObjectKey, originalPath)
  }

  const downloadValidation = await validateDownloadedFile(originalPath, 100)
  if (!downloadValidation.valid) {
    workerLog.error('DOWNLOAD_VALIDATION_FAILED', {
      itemId,
      storageKey: storageKey.substring(0, 60),
      error: downloadValidation.error,
      size: downloadValidation.size,
    })
    throw new Error(`Downloaded file validation failed: ${downloadValidation.error}`)
  }

  const stats = await fs.stat(originalPath)
  const detectedType = await detectFileType(originalPath)

  // Pull product-specific sheet width (maxWidthIn) from ProductConfig so the
  // preflight measurement anchors physical inches to the actual press width.
  // Falls back to plan default when no product config exists.
  let sheetWidthIn: number | undefined
  try {
    const upload = await prisma.upload.findUnique({
      where: { id: uploadId },
      select: { productId: true },
    })
    if (upload?.productId) {
      const productConfig = await prisma.productConfig.findFirst({
        where: { shopId, productId: upload.productId },
        select: { builderConfig: true },
      })
      const builderConfig = productConfig?.builderConfig as Record<string, unknown> | null
      const candidate = Number(builderConfig?.maxWidthIn)
      if (Number.isFinite(candidate) && candidate > 0) {
        sheetWidthIn = candidate
      }
    }
  } catch (configError) {
    workerLog.warn('SHEET_WIDTH_LOOKUP_FAILED', {
      uploadId,
      shopId,
      error: configError instanceof Error ? configError.message : String(configError),
    })
  }

  const baseConfig = PLAN_CONFIGS[shop.plan] || PLAN_CONFIGS.free
  const config: PreflightConfig =
    sheetWidthIn !== undefined ? { ...baseConfig, sheetWidthIn } : baseConfig

  return {
    uploadId,
    shopId,
    itemId,
    storageKey,
    shop,
    item,
    config,
    storageProvider,
    storageObjectKey,
    tempDir,
    originalPath,
    detectedType,
    fileSize: stats.size,
  }
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors.
  }
}

export async function waitForMeasurementResolution(
  itemId: string,
  timeoutMs: number = 20000
): Promise<{
  id: string
  preflightStatus: string
  preflightResult: unknown
  thumbnailKey: string | null
  previewKey: string | null
} | null> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const item = await prisma.uploadItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        preflightStatus: true,
        preflightResult: true,
        thumbnailKey: true,
        previewKey: true,
      },
    })

    if (!item) return null
    if (item.preflightStatus !== 'pending') return item

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return prisma.uploadItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
      previewKey: true,
    },
  })
}

export async function updateUploadAggregateStatus(
  uploadId: string,
  shopId: string,
  shopSettings: unknown
): Promise<UploadStatusValue> {
  const items = await prisma.uploadItem.findMany({
    where: { uploadId },
    select: {
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
    },
  })

  const itemStates = items.map((item) =>
    deriveUploadItemLifecycle({
      preflightStatus: item.preflightStatus,
      preflightResult: item.preflightResult,
      thumbnailKey: item.thumbnailKey,
    })
  )

  const autoApprove = getShopSettingsValue(shopSettings, 'autoApprove') !== false
  const hasError = items.some((item) => item.preflightStatus === 'error')
  const hasWarning = items.some((item) => item.preflightStatus === 'warning')
  const hasBlockedMeasurement =
    itemStates.some((itemState) => itemState.orderabilityStatus === 'blocked') &&
    itemStates.every((itemState) => itemState.measurementStatus !== 'pending')
  const allMeasurementsResolved = itemStates.every(
    (itemState) => itemState.measurementStatus !== 'pending'
  )

  let uploadStatus: UploadStatusValue
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
  } else if (!hasWarning && !autoApprove) {
    uploadStatus = 'pending_approval'
    summaryOverall = 'ok'
  } else {
    uploadStatus = 'needs_review'
    summaryOverall = 'warning'
  }

  await prisma.upload.updateMany({
    where: { id: uploadId, shopId },
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

  return uploadStatus
}
