import { createHash } from 'node:crypto'
import prisma from '~/lib/prisma.server'

/** Public commercial contract: charge only app-served captured line items. */
export const BILLING_POLICY = Object.freeze({ rate: 0.035, perOrderCapUsd: 6, currency: 'USD' as const })
export const COMMISSION_PERCENT = BILLING_POLICY.rate
export const COMMISSION_CAP_USD = BILLING_POLICY.perOrderCapUsd
export const MAX_FILE_SIZE_MB = 10240
export const BILLING_CAP_TIERS = [50, 200, 500, 1000] as const
export const BILLING_TERMS = '3.5% of captured app-served order line items after discounts, excluding tax and shipping; maximum US$6 per order. No monthly base fee. Non-USD amounts use a disclosed ECB reference-rate snapshot. Cancelled or fully refunded orders before recording incur no fee. Recorded usage adjustments are reviewed for Shopify app credit.'

export function getCommissionRate(_mode: string): number { return COMMISSION_PERCENT }
export function moneyToCents(amount: number): number { return Number.isFinite(amount) ? Math.round(amount * 100) : 0 }
export function centsToMoney(cents: number): number { return cents / 100 }
export function sumMoneyCents(amounts: Iterable<number>): number {
  let total = 0
  for (const amount of amounts) total += moneyToCents(amount)
  return total
}
/** Input is USD, never an unconverted shop-currency amount. */
export function calculateCommissionAmount(servedAmountUsd: number): number {
  const amount = Number.isFinite(servedAmountUsd) ? Math.max(0, servedAmountUsd) : 0
  return Math.min(Math.round((amount * COMMISSION_PERCENT + Number.EPSILON) * 100) / 100, COMMISSION_CAP_USD)
}
export function buildUsageIdempotencyKey(shopId: string, orderId: string): string {
  return `agsu-order-${createHash('sha256').update(`${shopId}|${orderId}`).digest('hex')}`
}
export function recommendedBillingCap(projectedMonthlyServedUsd = 0): number {
  const estimated = Math.max(0, projectedMonthlyServedUsd) * COMMISSION_PERCENT * 1.25
  return BILLING_CAP_TIERS.find((cap) => cap >= estimated) ?? 1000
}
export function billingCapState(cap: number, used: number, nextFee = 0): 'available' | 'approaching' | 'exhausted' {
  if (cap <= 0 || moneyToCents(used) + moneyToCents(nextFee) > moneyToCents(cap) || moneyToCents(used) >= moneyToCents(cap)) return 'exhausted'
  return used >= cap * 0.8 ? 'approaching' : 'available'
}
export function isZeroPaymentOrder(order: { total_price?: string | number | null; current_total_price?: string | number | null }): boolean {
  return (parseFloat(String(order.current_total_price ?? order.total_price ?? '0')) || 0) <= 0
}
export async function checkUploadAllowed(shopId: string, _mode: string, fileSizeMB: number): Promise<{ allowed: boolean; error?: string }> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { billingStatus: true } })
  if (!shop) return { allowed: false, error: 'Shop not found' }
  if (shop.billingStatus !== 'active') return { allowed: false, error: 'This shop has not approved Shopify app billing. Please contact the shop.' }
  if (fileSizeMB > MAX_FILE_SIZE_MB) return { allowed: false, error: `File exceeds the ${MAX_FILE_SIZE_MB} MB upload limit.` }
  return { allowed: true }
}
