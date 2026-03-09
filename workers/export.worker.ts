/**
 * Export Worker
 * Creates ZIP archives of approved uploads with manifest
 *
 * Job Payload:
 * {
 *   jobId: string,
 *   shopId: string
 * }
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PrismaClient } from '@prisma/client'
import archiver from 'archiver'
import { Job, Worker } from 'bullmq'
import { createObjectCsvStringifier } from 'csv-writer'
import { createWriteStream, mkdirSync, rmSync } from 'fs'
import fs from 'fs/promises'
import Redis from 'ioredis'
import { join } from 'path'

const prisma = new PrismaClient()

// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

// Get S3/R2 client from env
function getStorageClient(): S3Client {
  const provider = process.env.STORAGE_PROVIDER || 'r2'

  if (provider === 'r2') {
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

function getBucketName(): string {
  return process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'product-3d-customizer'
}

// Check if storage key is a Bunny URL or key
function isBunnyStorage(storageKey: string): boolean {
  return (
    storageKey.startsWith('bunny:') ||
    storageKey.includes('.b-cdn.net') ||
    storageKey.includes('bunnycdn.com')
  )
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

  console.log(`[Export Worker] Downloading from Bunny CDN: ${url}`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download from Bunny: ${response.status} ${response.statusText}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(localPath, buffer)
}

// Download file from local storage
async function downloadFromLocal(storageKey: string, localPath: string): Promise<void> {
  const uploadsDir = process.env.LOCAL_UPLOAD_DIR || join(process.cwd(), 'uploads')
  // Strip local: prefix if present
  const cleanKey = storageKey.startsWith('local:') ? storageKey.replace('local:', '') : storageKey
  const sourcePath = join(uploadsDir, cleanKey)
  const content = await fs.readFile(sourcePath)
  await fs.writeFile(localPath, content)
}

// Download file from storage (supports Bunny, Local, S3/R2)
async function downloadFileFromStorage(
  key: string,
  localPath: string,
  storageProvider?: string
): Promise<void> {
  // Check if it's a Bunny URL/key
  if (isBunnyStorage(key)) {
    await downloadFromBunny(key, localPath)
    return
  }

  // Check if local storage (explicit provider, local: prefix, or no R2 config)
  if (storageProvider === 'local' || key.startsWith('local:') || (!key.startsWith('http') && !key.startsWith('r2:') && !process.env.R2_BUCKET_NAME)) {
    await downloadFromLocal(key, localPath)
    return
  }

  // S3/R2 storage
  const client = getStorageClient()
  const bucket = getBucketName()

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
async function uploadFileToStorage(
  key: string,
  localPath: string,
  contentType: string
): Promise<void> {
  const client = getStorageClient()
  const bucket = getBucketName()
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

// Get signed download URL
async function getSignedDownloadUrl(key: string, expiresIn: number = 86400): Promise<string> {
  const client = getStorageClient()
  const bucket = getBucketName()

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn }
  )
}

// Helper function to get storage config from shop
function getStorageConfig(shopConfig: any): any {
  return shopConfig || {}
}

interface ExportJobData {
  jobId: string
  shopId: string
}

interface ManifestRow {
  orderId: string
  uploadId: string
  location: string
  fileName: string
  originalName: string
  dpi: string
  dimensions: string
  preflightStatus: string
}

async function processExportJob(job: Job<ExportJobData>) {
  const { jobId, shopId } = job.data

  console.log(`[Export Worker] Starting job ${jobId}`)

  try {
    // Get export job
    const exportJob = await prisma.exportJob.findFirst({
      where: { id: jobId, shopId },
    })

    if (!exportJob) {
      throw new Error('Export job not found')
    }

    // Update status to processing
    await prisma.exportJob.updateMany({
      where: { id: jobId, shopId },
      data: { status: 'processing' },
    })

    // Get shop for storage config
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    })

    if (!shop) {
      throw new Error('Shop not found')
    }

    const storageConfig = getStorageConfig({
      storageProvider: shop.storageProvider,
      storageConfig: shop.storageConfig as Record<string, string> | null,
    })
    const storageProvider = shop.storageProvider || 'local'

    // Get uploads with items
    const uploads = await prisma.upload.findMany({
      where: {
        id: { in: exportJob.uploadIds },
        shopId,
      },
      include: {
        items: true,
        ordersLink: {
          select: { orderId: true, lineItemId: true },
        },
      },
    })

    if (uploads.length === 0) {
      throw new Error('No uploads found')
    }

    // Create temp directory
    const tempDir = join(process.cwd(), 'temp', `export_${jobId}`)
    mkdirSync(tempDir, { recursive: true })

    const manifestRows: ManifestRow[] = []
    const dateStr = new Date().toISOString().split('T')[0]
    const zipFileName = `export_${dateStr}_${jobId.slice(0, 8)}.zip`
    const zipPath = join(tempDir, zipFileName)

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 5 } })
    const output = createWriteStream(zipPath)

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)

      // Process each upload
      ;(async () => {
        for (const upload of uploads) {
          const orderId = upload.ordersLink[0]?.orderId || upload.orderId || 'no_order'
          const orderFolder = `order_${orderId.slice(-8)}`

          // Create metadata for this upload
          const metadata = {
            uploadId: upload.id,
            orderId,
            mode: upload.mode,
            customerId: upload.customerId,
            customerEmail: upload.customerEmail,
            status: upload.status,
            createdAt: upload.createdAt.toISOString(),
            approvedAt: upload.approvedAt?.toISOString() || null,
            items: [] as any[],
          }

          for (const item of upload.items) {
            try {
              // Download original file from storage to temp
              const localFilePath = join(tempDir, `temp_${item.id}`)
              await downloadFileFromStorage(item.storageKey, localFilePath, storageProvider)
              const fileBuffer = await fs.readFile(localFilePath)

              // Determine file extension
              const ext = item.originalName?.split('.').pop() || 'png'
              const fileName = `${item.location}_design.${ext}`

              // Add to archive
              archive.append(fileBuffer, { name: `${orderFolder}/${fileName}` })

              // Add to metadata
              const preflightResult = (item.preflightResult as any) || {}
              metadata.items.push({
                location: item.location,
                fileName,
                originalName: item.originalName,
                transform: item.transform,
                preflight: preflightResult,
              })

              // Add to manifest
              manifestRows.push({
                orderId,
                uploadId: upload.id,
                location: item.location,
                fileName,
                originalName: item.originalName || '',
                dpi: preflightResult.dpi?.toString() || '',
                dimensions: preflightResult.dimensions
                  ? `${preflightResult.dimensions.width}x${preflightResult.dimensions.height}`
                  : '',
                preflightStatus: item.preflightStatus,
              })

              console.log(`[Export Worker] Added ${fileName} for order ${orderId}`)
            } catch (error) {
              console.error(`[Export Worker] Failed to process item ${item.id}:`, error)
            }
          }

          // Add metadata.json for this order
          archive.append(JSON.stringify(metadata, null, 2), {
            name: `${orderFolder}/metadata.json`,
          })

          // Report progress
          const progress = Math.round(((uploads.indexOf(upload) + 1) / uploads.length) * 100)
          await job.updateProgress(progress)
        }

        // Generate manifest CSV
        const csvStringifier = createObjectCsvStringifier({
          header: [
            { id: 'orderId', title: 'Order ID' },
            { id: 'uploadId', title: 'Upload ID' },
            { id: 'location', title: 'Location' },
            { id: 'fileName', title: 'File Name' },
            { id: 'originalName', title: 'Original Name' },
            { id: 'dpi', title: 'DPI' },
            { id: 'dimensions', title: 'Dimensions' },
            { id: 'preflightStatus', title: 'Preflight Status' },
          ],
        })

        const csvContent =
          csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(manifestRows)
        archive.append(csvContent, { name: 'manifest.csv' })

        // Finalize archive
        await archive.finalize()
      })()
    })

    // Upload ZIP to storage
    const zipStorageKey = `${shop.shopDomain}/exports/${zipFileName}`

    await uploadFileToStorage(zipStorageKey, zipPath, 'application/zip')

    // Get download URL (24 hour expiry)
    const downloadUrl = await getSignedDownloadUrl(zipStorageKey, 24 * 60 * 60)

    // Update export job
    await prisma.exportJob.updateMany({
      where: { id: jobId, shopId },
      data: {
        status: 'completed',
        downloadUrl,
        completedAt: new Date(),
      },
    })

    // Cleanup temp files
    rmSync(tempDir, { recursive: true, force: true })

    console.log(`[Export Worker] Job ${jobId} completed. Files: ${uploads.length}`)

    return {
      success: true,
      filesCount: manifestRows.length,
      downloadUrl,
    }
  } catch (error) {
    console.error(`[Export Worker] Job ${jobId} failed:`, error)

    // Update job status to failed
    await prisma.exportJob.updateMany({
      where: { id: jobId, shopId },
      data: { status: 'failed' },
    })

    throw error
  }
}

// Create worker
export function createExportWorker(redisConnection: { host: string; port: number }) {
  const worker = new Worker<ExportJobData>('export', processExportJob, {
    connection: redisConnection,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 60000, // 5 jobs per minute
    },
  })

  worker.on('completed', (job, result) => {
    console.log(`[Export Worker] Job ${job.id} completed:`, result)
  })

  worker.on('failed', (job, error) => {
    console.error(`[Export Worker] Job ${job?.id} failed:`, error.message)
  })

  worker.on('progress', (job, progress) => {
    console.log(`[Export Worker] Job ${job.id} progress: ${progress}%`)
  })

  return worker
}

// Standalone execution
if (require.main === module) {
  const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  }

  const worker = createExportWorker(redisConnection)
  console.log('[Export Worker] Started and waiting for jobs...')
}
