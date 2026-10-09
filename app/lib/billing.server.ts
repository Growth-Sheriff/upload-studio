import { createHash } from 'node:crypto'
import prisma from '~/lib/prisma.server'
import { MAX_FILE_SIZE_MB } from './billingPolicy'
import { merchantLegalAgreementSatisfied } from './publicLegal.server'
export * from './billingPolicy'
export function buildUsageIdempotencyKey(shopId: string, orderId: string): string {
  return `agsu-order-${createHash('sha256').update(`${shopId}|${orderId}`).digest('hex')}`
}
export async function checkUploadAllowed(shopId: string, _mode: string, fileSizeMB: number): Promise<{ allowed: boolean; error?: string }> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { billingStatus: true, erasureStartedAt: true, uninstalledAt: true, legalAgreementVersion: true, legalAgreementAcceptedAt: true, legalAgreementActorId: true } })
  if (!shop) return { allowed: false, error: 'Shop not found' }
  if (shop.erasureStartedAt || shop.uninstalledAt || shop.billingStatus !== 'active') return { allowed: false, error: 'This shop is unavailable or has not approved Shopify app billing. Please contact the shop.' }
  if (!merchantLegalAgreementSatisfied(shop)) return { allowed: false, error: 'This shop has not accepted the current service and data processing terms. Please contact the shop.' }
  if (fileSizeMB > MAX_FILE_SIZE_MB) return { allowed: false, error: `File exceeds the ${MAX_FILE_SIZE_MB} MB upload limit.` }
  return { allowed: true }
}
