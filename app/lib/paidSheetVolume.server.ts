import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import prisma from './prisma.server'
import { normalizeCustomerId } from './customerPricing.server'
import { variantIdsEqual } from './dtfSheetResolver.server'
import { matchUploadFromLineItem } from './orderMatching.server'
import { withTenantSql } from './tenantContext.server'

export const CHECKOUT_SHEET_CHANGED =
  'This upload already has a prepared checkout with different sheet dimensions or variant. Prepare a new upload before changing the sheet; quantity can still change.'

function unitInches(value: unknown): number {
  const inches = Number(value)
  return Number.isFinite(inches) && inches > 0 ? Number(inches.toFixed(4)) : 0
}

/** Freeze the server's accepted price unit, not client dimensions or copies.
 * Reusing a pending invoice after a settings/variant change must not turn an
 * old payment into a different number of inches. */
export async function acceptCheckoutSheetFacts(input: {
  shopId: string; uploadId: string; unitBillableInches: number;
  pricingMode: string; variantId: string | null;
}, store: Pick<typeof prisma, 'upload'> = prisma): Promise<void> {
  const inches = unitInches(input.unitBillableInches)
  if (!inches || !['measured_length', 'variant_length', 'standard_variant', 'linear_inches'].includes(input.pricingMode)) {
    throw new Error('The server billable sheet length is unavailable')
  }
  const variantId = input.variantId ? String(input.variantId).split('/').pop()! : null
  await store.upload.updateMany({
    where: { id: input.uploadId, shopId: input.shopId, privacyRedactedAt: null,
      checkoutQuoteAcceptedAt: null, orderId: null, ordersLink: { none: {} } },
    data: { checkoutUnitBillableInches: new Prisma.Decimal(inches),
      checkoutPricingMode: input.pricingMode, checkoutVariantId: variantId,
      checkoutQuoteAcceptedAt: new Date() },
  })
  const snapshot = await store.upload.findFirst({
    where: { id: input.uploadId, shopId: input.shopId, privacyRedactedAt: null },
    select: { checkoutUnitBillableInches: true, checkoutPricingMode: true,
      checkoutVariantId: true, checkoutQuoteAcceptedAt: true },
  })
  if (!snapshot?.checkoutQuoteAcceptedAt || unitInches(snapshot.checkoutUnitBillableInches) !== inches ||
      snapshot.checkoutPricingMode !== input.pricingMode || snapshot.checkoutVariantId !== variantId) {
    throw new Error(CHECKOUT_SHEET_CHANGED)
  }
}

export interface AcceptedSheetFacts {
  id: string; checkoutUnitBillableInches?: unknown; checkoutPricingMode?: string | null;
  checkoutVariantId?: string | null; checkoutQuoteAcceptedAt?: Date | null;
}

/** Payment dates come from successful typed sale/capture transactions, not
 * order creation, delivery time, gateway-specific receipts or local clocks. */
export function buildPaidSheetFacts(upload: AcceptedSheetFacts, order: any, lineItemId: string | null) {
  const inches = unitInches(upload.checkoutUnitBillableInches)
  const customerId = normalizeCustomerId(order.customer?.id)
  if (!inches || !upload.checkoutQuoteAcceptedAt || !customerId || !lineItemId ||
      order.financial_status !== 'paid' || order.cancelled_at ||
      (Array.isArray(order.refunds) && order.refunds.length > 0) ||
      order.volume_transactions_complete !== true || !Array.isArray(order.transactions)) return null
  const captures = order.transactions.filter((transaction: any) =>
    ['sale', 'capture'].includes(String(transaction.kind).toLowerCase()) &&
    String(transaction.status).toLowerCase() === 'success')
  if (!captures.length || captures.some((transaction: any) => !transaction.processed_at ||
      !Number.isFinite(Date.parse(transaction.processed_at)))) return null
  const paidAt = new Date(Math.max(...captures.map((transaction: any) => Date.parse(transaction.processed_at))))
  if (paidAt < upload.checkoutQuoteAcceptedAt) return null
  const lines = Array.isArray(order.line_items) ? order.line_items : []
  const line = lines.find((entry: any) => String(entry.id) === lineItemId)
  if (!line || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) return null
  const directMatches = lines.filter((entry: any) => matchUploadFromLineItem(entry)?.uploadId === upload.id)
  if (directMatches.length !== 1 || String(directMatches[0].id) !== lineItemId) return null
  if (upload.checkoutVariantId ? !variantIdsEqual(upload.checkoutVariantId, line.variant_id) : line.variant_id != null) return null
  return { paidAt, paidCustomerId: customerId, paidQuantity: line.quantity,
    paidUnitBillableInches: new Prisma.Decimal(inches),
    paidBillableInches: new Prisma.Decimal(inches).mul(line.quantity) }
}

/** One order/upload link earns volume once. A later edit or duplicate delivery
 * cannot rewrite the paid quantity/customer/unit; conflicts go to the audit. */
export async function recordPaidSheetFacts(input: {
  shopId: string; linkId: string; upload: AcceptedSheetFacts; order: any; lineItemId: string | null;
}, store?: Pick<typeof prisma, 'paidSheetVolume' | 'auditLog'> & Partial<Pick<typeof prisma, '$transaction'>>): Promise<boolean> {
  const facts = buildPaidSheetFacts(input.upload, input.order, input.lineItemId)
  if (!facts) return false
  const persist = async (client: Pick<Prisma.TransactionClient, 'paidSheetVolume' | 'auditLog'>) => {
    const written = await client.paidSheetVolume.createMany({
      skipDuplicates: true,
      data: { id: input.linkId, shopId: input.shopId, orderId: String(input.order.id),
        uploadId: input.upload.id, lineItemId: input.lineItemId!, ...facts },
    })
    if (written.count > 0) return true
    const previous = await client.paidSheetVolume.findFirst({
      where: { id: input.linkId, shopId: input.shopId },
      select: { lineItemId: true, paidAt: true, paidCustomerId: true, paidQuantity: true,
        paidUnitBillableInches: true, paidBillableInches: true },
    })
    if (previous?.paidAt && (previous.paidQuantity !== facts.paidQuantity ||
        previous.lineItemId !== input.lineItemId ||
        previous.paidCustomerId !== facts.paidCustomerId ||
        unitInches(previous.paidUnitBillableInches) !== unitInches(facts.paidUnitBillableInches))) {
      const resourceId = input.linkId
      const auditId = `paid_volume_${createHash('sha256').update(
        `${input.linkId}:${input.lineItemId}:${facts.paidCustomerId}:${facts.paidQuantity}:${facts.paidUnitBillableInches}`
      ).digest('hex').slice(0, 32)}`
      await client.auditLog.upsert({
        where: { id: auditId },
        update: {}, create: { id: auditId, shopId: input.shopId, action: 'paid_sheet_volume_snapshot_conflict',
          resourceType: 'order', resourceId,
          metadata: { orderId: String(input.order.id), lineItemId: input.lineItemId,
            previousQuantity: previous.paidQuantity, observedQuantity: facts.paidQuantity,
            message: 'Paid sheet facts remain unchanged; review the later order edit manually.' } },
      })
    }
    return false
  }
  const connection = store || prisma
  if (!connection.$transaction) return persist(connection)
  return connection.$transaction(async transaction => {
    // The same row is updated by privacy erasure before its customer linkage
    // is cleared. Holding SHARE until ledger commit orders those operations:
    // erasure either follows this fact or this writer sees an already blocked
    // upload and cannot recreate the erased customer's identity.
    const owned = await withTenantSql(shopId => transaction.$queryRaw<Array<{ id: string }>>`
      select id from uploads where id = ${input.upload.id}
        and shop_id = ${shopId} and privacy_redacted_at is null for share
    `)
    if (owned.length !== 1) return false
    return persist(transaction)
  })
}
