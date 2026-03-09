import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import { Job, Queue, Worker } from 'bullmq'
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
  generateThumbnail,
  PLAN_CONFIGS,
  runPreflightChecks,
  type PreflightConfig,
} from '../app/lib/preflight.server'

// Simple logger for worker (can't import from app due to module resolution)
const workerLog = {
  info: (event: string, ctx: Record<string, unknown>) => {
    console.log(`[Preflight:${event}]`, JSON.stringify(ctx))
  },
  warn: (event: string, ctx: Record<string, unknown>) => {
    console.warn(`[Preflight:${event}]`, JSON.stringify(ctx))
  },
  error: (event: string, ctx: Record<string, unknown>) => {
    console.error(`[Preflight:${event}]`, JSON.stringify(ctx))
  },
}

// PNG Magic bytes for validation
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Validate PNG file has correct header
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

// Validate downloaded file is not corrupted
async function validateDownloadedFile(filePath: string, expectedMinSize: number = 100): Promise<{ valid: boolean; size: number; error?: string }> {
  try {
    const stats = await fs.stat(filePath)
    if (stats.size < expectedMinSize) {
      return { valid: false, size: stats.size, error: `Downloaded file too small: ${stats.size} bytes (expected >= ${expectedMinSize})` }
    }
    return { valid: true, size: stats.size }
  } catch (error) {
    return { valid: false, size: 0, error: `File not found or unreadable: ${error instanceof Error ? error.message : 'Unknown'}` }
  }
}

// Get file type extension for placeholder
function getFileTypeLabel(detectedType: string | null, storageKey: string): string {
  if (detectedType === 'application/postscript') {
    const ext = path.extname(storageKey).toLowerCase()
    return ext === '.ai' ? 'AI' : 'EPS'
  }
  if (detectedType === 'application/pdf') return 'PDF'
  if (detectedType === 'image/vnd.adobe.photoshop' || detectedType === 'application/x-photoshop') return 'PSD'
  if (detectedType === 'image/tiff') return 'TIFF'
  return path.extname(storageKey).replace('.', '').toUpperCase() || 'FILE'
}

// Create placeholder thumbnail when conversion fails
async function createPlaceholderThumbnail(
  outputPath: string,
  fileType: string,
  size: number = 400
): Promise<boolean> {
  try {
    // Create a styled placeholder with file type label
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const cmd = `convert -size ${size}x${size} xc:"#f3f4f6" -gravity center -pointsize 64 -fill "#6b7280" -font "DejaVu-Sans-Bold" -annotate 0 "${fileType}" -quality 85 "${outputPath}"`
    
    await execAsync(cmd, { timeout: 10000 })
    
    const stats = await fs.stat(outputPath).catch(() => null)
    if (stats && stats.size > 100) {
      workerLog.info('PLACEHOLDER_CREATED', { fileType, outputPath: outputPath.substring(0, 50) })
      return true
    }
    return false
  } catch (error) {
    workerLog.warn('PLACEHOLDER_FAILED', { fileType, error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

// Safe file conversion with validation and graceful fallback
interface ConversionResult {
  success: boolean
  processedPath: string
  usedPlaceholder: boolean
  error?: string
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
    
    // Attempt conversion
    await convertFn()
    
    // Validate the converted PNG
    const validation = await validatePngFile(pngPath)
    
    if (!validation.valid) {
      workerLog.warn('CONVERSION_INVALID_PNG', {
        fileType: fileTypeLabel,
        error: validation.error,
      })
      
      // PNG is invalid - use original file for what we can
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
    const errorMsg = error instanceof Error ? error.message : String(error)
    workerLog.warn('CONVERSION_FAILED', {
      fileType: fileTypeLabel,
      error: errorMsg,
    })
    
    // Conversion failed - return original path, checks will use defaults
    return {
      success: false,
      processedPath: originalPath,
      usedPlaceholder: false,
      error: errorMsg,
    }
  }
}

// Initialize Prisma
const prisma = new PrismaClient()

// Redis connection for queue
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

// Preflight job data
interface PreflightJobData {
  uploadId: string
  shopId: string
  itemId: string
  storageKey: string
}

// Get S3/R2 client for remote storage
function getStorageClient(provider: string): S3Client | null {
  if (provider === 'local') {
    return null // Local storage doesn't use S3 client
  }

  if (provider === 'r2') {
    if (!process.env.R2_ACCOUNT_ID) {
      console.warn('[Preflight] R2_ACCOUNT_ID not set, cannot use R2 storage')
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

  // S3
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
  })
}

// Download file from local storage with Unicode normalization
async function downloadLocalFile(storageKey: string, localPath: string): Promise<void> {
  const uploadsDir = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads')
  // Strip local: prefix if present
  const cleanKey = storageKey.startsWith('local:') ? storageKey.replace('local:', '') : storageKey
  const dir = path.join(uploadsDir, path.dirname(cleanKey))
  const expectedFileName = path.basename(cleanKey)

  // Find file with matching NFC normalized name (handles NFD/NFC differences)
  const files = await fs.readdir(dir)
  const matchingFile = files.find((f) => f.normalize('NFC') === expectedFileName.normalize('NFC'))

  if (!matchingFile) {
    throw new Error(`File not found: ${storageKey}`)
  }

  const sourcePath = path.join(dir, matchingFile)
  await fs.copyFile(sourcePath, localPath)
}

// Upload file to local storage with Unicode normalization
async function uploadLocalFile(storageKey: string, localPath: string): Promise<void> {
  const uploadsDir = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads')
  // Strip local: prefix if present, then normalize to NFC
  const cleanKey = storageKey.startsWith('local:') ? storageKey.replace('local:', '') : storageKey
  const normalizedKey = cleanKey.normalize('NFC')
  const destPath = path.join(uploadsDir, normalizedKey)
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.copyFile(localPath, destPath)
}

// Download file from Bunny.net CDN
async function downloadFromBunny(storageKey: string, localPath: string): Promise<void> {
  const cdnUrl = process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'

  // Build URL - handle bunny: prefix and http URLs
  let url: string
  if (storageKey.startsWith('http://') || storageKey.startsWith('https://')) {
    url = storageKey
  } else if (storageKey.startsWith('bunny:')) {
    url = `${cdnUrl}/${storageKey.replace('bunny:', '')}`
  } else {
    url = `${cdnUrl}/${storageKey}`
  }

  workerLog.info('DOWNLOAD_STARTED', { provider: 'bunny', url: url.substring(0, 100), storageKey })
  const startTime = Date.now()

  const response = await fetch(url)
  if (!response.ok) {
    const durationMs = Date.now() - startTime
    workerLog.error('DOWNLOAD_FAILED', {
      provider: 'bunny',
      status: response.status,
      statusText: response.statusText,
      url: url.substring(0, 100),
      storageKey,
      durationMs,
    })
    throw new Error(`Failed to download from Bunny: ${response.status} ${response.statusText}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(localPath, buffer)
  
  const durationMs = Date.now() - startTime
  workerLog.info('DOWNLOAD_SUCCESS', {
    provider: 'bunny',
    fileSize: buffer.length,
    durationMs,
  })
}

// Upload file to Bunny.net storage
async function uploadToBunny(
  storageKey: string,
  localPath: string,
  contentType: string
): Promise<void> {
  const zone = process.env.BUNNY_STORAGE_ZONE || 'customizerappdev'
  const apiKey = process.env.BUNNY_API_KEY || ''

  // Remove bunny: prefix if present
  const key = storageKey.startsWith('bunny:') ? storageKey.replace('bunny:', '') : storageKey
  const url = `https://storage.bunnycdn.com/${zone}/${key}`

  console.log(`[Preflight] Uploading to Bunny storage: ${url}`)

  const content = await fs.readFile(localPath)

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      AccessKey: apiKey,
      'Content-Type': contentType,
    },
    body: content,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to upload to Bunny: ${response.status} ${response.statusText} - ${errorText}`
    )
  }
}

// Check if storage key is a Bunny URL or key
function isBunnyStorage(storageKey: string): boolean {
  return (
    storageKey.startsWith('bunny:') ||
    storageKey.includes('.b-cdn.net') ||
    storageKey.includes('bunnycdn.com')
  )
}

// Download file from storage (S3/R2)
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

// Upload file to storage
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

// Create queue
export const preflightQueue = new Queue<PreflightJobData>('preflight', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 1000,
  },
})

// Worker processor
const preflightWorker = new Worker<PreflightJobData>(
  'preflight',
  async (job: Job<PreflightJobData>) => {
    const { uploadId, shopId, itemId, storageKey } = job.data
    const jobStartTime = Date.now()
    
    workerLog.info('JOB_STARTED', {
      jobId: job.id,
      uploadId,
      itemId,
      storageKey: storageKey.substring(0, 80),
    })

    const tempDir = path.join(os.tmpdir(), `preflight-${itemId}`)
    await fs.mkdir(tempDir, { recursive: true })

    try {
      // Get shop info for plan config
      const shop = await prisma.shop.findUnique({ where: { id: shopId } })
      if (!shop) {
        throw new Error(`Shop not found: ${shopId}`)
      }

      const config: PreflightConfig = PLAN_CONFIGS[shop.plan] || PLAN_CONFIGS.free
      const storageProvider = shop.storageProvider || 'local'

      // Get upload item
      const item = await prisma.uploadItem.findUnique({ where: { id: itemId } })
      if (!item) {
        throw new Error(`Upload item not found: ${itemId}`)
      }

      // Verify item belongs to the expected upload (tenant isolation)
      if (item.uploadId !== uploadId) {
        throw new Error(
          `Upload item ${itemId} does not belong to upload ${uploadId} (actual: ${item.uploadId})`
        )
      }

      await job.updateProgress(10)
      console.log(`[Preflight] Downloading ${storageKey} from ${storageProvider} storage`)

      // Download file based on storage provider
      const ext = path.extname(storageKey) || '.tmp'
      const originalPath = path.join(tempDir, `original${ext}`)

      // Check for Bunny storage first (bunny: prefix or CDN URL)
      if (storageProvider === 'bunny' || isBunnyStorage(storageKey)) {
        await downloadFromBunny(storageKey, originalPath)
      } else if (storageProvider === 'local' || storageKey.startsWith('local:')) {
        await downloadLocalFile(storageKey, originalPath)
      } else {
        const client = getStorageClient(storageProvider)
        if (!client) {
          throw new Error(`Cannot initialize storage client for provider: ${storageProvider}`)
        }
        await downloadFile(client, storageKey, originalPath)
      }

      await job.updateProgress(15)

      // Validate downloaded file is not corrupted or partial
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

      workerLog.info('DOWNLOAD_VALIDATED', {
        itemId,
        size: downloadValidation.size,
      })

      await job.updateProgress(20)

      // Get file stats
      const stats = await fs.stat(originalPath)
      const fileSize = stats.size

      // Detect file type
      const detectedType = await detectFileType(originalPath)
      console.log(`[Preflight] Detected type: ${detectedType}`)

      await job.updateProgress(30)

      // Convert if needed for ANALYSIS ONLY (PDF, AI, EPS, TIFF, PSD)
      // IMPORTANT: Original file is ALWAYS preserved for merchant download
      // Conversion is ONLY used for:
      // 1. Generating thumbnail preview
      // 2. Running DPI/dimension checks
      // The converted file is NOT uploaded - it's temporary
      // 
      // GRACEFUL DEGRADATION: If conversion fails, we continue with:
      // - Original file preserved (merchant can always download)
      // - Placeholder thumbnail used
      // - Preflight status = 'warning' (not error)
      let processedPath = originalPath
      let conversionFailed = false
      let conversionError: string | undefined
      let usePlaceholderThumbnail = false

      // Get S3 client for remote storage (reuse for uploads)
      const client = storageProvider !== 'local' ? getStorageClient(storageProvider) : null

      if (detectedType === 'application/pdf') {
        const result = await safeConvertFile(
          originalPath,
          tempDir,
          detectedType,
          storageKey,
          async () => {
            const pngPath = path.join(tempDir, 'converted.png')
            await convertPdfToPng(originalPath, pngPath, 300)
          }
        )
        processedPath = result.processedPath
        conversionFailed = !result.success
        conversionError = result.error
        usePlaceholderThumbnail = conversionFailed
      } else if (detectedType === 'application/postscript') {
        const result = await safeConvertFile(
          originalPath,
          tempDir,
          detectedType,
          storageKey,
          async () => {
            const pngPath = path.join(tempDir, 'converted.png')
            await convertEpsToPng(originalPath, pngPath, 300)
          }
        )
        processedPath = result.processedPath
        conversionFailed = !result.success
        conversionError = result.error
        usePlaceholderThumbnail = conversionFailed
      } else if (detectedType === 'image/tiff') {
        const result = await safeConvertFile(
          originalPath,
          tempDir,
          detectedType,
          storageKey,
          async () => {
            const pngPath = path.join(tempDir, 'converted.png')
            await convertTiffToPng(originalPath, pngPath)
          }
        )
        processedPath = result.processedPath
        conversionFailed = !result.success
        conversionError = result.error
        usePlaceholderThumbnail = conversionFailed
      } else if (
        detectedType === 'image/vnd.adobe.photoshop' ||
        detectedType === 'application/x-photoshop'
      ) {
        const result = await safeConvertFile(
          originalPath,
          tempDir,
          detectedType,
          storageKey,
          async () => {
            const pngPath = path.join(tempDir, 'converted.png')
            await convertPsdToPng(originalPath, pngPath)
          }
        )
        processedPath = result.processedPath
        conversionFailed = !result.success
        conversionError = result.error
        usePlaceholderThumbnail = conversionFailed
      }

      await job.updateProgress(50)

      // Run preflight checks
      // If conversion failed, we run checks on original file with limited analysis
      console.log(`[Preflight] Running checks (conversionFailed: ${conversionFailed})`)
      let result = await runPreflightChecks(processedPath, detectedType || '', fileSize, config)

      // If conversion failed, add a warning check and downgrade from error to warning
      // CRITICAL: File is preserved, only analysis was limited
      if (conversionFailed) {
        result.checks.push({
          name: 'conversion',
          status: 'warning',
          message: `File preview could not be generated: ${conversionError || 'Unknown error'}. Original file is preserved and downloadable.`,
          details: {
            fileType: getFileTypeLabel(detectedType, storageKey),
            reason: conversionError,
            originalPreserved: true,
          },
        })
        // Downgrade overall to warning if it was ok (preserve existing warnings/errors)
        if (result.overall === 'ok') {
          result.overall = 'warning'
        }
        workerLog.warn('PREFLIGHT_CONVERSION_WARNING', {
          itemId,
          fileType: getFileTypeLabel(detectedType, storageKey),
          error: conversionError,
        })
      }

      await job.updateProgress(70)

      // Generate thumbnail
      // If conversion failed, use placeholder thumbnail
      console.log(`[Preflight] Generating thumbnail (usePlaceholder: ${usePlaceholderThumbnail})`)
      const thumbnailPath = path.join(tempDir, 'thumbnail.webp')
      let thumbnailGenerated = false

      if (usePlaceholderThumbnail) {
        // Create placeholder thumbnail with file type label
        const fileTypeLabel = getFileTypeLabel(detectedType, storageKey)
        thumbnailGenerated = await createPlaceholderThumbnail(thumbnailPath, fileTypeLabel, 400)
      } else {
        // Try normal thumbnail generation
        try {
          await generateThumbnail(processedPath, thumbnailPath, 400)
          thumbnailGenerated = true
        } catch (thumbError) {
          workerLog.warn('THUMBNAIL_GENERATION_FAILED', {
            itemId,
            error: thumbError instanceof Error ? thumbError.message : String(thumbError),
          })
          // Fallback to placeholder
          const fileTypeLabel = getFileTypeLabel(detectedType, storageKey)
          thumbnailGenerated = await createPlaceholderThumbnail(thumbnailPath, fileTypeLabel, 400)
        }
      }

      // Upload thumbnail - preserve bunny: prefix for proper URL generation
      // storageKey might be "bunny:path/to/file.psd" - we need "bunny:path/to/file_thumb.webp"
      const thumbnailKey = storageKey.replace(/\.[^.]+$/, '_thumb.webp')

      // Determine actual upload path (strip bunny: prefix for upload)
      const uploadPath = thumbnailKey.replace(/^bunny:/, '')

      // Only upload thumbnail if it was generated successfully
      if (thumbnailGenerated) {
        try {
          if (storageProvider === 'bunny' || storageKey.startsWith('bunny:')) {
            await uploadToBunny(uploadPath, thumbnailPath, 'image/webp')
          } else if (storageProvider === 'local') {
            await uploadLocalFile(uploadPath, thumbnailPath)
          } else if (client) {
            await uploadFile(client, uploadPath, thumbnailPath, 'image/webp')
          }
          workerLog.info('THUMBNAIL_UPLOADED', { uploadPath: uploadPath.substring(0, 60) })
        } catch (uploadError) {
          workerLog.error('THUMBNAIL_UPLOAD_FAILED', {
            itemId,
            error: uploadError instanceof Error ? uploadError.message : String(uploadError),
          })
          // Continue without thumbnail - not a critical failure
        }
      } else {
        workerLog.warn('THUMBNAIL_NOT_GENERATED', { itemId, storageKey: storageKey.substring(0, 60) })
      }

      await job.updateProgress(90)

      // Determine final thumbnailKey with proper prefix for URL generation
      // If Bunny storage, ensure bunny: prefix is present
      // If thumbnail wasn't generated, set to null
      const finalThumbnailKey = thumbnailGenerated
        ? storageProvider === 'bunny' || storageKey.startsWith('bunny:')
          ? thumbnailKey.startsWith('bunny:')
            ? thumbnailKey
            : `bunny:${uploadPath}`
          : uploadPath
        : null

      // Update database
      // IMPORTANT: previewKey = storageKey (original file) - merchant always gets original
      // CRITICAL: Original file is NEVER deleted, even on conversion failure
      await prisma.uploadItem.update({
        where: { id: itemId },
        data: {
          preflightStatus: result.overall,
          preflightResult: result as any,
          thumbnailKey: finalThumbnailKey,
          previewKey: storageKey, // Always use original file for merchant download - NEVER DELETE
        },
      })

      workerLog.info('DB_UPDATED', {
        itemId,
        status: result.overall,
        hasThumbnail: !!finalThumbnailKey,
        conversionFailed,
      })

      // Update upload status
      const allItems = await prisma.uploadItem.findMany({
        where: { uploadId },
        select: { preflightStatus: true },
      })

      // Get autoApprove setting from shop settings (not upload metadata)
      // shop is already fetched at the beginning of this function
      const shopSettings = (shop.settings as Record<string, any>) || {}
      const autoApprove = shopSettings.autoApprove !== false // Default to true

      const hasError = allItems.some((i) => i.preflightStatus === 'error')
      const hasWarning = allItems.some((i) => i.preflightStatus === 'warning')
      const allDone = allItems.every((i) => i.preflightStatus !== 'pending')

      if (allDone) {
        let uploadStatus = 'needs_review'
        if (hasError) {
          uploadStatus = 'blocked'
        } else if (!hasWarning && autoApprove) {
          // All OK and autoApprove enabled - set to ready
          uploadStatus = 'ready'
        } else if (!hasWarning && !autoApprove) {
          // All OK but autoApprove disabled - needs manual review
          uploadStatus = 'pending_approval'
        } else {
          // Has warnings - needs review regardless of autoApprove
          uploadStatus = 'needs_review'
        }

        await prisma.upload.updateMany({
          where: { id: uploadId, shopId },
          data: {
            status: uploadStatus,
            preflightSummary: {
              overall: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
              completedAt: new Date().toISOString(),
              itemCount: allItems.length,
              autoApproved: autoApprove && !hasError && !hasWarning,
            },
          },
        })
      }

      await job.updateProgress(100)
      
      const durationMs = Date.now() - jobStartTime
      workerLog.info('JOB_COMPLETED', {
        jobId: job.id,
        uploadId,
        itemId,
        result: result.overall,
        durationMs,
        thumbnailKey: finalThumbnailKey?.substring(0, 60),
      })

      return {
        status: result.overall,
        checks: result.checks,
        thumbnailKey: finalThumbnailKey,
      }
    } catch (error) {
      const durationMs = Date.now() - jobStartTime
      workerLog.error('JOB_FAILED', {
        jobId: job.id,
        uploadId,
        itemId,
        storageKey: storageKey.substring(0, 80),
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      })

      // Update item with error status
      await prisma.uploadItem.update({
        where: { id: itemId },
        data: {
          preflightStatus: 'error',
          preflightResult: {
            overall: 'error',
            checks: [
              {
                name: 'processing',
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
              },
            ],
          },
        },
      })

      throw error
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  },
  {
    connection,
    concurrency: 3,
    limiter: {
      max: 20,
      duration: 60000,
    },
  }
)

preflightWorker.on('completed', (job) => {
  console.log(`[Preflight Worker] Job ${job.id} completed`)
})

preflightWorker.on('failed', (job, err) => {
  console.error(`[Preflight Worker] Job ${job?.id} failed:`, err.message)
})

console.log('[Preflight Worker] Started and waiting for jobs...')

export default preflightWorker
