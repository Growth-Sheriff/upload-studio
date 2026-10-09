import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireTenantShopId, enterTenantContext } from './tenantContext.server'

function secret(): string {
  const value = process.env.SECRET_KEY || process.env.SHOPIFY_API_SECRET
  if (!value) throw new Error('Upload capability signing secret is required')
  return value
}

/** Durable bearer link belongs to one shop and upload. It grants only that
 * file's public identity/download, not access to a guessed global record ID. */
export function createUploadCapability(uploadId: string): string {
  const payload = Buffer.from(JSON.stringify({ shopId: requireTenantShopId(), uploadId })).toString('base64url')
  return `${payload}.${createHmac('sha256', secret()).update(`identity:${payload}`).digest('base64url')}`
}

export function bindUploadCapability(uploadId: string, token: string | null): boolean {
  if (!token || token.length > 1024) return false
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return false
  try {
    const expected = createHmac('sha256', secret()).update(`identity:${payload}`).digest()
    const actual = Buffer.from(signature, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (value.uploadId !== uploadId || typeof value.shopId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value.shopId)) return false
    enterTenantContext(value.shopId)
    return true
  } catch { return false }
}
