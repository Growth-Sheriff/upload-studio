import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import Redis from 'ioredis'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import {
  convertEpsToPng,
  convertPdfToPng,
  convertPsdToPng,
  convertTiffToPng,
  detectFileType,
  getImageDimensionsFast,
  PLAN_CONFIGS,
  type PreflightConfig,
} from '../app/lib/preflight.server'
import {
  getRuntimeMeasurementBasis,
} from '../app/lib/customerPricingModel.server'
import { resolveFinishedSheetSettings } from '../app/lib/finishedSheetMeasurement'
import { selectProductConfigForIdentity } from '../app/lib/productConfigIdentity.server'
import { shopifyProductIdCandidates } from '../app/lib/shopifyProductIdentity'
import { redactUploadLogLocation } from '../app/lib/uploadLogger.server'
import {
  MEASURE_PREFLIGHT_QUEUE_NAME,
  PREVIEW_RENDER_QUEUE_NAME,
  shouldPrelockLargeUpload,
  shouldSerializeLargeImage,
  type UploadPipelineJobData,
} from '../app/lib/uploadQueues'

export interface PreparedUploadJobContext {
  uploadId: string
  shopId: string
  itemId: string
  storageKey: string
  shop: {
    id: string
    shopDomain: string
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

export interface LargeImageLease {
  megapixels: number
  release: () => Promise<void>
}

export { updateUploadAggregateStatus } from '../app/lib/uploadAggregateStatus.server'

type ActualStorageProvider = 'local' | 'bunny' | 'r2'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const LARGE_IMAGE_LOCK_KEY = 'upload-pipeline:large-image'
const LARGE_IMAGE_LOCK_TTL_MS = 2 * 60 * 1000
export const LARGE_IMAGE_RETRY_DELAY_MS = 15_000

export class LargeImageSlotBusyError extends Error {
  constructor(itemId: string) {
    super(`Large-image processing slot is busy (${itemId}).`)
    this.name = 'LargeImageSlotBusyError'
  }
}

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

const RELEASE_LARGE_IMAGE_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`

const RENEW_LARGE_IMAGE_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
  end
  return 0
`

/**
 * Large raster jobs run in separate measure/preview processes, so a local
 * semaphore cannot protect container memory. A Redis lease serializes only
 * files above 300 MP across both queues. A busy slot is reported immediately
 * so BullMQ can delay the job without occupying a worker concurrency slot.
 */
async function acquireLargeImageRedisLease(
  itemId: string,
  imageInfo: { width: number; height: number } | null
): Promise<LargeImageLease> {
  const pixels = imageInfo
    ? Math.max(0, imageInfo.width) * Math.max(0, imageInfo.height)
    : 0
  const token = `${process.pid}:${itemId}:${randomUUID()}`
  const acquired = await connection.set(
    LARGE_IMAGE_LOCK_KEY,
    token,
    'PX',
    LARGE_IMAGE_LOCK_TTL_MS,
    'NX'
  )
  if (acquired !== 'OK') {
    throw new LargeImageSlotBusyError(itemId)
  }

  const renewal = setInterval(() => {
    void connection
      .eval(
        RENEW_LARGE_IMAGE_LOCK_SCRIPT,
        1,
        LARGE_IMAGE_LOCK_KEY,
        token,
        String(LARGE_IMAGE_LOCK_TTL_MS)
      )
      .then((renewed) => {
        if (Number(renewed) !== 1) {
          workerLog.error('LARGE_IMAGE_LOCK_OWNERSHIP_LOST', { itemId })
        }
      })
      .catch((error) =>
        workerLog.error('LARGE_IMAGE_LOCK_RENEW_FAILED', {
          itemId,
          error: error instanceof Error ? error.message : String(error),
        })
      )
  }, 30_000)
  renewal.unref()

  let released = false
  workerLog.info('LARGE_IMAGE_LOCK_ACQUIRED', {
    itemId,
    widthPx: imageInfo?.width || null,
    heightPx: imageInfo?.height || null,
    megapixels: imageInfo ? Number((pixels / 1_000_000).toFixed(2)) : null,
  })
  return {
    megapixels: pixels / 1_000_000,
    release: async () => {
      if (released) return
      released = true
      clearInterval(renewal)
      await connection.eval(RELEASE_LARGE_IMAGE_LOCK_SCRIPT, 1, LARGE_IMAGE_LOCK_KEY, token)
    },
  }
}

export function safeLocationForLog(value: string): string {
  return redactUploadLogLocation(value) || ''
}

/** Reserve the cross-worker slot before downloading a known-large object.
 * This prevents a delayed 81–154 MB job from downloading the same object on
 * every 15-second lock retry. Smaller objects are classified by pixels after
 * download so ordinary uploads retain normal concurrency. */
export async function acquireLargeUploadPrelock(
  itemId: string,
  fileSize: unknown
): Promise<LargeImageLease | null> {
  if (!shouldPrelockLargeUpload(fileSize)) return null
  return acquireLargeImageRedisLease(itemId, null)
}

export async function acquireLargeImageLease(
  filePath: string,
  itemId: string,
  detectedType?: string | null
): Promise<LargeImageLease | null> {
  const mayNeedRasterization =
    Boolean(detectedType?.startsWith('image/')) ||
    detectedType === 'application/pdf' ||
    detectedType === 'application/postscript'
  if (!mayNeedRasterization) return null

  const imageInfo = detectedType?.startsWith('image/')
    ? await getImageDimensionsFast(filePath, detectedType).catch((error) => {
        workerLog.warn('LARGE_IMAGE_PROBE_FAILED', {
          itemId,
          detectedType,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      })
    : null
  // Unknown raster dimensions are serialized conservatively. A malformed
  // header must never turn memory protection off.
  if (imageInfo && !shouldSerializeLargeImage(imageInfo.width, imageInfo.height)) return null
  return acquireLargeImageRedisLease(itemId, imageInfo)
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

export async function compareAndSwapUploadItemResult(input: {
  itemId: string
  expectedStatus: string
  expectedResult: unknown
  nextStatus: string
  nextResult: Record<string, unknown>
  expectedThumbnailKey: string | null
  expectedPreviewKey: string | null
  thumbnailKey: string | null
  previewKey: string | null
}): Promise<boolean> {
  const expectedJson = JSON.stringify(input.expectedResult ?? null)
  const nextJson = JSON.stringify(input.nextResult)
  const updated = await prisma.$executeRaw`
    update upload_items
    set preflight_status = ${input.nextStatus},
        preflight_result_json = ${nextJson}::jsonb,
        thumbnail_key = ${input.thumbnailKey},
        preview_key = ${input.previewKey}
    where id = ${input.itemId}
      and preflight_status = ${input.expectedStatus}
      and coalesce(preflight_result_json, 'null'::jsonb) = ${expectedJson}::jsonb
      and thumbnail_key is not distinct from ${input.expectedThumbnailKey}
      and preview_key is not distinct from ${input.expectedPreviewKey}
  `
  return updated === 1
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

const BUNNY_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

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
    storageKey: safeLocationForLog(storageKey).substring(0, 100),
    url: safeLocationForLog(url).substring(0, 100),
  })

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, BUNNY_DOWNLOAD_TIMEOUT_MS)
  timeout.unref()

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      const durationMs = Date.now() - startTime
      workerLog.error('DOWNLOAD_FAILED', {
        provider: 'bunny',
        status: response.status,
        statusText: response.statusText,
        durationMs,
        storageKey: safeLocationForLog(storageKey).substring(0, 100),
      })
      throw new Error(`Failed to download from Bunny: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Failed to download from Bunny: empty response body')
    }
    await pipeline(response.body as any, createWriteStream(localPath))
    const stats = await fs.stat(localPath)

    workerLog.info('DOWNLOAD_SUCCESS', {
      provider: 'bunny',
      durationMs: Date.now() - startTime,
      fileSize: stats.size,
    })
  } catch (error) {
    await fs.rm(localPath, { force: true }).catch(() => undefined)
    if (timedOut) {
      workerLog.error('DOWNLOAD_FAILED', {
        provider: 'bunny',
        durationMs: Date.now() - startTime,
        storageKey: safeLocationForLog(storageKey).substring(0, 100),
        reason: 'timeout',
      })
      throw new Error(
        `Bunny download timed out after ${BUNNY_DOWNLOAD_TIMEOUT_MS}ms`,
        { cause: error }
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
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

  await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(localPath))
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
  const { uploadId, shopId, itemId, storageKey: queuedStorageKey } = jobData
  // Unique per run: a stalled re-run of the same item must never share (and
  // delete) the directory of a run that is still working.
  const tempDir = path.join(
    os.tmpdir(),
    `${tempPrefix}-${itemId}-${process.pid}-${Date.now().toString(36)}-${randomUUID()}`
  )
  await fs.mkdir(tempDir, { recursive: true })

  try {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      settings: true,
      storageProvider: true,
    },
  })

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`)
  }

  const item = await prisma.uploadItem.findFirst({
    where: {
      id: itemId,
      uploadId,
      upload: { shopId },
    },
    select: {
      id: true,
      uploadId: true,
      storageKey: true,
      preflightStatus: true,
      preflightResult: true,
      thumbnailKey: true,
      previewKey: true,
      upload: { select: { productId: true } },
    },
  })

  if (!item) {
    throw new Error(`Upload item not found: ${itemId}`)
  }

  const storageKey = item.storageKey
  if (queuedStorageKey !== storageKey) {
    workerLog.warn('STALE_QUEUE_STORAGE_KEY_IGNORED', {
      uploadId,
      shopId,
      itemId,
    })
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
      storageKey: safeLocationForLog(storageKey).substring(0, 60),
      error: downloadValidation.error,
      size: downloadValidation.size,
    })
    throw new Error(`Downloaded file validation failed: ${downloadValidation.error}`)
  }

  const stats = await fs.stat(originalPath)
  const detectedType = await detectFileType(originalPath)






  let finishedSheetSettings = resolveFinishedSheetSettings(null)
  try {
    if (item.upload.productId) {
      const productConfigs = await prisma.productConfig.findMany({
        where: {
          shopId,
          productId: { in: shopifyProductIdCandidates(item.upload.productId) },
        },
        select: { productId: true, builderConfig: true },
      })
      const productConfig = selectProductConfigForIdentity({
        rows: productConfigs,
        productId: item.upload.productId,
        shopId,
        source: 'uploadPipeline',
      })
      const builderConfig = productConfig?.builderConfig as Record<string, unknown> | null
      finishedSheetSettings = resolveFinishedSheetSettings(builderConfig)
    }
  } catch (configError) {
    workerLog.warn('SHEET_WIDTH_LOOKUP_FAILED', {
      uploadId,
      shopId,
      error: configError instanceof Error ? configError.message : String(configError),
    })
  }

  const baseConfig = PLAN_CONFIGS[shop.plan] || PLAN_CONFIGS.free
  const storedResult = getResultRecord(item.preflightResult)
  const storedMeasurementBasis =
    storedResult.measurementBasis === 'full_page' || storedResult.measurementBasis === 'artwork_bounds'
      ? storedResult.measurementBasis
      : null
  const config: PreflightConfig = {
    ...baseConfig,
    measurementBasis:
      storedMeasurementBasis || getRuntimeMeasurementBasis(shop.shopDomain, shop.settings),
    maxPrintableWidthIn: finishedSheetSettings.maxPrintableWidthIn,
    fitToleranceIn: finishedSheetSettings.fitToleranceIn,
  }

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
  } catch (error) {
    await cleanupTempDir(tempDir)
    throw error
  }
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors.
  }
}

/** Read measurement state once. Preview workers must yield their concurrency
 * slot and hand a durable thumbnail to the measurement writer instead of
 * polling this row in-process. */
export async function readMeasurementResolution(itemId: string): Promise<{
  id: string
  preflightStatus: string
  preflightResult: unknown
  thumbnailKey: string | null
  previewKey: string | null
} | null> {
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
