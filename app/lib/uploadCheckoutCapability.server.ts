import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireTenantShopId } from './tenantContext.server'

function digest(uploadId: string): Buffer {
  const secret = process.env.SECRET_KEY || process.env.SHOPIFY_API_SECRET
  if (!secret) throw new Error('Upload checkout signing secret is required')
  return createHmac('sha256', secret).update(`guest-checkout:${requireTenantShopId()}:${uploadId}`).digest()
}

/** Issued only with an upload intent (or a resume proving the object key and
 * multipart ID). Unlike an identity/download link, this proves the guest
 * possesses the upload session. It is not a shopper/browser identifier. */
export function createUploadCheckoutToken(uploadId: string): string {
  return digest(uploadId).toString('base64url')
}

export function verifyUploadCheckoutToken(uploadId: string, token: unknown): boolean {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  const expected = digest(uploadId)
  const actual = Buffer.from(token, 'base64url')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
