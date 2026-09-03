import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'





























const LOCAL_STORAGE_BASE = process.env.LOCAL_STORAGE_PATH || './uploads'
const LOCAL_FILE_SECRET = process.env.SECRET_KEY || 'fallback-secret-key'


const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'customizerappdev'
const BUNNY_API_KEY = process.env.BUNNY_API_KEY || ''
const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL || (process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net')
const BUNNY_STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || 'storage.bunnycdn.com'


const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const R2_ENDPOINT = process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`


const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000





let r2Client: S3Client | null = null

function getR2Client(): S3Client | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return null
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  }

  return r2Client
}




export function isR2FallbackAvailable(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME)
}





export type StorageProvider = 'local' | 'bunny' | 'r2'

export interface StorageConfig {
  provider: StorageProvider

  localPath?: string

  bunnyZone?: string
  bunnyApiKey?: string
  bunnyCdnUrl?: string

  r2AccountId?: string
  r2AccessKeyId?: string
  r2SecretAccessKey?: string
  r2BucketName?: string
  r2PublicUrl?: string
}

export interface UploadUrlResult {
  url: string
  key: string
  provider: StorageProvider
  publicUrl: string
  method: 'PUT' | 'POST'
  headers?: Record<string, string>

  fallbackUrls?: {
    r2?: { url: string; publicUrl: string; method: 'PUT' | 'POST' }
    local?: { url: string; publicUrl: string; method: 'PUT' | 'POST' }
  }

  retryConfig?: {
    maxRetries: number
    retryDelayMs: number
  }
}










export function getStorageConfig(shopConfig?: {
  storageProvider?: string
  storageConfig?: Record<string, string> | null
}): StorageConfig {

  const provider =
    (shopConfig?.storageProvider as StorageProvider) ||
    (process.env.DEFAULT_STORAGE_PROVIDER as StorageProvider) ||
    'local'

  const shopStorageConfig = shopConfig?.storageConfig || {}


  const envBunnyZone = process.env.BUNNY_STORAGE_ZONE || 'customizerappdev'
  const envBunnyApiKey = process.env.BUNNY_API_KEY || ''
  const envBunnyCdnUrl = process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'

  return {
    provider,

    localPath: LOCAL_STORAGE_BASE,

    bunnyZone: shopStorageConfig.bunnyZone || envBunnyZone,
    bunnyApiKey: shopStorageConfig.bunnyApiKey || envBunnyApiKey,
    bunnyCdnUrl: shopStorageConfig.bunnyCdnUrl || envBunnyCdnUrl,

    r2AccountId: shopStorageConfig.r2AccountId || R2_ACCOUNT_ID,
    r2AccessKeyId: shopStorageConfig.r2AccessKeyId || R2_ACCESS_KEY_ID,
    r2SecretAccessKey: shopStorageConfig.r2SecretAccessKey || R2_SECRET_ACCESS_KEY,
    r2BucketName: shopStorageConfig.r2BucketName || R2_BUCKET_NAME,
    r2PublicUrl: shopStorageConfig.r2PublicUrl || R2_PUBLIC_URL,
  }
}




export function isStorageConfigured(config: StorageConfig): boolean {
  switch (config.provider) {
    case 'bunny':
      return !!(config.bunnyZone && config.bunnyApiKey)
    case 'r2':
      return !!(
        config.r2AccountId &&
        config.r2AccessKeyId &&
        config.r2SecretAccessKey &&
        config.r2BucketName
      )
    case 'local':
    default:
      return true
  }
}




export function getEffectiveStorageProvider(config: StorageConfig): StorageProvider {
  if (isStorageConfigured(config)) {
    return config.provider
  }

  console.warn(`[Storage] ${config.provider} not configured, falling back to local`)
  return 'local'
}





export function generateLocalFileToken(key: string, expiresAt: number): string {
  const payload = `${key}:${expiresAt}`
  const signature = crypto.createHmac('sha256', LOCAL_FILE_SECRET).update(payload).digest('hex')
  return `${expiresAt}.${signature}`
}

export function validateLocalFileToken(key: string, token: string): boolean {
  if (!token) return false

  const [expiresAtStr, signature] = token.split('.')
  if (!expiresAtStr || !signature) return false

  const expiresAt = parseInt(expiresAtStr, 10)
  if (isNaN(expiresAt)) return false

  if (Date.now() > expiresAt) return false

  const expectedPayload = `${key}:${expiresAt}`
  const expectedSignature = crypto
    .createHmac('sha256', LOCAL_FILE_SECRET)
    .update(expectedPayload)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )
}









export async function getUploadSignedUrl(
  config: StorageConfig,
  key: string,
  contentType: string,
  _expiresIn: number = 3600
): Promise<UploadUrlResult> {
  const effectiveProvider = getEffectiveStorageProvider(config)


  let primaryResult: UploadUrlResult

  switch (effectiveProvider) {
    case 'bunny':
      primaryResult = await getBunnyUploadUrlWithFallbacks(config, key, contentType)
      break
    case 'r2':
      primaryResult = await getR2UploadUrl(config, key, contentType)
      break
    case 'local':
    default:
      primaryResult = getLocalUploadUrl(config, key)
  }

  return primaryResult
}





async function getBunnyUploadUrlWithFallbacks(
  config: StorageConfig,
  key: string,
  contentType: string
): Promise<UploadUrlResult> {
  const uploadUrl = `https://${BUNNY_STORAGE_HOST}/${config.bunnyZone}/${key}`
  const publicUrl = `${config.bunnyCdnUrl}/${key}`


  const fallbackUrls: UploadUrlResult['fallbackUrls'] = {}


  if (isR2FallbackAvailable()) {
    try {
      const r2Result = await getR2UploadUrl(config, key, contentType)
      fallbackUrls.r2 = {
        url: r2Result.url,
        publicUrl: r2Result.publicUrl,
        method: r2Result.method,
      }
    } catch (error) {
      console.warn('[Storage] Failed to generate R2 fallback URL:', error)
    }
  }


  const localResult = getLocalUploadUrl(config, key)
  fallbackUrls.local = {
    url: localResult.url,
    publicUrl: localResult.publicUrl,
    method: localResult.method,
  }

  return {
    url: uploadUrl,
    key,
    provider: 'bunny',
    publicUrl,
    method: 'PUT',
    headers: {
      AccessKey: config.bunnyApiKey || '',
    },
    fallbackUrls,
    retryConfig: {
      maxRetries: MAX_RETRIES,
      retryDelayMs: RETRY_DELAY_MS,
    },
  }
}




async function getR2UploadUrl(
  config: StorageConfig,
  key: string,
  contentType: string
): Promise<UploadUrlResult> {
  const client = getR2Client()

  if (!client) {
    console.warn('[Storage] R2 not configured, using local')
    return getLocalUploadUrl(config, key)
  }

  try {
    const command = new PutObjectCommand({
      Bucket: config.r2BucketName || R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    })

    const presignedUrl = await getSignedUrl(client, command, { expiresIn: 3600 })


    let publicUrl: string



    const appHost = process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL!



    const expiresAt = Date.now() + 365 * 24 * 3600 * 1000
    const token = generateLocalFileToken(`r2:${key}`, expiresAt)

    publicUrl = `${appHost}/api/files/r2:${encodeURIComponent(key)}?token=${token}`

    return {
      url: presignedUrl,
      key,
      provider: 'r2',
      publicUrl,
      method: 'PUT',
    }
  } catch (error) {
    console.error('[Storage] R2 presigned URL error:', error)
    return getLocalUploadUrl(config, key)
  }
}





export async function getR2SignedGetUrl(
  config: StorageConfig,
  key: string,
  expiresIn: number = 300
): Promise<string | null> {
  const client = getR2Client()
  if (!client) return null

  try {
    const command = new GetObjectCommand({
      Bucket: config.r2BucketName || R2_BUCKET_NAME,
      Key: key,
    })

    return await getSignedUrl(client, command, { expiresIn })
  } catch (error) {
    console.error('[Storage] R2 signed GET URL error:', error)
    return null
  }
}





function getLocalUploadUrl(_config: StorageConfig, key: string): UploadUrlResult {
  let host = process.env.SHOPIFY_APP_URL || process.env.HOST || process.env.SHOPIFY_APP_URL!
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = `https://${host}`
  }

  return {
    url: `${host}/api/upload/local`,
    key,
    provider: 'local',
    publicUrl: `${host}/api/files/${encodeURIComponent(key)}`,
    method: 'POST',
  }
}










export async function getDownloadSignedUrl(
  config: StorageConfig,
  key: string,
  expiresIn: number = 30 * 24 * 3600
): Promise<string> {

  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key
  }


  if (key.startsWith('bunny:')) {
    const bunnyKey = key.replace('bunny:', '')

    const encodedPath = bunnyKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `${config.bunnyCdnUrl || BUNNY_CDN_URL}/${encodedPath}`
  }


  if (key.startsWith('r2:')) {
    const r2Key = key.replace('r2:', '')

    const encodedPath = r2Key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')


    const r2PublicUrl = config.r2PublicUrl || process.env.R2_PUBLIC_URL
    if (r2PublicUrl) {

       const baseUrl = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl
       return `${baseUrl}/${encodedPath}`
    }


    let host = process.env.SHOPIFY_APP_URL || process.env.HOST || process.env.SHOPIFY_APP_URL!
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `https://${host}`
    }


    const expiresAt = Date.now() + expiresIn * 1000
    const token = generateLocalFileToken(`r2:${r2Key}`, expiresAt)
    return `${host}/api/files/r2:${encodeURIComponent(r2Key)}?token=${token}`
  }


  if (key.startsWith('local:')) {
    const localKey = key.replace('local:', '')
    let host = process.env.SHOPIFY_APP_URL || process.env.HOST || process.env.SHOPIFY_APP_URL!
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `https://${host}`
    }
    const expiresAt = Date.now() + expiresIn * 1000
    const token = generateLocalFileToken(localKey, expiresAt)
    return `${host}/api/files/${encodeURIComponent(localKey)}?token=${token}`
  }


  const effectiveProvider = getEffectiveStorageProvider(config)

  switch (effectiveProvider) {
    case 'bunny':

      const encodedBunnyPath = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      return `${config.bunnyCdnUrl || BUNNY_CDN_URL}/${encodedBunnyPath}`
    case 'r2':

      const encodedR2Path = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      return `${config.r2PublicUrl || process.env.R2_PUBLIC_URL}/${encodedR2Path}`
    case 'local':
    default:

      let host = process.env.SHOPIFY_APP_URL || process.env.HOST || process.env.SHOPIFY_APP_URL!
      if (!host.startsWith('http://') && !host.startsWith('https://')) {
        host = `https://${host}`
      }
      const expiresAt = Date.now() + expiresIn * 1000
      const token = generateLocalFileToken(key, expiresAt)
      return `${host}/api/files/${encodeURIComponent(key)}?token=${token}`
  }
}






export function getThumbnailUrl(
  config: StorageConfig,
  key: string,
  width: number = 200,
  height?: number
): string {

  if (key.startsWith('https://') && key.includes('.b-cdn.net')) {
    const url = new URL(key)
    url.searchParams.set('width', width.toString())
    if (height) url.searchParams.set('height', height.toString())
    url.searchParams.set('format', 'webp')
    url.searchParams.set('quality', '85')
    return url.toString()
  }


  if (config.provider === 'bunny' || key.startsWith('bunny:')) {
    const bunnyKey = key.replace('bunny:', '')

    const encodedPath = bunnyKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `${config.bunnyCdnUrl || BUNNY_CDN_URL}/${encodedPath}?width=${width}${height ? `&height=${height}` : ''}&format=webp&quality=85`
  }


  if (key.startsWith('r2:')) {
    const r2Key = key.replace('r2:', '')
    const encodedPath = r2Key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')


    const r2PublicUrl = process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL!

    if (r2PublicUrl) {
       const baseUrl = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl
       return `${baseUrl}/${encodedPath}`
    }


    const r2AccountId = config.r2AccountId || process.env.R2_ACCOUNT_ID
    return `https://pub-${r2AccountId}.r2.dev/${encodedPath}`
  }


  if (key.startsWith('local:')) {
    const localKey = key.replace('local:', '')
    let host = process.env.SHOPIFY_APP_URL || process.env.HOST || process.env.SHOPIFY_APP_URL!
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `https://${host}`
    }
    const expiresAt = Date.now() + 3600 * 1000
    const token = generateLocalFileToken(localKey, expiresAt)
    return `${host}/api/files/${encodeURIComponent(localKey)}?token=${token}`
  }


  return key
}





function safePath(key: string): string {
  const base = resolve(LOCAL_STORAGE_BASE)
  const filePath = resolve(base, key)
  if (!filePath.startsWith(base + sep)) {
    throw new Error('Invalid file path: directory traversal detected')
  }
  return filePath
}

export async function saveLocalFile(key: string, data: Buffer): Promise<string> {
  const filePath = safePath(key)
  const dir = dirname(filePath)

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  await writeFile(filePath, data)
  return filePath
}

export async function readLocalFile(key: string): Promise<Buffer> {
  const filePath = safePath(key)
  return readFile(filePath)
}

export async function deleteLocalFile(key: string): Promise<void> {
  const filePath = safePath(key)
  try {
    await unlink(filePath)
  } catch (e) {
    // File may not exist, ignore
  }
}

export async function deleteFile(config: StorageConfig, key: string): Promise<void> {
  const effectiveProvider = getEffectiveStorageProvider(config)

  switch (effectiveProvider) {
    case 'bunny':
      await deleteBunnyFile(config, key)
      break
    case 'local':
    default:
      await deleteLocalFile(key)
  }
}

async function deleteBunnyFile(config: StorageConfig, key: string): Promise<void> {
  try {
    const bunnyKey = key.replace('bunny:', '')
    const response = await fetch(`https://${BUNNY_STORAGE_HOST}/${config.bunnyZone}/${bunnyKey}`, {
      method: 'DELETE',
      headers: {
        AccessKey: config.bunnyApiKey || '',
      },
    })
    if (!response.ok) {
      console.warn(`[Bunny] Failed to delete file: ${key}`)
    }
  } catch (e) {
    console.error('[Bunny] Delete error:', e)
  }
}





export function buildStorageKey(
  shopDomain: string,
  uploadId: string,
  itemId: string,
  filename: string
): string {
  const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
  const safeShop = shopDomain.replace(/[^a-zA-Z0-9-]/g, '_')
  const safeFilename = filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
  return `${safeShop}/${env}/${uploadId}/${itemId}/${safeFilename}`
}








export function buildStorageKeyWithPrefix(
  provider: StorageProvider,
  shopDomain: string,
  uploadId: string,
  itemId: string,
  filename: string
): string {
  const baseKey = buildStorageKey(shopDomain, uploadId, itemId, filename)

  return `${provider}:${baseKey}`
}

export function getLocalFilePath(key: string): string {
  return join(LOCAL_STORAGE_BASE, key)
}




export function isBunnyUrl(key: string | null | undefined): boolean {
  if (!key) return false
  return key.includes('.b-cdn.net') || key.includes('bunnycdn.com') || key.startsWith('bunny:')
}




export function isR2Url(key: string | null | undefined): boolean {
  if (!key) return false
  return key.includes('.r2.dev') || key.includes('r2.cloudflarestorage.com')
}




export function isExternalUrl(key: string | null | undefined): boolean {
  if (!key) return false
  return key.startsWith('http://') || key.startsWith('https://')
}




export const MULTIPART_THRESHOLD_BYTES =
  Number(process.env.MULTIPART_THRESHOLD_MB || '100') * 1024 * 1024
export const MULTIPART_PART_SIZE_BYTES =
  Number(process.env.MULTIPART_PART_SIZE_MB || '10') * 1024 * 1024
export const MULTIPART_MIN_PART_SIZE = 5 * 1024 * 1024 // R2 / S3 spec
export const MULTIPART_MAX_PARTS = 10_000

export interface R2MultipartInitResult {
  uploadId: string
  key: string
  publicUrl: string
  partSize: number
  totalParts: number
  parts: Array<{ partNumber: number; url: string }>
  completeUrl: string
  abortUrl: string
}

export async function getR2MultipartInit(
  config: StorageConfig,
  key: string,
  contentType: string,
  fileSize: number,
  partSizeOverride?: number
): Promise<R2MultipartInitResult | null> {
  const client = getR2Client()
  if (!client) return null

  const bucket = config.r2BucketName || R2_BUCKET_NAME
  if (!bucket) return null

  let partSize = Math.max(
    MULTIPART_MIN_PART_SIZE,
    partSizeOverride || MULTIPART_PART_SIZE_BYTES
  )
  let totalParts = Math.ceil(fileSize / partSize)
  if (totalParts > MULTIPART_MAX_PARTS) {
    partSize = Math.ceil(fileSize / MULTIPART_MAX_PARTS)
    totalParts = Math.ceil(fileSize / partSize)
  }
  if (totalParts < 1) {
    throw new Error(`Invalid multipart configuration: fileSize=${fileSize}`)
  }

  const initRes = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    })
  )
  const uploadId = initRes.UploadId
  if (!uploadId) throw new Error('R2 did not return UploadId')

  const parts: Array<{ partNumber: number; url: string }> = []
  for (let i = 1; i <= totalParts; i++) {
    const url = await getSignedUrl(
      client,
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        PartNumber: i,
        UploadId: uploadId,
      }),
      { expiresIn: 3600 }
    )
    parts.push({ partNumber: i, url })
  }

  const appHost = process.env.SHOPIFY_APP_URL || ''
  const expiresAt = Date.now() + 365 * 24 * 3600 * 1000
  const token = generateLocalFileToken(`r2:${key}`, expiresAt)
  const publicUrl = `${appHost}/api/files/r2:${encodeURIComponent(key)}?token=${token}`

  return {
    uploadId,
    key,
    publicUrl,
    partSize,
    totalParts,
    parts,
    completeUrl: `${appHost}/api/upload/multipart-complete`,
    abortUrl: `${appHost}/api/upload/multipart-abort`,
  }
}

export async function completeR2Multipart(
  config: StorageConfig,
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>
): Promise<{ ok: boolean; location?: string; error?: string }> {
  const client = getR2Client()
  if (!client) return { ok: false, error: 'r2_not_configured' }
  const bucket = config.r2BucketName || R2_BUCKET_NAME
  if (!bucket) return { ok: false, error: 'r2_bucket_missing' }

  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  try {
    const res = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sortedParts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag.startsWith('"') ? p.etag : `"${p.etag}"`,
          })),
        },
      })
    )
    return { ok: true, location: res.Location }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Parts R2 already holds for an in-progress multipart upload (resume). */
export async function listR2MultipartParts(
  config: StorageConfig,
  key: string,
  uploadId: string
): Promise<{ ok: boolean; parts: Array<{ partNumber: number; etag: string; size: number }>; error?: string }> {
  const client = getR2Client()
  if (!client) return { ok: false, parts: [], error: 'r2_not_configured' }
  const bucket = config.r2BucketName || R2_BUCKET_NAME
  if (!bucket) return { ok: false, parts: [], error: 'r2_bucket_missing' }
  try {
    const parts: Array<{ partNumber: number; etag: string; size: number }> = []
    let marker: number | undefined
    // ListParts pages at 1000; loop until IsTruncated is false.
    for (let page = 0; page < 20; page++) {
      const res = await client.send(
        new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker as any })
      )
      for (const p of res.Parts || []) {
        if (p.PartNumber && p.ETag) {
          parts.push({ partNumber: p.PartNumber, etag: p.ETag.replace(/^"|"$/g, ''), size: p.Size || 0 })
        }
      }
      if (!res.IsTruncated) break
      marker = res.NextPartNumberMarker as any
    }
    return { ok: true, parts }
  } catch (err) {
    return { ok: false, parts: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/** Fresh presigned URLs for specific part numbers of an existing multipart upload. */
export async function presignR2MultipartParts(
  config: StorageConfig,
  key: string,
  uploadId: string,
  partNumbers: number[]
): Promise<Array<{ partNumber: number; url: string }>> {
  const client = getR2Client()
  const bucket = config.r2BucketName || R2_BUCKET_NAME
  if (!client || !bucket) return []
  const out: Array<{ partNumber: number; url: string }> = []
  for (const partNumber of partNumbers) {
    const url = await getSignedUrl(
      client,
      new UploadPartCommand({ Bucket: bucket, Key: key, PartNumber: partNumber, UploadId: uploadId }),
      { expiresIn: 3600 }
    )
    out.push({ partNumber, url })
  }
  return out
}

export async function abortR2Multipart(
  config: StorageConfig,
  key: string,
  uploadId: string
): Promise<{ ok: boolean; error?: string }> {
  const client = getR2Client()
  if (!client) return { ok: false, error: 'r2_not_configured' }
  const bucket = config.r2BucketName || R2_BUCKET_NAME
  if (!bucket) return { ok: false, error: 'r2_bucket_missing' }
  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      })
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
