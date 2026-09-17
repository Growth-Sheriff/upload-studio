import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '~/lib/prisma.server'
import {
  buildOrderFeeDescription,
  centsToMoney,
  moneyToCents,
  sumMoneyCents,
} from '~/lib/billing.server'

export const HOSTED_CHECKOUT_RESERVED_STATUS = 'checkout_reserved'
export const HOSTED_CHECKOUT_RESERVATION_VERSION = 1

export type HostedCheckoutProvider = 'stripe' | 'paypal'

export type HostedCheckoutReservationSnapshot = {
  version: typeof HOSTED_CHECKOUT_RESERVATION_VERSION
  reservationRef: string
  provider: HostedCheckoutProvider
  orderIds: string[]
  totalCents: number
  currency: 'USD'
  monthKey: string | null
}

export type HostedCheckoutReservation = HostedCheckoutReservationSnapshot & {
  totalAmount: number
  description: string
}

type ReservationRow = {
  order_id: string
  commission_amount: unknown
  order_currency: string
  created_at: Date
}

export type HostedCheckoutSettlementRow = {
  orderId: string
  commissionAmount: number
  orderCurrency: string
  status: string
  paymentRef: string | null
  paymentProvider: string | null
  reviewRequiredAt?: Date | string | null
  reviewReason?: string | null
  shopifyRefundStatus?: string | null
  shopifyCancelledAt?: Date | string | null
}

export class HostedCheckoutReservationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'no_outstanding_fees'
      | 'unsupported_currency'
      | 'invalid_reservation'
      | 'payment_mismatch'
      | 'reservation_conflict'
  ) {
    super(message)
    this.name = 'HostedCheckoutReservationError'
  }
}

function uniqueOrderIds(orderIds?: string[] | null): string[] {
  return [
    ...new Set(
      (orderIds || [])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ]
}

function sameOrderIdSet(actual: Iterable<string>, expected: Iterable<string>): boolean {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  return (
    actualSet.size === expectedSet.size &&
    [...actualSet].every((orderId) => expectedSet.has(orderId))
  )
}

function normalizeCurrency(value: string | null | undefined): string {
  return String(value || '').trim().toUpperCase()
}

function reservationMetadata(snapshot: HostedCheckoutReservationSnapshot) {
  return { hostedCheckoutReservation: snapshot }
}

export function parseHostedCheckoutReservation(
  metadata: unknown
): HostedCheckoutReservationSnapshot | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const raw = (metadata as Record<string, unknown>).hostedCheckoutReservation
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const value = raw as Record<string, unknown>
  const provider = value.provider
  const orderIds = uniqueOrderIds(
    Array.isArray(value.orderIds)
      ? value.orderIds.filter((item): item is string => typeof item === 'string')
      : []
  )
  const reservationRef =
    typeof value.reservationRef === 'string' ? value.reservationRef.trim() : ''
  const totalCents = Number(value.totalCents)
  const currency = normalizeCurrency(
    typeof value.currency === 'string' ? value.currency : ''
  )

  if (
    value.version !== HOSTED_CHECKOUT_RESERVATION_VERSION ||
    (provider !== 'stripe' && provider !== 'paypal') ||
    !reservationRef ||
    orderIds.length === 0 ||
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    currency !== 'USD'
  ) {
    return null
  }

  return {
    version: HOSTED_CHECKOUT_RESERVATION_VERSION,
    reservationRef,
    provider,
    orderIds,
    totalCents,
    currency: 'USD',
    monthKey: typeof value.monthKey === 'string' ? value.monthKey : null,
  }
}

/**
 * Atomically removes the selected pending fee rows from both auto-charge and
 * other hosted checkout attempts before any provider session is created.
 * The existing free-form status/paymentRef columns are sufficient, so this
 * safety boundary does not require a schema migration.
 */
export async function reserveFeesForHostedCheckout(input: {
  shopId: string
  provider: HostedCheckoutProvider
  requestedOrderIds?: string[] | null
  monthKey?: string | null
}): Promise<HostedCheckoutReservation> {
  const requestedOrderIds = uniqueOrderIds(input.requestedOrderIds)
  const reservationRef = `hco_${input.provider}_${randomUUID()}`

  return prisma.$transaction(async (tx) => {
    const rows = requestedOrderIds.length
      ? await tx.$queryRaw<ReservationRow[]>`
          update commissions
          set status = ${HOSTED_CHECKOUT_RESERVED_STATUS},
              payment_ref = ${reservationRef},
              payment_provider = ${input.provider},
              updated_at = now()
          where shop_id = ${input.shopId}
            and status = 'pending'
            and payment_ref is null
            and collectible_at is not null
            and review_required_at is null
            and order_id in (${Prisma.join(requestedOrderIds)})
          returning order_id, commission_amount, order_currency, created_at`
      : await tx.$queryRaw<ReservationRow[]>`
          update commissions
          set status = ${HOSTED_CHECKOUT_RESERVED_STATUS},
              payment_ref = ${reservationRef},
              payment_provider = ${input.provider},
              updated_at = now()
          where shop_id = ${input.shopId}
            and status = 'pending'
            and payment_ref is null
            and collectible_at is not null
            and review_required_at is null
          returning order_id, commission_amount, order_currency, created_at`

    rows.sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
        String(left.order_id).localeCompare(String(right.order_id))
    )

    if (rows.length === 0) {
      throw new HostedCheckoutReservationError(
        'No outstanding order fees are available to reserve.',
        'no_outstanding_fees'
      )
    }

    const currencies = new Set(rows.map((row) => normalizeCurrency(row.order_currency)))
    if (currencies.size !== 1 || !currencies.has('USD')) {
      // Throwing rolls the UPDATE back. There is no exchange-rate policy in
      // the billing model, so silently treating a non-USD amount as USD would
      // collect the wrong amount.
      throw new HostedCheckoutReservationError(
        `Hosted checkout cannot collect fee rows denominated in ${
          [...currencies].filter(Boolean).join(', ') || 'an unknown currency'
        }.`,
        'unsupported_currency'
      )
    }

    const feeAmounts = rows.map((row) => Number(row.commission_amount))
    const totalCents = sumMoneyCents(feeAmounts)
    if (totalCents <= 0) {
      throw new HostedCheckoutReservationError(
        'The selected order fees do not have a positive collectible amount.',
        'payment_mismatch'
      )
    }

    const snapshot: HostedCheckoutReservationSnapshot = {
      version: HOSTED_CHECKOUT_RESERVATION_VERSION,
      reservationRef,
      provider: input.provider,
      orderIds: rows.map((row) => String(row.order_id)),
      totalCents,
      currency: 'USD',
      monthKey: input.monthKey || null,
    }

    await tx.auditLog.create({
      data: {
        id: reservationRef,
        shopId: input.shopId,
        action: `${input.provider}_checkout_reserved`,
        resourceType: `${input.provider}_checkout`,
        resourceId: reservationRef,
        metadata: {
          ...reservationMetadata(snapshot),
          orderIds: snapshot.orderIds,
          amount: centsToMoney(totalCents).toFixed(2),
          amountCents: totalCents,
          currency: snapshot.currency,
          orderCount: snapshot.orderIds.length,
        },
      },
    })

    return {
      ...snapshot,
      totalAmount: centsToMoney(totalCents),
      description: buildOrderFeeDescription(feeAmounts, input.monthKey),
    }
  })
}

async function mergeReservationAudit(
  reservationRef: string,
  action: string,
  resourceId: string,
  metadataPatch: Record<string, unknown>
) {
  const patchJson = JSON.stringify(metadataPatch)
  const updated = await prisma.$executeRaw`
    update audit_logs
    set action = ${action},
        resource_id = ${resourceId},
        metadata_json = coalesce(metadata_json, '{}'::jsonb) || ${patchJson}::jsonb
    where id = ${reservationRef}`
  if (updated !== 1) {
    throw new HostedCheckoutReservationError(
      `Hosted checkout reservation ${reservationRef} has no audit record.`,
      'invalid_reservation'
    )
  }
}

export async function markHostedCheckoutSessionCreated(input: {
  reservationRef: string
  provider: HostedCheckoutProvider
  providerSessionId: string
  checkoutUrl?: string | null
}) {
  await mergeReservationAudit(
    input.reservationRef,
    `${input.provider}_checkout_created`,
    input.providerSessionId,
    {
      providerSessionId: input.providerSessionId,
      // Persisting the provider URL lets support return the merchant to the
      // one already-reserved session instead of creating a second one.
      checkoutUrl: input.checkoutUrl || null,
      providerSessionCreatedAt: new Date().toISOString(),
    }
  )
}

export async function markHostedCheckoutCreationUnknown(input: {
  reservationRef: string
  provider: HostedCheckoutProvider
  error: string
}) {
  await mergeReservationAudit(
    input.reservationRef,
    `${input.provider}_checkout_creation_unknown`,
    input.reservationRef,
    {
      providerOutcomeUnknown: true,
      reviewRequired: true,
      providerError: input.error,
      providerErrorAt: new Date().toISOString(),
    }
  )
}

export function validateHostedCheckoutSettlement(input: {
  snapshot: HostedCheckoutReservationSnapshot
  rows: HostedCheckoutSettlementRow[]
  provider: HostedCheckoutProvider
  captureRef: string
  providerAmountCents: number
  providerCurrency: string
}): { alreadyProcessed: boolean; totalCents: number } {
  const { snapshot, rows, provider, captureRef } = input
  if (snapshot.provider !== provider) {
    throw new HostedCheckoutReservationError(
      `Reservation provider ${snapshot.provider} does not match ${provider}.`,
      'invalid_reservation'
    )
  }
  if (!sameOrderIdSet(rows.map((row) => row.orderId), snapshot.orderIds)) {
    throw new HostedCheckoutReservationError(
      'The reserved fee row set no longer matches the checkout snapshot.',
      'reservation_conflict'
    )
  }

  const currency = normalizeCurrency(input.providerCurrency)
  if (currency !== snapshot.currency) {
    throw new HostedCheckoutReservationError(
      `Provider currency ${currency || 'unknown'} does not match ${snapshot.currency}.`,
      'payment_mismatch'
    )
  }

  const rowCurrencies = new Set(rows.map((row) => normalizeCurrency(row.orderCurrency)))
  if (rowCurrencies.size !== 1 || !rowCurrencies.has(snapshot.currency)) {
    throw new HostedCheckoutReservationError(
      'The reserved fee currency no longer matches the checkout snapshot.',
      'payment_mismatch'
    )
  }

  const totalCents = sumMoneyCents(rows.map((row) => row.commissionAmount))
  if (
    !Number.isSafeInteger(input.providerAmountCents) ||
    input.providerAmountCents !== snapshot.totalCents ||
    totalCents !== snapshot.totalCents
  ) {
    throw new HostedCheckoutReservationError(
      `Provider amount ${input.providerAmountCents} does not match reserved amount ${snapshot.totalCents}.`,
      'payment_mismatch'
    )
  }

  const alreadyProcessed = rows.every(
    (row) =>
      row.status === 'paid' &&
      row.paymentRef === captureRef &&
      row.paymentProvider === provider
  )
  if (alreadyProcessed) return { alreadyProcessed: true, totalCents }

  const allReserved = rows.every(
    (row) =>
      row.status === HOSTED_CHECKOUT_RESERVED_STATUS &&
      row.paymentRef === snapshot.reservationRef &&
      row.paymentProvider === provider
  )
  if (!allReserved) {
    throw new HostedCheckoutReservationError(
      'One or more checkout fee rows were released, claimed, or paid by another payment.',
      'reservation_conflict'
    )
  }

  return { alreadyProcessed: false, totalCents }
}

/**
 * A provider-confirmed payment must be recorded as paid, even if Shopify sent
 * a cancellation/refund while the checkout was open. These rows remain
 * explicitly quarantined for refund/credit review after settlement.
 */
export function getHostedCheckoutSettlementReviewOrderIds(
  rows: HostedCheckoutSettlementRow[]
): string[] {
  return rows
    .filter(
      (row) =>
        Boolean(row.reviewRequiredAt) ||
        Boolean(row.shopifyCancelledAt) ||
        Boolean(row.shopifyRefundStatus)
    )
    .map((row) => String(row.orderId))
}

export function validateHostedCheckoutPreCapture(input: {
  snapshot: HostedCheckoutReservationSnapshot
  rows: HostedCheckoutSettlementRow[]
  provider: HostedCheckoutProvider
}): { totalCents: number } {
  const validation = validateHostedCheckoutSettlement({
    snapshot: input.snapshot,
    rows: input.rows,
    provider: input.provider,
    captureRef: `${input.snapshot.reservationRef}:pre_capture`,
    providerAmountCents: input.snapshot.totalCents,
    providerCurrency: input.snapshot.currency,
  })
  if (validation.alreadyProcessed) {
    throw new HostedCheckoutReservationError(
      'This fee reservation has already been settled.',
      'reservation_conflict'
    )
  }

  const unsafeOrderIds = getHostedCheckoutSettlementReviewOrderIds(input.rows)
  if (unsafeOrderIds.length > 0) {
    throw new HostedCheckoutReservationError(
      `The reserved fee is under cancellation/refund review for order(s): ${unsafeOrderIds.join(', ')}.`,
      'reservation_conflict'
    )
  }
  return { totalCents: validation.totalCents }
}

/**
 * Final local gate immediately before an app-initiated provider capture. A
 * provider-confirmed payment is still settled later, but the app must not
 * initiate one after Shopify has supplied a cancellation/refund review fact.
 */
export async function assertHostedCheckoutReservationCapturable(input: {
  shopId: string
  snapshot: HostedCheckoutReservationSnapshot
  provider: HostedCheckoutProvider
}): Promise<{ totalCents: number }> {
  const databaseRows = await prisma.commission.findMany({
    where: {
      shopId: input.shopId,
      OR: [
        { orderId: { in: input.snapshot.orderIds } },
        {
          status: HOSTED_CHECKOUT_RESERVED_STATUS,
          paymentRef: input.snapshot.reservationRef,
        },
      ],
    },
    select: {
      orderId: true,
      commissionAmount: true,
      orderCurrency: true,
      status: true,
      paymentRef: true,
      paymentProvider: true,
      reviewRequiredAt: true,
      reviewReason: true,
      shopifyRefundStatus: true,
      shopifyCancelledAt: true,
    },
  })
  const rows: HostedCheckoutSettlementRow[] = databaseRows.map((row) => ({
    ...row,
    commissionAmount: Number(row.commissionAmount),
  }))
  return validateHostedCheckoutPreCapture({
    snapshot: input.snapshot,
    rows,
    provider: input.provider,
  })
}

export async function settleHostedCheckoutReservation(input: {
  shopId: string
  snapshot: HostedCheckoutReservationSnapshot
  provider: HostedCheckoutProvider
  captureRef: string
  providerSessionId: string
  providerAmountCents: number
  providerCurrency: string
  source: string
  eventId?: string | null
  extraMetadata?: Record<string, unknown>
}): Promise<{ markedCount: number; alreadyProcessed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const select = {
      orderId: true,
      commissionAmount: true,
      orderCurrency: true,
      status: true,
      paymentRef: true,
      paymentProvider: true,
      reviewRequiredAt: true,
      reviewReason: true,
      shopifyRefundStatus: true,
      shopifyCancelledAt: true,
    } as const
    const databaseRows = await tx.commission.findMany({
      where: { shopId: input.shopId, orderId: { in: input.snapshot.orderIds } },
      select,
    })
    const rows: HostedCheckoutSettlementRow[] = databaseRows.map((row) => ({
      ...row,
      commissionAmount: Number(row.commissionAmount),
    }))

    const validation = validateHostedCheckoutSettlement({
      snapshot: input.snapshot,
      rows,
      provider: input.provider,
      captureRef: input.captureRef,
      providerAmountCents: input.providerAmountCents,
      providerCurrency: input.providerCurrency,
    })
    if (validation.alreadyProcessed) {
      return { markedCount: rows.length, alreadyProcessed: true }
    }
    const allRowsForReservation = await tx.commission.findMany({
      where: {
        shopId: input.shopId,
        status: HOSTED_CHECKOUT_RESERVED_STATUS,
        paymentRef: input.snapshot.reservationRef,
      },
      select: { orderId: true },
    })
    if (!sameOrderIdSet(allRowsForReservation.map((row) => row.orderId), input.snapshot.orderIds)) {
      throw new HostedCheckoutReservationError(
        'The reservation contains an unexpected fee row set.',
        'reservation_conflict'
      )
    }

    const paidAt = new Date()
    const updated = await tx.commission.updateMany({
      where: {
        shopId: input.shopId,
        orderId: { in: input.snapshot.orderIds },
        status: HOSTED_CHECKOUT_RESERVED_STATUS,
        paymentRef: input.snapshot.reservationRef,
        paymentProvider: input.provider,
      },
      data: {
        status: 'paid',
        paidAt,
        paymentRef: input.captureRef,
        paymentProvider: input.provider,
      },
    })

    if (updated.count !== input.snapshot.orderIds.length) {
      if (updated.count === 0) {
        // A webhook and browser return can finalize the same provider payment
        // concurrently. PostgreSQL re-checks the UPDATE predicate after the
        // winner commits; at READ COMMITTED a fresh read can then identify the
        // exact same capture as an idempotent replay.
        const replayRows = await tx.commission.findMany({
          where: { shopId: input.shopId, orderId: { in: input.snapshot.orderIds } },
          select,
        })
        const replay = validateHostedCheckoutSettlement({
          snapshot: input.snapshot,
          rows: replayRows.map((row) => ({
            ...row,
            commissionAmount: Number(row.commissionAmount),
          })),
          provider: input.provider,
          captureRef: input.captureRef,
          providerAmountCents: input.providerAmountCents,
          providerCurrency: input.providerCurrency,
        })
        if (replay.alreadyProcessed) {
          return {
            markedCount: input.snapshot.orderIds.length,
            alreadyProcessed: true,
          }
        }
      }
      // updateMany is inside the transaction: throwing guarantees a partial
      // settlement cannot commit.
      throw new HostedCheckoutReservationError(
        `Expected to settle ${input.snapshot.orderIds.length} fee rows, settled ${updated.count}.`,
        'reservation_conflict'
      )
    }

    // Money has already moved, so the provider-confirmed outcome wins the
    // payment status. A Shopify terminal fact that arrived before or during
    // settlement still wins the review decision. This update never clears an
    // existing review marker or the exact provider capture.
    await tx.commission.updateMany({
      where: {
        shopId: input.shopId,
        orderId: { in: input.snapshot.orderIds },
        status: 'paid',
        paymentRef: input.captureRef,
        paymentProvider: input.provider,
        reviewRequiredAt: null,
        OR: [
          { shopifyCancelledAt: { not: null } },
          { shopifyRefundStatus: { not: null } },
        ],
      },
      data: {
        reviewRequiredAt: paidAt,
        reviewReason: 'shopify_terminal_fact_before_checkout_settlement',
      },
    })
    const settledRows = await tx.commission.findMany({
      where: {
        shopId: input.shopId,
        orderId: { in: input.snapshot.orderIds },
        status: 'paid',
        paymentRef: input.captureRef,
        paymentProvider: input.provider,
      },
      select,
    })
    const reviewOrderIds = getHostedCheckoutSettlementReviewOrderIds(
      settledRows.map((row) => ({
        ...row,
        commissionAmount: Number(row.commissionAmount),
      }))
    )

    const existingAudit = await tx.auditLog.findUnique({
      where: { id: input.snapshot.reservationRef },
      select: { metadata: true },
    })
    const existingMetadata =
      existingAudit?.metadata &&
      typeof existingAudit.metadata === 'object' &&
      !Array.isArray(existingAudit.metadata)
        ? (existingAudit.metadata as Record<string, unknown>)
        : {}

    await tx.auditLog.update({
      where: { id: input.snapshot.reservationRef },
      data: {
        action: `${input.provider}_checkout_settled`,
        resourceId: input.captureRef,
        metadata: {
          ...existingMetadata,
          ...reservationMetadata(input.snapshot),
          ...(input.extraMetadata || {}),
          source: input.source,
          eventId: input.eventId || null,
          providerSessionId: input.providerSessionId,
          captureRef: input.captureRef,
          providerAmountCents: input.providerAmountCents,
          providerCurrency: normalizeCurrency(input.providerCurrency),
          settledAt: paidAt.toISOString(),
          markedCount: updated.count,
          reviewRequired: reviewOrderIds.length > 0,
          reviewOrderIds,
        },
      },
    })

    return { markedCount: updated.count, alreadyProcessed: false }
  })
}

export function amountStringToCents(value: string): number {
  const trimmed = String(value || '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new HostedCheckoutReservationError(
      `Provider returned an invalid amount: ${trimmed || 'empty'}.`,
      'payment_mismatch'
    )
  }
  return moneyToCents(Number(trimmed))
}
