import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from './prisma.server'
import { buildUsageIdempotencyKey } from './billing.server'
import { COMMISSION_CAP_USD } from './billingPolicy'
import { withTenantContext, withTenantSql } from './tenantContext.server'

export interface ManualBillingAdjustment {
  shopId: string
  shopDomain: string
  reviewId: string
  commissionId: string
  expectedUsageRecordId: string
  expectedFeeUsd: string
  operation: 'credit' | 'refund'
  outcome: 'confirmed' | 'unknown'
  currency: 'USD'
  amountUsd: string
  providerRef?: string
  providerConfirmedAt?: string
  operator: string
  reason: string
}

export class BillingAdjustmentError extends Error {
  constructor(message: string) { super(message); this.name = 'BillingAdjustmentError' }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function text(value: unknown, name: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new BillingAdjustmentError(`Invalid ${name}`)
  return value.trim()
}
function cents(value: unknown, name: string): number {
  if (typeof value !== 'string' || !/^\d{1,3}\.\d{2}$/.test(value)) throw new BillingAdjustmentError(`${name} must be a USD amount with exactly two decimals`)
  const [dollars, fraction] = value.split('.')
  return Number(dollars) * 100 + Number(fraction)
}

/** Validate an operator's attestation, not the provider outcome itself. The
 * receipt must already have been reconciled in Shopify's own charge history. */
export function validateManualBillingAdjustment(raw: unknown, now = new Date()): ManualBillingAdjustment {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BillingAdjustmentError('Expected one adjustment object')
  const value = raw as Record<string, unknown>
  const allowed = new Set(['shopId', 'shopDomain', 'reviewId', 'commissionId', 'expectedUsageRecordId', 'expectedFeeUsd', 'operation', 'outcome', 'currency', 'amountUsd', 'providerRef', 'providerConfirmedAt', 'operator', 'reason'])
  if (Object.keys(value).some(key => !allowed.has(key))) throw new BillingAdjustmentError('Unexpected adjustment field')
  const shopDomain = text(value.shopDomain, 'shopDomain', 255)
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) throw new BillingAdjustmentError('Expected an exact myshopify.com domain')
  if (value.operation !== 'credit' && value.operation !== 'refund') throw new BillingAdjustmentError('Expected credit or refund')
  if (value.outcome !== 'confirmed' && value.outcome !== 'unknown') throw new BillingAdjustmentError('Expected confirmed or unknown')
  if (value.currency !== 'USD') throw new BillingAdjustmentError('Only a reconciled USD adjustment is supported; do not guess invoice FX')
  const fee = cents(value.expectedFeeUsd, 'expectedFeeUsd')
  const amount = cents(value.amountUsd, 'amountUsd')
  if (fee <= 0 || fee > COMMISSION_CAP_USD * 100 || amount <= 0 || amount > fee) throw new BillingAdjustmentError('Adjustment must be positive and no greater than the frozen fee')
  let providerRef: string | undefined
  let providerConfirmedAt: string | undefined
  if (value.outcome === 'confirmed') {
    providerRef = text(value.providerRef, 'providerRef')
    const date = text(value.providerConfirmedAt, 'providerConfirmedAt', 30)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date) || !Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime() + 60000 || new Date(date).toISOString().slice(0, 19) !== date.slice(0, 19)) throw new BillingAdjustmentError('providerConfirmedAt must be a verified UTC time, not a future timestamp')
    providerConfirmedAt = new Date(date).toISOString()
  } else if (value.providerRef !== undefined || value.providerConfirmedAt !== undefined) throw new BillingAdjustmentError('Unknown outcomes cannot claim a confirmed provider receipt')
  return {
    shopId: text(value.shopId, 'shopId', 100), shopDomain,
    reviewId: text(value.reviewId, 'reviewId', 100), commissionId: text(value.commissionId, 'commissionId', 100),
    expectedUsageRecordId: text(value.expectedUsageRecordId, 'expectedUsageRecordId'),
    expectedFeeUsd: (fee / 100).toFixed(2), operation: value.operation, outcome: value.outcome,
    currency: 'USD', amountUsd: (amount / 100).toFixed(2), providerRef, providerConfirmedAt,
    operator: text(value.operator, 'operator', 120), reason: text(value.reason, 'reason', 500),
  }
}

/** Owner-only bookkeeping: no provider call, money movement or Commission
 * update. Holding Shop fences redaction; BillingCredit's unique providerRef
 * prevents reusing the exact receipt even after ordinary audit expiry. */
export async function recordManualBillingAdjustment(raw: unknown) {
  if (process.env.PUBLIC_APP_RUNTIME !== 'true') throw new BillingAdjustmentError('Public app runtime is required')
  const input = validateManualBillingAdjustment(raw)
  const fingerprint = hash(JSON.stringify(input))
  const auditId = input.outcome === 'confirmed' ? `manual-adjustment-${hash(input.providerRef!)}` : `manual-adjustment-unknown-${fingerprint}`
  return withTenantContext(input.shopId, () => withTenantSql(async owner => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          // Uninstalled shops may still need relief before erasure begins.
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM shops WHERE id = ${owner} AND shop_domain = ${input.shopDomain} AND erasure_started_at IS NULL AND billing_status <> 'erasing' FOR UPDATE`
          if (!locked.length) throw new BillingAdjustmentError('Exact shop is missing or closed for erasure')
          const fee = await tx.commission.findFirst({ where: { id: input.commissionId, shopId: owner } })
          const review = await tx.billingCredit.findFirst({ where: { id: input.reviewId, shopId: owner, commissionId: input.commissionId } })
          if (!fee || !review) throw new BillingAdjustmentError('Exact owned fee and review were not found')
          const key = buildUsageIdempotencyKey(owner, fee.orderId)
          if (fee.status !== 'paid' || fee.paymentProvider !== 'shopify' || fee.billingCurrency !== 'USD' || !fee.reviewRequiredAt ||
              fee.usageRecordId !== input.expectedUsageRecordId || fee.paymentRef !== input.expectedUsageRecordId ||
              fee.usageIdempotencyKey !== key || !fee.usageSubscriptionId || !fee.usageLineItemId ||
              fee.commissionAmount.toFixed(2) !== input.expectedFeeUsd || review.idempotencyKey !== `credit-${key}` ||
              Number(review.amountUsd) < Number(input.amountUsd)) throw new BillingAdjustmentError('Frozen fee, usage identity or review budget does not match; reconcile before recording')
          const partial = Number(input.amountUsd) < Number(input.expectedFeeUsd)
          const status = input.outcome === 'unknown' ? 'quarantined' : `${partial ? 'partially_' : ''}${input.operation === 'credit' ? 'credited' : 'refunded'}`
          if (review.providerRef || review.settledAt || review.receiptFingerprint || review.settledAmountUsd || !['review', 'quarantined'].includes(review.status)) {
            // Financial receipt facts outlive ordinary 365-day audits. An
            // identical replay never recreates its expired operator audit.
            if (input.outcome === 'confirmed' && review.providerRef === input.providerRef && review.settledAt && review.status === status && review.receiptFingerprint === fingerprint && review.settledAmountUsd?.toFixed(2) === input.amountUsd) return { reviewId: review.id, status: review.status, auditId, replayed: true }
            throw new BillingAdjustmentError('Review already has an outcome; conflicting attestation cannot overwrite it')
          }
          const prior = await tx.auditLog.findFirst({ where: { id: auditId, shopId: owner } })
          if (prior) {
            const metadata = prior.metadata as Record<string, unknown> | null
            if (prior.resourceId !== review.id || metadata?.fingerprint !== fingerprint ||
                (input.outcome === 'confirmed' && (review.providerRef !== input.providerRef || !review.settledAt || review.status !== status))) throw new BillingAdjustmentError('Receipt or attestation conflicts with a previous outcome')
            return { reviewId: review.id, status: review.status, auditId, replayed: true }
          }
          const changed = await tx.billingCredit.updateMany({
            where: { id: review.id, shopId: owner, commissionId: fee.id, status: review.status, providerRef: null, settledAt: null, receiptFingerprint: null, settledAmountUsd: null, amountUsd: review.amountUsd },
            data: { status, ...(input.outcome === 'confirmed' ? { providerRef: input.providerRef, settledAt: new Date(), settledAmountUsd: input.amountUsd, receiptFingerprint: fingerprint } : {}) },
          })
          if (changed.count !== 1) throw new BillingAdjustmentError('Review changed concurrently; inspect the existing outcome')
          await tx.auditLog.create({ data: {
            id: auditId, shopId: owner, userId: input.operator,
            action: input.outcome === 'confirmed' ? 'shopify_manual_adjustment_recorded' : 'shopify_manual_adjustment_unknown',
            resourceType: 'billing_credit', resourceId: review.id,
            metadata: { ...input, fingerprint, orderId: fee.orderId, usageIdempotencyKey: key, usageSubscriptionId: fee.usageSubscriptionId, usageLineItemId: fee.usageLineItemId, operatorIdentitySource: 'owner_cli_attestation', commissionUnchanged: true },
          } })
          return { reviewId: review.id, status, auditId, replayed: false }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue
        // A globally reused receipt can belong to a different shop. Do not
        // reveal its owner; the transaction rolls back this review's update.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BillingAdjustmentError('Receipt was already recorded or conflicts; inspect provider history, do not issue relief again')
        throw error
      }
    }
  }))
}
