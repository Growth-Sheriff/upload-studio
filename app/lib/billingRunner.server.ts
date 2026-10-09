import prisma from '~/lib/prisma.server'
import { billingCapState, buildUsageIdempotencyKey, moneyToCents } from '~/lib/billing.server'
import { createShopifyUsageRecord, findShopifyUsageRecord, ShopifyBillingUserError, syncShopifyBilling, type BillingAdmin } from '~/lib/shopifyBilling.server'
import { withTenantContext } from '~/lib/tenantContext.server'

export function usageFeeEligible(row: { collectibleAt?: Date | string | null; reviewRequiredAt?: Date | string | null; shopifyFinancialStatus?: string | null; shopifyRefundStatus?: string | null; shopifyCancelledAt?: Date | string | null }): boolean {
  return Boolean(row.collectibleAt) && !row.reviewRequiredAt && row.shopifyFinancialStatus === 'paid' && !row.shopifyRefundStatus && !row.shopifyCancelledAt
}

/** Retry a quarantined request only with its original immutable amount/key/line. */
export async function runShopUsageBilling(shopId: string, suppliedAdmin?: BillingAdmin) {
  return withTenantContext(shopId, () => executeShopUsageBilling(shopId, suppliedAdmin))
}

async function executeShopUsageBilling(shopId: string, suppliedAdmin?: BillingAdmin) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, shopDomain: true, uninstalledAt: true, erasureStartedAt: true } })
  if (!shop || shop.uninstalledAt || shop.erasureStartedAt) return { recorded: 0, pending: 0, reason: 'uninstalled_or_erasing' }
  const admin = suppliedAdmin || (await (await import('~/shopify.server')).unauthenticated.admin(shop.shopDomain)).admin
  const billing = await syncShopifyBilling(shopId, admin)
  const approved = billing.status === 'active' && Boolean(billing.usageLineItemId)
  const now = new Date()
  const candidates = await prisma.commission.findMany({
    where: { shopId, status: { in: ['pending', 'charging'] }, OR: [{ nextBillingAttemptAt: null }, { nextBillingAttemptAt: { lte: now } }] },
    orderBy: { createdAt: 'asc' }, take: 20,
  })
  let recorded = 0
  let used = Number(billing.balanceUsedUsd)
  for (const candidate of candidates) {
    if (candidate.status === 'charging' && !candidate.usageRequestStartedAt) {
      // The durable request-start marker precedes the provider call. An expired
      // lease without that marker proves this process never sent the request.
      const terminal = Boolean(candidate.shopifyCancelledAt) || candidate.shopifyRefundStatus === 'full' || candidate.shopifyFinancialStatus === 'voided'
      const recovered = await prisma.commission.updateMany({ where: { shopId, id: candidate.id, status: 'charging', usageRequestStartedAt: null, paymentRef: candidate.paymentRef, OR: [{ nextBillingAttemptAt: null }, { nextBillingAttemptAt: { lte: now } }] }, data: { status: terminal ? 'void' : 'pending', paymentRef: null, nextBillingAttemptAt: null, ...(terminal ? { commissionAmount: 0, collectibleAt: null } : {}) } })
      if (!recovered.count || terminal) continue
      candidate.status = 'pending'; candidate.paymentRef = null; candidate.nextBillingAttemptAt = null
    }
    const wasUnknown = candidate.status === 'charging' && Boolean(candidate.usageRequestStartedAt)
    // Terminal facts prohibit a new request. An already-sent request must be
    // reconciled using its key even if a cancellation raced the provider.
    if (!wasUnknown && !usageFeeEligible(candidate)) continue
    if (!wasUnknown && !approved) continue
    const amount = Number(candidate.commissionAmount)
    if (moneyToCents(amount) <= 0) {
      if (!wasUnknown) await prisma.commission.updateMany({ where: { shopId, id: candidate.id, status: 'pending', paymentRef: null }, data: { status: 'void', collectibleAt: null } })
      continue
    }
    if (!wasUnknown && billingCapState(Number(billing.cappedAmountUsd), used, amount) === 'exhausted') {
      await prisma.auditLog.upsert({ where: { id: `usage-cap-${shopId}-${billing.subscriptionId}-${billing.currentPeriodEnd?.toISOString() || 'unknown'}` }, create: { id: `usage-cap-${shopId}-${billing.subscriptionId}-${billing.currentPeriodEnd?.toISOString() || 'unknown'}`, shopId, action: 'shopify_billing_cap_blocked', resourceType: 'billing', resourceId: billing.subscriptionId, metadata: { approvedCapUsd: Number(billing.cappedAmountUsd), usedUsd: used, orderId: candidate.orderId } }, update: {} })
      break
    }
    const key = candidate.usageIdempotencyKey || buildUsageIdempotencyKey(shopId, candidate.orderId)
    const line = wasUnknown ? candidate.usageLineItemId : billing.usageLineItemId
    const subscription = wasUnknown ? candidate.usageSubscriptionId : billing.subscriptionId
    if (!line || !subscription) throw new Error('Unresolved usage request has no original subscription/line; manual reconciliation required')
    // Atomic five-minute lease. Pending facts/amount are checked again so a
    // refund or edit racing candidate selection cannot be silently charged.
    const claim = await prisma.commission.updateMany({ where: {
      shopId, id: candidate.id, status: candidate.status, commissionAmount: candidate.commissionAmount,
      OR: [{ nextBillingAttemptAt: null }, { nextBillingAttemptAt: { lte: now } }],
      ...(wasUnknown ? {} : { collectibleAt: { not: null }, reviewRequiredAt: null, shopifyFinancialStatus: 'paid', shopifyRefundStatus: null, shopifyCancelledAt: null, paymentRef: null }),
    }, data: { status: 'charging', paymentRef: key, usageIdempotencyKey: key, usageLineItemId: line, usageSubscriptionId: subscription, nextBillingAttemptAt: new Date(Date.now() + 5 * 60000) } })
    if (!claim.count) continue
    const claimed = await prisma.commission.findFirst({ where: { shopId, id: candidate.id, status: 'charging', paymentRef: key } })
    if (!claimed) continue
    if (!wasUnknown && !usageFeeEligible(claimed)) {
      await prisma.commission.updateMany({ where: { shopId, id: claimed.id, status: 'charging', usageRequestStartedAt: null }, data: { status: 'pending', paymentRef: null, nextBillingAttemptAt: null } })
      continue
    }
    // Cancellation/refund can arrive after the eligibility read above. The
    // first request may start only if those facts are still true in this CAS.
    // Previously sent, unknown requests keep their original reconciliation path.
    const started = await prisma.commission.updateMany({ where: {
      shopId, id: claimed.id, status: 'charging', paymentRef: key,
      ...(wasUnknown ? {} : { usageRequestStartedAt: null, collectibleAt: { not: null }, reviewRequiredAt: null, shopifyFinancialStatus: 'paid', shopifyRefundStatus: null, shopifyCancelledAt: null }),
    }, data: { usageRequestStartedAt: claimed.usageRequestStartedAt || new Date() } })
    if (!started.count) continue
    try {
      let recordId: string
      if (wasUnknown && (!usageFeeEligible(claimed) || !approved)) {
        const existing = await findShopifyUsageRecord(admin, { subscriptionId: subscription, lineItemId: line, key, amountUsd: amount, requestStartedAt: candidate.usageRequestStartedAt! })
        if (!existing) throw new Error('Terminal order usage not found; no new request permitted, outcome remains quarantined')
        recordId = existing
      } else {
        recordId = await createShopifyUsageRecord(admin, { lineItemId: line, amountUsd: amount, orderId: candidate.orderId, orderNumber: candidate.orderNumber, idempotencyKey: key })
      }
      await prisma.$transaction(async (tx) => {
        const settled = await tx.commission.updateMany({ where: { shopId, id: candidate.id, status: 'charging', paymentRef: key }, data: { status: 'paid', paidAt: new Date(), paymentRef: recordId, paymentProvider: 'shopify', usageRecordId: recordId, billingLastError: null, nextBillingAttemptAt: null } })
        if (!settled.count) throw new Error('Usage was recorded but local settlement changed; reconcile original key')
        const final = await tx.commission.findFirst({ where: { shopId, id: candidate.id } })
        if (final?.shopifyCancelledAt || final?.shopifyRefundStatus === 'full') {
          const creditKey = `credit-${key}`
          await tx.billingCredit.upsert({ where: { idempotencyKey: creditKey }, create: { shopId, commissionId: candidate.id, amountUsd: amount, status: 'review', idempotencyKey: creditKey }, update: {} })
        }
        await tx.auditLog.create({ data: { shopId, action: 'shopify_usage_recorded', resourceType: 'commission', resourceId: candidate.orderId, metadata: { recordId, key, amountUsd: amount, lineItemId: line } } })
      })
      recorded++
      used += amount
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof ShopifyBillingUserError && !wasUnknown) {
        // GraphQL userErrors prove this call did not create a record. Only this
        // first confirmed rejection may return to pending; never a lost outcome.
        await prisma.commission.updateMany({ where: { shopId, id: candidate.id, status: 'charging', paymentRef: key }, data: { status: 'pending', paymentRef: null, usageRequestStartedAt: null, billingLastError: message, nextBillingAttemptAt: new Date(Date.now() + 15 * 60000) } })
      } else {
        await prisma.commission.updateMany({ where: { shopId, id: candidate.id, status: 'charging', paymentRef: key }, data: { billingLastError: message, nextBillingAttemptAt: new Date(Date.now() + 5 * 60000) } })
      }
      await prisma.auditLog.create({ data: { shopId, action: error instanceof ShopifyBillingUserError && !wasUnknown ? 'shopify_usage_rejected' : 'shopify_usage_outcome_unknown', resourceType: 'commission', resourceId: candidate.orderId, metadata: { key, lineItemId: line, amountUsd: amount, message } } })
    }
  }
  return { recorded, pending: candidates.length - recorded }
}
