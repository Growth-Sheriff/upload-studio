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
import { Decimal } from '@prisma/client/runtime/library'
import prisma from '~/lib/prisma.server'
import { COMMISSION_PERCENT, calculateCommissionAmount } from '~/lib/billing.server'
import { recordOrderForVisitor } from '~/lib/visitor.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  extractVipUploadIdsFromOrderNote,
  isForeignAppLine,
  matchUploadFromLineItem,
  normalizeCartToken,
} from '~/lib/orderMatching.server'
import { buildIdentityUrl } from '~/lib/uploadUrls.server'

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

/** Pure: next upload status for these order facts, or null for "no change".
 *  Encodes the lattice above; webhook retries and out-of-order delivery can
 *  therefore never move a status backwards. */
export function deriveUploadStatusTransition(
  current: string,
  facts: OrderFacts
): string | null {
  if (facts.cancelled) {
    return current === 'archived' || current === 'shipped' ? null : 'archived'
  }
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
    const isGhost = upload.items.length > 0 && upload.items.every((item) => !item.storageKey)

    await prisma.orderLink.upsert({
      where: { orderId_uploadId: { orderId, uploadId } },
      update: lineItemId ? { lineItemId } : {},
      create: { shopId: shop.id, orderId, uploadId, lineItemId },
    })

    const nextStatus = deriveUploadStatusTransition(upload.status, facts)
    const firstPaidTransition = facts.paid && !upload.orderPaidAt

    await prisma.upload.updateMany({
      where: { id: uploadId, shopId: shop.id },
      data: {
        orderId,
        orderName,
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
      await applyUpload(match.uploadId, lineItemId, match.source)
      continue
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
  const fallbackLineItem = order.line_items?.[0] || null
  for (const vipUploadId of extractVipUploadIdsFromOrderNote(order.note)) {
    await applyUpload(
      vipUploadId,
      fallbackLineItem?.id ? String(fallbackLineItem.id) : null,
      'order_note'
    )
  }

  // ── Commission ───────────────────────────────────────────────────────────
  // Charged ONLY when a real upload flowed through this app (summary.linked).
  // Ghost records — customer bypassed the upload, or historical foreign-app
  // lines — are operational warnings, never billable events: billing an
  // order this app did not serve is wrong revenue.
  if (summary.linked.length > 0) {
    // Basis: the app's own line items, net of their discount allocations.
    // A note-only match (VIP/measured checkout: every line is ours) falls
    // back to the order subtotal.
    const served = new Set(summary.servedLineItemIds)
    let servedAmount = 0
    for (const line of order.line_items || []) {
      if (!served.has(String(line.id))) continue
      const gross = (parseFloat(String(line.price ?? '0')) || 0) * (Number(line.quantity) || 0)
      const discounts = Array.isArray(line.discount_allocations)
        ? line.discount_allocations.reduce((sum: number, d: any) => sum + (parseFloat(String(d?.amount ?? '0')) || 0), 0)
        : 0
      servedAmount += Math.max(0, gross - discounts)
    }
    if (servedAmount <= 0) {
      servedAmount = parseFloat(String(order.subtotal_price ?? order.total_line_items_price ?? order.total_price ?? '0')) || 0
    }
    const commissionAmount = calculateCommissionAmount(servedAmount)

    await prisma.commission.upsert({
      where: { commission_shop_order: { shopId: shop.id, orderId } },
      create: {
        shopId: shop.id,
        orderId,
        orderNumber: order.name || order.order_number?.toString(),
        orderTotal: new Decimal(order.total_price || '0'),
        orderCurrency,
        commissionRate: new Decimal(COMMISSION_PERCENT),
        commissionAmount: new Decimal(commissionAmount),
        status: 'pending',
      },
      update: {
        orderTotal: new Decimal(order.total_price || '0'),
        orderCurrency,
        commissionRate: new Decimal(COMMISSION_PERCENT),
        commissionAmount: new Decimal(commissionAmount),
      },
    })
    console.log(`[Reconcile] Commission upserted (${Math.round(COMMISSION_PERCENT * 100)}% of $${servedAmount.toFixed(2)} = $${commissionAmount.toFixed(2)}) for order ${orderId}`)
  }

  // ── Metafield mirrors (best-effort, never fail the webhook) ──────────────
  if (summary.linked.length > 0 && shop.accessToken) {
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

  if (facts.paid && designManifest.length > 0 && shop.accessToken) {
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
