// Shared builders for customer-facing upload file URLs and identity links.
//
// The URL rules mirror api.upload.status.$id.tsx: storage keys are prefixed
// (`bunny:`, `r2:`, `local:`, `shopify:`) or are already absolute URLs.
// `shopify:` keys need an async Admin API resolution and are intentionally
// NOT handled here — callers fall back to the identity page link, and the
// status endpoint rewrites those keys to absolute URLs over time.

import {
  generateLocalFileToken,
  getStorageConfig,
  getThumbnailUrl,
  isBunnyUrl,
  type StorageConfig,
} from '~/lib/storage.server'

const LOCAL_TOKEN_TTL_MS = 365 * 24 * 3600 * 1000

function appHost(): string {
  const hostEnv = process.env.SHOPIFY_APP_URL || process.env.HOST || ''
  return hostEnv.startsWith('https://') || hostEnv.startsWith('http://')
    ? hostEnv.replace(/\/$/, '')
    : `https://${hostEnv}`.replace(/\/$/, '')
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** Absolute identity page URL for an upload (HTML for humans, .json for machines). */
export function buildIdentityUrl(uploadId: string): string {
  return `${appHost()}/i/${uploadId}`
}

export function storageConfigForShop(shop: {
  storageProvider: string
  storageConfig: unknown
}): StorageConfig {
  return getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: shop.storageConfig as Record<string, string> | null,
  })
}

/** Customer-facing download URL for a stored file key, or null for keys that
 *  need async resolution (`shopify:`) or are missing. */
export function buildFileUrl(
  storageConfig: StorageConfig,
  storageKey: string | null | undefined
): string | null {
  if (!storageKey) return null

  if (storageKey.startsWith('http://') || storageKey.startsWith('https://')) {
    return storageKey
  }

  if (storageKey.startsWith('bunny:') || isBunnyUrl(storageKey)) {
    const bunnyKey = storageKey.replace(/^bunny:/, '')
    const cdnUrl =
      storageConfig.bunnyCdnUrl ||
      process.env.BUNNY_CDN_URL ||
      'https://customizerappdev.b-cdn.net'
    return `${cdnUrl}/${encodePath(bunnyKey)}`
  }

  if (storageKey.startsWith('r2:')) {
    const r2Key = storageKey.replace(/^r2:/, '')
    const token = generateLocalFileToken(`r2:${r2Key}`, Date.now() + LOCAL_TOKEN_TTL_MS)
    return `${appHost()}/api/files/r2:${encodePath(r2Key)}?token=${token}`
  }

  if (storageKey.startsWith('shopify:')) {
    return null
  }

  const localKey = storageKey.replace(/^local:/, '')
  const token = generateLocalFileToken(localKey, Date.now() + LOCAL_TOKEN_TTL_MS)
  return `${appHost()}/api/files/${encodeURIComponent(localKey)}?token=${encodeURIComponent(token)}`
}

/** Thumbnail URL for a stored thumbnail key (small preview rendition). */
export function buildThumbnailUrl(
  storageConfig: StorageConfig,
  thumbnailKey: string | null | undefined
): string | null {
  if (!thumbnailKey) return null
  if (thumbnailKey.startsWith('bunny:') || isBunnyUrl(thumbnailKey)) {
    return getThumbnailUrl(storageConfig, thumbnailKey, 200)
  }
  return buildFileUrl(storageConfig, thumbnailKey)
}
