export const COMMISSION_AWAITING_PAYMENT_STATUS = 'awaiting_payment'

export type ShopifyRefundState = 'none' | 'partial' | 'full'

export interface ShopifyCommissionFacts {
  financialStatus: string
  captureConfirmed: boolean
  cancelledAt: Date | null
  refundState: ShopifyRefundState
  terminalUnpaid: boolean
  observedAt: Date | null
}

export interface CurrentCommissionState {
  status: string | null
  paymentRef?: string | null
  collectibleAt?: Date | null
  reviewRequiredAt?: Date | null
  shopifyRefundStatus?: string | null
  shopifyCancelledAt?: Date | null
}

export type CommissionReconciliationPlan =
  | { action: 'await_payment'; status: typeof COMMISSION_AWAITING_PAYMENT_STATUS }
  | { action: 'make_collectible'; status: 'pending' }
  | { action: 'void'; status: 'void'; reason: string }
  | { action: 'review'; status: string; reason: string }
  | { action: 'preserve'; status: string }

function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function parsedDate(value: unknown): Date | null {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isFinite(date.getTime()) ? date : null
}

function successfulRefundAmount(order: {
  refunds?: Array<{
    transactions?: Array<{
      kind?: string | null
      status?: string | null
      amount?: string | number | null
    }> | null
  }> | null
}): number {
  let total = 0
  for (const refund of order.refunds || []) {
    for (const transaction of refund.transactions || []) {
      if (normalized(transaction.kind) !== 'refund') continue
      const status = normalized(transaction.status)
      if (status && status !== 'success') continue
      total += Math.max(0, Number.parseFloat(String(transaction.amount ?? '0')) || 0)
    }
  }
  return total
}

/**
 * Extract only provider facts Shopify can prove. In particular,
 * `partially_paid` is not enough evidence that this app's line items were
 * captured, so only `paid` can make a fee collectible automatically.
 */
export function extractShopifyCommissionFacts(order: {
  financial_status?: string | null
  cancelled_at?: string | null
  updated_at?: string | null
  processed_at?: string | null
  total_price?: string | number | null
  current_total_price?: string | number | null
  refunds?: Array<{
    transactions?: Array<{
      kind?: string | null
      status?: string | null
      amount?: string | number | null
    }> | null
  }> | null
}): ShopifyCommissionFacts {
  const financialStatus = normalized(order.financial_status)
  const originalTotal = Math.max(0, Number.parseFloat(String(order.total_price ?? '0')) || 0)
  const currentTotal = Math.max(
    0,
    Number.parseFloat(String(order.current_total_price ?? order.total_price ?? '0')) || 0
  )
  const refundedAmount = successfulRefundAmount(order)
  const hasRefundRecord = Boolean(order.refunds?.length)

  let refundState: ShopifyRefundState = 'none'
  if (
    financialStatus === 'refunded' ||
    (originalTotal > 0 && currentTotal <= 0) ||
    (originalTotal > 0 && refundedAmount >= originalTotal - 0.005)
  ) {
    refundState = 'full'
  } else if (
    financialStatus === 'partially_refunded' ||
    refundedAmount > 0 ||
    hasRefundRecord
  ) {
    refundState = 'partial'
  }

  return {
    financialStatus,
    captureConfirmed: financialStatus === 'paid',
    cancelledAt: parsedDate(order.cancelled_at),
    refundState,
    terminalUnpaid: financialStatus === 'voided',
    observedAt: parsedDate(order.updated_at) || parsedDate(order.processed_at),
  }
}

function protectedByProviderClaim(current: CurrentCommissionState): boolean {
  return (
    current.status === 'paid' ||
    current.status === 'charging' ||
    current.status === 'checkout_reserved' ||
    Boolean(current.paymentRef)
  )
}

/**
 * Pure, monotone state decision. Refund/cancellation facts never release a
 * provider claim and a late paid webhook never reopens a void/reviewed row.
 */
export function planCommissionReconciliation(input: {
  current: CurrentCommissionState
  facts: ShopifyCommissionFacts
  servedAmount: number
  zeroPayment: boolean
}): CommissionReconciliationPlan {
  const { current, facts } = input
  const status = current.status
  const protectedClaim = protectedByProviderClaim(current)

  const terminalReason = facts.cancelledAt
    ? 'shopify_order_cancelled'
    : facts.refundState === 'full'
      ? 'shopify_order_fully_refunded'
      : facts.terminalUnpaid
        ? 'shopify_payment_voided'
        : input.zeroPayment || input.servedAmount <= 0
          ? 'shopify_zero_attributable_payment'
          : null

  if (terminalReason) {
    if (protectedClaim) {
      return {
        action: 'review',
        status: status || COMMISSION_AWAITING_PAYMENT_STATUS,
        reason: `${terminalReason}_provider_reconciliation_required`,
      }
    }
    if (status === 'void' || status === 'waived') {
      return { action: 'preserve', status }
    }
    return { action: 'void', status: 'void', reason: terminalReason }
  }

  if (facts.refundState === 'partial') {
    if (status === 'void' || status === 'waived') {
      return { action: 'preserve', status }
    }
    return {
      action: 'review',
      status: status || COMMISSION_AWAITING_PAYMENT_STATUS,
      reason: 'shopify_order_partially_refunded',
    }
  }

  // A cancellation/refund already observed in a newer event is sticky. This
  // prevents an out-of-order paid delivery from making the row collectible.
  if (current.shopifyCancelledAt || current.shopifyRefundStatus) {
    if (status === 'void' || status === 'waived') {
      return { action: 'preserve', status }
    }
    return {
      action: current.reviewRequiredAt ? 'preserve' : 'review',
      status: status || COMMISSION_AWAITING_PAYMENT_STATUS,
      ...(current.reviewRequiredAt
        ? {}
        : { reason: 'shopify_terminal_fact_already_observed' }),
    } as CommissionReconciliationPlan
  }

  if (facts.captureConfirmed) {
    if (status === 'void' || status === 'waived' || status === 'paid' || protectedClaim) {
      return { action: 'preserve', status: status || COMMISSION_AWAITING_PAYMENT_STATUS }
    }
    if (current.reviewRequiredAt) {
      return { action: 'preserve', status: status || COMMISSION_AWAITING_PAYMENT_STATUS }
    }
    return { action: 'make_collectible', status: 'pending' }
  }

  if (!status) {
    return { action: 'await_payment', status: COMMISSION_AWAITING_PAYMENT_STATUS }
  }
  return { action: 'preserve', status }
}

export function isCommissionCollectible(row: {
  status: string
  paymentRef?: string | null
  collectibleAt?: Date | string | null
  reviewRequiredAt?: Date | string | null
}): boolean {
  return (
    row.status === 'pending' &&
    !row.paymentRef &&
    Boolean(row.collectibleAt) &&
    !row.reviewRequiredAt
  )
}
