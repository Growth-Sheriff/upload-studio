import prisma from './prisma.server'
import { bindUploadCapabilityToken, type StorageProvider } from './storage.server'

/** A signed key is not a user-supplied shop selector. Bind its signed owner,
 * then verify its persisted shop prefix and deny writes during erasure. */
export async function authorizeUploadStorageCapability(
  provider: StorageProvider,
  key: string,
  expectedSize: number,
  token: string
): Promise<boolean> {
  const shopId = bindUploadCapabilityToken(provider, key, expectedSize, token)
  if (!shopId) return false
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true, erasureStartedAt: true, billingStatus: true },
  })
  if (!shop || shop.erasureStartedAt || shop.billingStatus === 'erasing') return false
  const prefix = `${shop.shopDomain.replace(/[^a-zA-Z0-9-]/g, '_')}/`
  if (!key.startsWith(prefix)) return false
  const segments = key.split('/')
  return segments.length === 5 && ['prod', 'dev'].includes(segments[1]) &&
    segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\'))
}
