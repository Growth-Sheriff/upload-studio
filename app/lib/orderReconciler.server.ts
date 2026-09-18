// Convergent order reconciliation.
//
// Shopify order webhooks (orders/create, orders/paid, orders/cancelled,
// orders/fulfilled) each carry the FULL order state — financial_status,
// cancelled_at, fulfillment_status, line items, note, cart_token. Delivery
// order and retries are NOT guaranteed, so instead of one handler per event
// mutating state imperatively, every webhook funnels into reconcileOrder():
// resolve uploads from the payload, derive the target state from payload
// FACTS, and apply idempotently. Whichever webhook arrives first or last —
// or twice — the system converges to the same state.
//
// Status lattice (merchant-driven statuses are never downgraded by webhooks):
//   draft/ready -> needs_review -> approved -> printed -> shipped
//   blocked   : sticky at link time; payment unblocks (historical behavior)
//   archived  : cancellation, unless already archived/shipped
//
// Per-behavior provenance (preserved exactly from the legacy handlers):
//   - link-time needs_review, blocked sticky ... old orders-create
//   - paid -> approved (even from blocked)   ... old orders-paid
//   - cancelled -> archived unless shipped   ... old orders-cancelled
//   - fulfilled: only printed -> shipped     ... old orders-fulfilled

import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import prisma from '~/lib/prisma.server'
import { COMMISSION_PERCENT, calculateCommissionAmount, isZeroPaymentOrder } from '~/lib/billing.server'
import { recordOrderForVisitor } from '~/lib/visitor.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  extractVipUploadIdsFromOrderNote,
  isForeignAppLine,
  matchUploadFromLineItem,
  normalizeCartToken,
} from '~/lib/orderMatching.server'
import { buildIdentityUrl } from '~/lib/uploadUrls.server'
import {
  COMMISSION_AWAITING_PAYMENT_STATUS,
  extractShopifyCommissionFacts,
  planCommissionReconciliation,
} from '~/lib/commissionEligibility.server'

/** Constant-time webhook HMAC check shared by every order webhook adapter.
 *  (Two of the legacy handlers compared strings with `!==`; unified here on
 *  timingSafeEqual with a length guard so malformed headers cannot throw.) */
export function verifyShopifyWebhookHmac(
  body: string,
  hmacHeader: string | null,
  secret: string
): boolean {
  if (!hmacHeader || !secret) return false
  const digest = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
  const a = Buffer.from(digest)
  const b = Buffer.from(hmacHeader)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export interface OrderFacts {
  paid: boolean
  cancelled: boolean
  fulfilled: boolean
}

/** Pure: read the facts that drive status from an order payload. */
export function extractOrderFacts(order: {
  financial_status?: string | null
  cancelled_at?: string | null
  fulfillment_status?: string | null
}): OrderFacts {
  return {
    paid: order.financial_status === 'paid' || order.financial_status === 'partially_paid',
    cancelled: Boolean(order.cancelled_at),
    fulfilled: order.fulfillment_status === 'fulfilled',
  }
}

export function calculateServedOrderAmount(
  order: {
    line_items?: Array<{
      id: string | number
      price?: string | number | null
      quantity?: string | number | null
      discount_allocations?: Array<{ amount?: string | number | null }> | null
    }> | null
    subtotal_price?: string | number | null
    total_line_items_price?: string | number | null
    total_price?: string | number | null
  },
  servedLineItemIds: Iterable<string>
): number | null {
  const served = new Set(Array.from(servedLineItemIds, (value) => String(value)))
  if (served.size === 0) return null

  const lineItems = Array.isArray(order.line_items) ? order.line_items : []
  const availableLineItemIds = new Set(lineItems.map((line) => String(line.id)))
  if ([...served].some((lineItemId) => !availableLineItemIds.has(lineItemId))) return null

  let servedAmount = 0
  for (const line of lineItems) {
    if (!served.has(String(line.id))) continue
    const gross = (parseFloat(String(line.price ?? '0')) || 0) * (Number(line.quantity) || 0)
    const discounts = Array.isArray(line.discount_allocations)
      ? line.discount_allocations.reduce(
          (sum, discount) => sum + (parseFloat(String(discount?.amount ?? '0')) || 0),
          0
        )
      : 0
    servedAmount += Math.max(0, gross - discounts)
  }
  return servedAmount
}

/**
 * A linked upload is billable only when at least one persisted file exists.
 * Zero-item uploads are just as unserved as the explicit empty-storage-key
 * ghost rows created for bypassed storefront uploads.
 */
export function isGhostUploadItems(
  items: Array<{ storageKey?: string | null }>
): boolean {
  return (
    items.length === 0 ||
    items.every((item) => !String(item.storageKey || '').trim())
  )
}

async function recordCommissionFactOnce(input: {
  shopId: string
  orderId: string
  action: string
  topic: string
  metadata: Prisma.InputJsonObject
  factFingerprint: string
}) {
  const digest = crypto
    .createHash('sha256')
    .update(
      [input.shopId, input.orderId, input.action, input.topic, input.factFingerprint].join('|')
    )
    .digest('hex')
    .slice(0, 32)

  try {
    await prisma.auditLog.upsert({
      where: { id: `commission_fact_${digest}` },
      create: {
        id: `commission_fact_${digest}`,
        shopId: input.shopId,
        action: input.action,
        resourceType: 'commission',
        resourceId: input.orderId,
        metadata: input.metadata,
      },
      update: {},
    })
  } catch (error) {
    // Shopify delivers orders/paid and orders/updated for the same order at the
    // same moment, and upsert is read-then-insert. Losing that race means the
    // identical fact was already recorded, which is exactly what "once" asks
    // for; failing the webhook here only made Shopify retry a finished job.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
    throw error
  }
}

type RefundSnapshotReviewStore = {
  commission: {
    findUnique(args: any): Promise<{
      id: string
      status: string
      paymentRef: string | null
      reviewRequiredAt: Date | null
    } | null>
    updateMany(args: any): Promise<{ count: number }>
  }
  auditLog: {
    upsert(args: any): Promise<unknown>
  }
}

type DeferredRefundReviewStore = {
  auditLog: {
    findFirst(args: any): Promise<{ metadata: unknown } | null>
  }
}

export async function findUnresolvedRefundSnapshotReviewReason(
  input: { shopId: string; orderId: string },
  store: DeferredRefundReviewStore = prisma as unknown as DeferredRefundReviewStore
): Promise<string | null> {
  const deferred = await store.auditLog.findFirst({
    where: {
      shopId: input.shopId,
      action: 'commission_refund_snapshot_review_deferred',
      resourceType: 'commission',
      resourceId: input.orderId,
    },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true },
  })
  if (!deferred) return null

  const metadata =
    deferred.metadata && typeof deferred.metadata === 'object' && !Array.isArray(deferred.metadata)
      ? (deferred.metadata as Record<string, unknown>)
      : null
  const recordedReason = typeof metadata?.reason === 'string' ? metadata.reason.trim() : ''
  return recordedReason || 'shopify_refund_snapshot_unavailable'
}

/**
 * A verified refunds/create payload proves that a refund event exists, but it
 * does not prove whether the order is partially or fully refunded. If the
 * authoritative order snapshot cannot be read, quarantine the existing fee
 * without changing its amount, provider claim, or guessed refund state.
 */
export async function quarantineCommissionForVerifiedRefundSnapshotFailure(
  input: {
    shopId: string
    orderId: string
    refundId?: string | null
    snapshotError: string
  },
  store: RefundSnapshotReviewStore = prisma as unknown as RefundSnapshotReviewStore
): Promise<{ commissionFound: boolean; reviewFlagAdded: boolean }> {
  const existing = await store.commission.findUnique({
    where: {
      commission_shop_order: { shopId: input.shopId, orderId: input.orderId },
    },
    select: {
      id: true,
      status: true,
      paymentRef: true,
      reviewRequiredAt: true,
    },
  })
  const now = new Date()
  const reviewReason = 'shopify_refund_snapshot_unavailable'
  const auditDigest = crypto
    .createHash('sha256')
    .update(
      [input.shopId, input.orderId, input.refundId || 'unknown-refund', reviewReason].join('|')
    )
    .digest('hex')
    .slice(0, 32)
  await store.auditLog.upsert({
    where: { id: `commission_refund_snapshot_${auditDigest}` },
    create: {
      id: `commission_refund_snapshot_${auditDigest}`,
      shopId: input.shopId,
      action: existing
        ? 'commission_review_required'
        : 'commission_refund_snapshot_review_deferred',
      resourceType: 'commission',
      resourceId: input.orderId,
      metadata: {
        orderId: input.orderId,
        topic: 'refunds/create',
        refundId: input.refundId || null,
        reason: reviewReason,
        refundExtent: 'unknown',
        snapshotError: input.snapshotError.slice(0, 500),
        preservedStatus: existing?.status || null,
        preservedPaymentRef: existing?.paymentRef || null,
        commissionFound: Boolean(existing),
      },
    },
    update: {},
  })

  // Write the durable refund fact first, then quarantine by business key. If
  // order reconciliation creates the fee concurrently, it either observes the
  // audit or is caught by this update without changing a provider claim.
  const updated = await store.commission.updateMany({
    where: {
      shopId: input.shopId,
      orderId: input.orderId,
      reviewRequiredAt: null,
    },
    data: {
      reviewRequiredAt: now,
      reviewReason,
    },
  })

  return {
    commissionFound: Boolean(existing) || updated.count > 0,
    reviewFlagAdded: updated.count > 0,
  }
}

async function reconcileCommission(input: {
  shopId: string
  orderId: string
  orderName: string | null
  order: any
  orderCurrency: string
  servedAmount: number
  topic: string
  forcedReviewReason?: string | null
}) {
  const facts = extractShopifyCommissionFacts(input.order)
  const requestedReviewReason = String(input.forcedReviewReason || '').trim() || null
  let forcedReviewReason =
    requestedReviewReason ||
    (await findUnresolvedRefundSnapshotReviewReason({
      shopId: input.shopId,
      orderId: input.orderId,
    }))
  const zeroPayment = !forcedReviewReason && (isZeroPaymentOrder(input.order) || input.servedAmount <= 0)
  const calculatedAmount =
    zeroPayment || requestedReviewReason ? 0 : calculateCommissionAmount(input.servedAmount)
  const now = new Date()
  const observedAt = facts.observedAt || now
  const commissionKey = {
    commission_shop_order: { shopId: input.shopId, orderId: input.orderId },
  }

  const existingBeforeUpsert = await prisma.commission.findUnique({
    where: commissionKey,
    select: {
      status: true,
      paymentRef: true,
      collectibleAt: true,
      reviewRequiredAt: true,
      shopifyRefundStatus: true,
      shopifyCancelledAt: true,
    },
  })
  const createPlan = forcedReviewReason
    ? {
        action: 'review' as const,
        status: COMMISSION_AWAITING_PAYMENT_STATUS,
        reason: forcedReviewReason,
      }
    : planCommissionReconciliation({
        current: { status: null, paymentRef: null },
        facts,
        servedAmount: input.servedAmount,
        zeroPayment,
      })
  const initialReview = createPlan.action === 'review' ? createPlan.reason : null
  const stageBeforeCollectible = createPlan.action === 'make_collectible'

  await prisma.commission.upsert({
    where: commissionKey,
    create: {
      shopId: input.shopId,
      orderId: input.orderId,
      orderNumber: input.orderName || input.order.order_number?.toString(),
      orderTotal: new Decimal(input.order.total_price || '0'),
      orderCurrency: input.orderCurrency,
      commissionRate: new Decimal(COMMISSION_PERCENT),
      commissionAmount: new Decimal(createPlan.action === 'void' ? 0 : calculatedAmount),
      status: stageBeforeCollectible ? COMMISSION_AWAITING_PAYMENT_STATUS : createPlan.status,
      collectibleAt: null,
      eligibilitySource: null,
      attributableCapturedAmount: null,
      shopifyFinancialStatus: facts.financialStatus || null,
      shopifyRefundStatus: facts.refundState === 'none' ? null : facts.refundState,
      shopifyCancelledAt: facts.cancelledAt,
      shopifyObservedAt: observedAt,
      reviewRequiredAt: initialReview ? now : null,
      reviewReason: initialReview,
    },
    update: {},
  })

  // Re-read the durable refund guard after the insert. Together with the
  // audit-first quarantine update, this closes the missing-row race: a fee is
  // staged as non-collectible until both checks have passed.
  if (!forcedReviewReason) {
    forcedReviewReason = await findUnresolvedRefundSnapshotReviewReason({
      shopId: input.shopId,
      orderId: input.orderId,
    })
  }

  const factFingerprint = JSON.stringify({
    financialStatus: facts.financialStatus,
    cancelledAt: facts.cancelledAt?.toISOString() || null,
    refundState: facts.refundState,
    observedAt: facts.observedAt?.toISOString() || null,
    currentTotalPrice: input.order.current_total_price ?? null,
    totalPrice: input.order.total_price ?? null,
    refunds: Array.isArray(input.order.refunds)
      ? input.order.refunds.map((refund: any) => ({
          id: refund?.id ?? null,
          transactions: Array.isArray(refund?.transactions)
            ? refund.transactions.map((transaction: any) => ({
                id: transaction?.id ?? null,
                kind: transaction?.kind ?? null,
                status: transaction?.status ?? null,
                amount: transaction?.amount ?? null,
              }))
            : [],
        }))
      : [],
    forcedReviewReason,
  })

  const current = await prisma.commission.findUnique({
    where: commissionKey,
    select: {
      id: true,
      status: true,
      paymentRef: true,
      collectibleAt: true,
      reviewRequiredAt: true,
      shopifyRefundStatus: true,
      shopifyCancelledAt: true,
    },
  })
  if (!current) throw new Error(`Commission row disappeared for order ${input.orderId}`)

  const plan = forcedReviewReason
    ? {
        action: 'review' as const,
        status: current.status || COMMISSION_AWAITING_PAYMENT_STATUS,
        reason: forcedReviewReason,
      }
    : existingBeforeUpsert
      ? planCommissionReconciliation({
          current,
          facts,
          servedAmount: input.servedAmount,
          zeroPayment,
        })
      : createPlan

  const observedData = {
    shopifyFinancialStatus: facts.financialStatus || null,
    shopifyObservedAt: observedAt,
    ...(facts.refundState === 'none' ? {} : { shopifyRefundStatus: facts.refundState }),
    ...(facts.cancelledAt ? { shopifyCancelledAt: facts.cancelledAt } : {}),
  }

  const quarantineForReview = async (
    row: { id: string; status: string; paymentRef: string | null },
    reason: string
  ) => {
    // Never alter the provider-owned status/reference. The review flag also
    // excludes a legacy/pending row from every collector.
    await prisma.commission.updateMany({
      where: { id: row.id, reviewRequiredAt: null },
      data: {
        reviewRequiredAt: now,
        reviewReason: reason,
        ...observedData,
      },
    })
    await recordCommissionFactOnce({
      shopId: input.shopId,
      orderId: input.orderId,
      action: 'commission_review_required',
      topic: input.topic,
      factFingerprint,
      metadata: {
        orderId: input.orderId,
        topic: input.topic,
        reason,
        preservedStatus: row.status,
        preservedPaymentRef: row.paymentRef,
        financialStatus: facts.financialStatus,
        refundState: facts.refundState,
        cancelledAt: facts.cancelledAt?.toISOString() || null,
      },
    })
  }

  if (plan.action === 'make_collectible') {
    // Both the status and explicit evidence are required by every collector.
    // Refund/cancellation observations are sticky and block a late paid event.
    const result = await prisma.commission.updateMany({
      where: {
        id: current.id,
        status: { in: [COMMISSION_AWAITING_PAYMENT_STATUS, 'pending'] },
        paymentRef: null,
        reviewRequiredAt: null,
        shopifyRefundStatus: null,
        shopifyCancelledAt: null,
      },
      data: {
        orderTotal: new Decimal(input.order.total_price || '0'),
        orderCurrency: input.orderCurrency,
        commissionRate: new Decimal(COMMISSION_PERCENT),
        commissionAmount: new Decimal(calculatedAmount),
        status: 'pending',
        collectibleAt: current.collectibleAt || observedAt,
        eligibilitySource: input.topic,
        attributableCapturedAmount: new Decimal(input.servedAmount),
        ...observedData,
      },
    })
    if (result.count > 0) {
      await recordCommissionFactOnce({
        shopId: input.shopId,
        orderId: input.orderId,
        action: 'commission_became_collectible',
        topic: input.topic,
        factFingerprint,
        metadata: {
          orderId: input.orderId,
          topic: input.topic,
          financialStatus: facts.financialStatus,
          attributableCapturedAmount: input.servedAmount,
          commissionAmount: calculatedAmount,
          eligibilitySource: input.topic,
        },
      })
    }
  } else if (plan.action === 'void') {
    // A provider claim owns charging/reserved rows. The predicate deliberately
    // cannot release one; such a row is handled by the review branch instead.
    const result = await prisma.commission.updateMany({
      where: {
        id: current.id,
        status: { in: [COMMISSION_AWAITING_PAYMENT_STATUS, 'pending'] },
        paymentRef: null,
      },
      data: {
        status: 'void',
        commissionAmount: new Decimal(0),
        collectibleAt: null,
        eligibilitySource: null,
        attributableCapturedAmount: null,
        reviewRequiredAt: null,
        reviewReason: null,
        ...observedData,
      },
    })
    const createdAsVoid = !existingBeforeUpsert && createPlan.action === 'void'
    if (result.count > 0 || createdAsVoid) {
      await recordCommissionFactOnce({
        shopId: input.shopId,
        orderId: input.orderId,
        action: 'commission_voided',
        topic: input.topic,
        factFingerprint,
        metadata: {
          orderId: input.orderId,
          topic: input.topic,
          reason: plan.reason,
          financialStatus: facts.financialStatus,
          refundState: facts.refundState,
          cancelledAt: facts.cancelledAt?.toISOString() || null,
          calculatedFeeBeforeVoid: calculatedAmount,
        },
      })
    } else {
      // Auto-charge/hosted checkout can claim the row after our read but
      // before the conditional void. Re-read the winner and quarantine it;
      // never report a void that did not commit and never clear its reference.
      const latest = await prisma.commission.findUnique({
        where: commissionKey,
        select: {
          id: true,
          status: true,
          paymentRef: true,
          collectibleAt: true,
          reviewRequiredAt: true,
          shopifyRefundStatus: true,
          shopifyCancelledAt: true,
        },
      })
      if (latest) {
        const racePlan = planCommissionReconciliation({
          current: latest,
          facts,
          servedAmount: input.servedAmount,
          zeroPayment,
        })
        if (racePlan.action === 'review') {
          await quarantineForReview(latest, racePlan.reason)
        }
      }
    }
  } else if (plan.action === 'review') {
    await quarantineForReview(current, plan.reason)
  } else if (plan.action === 'await_payment') {
    await recordCommissionFactOnce({
      shopId: input.shopId,
      orderId: input.orderId,
      action: 'commission_awaiting_shopify_capture',
      topic: input.topic,
      factFingerprint,
      metadata: {
        orderId: input.orderId,
        topic: input.topic,
        financialStatus: facts.financialStatus || 'unknown',
        calculatedFeeIfCaptured: calculatedAmount,
      },
    })
  }

  console.log(
    `[Reconcile] Commission order=${input.orderId} action=${plan.action} status=${plan.status} financial=${facts.financialStatus || 'unknown'} amount=$${calculatedAmount.toFixed(2)}`
  )
}

/** Pure: next upload status for these order facts, or null for "no change".
 *  Encodes the lattice above; webhook retries and out-of-order delivery can
 *  therefore never move a status backwards. */
export function deriveUploadStatusTransition(
  current: string,
  facts: OrderFacts,
  options: { isGhost?: boolean } = {}
): string | null {
  if (facts.cancelled) {
    return current === 'archived' || current === 'shipped' ? null : 'archived'
  }
  // Missing-file placeholders must never enter the approved production queue.
  // Cancellation may still archive them so the queue reflects the order.
  if (options.isGhost) return null
  if (facts.fulfilled && current === 'printed') {
    return 'shipped'
  }
  if (facts.paid) {
    if (
      current === 'approved' ||
      current === 'printed' ||
      current === 'shipped' ||
      current === 'archived'
    ) {
      return null
    }
    return 'approved' // includes blocked -> approved (historical paid behavior)
  }
  // Link-time (order exists but is not yet paid/cancelled/fulfilled).
  if (
    current === 'blocked' ||
    current === 'needs_review' ||
    current === 'approved' ||
    current === 'printed' ||
    current === 'shipped' ||
    current === 'archived'
  ) {
    return null
  }
  return 'needs_review'
}

interface DesignManifestRow {
  lineItemId: string
  uploadId: string
  location: string
  originalFile: string
  previewUrl: string
  transform: unknown
  preflightStatus: string
}

export interface ReconcileSummary {
  linked: Array<{ uploadId: string; matchSource: string }>
  /** Order line ids this app served (basis of the 4% commission). */
  servedLineItemIds: string[]
  ghostsCreated: string[]
  foreignLinesSkipped: number
  affectedUploadIds: string[]
}

const ORDER_DESIGNS_METAFIELD_MUTATION = `
  mutation orderMetafieldSet($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id }
      userErrors { field message }
    }
  }
`

const ORDER_UPLOADS_METAFIELD_MUTATION = `
  mutation setOrderUploads($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`

export async function reconcileOrder(
  shop: { id: string; shopDomain: string; accessToken: string },
  order: any,
  topic: string
): Promise<ReconcileSummary> {
  const orderId = String(order.id)
  const facts = extractOrderFacts(order)
  const orderTotal = parseFloat(order.total_price) || 0
  const orderCurrency = order.currency || 'USD'
  const orderName = order.name ? String(order.name) : null
  // orders/updated can itself be caused by an order metafield write. Never
  // write the mirrors again from that catch-all topic (or its refund refresh),
  // otherwise Shopify can feed our own update back into the webhook loop.
  const mayWriteOrderMetafields = topic !== 'orders/updated' && topic !== 'refunds/create'

  const summary: ReconcileSummary = {
    linked: [],
    servedLineItemIds: [],
    ghostsCreated: [],
    foreignLinesSkipped: 0,
    affectedUploadIds: [],
  }
  const processed = new Set<string>()
  const designManifest: DesignManifestRow[] = []
  let paidNewlyRecorded = false

  // ── Resolution sources ───────────────────────────────────────────────────
  const productConfigs = await prisma.productConfig.findMany({
    where: { shopId: shop.id, uploadEnabled: true },
    select: { productId: true, mode: true },
  })
  const configuredProductIds = new Map(
    productConfigs.map((p) => [p.productId.split('/').pop() || '', p.mode])
  )

  const cartToken = normalizeCartToken(order.cart_token)
  const tokenUploads = cartToken
    ? await prisma.upload.findMany({
        where: { shopId: shop.id, cartToken },
        select: { id: true, productId: true, variantId: true },
      })
    : []
  const unconsumedTokenUploads = new Set(tokenUploads.map((u) => u.id))

  const existingLinks = await prisma.orderLink.findMany({
    where: { shopId: shop.id, orderId },
    select: { uploadId: true, lineItemId: true },
  })
  const linkedLineItemIds = new Set(
    existingLinks.map((l) => l.lineItemId).filter(Boolean) as string[]
  )

  // ── Apply one upload (idempotent) ────────────────────────────────────────
  const applyUpload = async (
    uploadId: string,
    lineItemId: string | null,
    matchSource: string
  ): Promise<boolean> => {
    if (processed.has(uploadId)) return true

    const upload = await prisma.upload.findFirst({
      where: { id: uploadId, shopId: shop.id },
      include: {
        items: {
          select: {
            location: true,
            originalName: true,
            previewKey: true,
            thumbnailKey: true,
            transform: true,
            preflightStatus: true,
            storageKey: true,
          },
        },
      },
    })
    if (!upload) {
      console.warn(
        `[Reconcile] Upload ${uploadId} not found for shop ${shop.shopDomain} (source=${matchSource})`
      )
      return false
    }

    // A ghost record (created below for a line that reached the order without
    // any file) has no stored file. It keeps its order link so the merchant
    // sees the gap, but it is never a served line: no commission, no design
    // manifest. Without this guard the paid webhook re-applied the ghost via
    // Pass 2 and billed 4% on an order this app never handled.
    const isGhost = isGhostUploadItems(upload.items)

    await prisma.orderLink.upsert({
      where: { orderId_uploadId: { orderId, uploadId } },
      update: lineItemId ? { lineItemId } : {},
      create: { shopId: shop.id, orderId, uploadId, lineItemId },
    })

    const nextStatus = deriveUploadStatusTransition(upload.status, facts, { isGhost })
    const firstPaidTransition = facts.paid && !upload.orderPaidAt

    await prisma.upload.updateMany({
      where: { id: uploadId, shopId: shop.id },
      data: {
        orderId,
        orderName,
        customerEmail: order.email || upload.customerEmail,
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(facts.paid
          ? {
              orderTotal: orderTotal,
              orderCurrency: orderCurrency,
              ...(firstPaidTransition ? { orderPaidAt: new Date() } : {}),
            }
          : {}),
      },
    })

    if (firstPaidTransition && upload.visitorId) {
      try {
        await recordOrderForVisitor(shop.id, upload.visitorId, orderTotal)
        console.log(`[Reconcile] Revenue recorded for visitor ${upload.visitorId}: $${orderTotal}`)
      } catch (visitorErr) {
        console.warn('[Reconcile] Visitor revenue tracking failed:', visitorErr)
      }
      paidNewlyRecorded = true
    }

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'order_linked',
        resourceType: 'upload',
        resourceId: uploadId,
        metadata: {
          orderId: order.id,
          orderName: order.name,
          lineItemId,
          customerEmail: order.email,
          matchSource,
          topic,
          statusApplied: nextStatus,
        },
      },
    })

    if (facts.paid && !isGhost) {
      for (const item of upload.items) {
        designManifest.push({
          lineItemId: lineItemId || `order-${orderId}`,
          uploadId: upload.id,
          location: item.location,
          originalFile: item.originalName || '',
          previewUrl: item.thumbnailKey || item.previewKey || '',
          transform: item.transform,
          preflightStatus: item.preflightStatus,
        })
      }
    }

    processed.add(uploadId)
    unconsumedTokenUploads.delete(uploadId)
    if (isGhost) {
      summary.affectedUploadIds.push(uploadId)
      console.log(`[Reconcile] Ghost upload ${uploadId} refreshed for order ${orderId} (source=${matchSource}); not billable`)
      return true
    }
    summary.linked.push({ uploadId, matchSource })
    if (lineItemId && !summary.servedLineItemIds.includes(lineItemId)) summary.servedLineItemIds.push(lineItemId)
    summary.affectedUploadIds.push(uploadId)
    console.log(
      `[Reconcile] Upload ${uploadId} <- order ${orderId} (source=${matchSource}, topic=${topic}, status=${nextStatus ?? 'unchanged'})`
    )
    return true
  }

  // ── Pass 1: line items ───────────────────────────────────────────────────
  for (const lineItem of order.line_items || []) {
    const lineItemId = String(lineItem.id)
    const match = matchUploadFromLineItem(lineItem)

    if (match) {
      const applied = await applyUpload(match.uploadId, lineItemId, match.source)
      if (applied) continue
      // A syntactically valid but unknown/stale upload id is not proof that
      // this configured line was served. Continue through cart-token recovery
      // and ghost creation so production sees the missing-file condition.
    }

    if (!configuredProductIds.has(String(lineItem.product_id))) continue

    // Shared-product guard: lines that demonstrably belong to another
    // gang-sheet app are neither missing uploads nor commissionable.
    if (isForeignAppLine(lineItem)) {
      summary.foreignLinesSkipped++
      console.log(
        `[Reconcile] Line ${lineItemId} belongs to another gang-sheet app; skipping ghost/commission`
      )
      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: 'foreign_app_line_skipped',
          resourceType: 'order',
          resourceId: orderId,
          metadata: {
            orderId: order.id,
            orderName: order.name,
            lineItemId: lineItem.id,
            productId: lineItem.product_id,
          },
        },
      })
      continue
    }

    // Stripped properties: cart-token carrier before declaring missing.
    const lineProductGid = `gid://shopify/Product/${lineItem.product_id}`
    const lineVariantGid = `gid://shopify/ProductVariant/${lineItem.variant_id}`
    const tokenCandidate =
      tokenUploads.find((u) => unconsumedTokenUploads.has(u.id) && u.variantId === lineVariantGid) ||
      tokenUploads.find((u) => unconsumedTokenUploads.has(u.id) && u.productId === lineProductGid) ||
      tokenUploads.find((u) => unconsumedTokenUploads.has(u.id))

    if (tokenCandidate) {
      console.log(
        `[Reconcile] Line ${lineItemId} had no properties; recovered upload ${tokenCandidate.id} via cart_token`
      )
      await applyUpload(tokenCandidate.id, lineItemId, 'cart_token')
      continue
    }

    // Ghost upload — idempotent: a webhook retry (or a later topic) finds the
    // OrderLink written for this exact line and skips re-creating. Cancelled
    // orders never spawn ghosts — there is no file left to chase.
    if (linkedLineItemIds.has(lineItemId) || facts.cancelled) continue

    console.warn(
      `[Reconcile] Missing upload for configured product ${lineItem.product_id} in order ${orderId}`
    )
    const mode = configuredProductIds.get(String(lineItem.product_id)) || 'dtf'
    const ghostUpload = await prisma.upload.create({
      data: {
        shopId: shop.id,
        productId: lineProductGid,
        variantId: lineVariantGid,
        customerId: order.customer?.id ? String(order.customer.id) : null,
        customerEmail: order.email,
        orderId,
        orderName,
        status: 'blocked', // Blocked so merchant sees it immediately
        mode,
        preflightSummary: {
          overall: 'error',
          errorType: 'missing_upload',
          message: 'Upload data missing. Customer likely used "Buy Now" button or bypassed upload.',
          lineItems: [lineItem.name],
        },
      },
    })
    await prisma.orderLink.create({
      data: { shopId: shop.id, orderId, uploadId: ghostUpload.id, lineItemId },
    })
    await prisma.uploadItem.create({
      data: {
        uploadId: ghostUpload.id,
        location: 'unknown',
        storageKey: '',
        originalName: 'Missing File',
        preflightStatus: 'error',
        preflightResult: {
          overall: 'error',
          checks: [
            {
              name: 'upload_check',
              status: 'error',
              message: 'File not found. Please contact customer for the file.',
            },
          ],
        },
      },
    })
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'ghost_upload_created',
        resourceType: 'upload',
        resourceId: ghostUpload.id,
        metadata: { orderId: order.id, reason: 'missing_properties', productId: lineItem.product_id },
      },
    })
    processed.add(ghostUpload.id)
    linkedLineItemIds.add(lineItemId)
    summary.ghostsCreated.push(ghostUpload.id)
    summary.affectedUploadIds.push(ghostUpload.id)
  }

  if (unconsumedTokenUploads.size > 0) {
    // Deliberately NOT linked order-level: a token-bound upload the customer
    // removed from the cart before ordering would be a false positive.
    console.log(
      `[Reconcile] ${unconsumedTokenUploads.size} cart_token upload(s) not consumed by order ${orderId} (likely removed from cart)`
    )
  }

  // ── Pass 2: OrderLink rows from earlier webhooks (status refresh) ────────
  for (const link of existingLinks) {
    await applyUpload(link.uploadId, link.lineItemId, 'order_link')
  }

  // ── Pass 3: VIP/measured-checkout note ids ───────────────────────────────
  for (const vipUploadId of extractVipUploadIdsFromOrderNote(order.note)) {
    // The order note proves an upload id, but not which paid Shopify line it
    // served. Keep the production link and fail billing closed below instead
    // of attributing the first line (or the whole subtotal) by assumption.
    await applyUpload(vipUploadId, null, 'order_note')
  }

  // ── Commission ───────────────────────────────────────────────────────────
  // Charged ONLY when a real upload flowed through this app (summary.linked).
  // Ghost records — customer bypassed the upload, or historical foreign-app
  // lines — are operational warnings, never billable events: billing an
  // order this app did not serve is wrong revenue.
  if (summary.linked.length > 0) {
    // Basis: exact app line ids, net of their discount allocations. An order
    // note proves a production link but not a monetary line attribution, so a
    // missing/mismatched id creates a non-collectible review row with no
    // guessed fee amount.
    const servedAmount = calculateServedOrderAmount(order, summary.servedLineItemIds)
    // The row is an audit record at order creation, not a debt. Only a Shopify
    // `paid` fact can attach collectible evidence. Cancellation/refunds are
    // monotone and provider-owned claims are quarantined, never released here.
    await reconcileCommission({
      shopId: shop.id,
      orderId,
      orderName,
      order,
      orderCurrency,
      servedAmount: servedAmount ?? 0,
      topic,
      forcedReviewReason:
        servedAmount === null ? 'missing_exact_served_line_attribution' : null,
    })
  }

  // ── Metafield mirrors (best-effort, never fail the webhook) ──────────────
  if (mayWriteOrderMetafields && summary.linked.length > 0 && shop.accessToken) {
    try {
      await shopifyGraphQL(shop.shopDomain, shop.accessToken, ORDER_UPLOADS_METAFIELD_MUTATION, {
        metafields: [
          {
            ownerId: `gid://shopify/Order/${orderId}`,
            namespace: 'upload_studio',
            key: 'uploads',
            type: 'json',
            value: JSON.stringify(
              summary.linked.map((u) => ({
                uploadId: u.uploadId,
                identityUrl: buildIdentityUrl(u.uploadId),
                matchSource: u.matchSource,
              }))
            ),
          },
        ],
      })
    } catch (error) {
      console.warn('[Reconcile] upload_studio.uploads metafield write failed (non-fatal):', error)
    }
  }

  if (mayWriteOrderMetafields && facts.paid && designManifest.length > 0 && shop.accessToken) {
    try {
      await shopifyGraphQL(shop.shopDomain, shop.accessToken, ORDER_DESIGNS_METAFIELD_MUTATION, {
        input: {
          id: `gid://shopify/Order/${orderId}`,
          metafields: [
            {
              namespace: 'upload_lift',
              key: 'designs',
              value: JSON.stringify({
                version: '1.0',
                totalDesigns: designManifest.length,
                designs: designManifest,
                processedAt: new Date().toISOString(),
              }),
              type: 'json',
            },
          ],
        },
      })
      console.log(`[Reconcile] upload_lift.designs metafield written for order ${orderId}`)
    } catch (error) {
      console.error('[Reconcile] Failed to write designs metafield:', error)
    }
  }

  console.log(
    `[Reconcile] order ${orderId} topic=${topic}: linked=${summary.linked.length} ghosts=${summary.ghostsCreated.length} foreignSkipped=${summary.foreignLinesSkipped} paidNew=${paidNewlyRecorded}`
  )
  return summary
}
