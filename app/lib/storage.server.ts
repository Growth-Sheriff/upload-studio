import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'

/**
 * MULTI-STORAGE SYSTEM v3.0 - BULLETPROOF EDITION
 * ================================================
 * Supports: Bunny.net (primary), R2 (fallback), Local (last resort)
 *
 * Features:
 * - Automatic retry with exponential backoff (3 attempts)
 * - R2 fallback when Bunny fails
 * - Local fallback when both cloud storages fail
 * - Detailed error logging
 *
 * Environment Variables:
 * - DEFAULT_STORAGE_PROVIDER: bunny | local | r2
 * - BUNNY_STORAGE_ZONE: Storage zone name
 * - BUNNY_API_KEY: Storage zone password
 * - BUNNY_CDN_URL: Pull zone URL (https://xxx.b-cdn.net)
 * - R2_ACCOUNT_ID: Cloudflare account ID
 * - R2_ACCESS_KEY_ID: R2 API access key
 * - R2_SECRET_ACCESS_KEY: R2 API secret key
 * - R2_BUCKET_NAME: R2 bucket name
 * - LOCAL_STORAGE_PATH: Local storage directory
 * - SECRET_KEY: HMAC secret for signed URLs
 */

// ============================================================
// CONFIGURATION
// ============================================================

const LOCAL_STORAGE_BASE = process.env.LOCAL_STORAGE_PATH || './uploads'
const LOCAL_FILE_SECRET = process.env.SECRET_KEY || 'fallback-secret-key'

// Bunny.net Configuration
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'customizerappdev'
const BUNNY_API_KEY = process.env.BUNNY_API_KEY || ''
const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL || 'https://img.customizerapp.dev'
const BUNNY_STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || 'storage.bunnycdn.com'

// R2 Configuration (for future use)
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const R2_ENDPOINT = process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

// Retry Configuration
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000 // 2 seconds, doubles each retry

// ============================================================
// R2 CLIENT (Lazy initialization)
// ============================================================

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

/**
 * Check if R2 fallback is available
 */
export function isR2FallbackAvailable(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME)
}

// ============================================================
// TYPES
// ============================================================

export type StorageProvider = 'local' | 'bunny' | 'r2'

export interface StorageConfig {
  provider: StorageProvider
  // Local
  localPath?: string
  // Bunny
  bunnyZone?: string
  bunnyApiKey?: string
  bunnyCdnUrl?: string
  // R2
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
  // Fallback URLs for client-side retry
  fallbackUrls?: {
    r2?: { url: string; publicUrl: string; method: 'PUT' | 'POST' }
    local?: { url: string; publicUrl: string; method: 'PUT' | 'POST' }
  }
  // Retry configuration for client
  retryConfig?: {
    maxRetries: number
    retryDelayMs: number
  }
}

// ============================================================
// STORAGE CONFIG FACTORY
// ============================================================

/**
 * Get storage config from shop settings or environment
 * NOTE: We read process.env directly here to ensure we get the latest values
 * after dotenv has loaded the .env file
 */
export function getStorageConfig(shopConfig?: {
  storageProvider?: string
  storageConfig?: Record<string, string> | null
}): StorageConfig {
  // Shop-level override
  const provider =
    (shopConfig?.storageProvider as StorageProvider) ||
    (process.env.DEFAULT_STORAGE_PROVIDER as StorageProvider) ||
    'local'

  const shopStorageConfig = shopConfig?.storageConfig || {}

  // Read env vars directly to ensure we get values after dotenv loads
  const envBunnyZone = process.env.BUNNY_STORAGE_ZONE || 'customizerappdev'
  const envBunnyApiKey = process.env.BUNNY_API_KEY || ''
  const envBunnyCdnUrl = process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'

  return {
    provider,
    // Local
    localPath: LOCAL_STORAGE_BASE,
    // Bunny (shop config overrides env) - read env directly
    bunnyZone: shopStorageConfig.bunnyZone || envBunnyZone,
    bunnyApiKey: shopStorageConfig.bunnyApiKey || envBunnyApiKey,
    bunnyCdnUrl: shopStorageConfig.bunnyCdnUrl || envBunnyCdnUrl,
    // R2 (shop config overrides env)
    r2AccountId: shopStorageConfig.r2AccountId || R2_ACCOUNT_ID,
    r2AccessKeyId: shopStorageConfig.r2AccessKeyId || R2_ACCESS_KEY_ID,
    r2SecretAccessKey: shopStorageConfig.r2SecretAccessKey || R2_SECRET_ACCESS_KEY,
    r2BucketName: shopStorageConfig.r2BucketName || R2_BUCKET_NAME,
    r2PublicUrl: shopStorageConfig.r2PublicUrl || R2_PUBLIC_URL,
  }
}

/**
 * Check if storage is properly configured
 */
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

/**
 * Get effective provider with fallback
 */
export function getEffectiveStorageProvider(config: StorageConfig): StorageProvider {
  if (isStorageConfigured(config)) {
    return config.provider
  }
  // Fallback to local if primary not configured
  console.warn(`[Storage] ${config.provider} not configured, falling back to local`)
  return 'local'
}

// ============================================================
// SIGNED URL TOKEN (for local storage)
// ============================================================

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

// ============================================================
// UPLOAD URL GENERATION
// ============================================================

/**
 * Generate upload URL based on storage provider
 * Includes fallback URLs for client-side retry mechanism
 */
export async function getUploadSignedUrl(
  config: StorageConfig,
  key: string,
  contentType: string,
  _expiresIn: number = 3600
): Promise<UploadUrlResult> {
  const effectiveProvider = getEffectiveStorageProvider(config)

  // Get primary URL
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

/**
 * Bunny.net Direct Upload URL with R2 and Local fallbacks
 * Client uploads directly to Bunny Storage via PUT
 */
async function getBunnyUploadUrlWithFallbacks(
  config: StorageConfig,
  key: string,
  contentType: string
): Promise<UploadUrlResult> {
  const uploadUrl = `https://${BUNNY_STORAGE_HOST}/${config.bunnyZone}/${key}`
  const publicUrl = `${config.bunnyCdnUrl}/${key}`

  // Build fallback URLs
  const fallbackUrls: UploadUrlResult['fallbackUrls'] = {}

  // R2 fallback
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

  // Local fallback (always available)
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

/**
 * R2 Presigned Upload URL
 */
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

    // R2 public URL logic
    let publicUrl: string
    
    // FORCE UPDATE: Always use main app domain for R2 proxy
    // Using app. subdomain caused 404s due to missing DNS/Cloudflare config
    const appHost = process.env.SHOPIFY_APP_URL || 'https://customizerapp.dev'
    
    // We don't strictly need a token for r2: paths in api.files.$.tsx (as per its current logic),
    // but generating one keeps it consistent with local file handling.
    const expiresAt = Date.now() + 365 * 24 * 3600 * 1000 // 1 year
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

/**
 * Generate a signed GET URL for an R2 object
 * Used by the file proxy to serve private R2 files
 */
export async function getR2SignedGetUrl(
  config: StorageConfig,
  key: string,
  expiresIn: number = 300 // 5 minutes default for proxy redirect
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

/**
 * Local Storage Upload URL
 * Client uploads via POST to our endpoint
 */
function getLocalUploadUrl(_config: StorageConfig, key: string): UploadUrlResult {
  let host = process.env.SHOPIFY_APP_URL || process.env.HOST || 'https://customizerapp.dev'
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

// ============================================================
// DOWNLOAD URL GENERATION
// ============================================================

/**
 * Generate download/public URL based on storage provider
 * IMPORTANT: Checks for provider prefix in key FIRST (bunny:, r2:, local:)
 * This ensures correct URL generation regardless of shop's current provider setting
 */
export async function getDownloadSignedUrl(
  config: StorageConfig,
  key: string,
  expiresIn: number = 30 * 24 * 3600
): Promise<string> {
  // Check if key is already a full URL (external storage)
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key
  }

  // Check if key indicates Bunny storage (prefix-based detection)
  if (key.startsWith('bunny:')) {
    const bunnyKey = key.replace('bunny:', '')
    // Encode path segments to handle spaces and special characters
    const encodedPath = bunnyKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `${config.bunnyCdnUrl || BUNNY_CDN_URL}/${encodedPath}`
  }

  // Check if key indicates R2 storage (prefix-based detection)
  if (key.startsWith('r2:')) {
    const r2Key = key.replace('r2:', '')
    // Encode path segments to handle spaces and special characters
    const encodedPath = r2Key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
      
    // Use configured Public URL (Recommended)
    const r2PublicUrl = config.r2PublicUrl || process.env.R2_PUBLIC_URL
    if (r2PublicUrl) {
       // Ensure no double slash if url ends with /
       const baseUrl = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl
       return `${baseUrl}/${encodedPath}`
    }

    // Fallback: Private bucket proxy using our API
    let host = process.env.SHOPIFY_APP_URL || process.env.HOST || 'https://customizerapp.dev'
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `https://${host}`
    }
    
    // Generate token for proxy access
    const expiresAt = Date.now() + expiresIn * 1000
    const token = generateLocalFileToken(`r2:${r2Key}`, expiresAt)
    return `${host}/api/files/r2:${encodeURIComponent(r2Key)}?token=${token}`
  }

  // Check if key indicates Local storage (prefix-based detection)
  if (key.startsWith('local:')) {
    const localKey = key.replace('local:', '')
    let host = process.env.SHOPIFY_APP_URL || process.env.HOST || 'https://customizerapp.dev'
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `https://${host}`
    }
    const expiresAt = Date.now() + expiresIn * 1000
    const token = generateLocalFileToken(localKey, expiresAt)
    return `${host}/api/files/${encodeURIComponent(localKey)}?token=${token}`
  }

  // Fallback: Use effective provider from config (no prefix in key)
  const effectiveProvider = getEffectiveStorageProvider(config)

  switch (effectiveProvider) {
    case 'bunny':
      // Bunny CDN URL (public)
      const encodedBunnyPath = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      return `${config.bunnyCdnUrl || BUNNY_CDN_URL}/${encodedBunnyPath}`
    case 'r2':
      // R2 public URL
      const encodedR2Path = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      return `${config.r2PublicUrl || process.env.R2_PUBLIC_URL}/${encodedR2Path}`
    case 'local':
    default:
      // Local signed URL
      let host = process.env.SHOPIFY_APP_URL || process.env.HOST || 'https://customizerapp.dev'
      if (!host.startsWith('http://') && !host.startsWith('https://')) {
        host = `https://${host}`
      }
      const expiresAt = Date.now() + expiresIn * 1000
      const token = generateLocalFileToken(key, expiresAt)
      return `${host}/api/files/${encodeURIComponent(key)}?token=${token}`
  }
}

/**
 * Generate thumbnail URL with Bunny Optimizer
 * IMPORTANT: URL encodes the path to handle special characters and spaces
 * Supports prefix-based detection: bunny:, r2:, local:
 */
export function getThumbnailUrl(
  config: StorageConfig,
  key: string,
  width: number = 200,
  height?: number
): string {
  // If already a URL, add optimizer params if Bunny
  if (key.startsWith('https://') && key.includes('.b-cdn.net')) {
    const url = new URL(key)
    url.searchParams.set('width', width.toString())
    if (height) url.searchParams.set('height', height.toString())
    url.searchParams.set('format', 'webp')
    url.searchParams.set('quality', '85')
    return url.toString()
  }

  // Bunny key - encode path segments to handle spaces and special chars
  if (config.provider === 'bunny' || key.startsWith('bunny:')) {
    const bunnyKey = key.replace('bunny:', '')
    // Encode each path segment separately to preserve slashes
    const encodedPath = bunnyKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `${config.bunnyCdnUrl || BUNNY_CDN_URL}/${encodedPath}?width=${width}${height ? `&height=${height}` : ''}&format=webp&quality=85`
  }

  // R2 key - R2 doesn't have image optimizer, return direct URL
  if (key.startsWith('r2:')) {
    const r2Key = key.replace('r2:', '')
    const encodedPath = r2Key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
      
    // Always prefer the custom domain (hardcoded + env fallback)
    const r2PublicUrl = process.env.SHOPIFY_APP_URL || 'https://customizerapp.dev' 
    
    if (r2PublicUrl) {
       const baseUrl = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl
       return `${baseUrl}/${encodedPath}`
    }

    // This part should technically be unreachable if we hardcode above, but keeping as safety net
    const r2AccountId = config.r2AccountId || process.env.R2_ACCOUNT_ID
    return `https://pub-${r2AccountId}.r2.dev/${encodedPath}`
  }

  // Local key - return signed URL for local files
  if (key.startsWith('local:')) {
    const localKey = key.replace('local:', '')
    let host = process.env.SHOPIFY_APP_URL || process.env.HOST || 'https://customizerapp.dev'
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `https://${host}`
    }
    const expiresAt = Date.now() + 3600 * 1000 // 1 hour for thumbnails
    const token = generateLocalFileToken(localKey, expiresAt)
    return `${host}/api/files/${encodeURIComponent(localKey)}?token=${token}`
  }

  // Local - no optimizer, return as-is (legacy, no prefix)
  return key
}

// ============================================================
// LOCAL FILE OPERATIONS
// ============================================================

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

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

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

/**
 * Build storage key WITH provider prefix (for database storage)
 * This is the CANONICAL format stored in database
 * Format: "bunny:shop/prod/uploadId/itemId/file.png" or "r2:..." or "local:..."
 * 
 * CRITICAL: This ensures preflight worker always has correct provider info
 */
export function buildStorageKeyWithPrefix(
  provider: StorageProvider,
  shopDomain: string,
  uploadId: string,
  itemId: string,
  filename: string
): string {
  const baseKey = buildStorageKey(shopDomain, uploadId, itemId, filename)
  // Always prefix with provider for unambiguous storage resolution
  return `${provider}:${baseKey}`
}

export function getLocalFilePath(key: string): string {
  return join(LOCAL_STORAGE_BASE, key)
}

/**
 * Check if a storage key is from Bunny CDN
 */
export function isBunnyUrl(key: string | null | undefined): boolean {
  if (!key) return false
  return key.includes('.b-cdn.net') || key.includes('bunnycdn.com') || key.startsWith('bunny:')
}

/**
 * Check if a storage key is from R2
 */
export function isR2Url(key: string | null | undefined): boolean {
  if (!key) return false
  return key.includes('.r2.dev') || key.includes('r2.cloudflarestorage.com')
}

/**
 * Check if a storage key is an external URL
 */
export function isExternalUrl(key: string | null | undefined): boolean {
  if (!key) return false
  return key.startsWith('http://') || key.startsWith('https://')
}
