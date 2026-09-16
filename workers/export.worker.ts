










import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PrismaClient } from '@prisma/client'
import archiver from 'archiver'
import { Job, Queue, Worker } from 'bullmq'
import { createObjectCsvStringifier } from 'csv-writer'
import { randomUUID } from 'crypto'
import { createReadStream, createWriteStream, mkdirSync } from 'fs'
import fs from 'fs/promises'
import Redis from 'ioredis'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import {
  getEmptyExportUploadIds,
  getExportItemFileName,
  getExportUploadFolder,
  getMissingExportUploadIds,
} from '../app/lib/exportArchive'
import {
  EXPORT_QUEUE_NAME,
  EXPORT_JOB_OPTIONS,
  getExportJobOptions,
  isFinalUploadJobAttempt,
  type ExportJobData,
} from '../app/lib/uploadQueues'

const prisma = new PrismaClient()

const BUNNY_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000


const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})


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


function isBunnyStorage(storageKey: string): boolean {
  return (
    storageKey.startsWith('bunny:') ||
    storageKey.includes('.b-cdn.net') ||
    storageKey.includes('bunnycdn.com')
  )
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

  console.log(`[Export Worker] Downloading from Bunny CDN: ${url}`)

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
      throw new Error(`Failed to download from Bunny: ${response.status} ${response.statusText}`)
    }

    if (!response.body) throw new Error('Empty Bunny response body')
    await pipeline(response.body as any, createWriteStream(localPath))
  } catch (error) {
    await fs.rm(localPath, { force: true }).catch(() => undefined)
    if (timedOut) {
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


async function downloadFromLocal(storageKey: string, localPath: string): Promise<void> {
  const uploadsDir = process.env.LOCAL_UPLOAD_DIR || join(process.cwd(), 'uploads')

  const cleanKey = storageKey.startsWith('local:') ? storageKey.replace('local:', '') : storageKey
  const sourcePath = join(uploadsDir, cleanKey)
  await fs.copyFile(sourcePath, localPath)
}


async function downloadFileFromStorage(
  key: string,
  localPath: string,
  storageProvider?: string
): Promise<void> {

  if (isBunnyStorage(key)) {
    await downloadFromBunny(key, localPath)
    return
  }


  if (storageProvider === 'local' || key.startsWith('local:') || (!key.startsWith('http') && !key.startsWith('r2:') && !process.env.R2_BUCKET_NAME)) {
    await downloadFromLocal(key, localPath)
    return
  }


  const client = getStorageClient()
  const bucket = getBucketName()

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key.startsWith('r2:') ? key.slice('r2:'.length) : key,
    })
  )

  if (!response.Body) {
    throw new Error('Empty response body')
  }

  await pipeline(response.Body as any, createWriteStream(localPath))
}


async function uploadFileToStorage(
  key: string,
  localPath: string,
  contentType: string
): Promise<void> {
  const client = getStorageClient()
  const bucket = getBucketName()
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType,
    })
  )
}


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


function getStorageConfig(shopConfig: any): any {
  return shopConfig || {}
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
  const { exportId, shopId } = job.data
  let tempDir = ''

  console.log(`[Export Worker] Starting job ${exportId}`)

  try {
    if (!exportId || !shopId) {
      throw new Error('Export job payload is missing exportId or shopId')
    }

    const exportJob = await prisma.exportJob.findFirst({
      where: { id: exportId, shopId },
    })

    if (!exportJob) {
      throw new Error('Export job not found')
    }

    if (exportJob.status === 'completed' && exportJob.downloadUrl) {
      console.log(`[Export Worker] Job ${exportId} is already completed; reusing stored result`)
      return {
        success: true,
        skipped: true,
        downloadUrl: exportJob.downloadUrl,
      }
    }


    await prisma.exportJob.updateMany({
      where: { id: exportId, shopId, status: { not: 'completed' } },
      data: { status: 'processing' },
    })


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

    const missingUploadIds = getMissingExportUploadIds(
      exportJob.uploadIds,
      uploads.map((upload) => upload.id)
    )
    if (missingUploadIds.length > 0) {
      throw new Error(
        `Export is incomplete; ${missingUploadIds.length} requested upload(s) were not found: ${missingUploadIds.join(', ')}`
      )
    }

    const emptyUploadIds = getEmptyExportUploadIds(uploads)
    if (emptyUploadIds.length > 0) {
      throw new Error(
        `Export is incomplete; ${emptyUploadIds.length} requested upload(s) contain no design items: ${emptyUploadIds.join(', ')}`
      )
    }


    tempDir = join(
      process.cwd(),
      'temp',
      `export_${exportId}_${process.pid}_${randomUUID()}`
    )
    mkdirSync(tempDir, { recursive: true })

    const manifestRows: ManifestRow[] = []
    const dateStr = new Date().toISOString().split('T')[0]
    const zipFileName = `export_${dateStr}_${exportId}.zip`
    const zipPath = join(tempDir, zipFileName)


    const archive = archiver('zip', { zlib: { level: 5 } })
    const output = createWriteStream(zipPath)
    const failedItemIds: string[] = []
    const uploadsPerOrder = new Map<string, number>()
    for (const upload of uploads) {
      const orderId = upload.ordersLink[0]?.orderId || upload.orderId || 'no_order'
      uploadsPerOrder.set(orderId, (uploadsPerOrder.get(orderId) || 0) + 1)
    }

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)

      // Process each upload
      ;(async () => {
        for (const upload of uploads) {
          const orderId = upload.ordersLink[0]?.orderId || upload.orderId || 'no_order'
          const orderFolder = getExportUploadFolder(
            orderId,
            upload.id,
            uploadsPerOrder.get(orderId) || 1
          )


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

              const localFilePath = join(tempDir, `temp_${item.id}`)
              await downloadFileFromStorage(item.storageKey, localFilePath, storageProvider)
              const fileName = getExportItemFileName(
                item.location,
                item.originalName,
                item.id
              )


              archive.file(localFilePath, { name: `${orderFolder}/${fileName}` })


              const preflightResult = (item.preflightResult as any) || {}
              metadata.items.push({
                location: item.location,
                fileName,
                originalName: item.originalName,
                transform: item.transform,
                preflight: preflightResult,
              })


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
              failedItemIds.push(item.id)
            }
          }


          archive.append(JSON.stringify(metadata, null, 2), {
            name: `${orderFolder}/metadata.json`,
          })


          const progress = Math.round(((uploads.indexOf(upload) + 1) / uploads.length) * 100)
          await job.updateProgress(progress)
        }


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


        await archive.finalize()
      })().catch(reject)
    })

    if (failedItemIds.length > 0) {
      throw new Error(
        `Export is incomplete; failed to include ${failedItemIds.length} item(s): ${failedItemIds.join(', ')}`
      )
    }


    const zipStorageKey = `${shop.shopDomain}/exports/${zipFileName}`

    await uploadFileToStorage(zipStorageKey, zipPath, 'application/zip')


    const downloadUrl = await getSignedDownloadUrl(zipStorageKey, 24 * 60 * 60)


    await prisma.exportJob.updateMany({
      where: { id: exportId, shopId },
      data: {
        status: 'completed',
        downloadUrl,
        completedAt: new Date(),
      },
    })


    console.log(`[Export Worker] Job ${exportId} completed. Files: ${uploads.length}`)

    return {
      success: true,
      filesCount: manifestRows.length,
      downloadUrl,
    }
  } catch (error) {
    console.error(`[Export Worker] Job ${exportId || 'unknown'} failed:`, error)

    if (exportId && shopId) {
      const finalAttempt = isFinalUploadJobAttempt(job.attemptsMade, job.opts.attempts)
      await prisma.exportJob.updateMany({
        where: { id: exportId, shopId, status: { in: ['pending', 'processing'] } },
        data: { status: finalAttempt ? 'failed' : 'pending' },
      })
    }

    throw error
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) =>
        console.warn(`[Export Worker] Could not clean temp directory ${tempDir}:`, cleanupError)
      )
    }
  }
}

function startPendingExportReconciler(redisConnection: { host: string; port: number; db?: number }) {
  const queue = new Queue<ExportJobData>(EXPORT_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: EXPORT_JOB_OPTIONS,
  })
  let running = false
  const reconcile = async () => {
    if (running) return
    running = true
    try {
      const pending = await prisma.exportJob.findMany({
        where: { status: 'pending' },
        select: { id: true, shopId: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      })
      for (const exportJob of pending) {
        const options = getExportJobOptions(exportJob.id)
        const existing = options.jobId ? await queue.getJob(String(options.jobId)) : null
        if (!existing) {
          await queue.add(
            'process-export',
            { exportId: exportJob.id, shopId: exportJob.shopId },
            options
          )
        }
      }
    } catch (error) {
      console.error('[Export Worker] Pending export reconciliation failed:', error)
    } finally {
      running = false
    }
  }
  const initial = setTimeout(() => void reconcile(), 10_000)
  initial.unref()
  const interval = setInterval(() => void reconcile(), 60_000)
  interval.unref()
}


export function createExportWorker(redisConnection: { host: string; port: number }) {
  const worker = new Worker<ExportJobData>(EXPORT_QUEUE_NAME, processExportJob, {
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

  worker.on('failed', async (job, error) => {
    console.error(`[Export Worker] Job ${job?.id} failed:`, error.message)
    if (!job?.data.exportId || !job.data.shopId) return

    const configuredAttempts = Math.max(1, Number(job.opts.attempts) || 1)
    const exhaustedAttempts = job.attemptsMade >= configuredAttempts
    const exhaustedStalls = /stalled more than allowable limit/i.test(error.message)
    if (!exhaustedAttempts && !exhaustedStalls) return

    try {
      await prisma.exportJob.updateMany({
        where: {
          id: job.data.exportId,
          shopId: job.data.shopId,
          status: { in: ['pending', 'processing'] },
        },
        data: { status: 'failed' },
      })
    } catch (persistError) {
      console.error(
        `[Export Worker] Could not persist terminal failure for ${job.data.exportId}:`,
        persistError
      )
    }
  })

  worker.on('progress', (job, progress) => {
    console.log(`[Export Worker] Job ${job.id} progress: ${progress}%`)
  })

  startPendingExportReconciler(redisConnection)

  return worker
}


if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('export.worker.ts')) {
  const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
  const redisConnection = {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port || '6379'),
    db: parseInt(redisUrl.pathname?.slice(1) || '0'),
  }

  const worker = createExportWorker(redisConnection)
  console.log('[Export Worker] Started and waiting for jobs...')
}
