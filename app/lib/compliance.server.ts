import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Prisma, type PaidSheetVolume } from '@prisma/client'
import prisma from './prisma.server'
import { TenantIsolationError, withTenantContext } from './tenantContext.server'
import { deleteFile, deleteShopStorageObjects, getStorageConfig } from './storage.server'

export const COMPLIANCE_TOPICS = ['customers/data_request', 'customers/redact', 'shop/redact'] as const
type ComplianceTopic = typeof COMPLIANCE_TOPICS[number]

export function verifyComplianceHmac(body: string | Uint8Array, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  const supplied = Buffer.from(signature, 'base64')
  const expected = createHmac('sha256', secret).update(body).digest()
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

const MAX_PRIVACY_BODY_BYTES = 1024 * 1024
async function readComplianceBody(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) return Buffer.concat(chunks, bytes)
      bytes += part.value.byteLength
      if (bytes > MAX_PRIVACY_BODY_BYTES) { await reader.cancel(); return null }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
}

/** Acknowledgment means accepted durably, never merely launched as an
 * unawaited promise. Payloads are cleared after erasure/export expires. */
export async function receiveComplianceRequest(request: Request) {
  const body = await readComplianceBody(request)
  if (!body) return new Response('Privacy request body exceeds 1 MiB', { status: 413 })
  if (!verifyComplianceHmac(body, request.headers.get('X-Shopify-Hmac-Sha256'), process.env.SHOPIFY_API_SECRET || '')) return new Response('Invalid HMAC', { status: 401 })
  const topic = request.headers.get('X-Shopify-Topic') as ComplianceTopic
  const shopDomain = request.headers.get('X-Shopify-Shop-Domain') || ''
  if (!COMPLIANCE_TOPICS.includes(topic) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) return new Response('Invalid topic or shop', { status: 400 })
  let payload: Record<string, unknown>
  try { payload = JSON.parse(body.toString('utf8')) } catch { return new Response('Invalid JSON', { status: 400 }) }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.shop_domain !== shopDomain) return new Response('Shop mismatch', { status: 400 })
  if (topic !== 'shop/redact' && !(payload.customer && typeof payload.customer === 'object')) return new Response('Missing customer', { status: 400 })
  // Shopify also sends contact-only requests. We never stored buyer contacts,
  // so accept those, but never persist the email/phone from the webhook.
  const minimized = minimizeCompliancePayload(payload, shopDomain)
  const eventId = request.headers.get('X-Shopify-Event-Id') || request.headers.get('X-Shopify-Webhook-Id') || createHash('sha256').update(body).digest('hex')
  await prisma.complianceRequest.upsert({
    where: { compliance_shop_topic_event: { shopDomain, topic, eventId } },
    update: {}, create: { shopDomain, topic, eventId, payload: minimized, dueAt: new Date() },
  })
  return new Response(null, { status: 200 })
}

function resourceId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const raw = String(value)
  return /^[1-9]\d*$/.test(raw) ? raw : null
}

export function minimizeCompliancePayload(payload: any, shopDomain: string) {
  const ids = (values: unknown) => Array.isArray(values) ? [...new Set(values.map(resourceId).filter((id): id is string => Boolean(id)))] : []
  return { shop_domain: shopDomain, customer: { id: resourceId(payload.customer?.id) }, orders_requested: ids(payload.orders_requested), orders_to_redact: ids(payload.orders_to_redact) }
}

function customerIds(payload: any): string[] {
  const id = resourceId(payload?.customer?.id)
  return id ? [id, `gid://shopify/Customer/${id}`] : []
}

function subjectWhere(payload: any): Prisma.UploadWhereInput {
  const ids = customerIds(payload)
  const orders = [...(payload?.orders_requested || []), ...(payload?.orders_to_redact || [])].map(String)
  return { OR: [{ customerId: { in: ids } }, { orderId: { in: orders } }] }
}

type AssertLease = () => Promise<void>
const noLeaseCheck: AssertLease = async () => {}

async function eraseUploadFiles(shop: { shopDomain: string; storageProvider: string; storageConfig: unknown }, uploads: Array<{ items: Array<{ storageKey: string; thumbnailKey: string | null; previewKey: string | null }> }>, assertLease: AssertLease = noLeaseCheck) {
  const config = getStorageConfig({ storageProvider: shop.storageProvider, storageConfig: shop.storageConfig as Record<string, string> | null })
  const prefix = `${shop.shopDomain.replace(/[^a-zA-Z0-9-]/g, '_')}/`
  for (const upload of uploads) for (const item of upload.items) for (const key of new Set([item.storageKey, item.thumbnailKey, item.previewKey].filter((key): key is string => Boolean(key)))) {
    if (!key.replace(/^(r2|local|bunny):/, '').startsWith(prefix)) throw new Error('Erasure object owner mismatch')
    await assertLease()
    await deleteFile(config, key)
  }
}

class ErasureWaiting extends Error {
  constructor(readonly dueAt: Date) { super('Waiting for existing upload capabilities to expire') }
}

async function eraseExportFiles(shop: { shopDomain: string; storageProvider: string; storageConfig: unknown }, rows: Array<{ storageKey: string | null; status: string }>, assertLease: AssertLease = noLeaseCheck) {
  const config = getStorageConfig({ storageProvider: shop.storageProvider, storageConfig: shop.storageConfig as Record<string, string> | null })
  const prefix = `${shop.shopDomain.replace(/[^a-zA-Z0-9-]/g, '_')}/`
  for (const row of rows) {
    if (!row.storageKey) {
      if (row.status === 'completed') throw new Error('Completed export lacks erasure object key')
      continue
    }
    if (!row.storageKey.replace(/^(r2|local|bunny):/, '').startsWith(prefix)) throw new Error('Export object owner mismatch')
    await assertLease()
    await deleteFile(config, row.storageKey)
  }
}

function customerPricingEntries(settings: any, ids: string[]) {
  const matches = (entry: any) => ids.includes(String(entry?.customerId || entry?.shopifyCustomerId || ''))
  const result: Record<string, unknown[]> = {}
  for (const [program, keys] of Object.entries({ customerPricing: ['assignments', 'eligibleCustomers', 'customerOverrides'], alphaProDiscount: ['eligibleCustomers'] })) {
    for (const key of keys) if (Array.isArray(settings?.[program]?.[key])) result[`${program}.${key}`] = settings[program][key].filter(matches)
  }
  return result
}

async function loadSubjectVolume(shopId: string, payload: any): Promise<PaidSheetVolume[]> {
  const orders = [...(payload?.orders_requested || []), ...(payload?.orders_to_redact || [])].map(String)
  return prisma.paidSheetVolume.findMany({ where: { shopId, OR: [{ paidCustomerId: { in: customerIds(payload) } }, { orderId: { in: orders } }] } })
}

function subjectUploadWhere(shopId: string, payload: any, volumes: PaidSheetVolume[]): Prisma.UploadWhereInput {
  // Anonymous uploads can acquire the buyer association only when Shopify
  // confirms payment. The independent ledger still finds them for erasure.
  return { shopId, OR: [subjectWhere(payload), { id: { in: volumes.map(volume => volume.uploadId) } }] }
}

async function exportSubject(shopId: string, payload: any, settings: unknown, volumes: PaidSheetVolume[]) {
  const uploads = await prisma.upload.findMany({ where: subjectUploadWhere(shopId, payload, volumes), select: { id: true, customerId: true, createdAt: true, orderId: true, orderName: true, status: true, items: { select: { originalName: true, fileSize: true, mimeType: true, preflightResult: true } } } })
  const orders = [...new Set([...uploads.map(upload => upload.orderId).filter((id): id is string => Boolean(id)), ...volumes.map(volume => volume.orderId), ...(payload?.orders_requested || [])])]
  const uploadIds = uploads.map(upload => upload.id)
  const orderLinks = await prisma.orderLink.findMany({ where: { shopId, OR: [{ uploadId: { in: uploadIds } }, { orderId: { in: orders } }] }, select: { orderId: true, uploadId: true, lineItemId: true, createdAt: true } })
  const commissions = await prisma.commission.findMany({ where: { shopId, orderId: { in: orders } }, select: { id: true, orderId: true, orderTotal: true, orderCurrency: true, commissionAmount: true, billingCurrency: true, status: true, attributableCapturedAmount: true, usageRecordId: true, paymentRef: true, shopifyFinancialStatus: true, shopifyRefundStatus: true, reviewReason: true, createdAt: true, paidAt: true } })
  const credits = await prisma.billingCredit.findMany({ where: { shopId, commissionId: { in: commissions.map(fee => fee.id) } }, select: { commissionId: true, amountUsd: true, status: true, providerRef: true, requestedAt: true, settledAt: true } })
  return JSON.parse(JSON.stringify({ generatedAt: new Date().toISOString(), uploads, orderLinks, commissions, credits, paidSheetVolume: volumes.map(({ shopId: _owner, ...facts }) => facts), customerPricing: customerPricingEntries(settings, customerIds(payload)), contactData: 'Buyer email, name, phone and address are not collected. A contact-only request with no order IDs cannot identify any stored records.' }))
}

async function redactCustomerSettings(shopId: string, payload: any) {
  const ids = customerIds(payload)
  if (!ids.length) return
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(async tx => {
        // Read inside the transaction, not from the worker's old Shop snapshot.
        const shop = await tx.shop.findUniqueOrThrow({ where: { id: shopId }, select: { settings: true } })
        const settings: any = shop.settings || {}
        const before = JSON.stringify(settings)
        for (const [program, keys] of Object.entries({ customerPricing: ['assignments', 'eligibleCustomers', 'customerOverrides'], alphaProDiscount: ['eligibleCustomers'] })) {
          for (const key of keys) if (Array.isArray(settings[program]?.[key])) settings[program][key] = settings[program][key].filter((entry: any) => !ids.includes(String(entry?.customerId || entry?.shopifyCustomerId || '')))
        }
        if (before !== JSON.stringify(settings)) await tx.shop.update({ where: { id: shopId }, data: { settings } })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      return
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error
    }
  }
}

/** Reinstallation and erasure compete on the same Shop row. A stale worker
 * may not overwrite a reinstall that already cleared the original uninstall;
 * once erasure wins, its marker is immutable and every retry continues it. */
export async function claimShopErasureStart(snapshot: { id: string; uninstalledAt: Date | null; erasureStartedAt: Date | null }, originalUninstalledAt?: string | null, lease?: { id: string; token: string }): Promise<{ startedAt: Date | null; reason?: 'reinstalled' | 'superseded_uninstall' | 'no_stored_shop' }> {
  if (!snapshot.erasureStartedAt && originalUninstalledAt && snapshot.uninstalledAt?.toISOString() !== originalUninstalledAt) return { startedAt: null, reason: snapshot.uninstalledAt ? 'superseded_uninstall' : 'reinstalled' }
  return prisma.$transaction(async tx => {
    let startedAt = snapshot.erasureStartedAt
    if (!startedAt) {
      startedAt = new Date()
      const claimed = await tx.shop.updateMany({
        where: { id: snapshot.id, uninstalledAt: snapshot.uninstalledAt, erasureStartedAt: null },
        data: { billingStatus: 'erasing', accessToken: '', erasureStartedAt: startedAt },
      })
      if (!claimed.count) {
        const current = await tx.shop.findUnique({ where: { id: snapshot.id }, select: { uninstalledAt: true, erasureStartedAt: true } })
        if (!current) return { startedAt: null, reason: 'no_stored_shop' as const }
        if (!current.erasureStartedAt) return { startedAt: null, reason: current.uninstalledAt ? 'superseded_uninstall' as const : 'reinstalled' as const }
        startedAt = current.erasureStartedAt
      }
    }
    if (lease) {
      // Same lock order as installation: Shop first, then inbox. If reinstall
      // revoked an already-claimed request, this transaction rolls back its
      // marker instead of letting the old worker begin irreversible erasure.
      const owned = await tx.complianceRequest.updateMany({ where: { id: lease.id, status: 'processing', leaseToken: lease.token, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 120_000) } })
      if (!owned.count) throw new Error('Compliance lease lost before erasure start')
    }
    return { startedAt }
  })
}

async function processRequest(row: { shopDomain: string; topic: string; payload: any; createdAt: Date }, assertLease: AssertLease, lease: { id: string; token: string }) {
  const shop = await prisma.shop.findUnique({ where: { shopDomain: row.shopDomain } })
  if (!shop) return { noStoredShop: true }
  return withTenantContext(shop.id, async () => {
    await assertLease()
    if (row.topic === 'uninstall/erase' && !shop.uninstalledAt && !shop.erasureStartedAt) return { reinstalled: true }
    if (row.topic === 'shop/redact' || row.topic === 'uninstall/erase') {
      // Prevent new processing before deleting objects. Delete the database
      // only after object deletion succeeds, so errors remain retryable.
      const claim = await claimShopErasureStart(shop, row.topic === 'uninstall/erase' ? row.payload?.uninstalledAt : undefined, lease)
      if (!claim.startedAt) return { skipped: claim.reason }
      const startedAt = claim.startedAt
      await prisma.session.deleteMany({ where: { shop: shop.shopDomain } })
      // Previously issued direct PUT/multipart URLs live for one hour. A
      // completed erasure must not be followed by a late upload of an orphan.
      const notBefore = new Date(startedAt.getTime() + 61 * 60_000)
      if (notBefore.getTime() > Date.now()) throw new ErasureWaiting(notBefore)
      await assertLease()
      await deleteShopStorageObjects(getStorageConfig({ storageProvider: shop.storageProvider, storageConfig: shop.storageConfig as Record<string, string> | null }), shop.shopDomain)
      await assertLease()
      await prisma.complianceRequest.updateMany({ where: { shopDomain: shop.shopDomain, topic: { notIn: ['shop/redact', 'uninstall/erase'] } }, data: { payload: Prisma.DbNull, result: Prisma.DbNull, status: 'erased', completedAt: new Date(), leaseToken: null, leaseUntil: null } })
      await prisma.supportTicket.deleteMany({ where: { shopDomain: shop.shopDomain } })
      await prisma.shop.delete({ where: { id: shop.id } })
      return { erased: true }
    }
    const volumes = await loadSubjectVolume(shop.id, row.payload)
    const where = subjectUploadWhere(shop.id, row.payload, volumes)
    if (row.topic === 'customers/data_request') {
      // Kept in the merchant's authenticated privacy page; webhook response
      // bodies are not a delivery channel to the buyer.
      return exportSubject(shop.id, row.payload, shop.settings, volumes)
    }
    if (row.topic !== 'customers/redact') throw new Error('Unsupported compliance topic')
    await prisma.upload.updateMany({ where, data: { status: 'blocked', privacyRedactedAt: new Date() } })
    const notBefore = new Date(row.createdAt.getTime() + 61 * 60_000)
    if (notBefore.getTime() > Date.now()) throw new ErasureWaiting(notBefore)
    for (;;) {
      const uploads = await prisma.upload.findMany({ where, include: { items: true }, take: 50 })
      if (!uploads.length) break
      await eraseUploadFiles(shop, uploads, assertLease)
      const archiveWhere = { shopId: shop.id, uploadIds: { hasSome: uploads.map(upload => upload.id) } }
      const archives = await prisma.exportJob.findMany({ where: archiveWhere, select: { storageKey: true, status: true } })
      await eraseExportFiles(shop, archives, assertLease)
      await assertLease()
      await prisma.uploadLog.deleteMany({ where: { shopId: shop.id, uploadId: { in: uploads.map(upload => upload.id) } } })
      await prisma.exportJob.deleteMany({ where: archiveWhere })
      await prisma.upload.deleteMany({ where: { shopId: shop.id, id: { in: uploads.map(upload => upload.id) } } })
    }
    if (volumes.length) {
      // An archive can outlive an already-expired original upload. Its scalar
      // upload reference still identifies it without keeping the buyer link.
      const archiveWhere = { shopId: shop.id, uploadIds: { hasSome: volumes.map(volume => volume.uploadId) } }
      await eraseExportFiles(shop, await prisma.exportJob.findMany({ where: archiveWhere, select: { storageKey: true, status: true } }), assertLease)
      await assertLease()
      await prisma.exportJob.deleteMany({ where: archiveWhere })
    }
    // Customer rates are merchant-entered IDs; redact those assignments too.
    await assertLease()
    await redactCustomerSettings(shop.id, row.payload)
    // Clear earlier export snapshots for this subject too; erasure must not
    // leave a second copy in the compliance inbox.
    const exports = await prisma.complianceRequest.findMany({ where: { shopDomain: shop.shopDomain, topic: 'customers/data_request' }, select: { id: true, result: true, payload: true } })
    const ids = customerIds(row.payload)
    const orders = new Set([...(row.payload?.orders_to_redact || []).map(String), ...volumes.map(volume => volume.orderId)])
    const exportIds = exports.filter(entry => {
      const result: any = entry.result
      const payload: any = entry.payload
      return customerIds(payload).some(id => ids.includes(id)) || (payload?.orders_requested || []).some((order: unknown) => orders.has(String(order))) || (result?.uploads || []).some((upload: any) => ids.includes(String(upload.customerId)) || orders.has(String(upload.orderId))) || (result?.commissions || []).some((fee: any) => orders.has(String(fee.orderId))) || (result?.paidSheetVolume || []).some((volume: any) => ids.includes(String(volume.paidCustomerId)) || orders.has(String(volume.orderId))) || Object.values(result?.customerPricing || {}).some((entries: any) => Array.isArray(entries) && entries.some(entry => ids.includes(String(entry.customerId || entry.shopifyCustomerId))))
    }).map(entry => entry.id)
    if (exportIds.length) await prisma.complianceRequest.updateMany({ where: { id: { in: exportIds }, shopDomain: shop.shopDomain }, data: { result: Prisma.DbNull, payload: Prisma.DbNull, status: 'erased', completedAt: new Date(), leaseToken: null, leaseUntil: null } })
    // Retain discovery until every linked file, assignment and export has
    // been erased/fenced, including a retry after the Upload is already gone.
    // Insert-only writer + owned non-redacted Upload lock forbids relinking.
    await assertLease()
    if (volumes.length) await prisma.paidSheetVolume.updateMany({ where: { shopId: shop.id, id: { in: volumes.map(volume => volume.id) } }, data: { paidCustomerId: null } })
    await prisma.auditLog.create({ data: { shopId: shop.id, action: 'customer_data_erased', resourceType: 'compliance', metadata: { topic: row.topic } } })
    return { erased: true, retainedFinancialRecords: 'Minimal merchant accounting, usage idempotency and refund-review records have no buyer contact fields; they remain until shop erasure.' }
  })
}

export async function runComplianceBatch() {
  const now = new Date()
  const rows = await prisma.complianceRequest.findMany({ where: { dueAt: { lte: now }, OR: [{ status: 'pending' }, { status: 'processing', leaseUntil: { lt: now } }] }, orderBy: { dueAt: 'asc' }, take: 10 })
  for (const row of rows) {
    const token = randomUUID()
    const claimed = await prisma.complianceRequest.updateMany({ where: { id: row.id, OR: [{ status: 'pending' }, { status: 'processing', leaseUntil: { lt: now } }] }, data: { status: 'processing', leaseToken: token, leaseUntil: new Date(Date.now() + 120_000), attempts: { increment: 1 } } })
    if (!claimed.count) continue
    const heartbeat = setInterval(() => void prisma.complianceRequest.updateMany({ where: { id: row.id, leaseToken: token }, data: { leaseUntil: new Date(Date.now() + 120_000) } }).catch(() => {}), 30_000)
    try {
      const assertLease = async () => {
        if (!await prisma.complianceRequest.findFirst({ where: { id: row.id, status: 'processing', leaseToken: token, leaseUntil: { gt: new Date() } }, select: { id: true } })) throw new Error('Compliance lease lost')
      }
      const result = await processRequest(row, assertLease, { id: row.id, token })
      await prisma.complianceRequest.updateMany({ where: { id: row.id, leaseToken: token }, data: { status: 'completed', completedAt: new Date(), payload: Prisma.DbNull, result: result as any, lastError: null, leaseToken: null, leaseUntil: null } })
    } catch (error) {
      await prisma.complianceRequest.updateMany({ where: { id: row.id, leaseToken: token }, data: { status: 'pending', dueAt: error instanceof ErasureWaiting ? error.dueAt : new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attempts, 7))), lastError: error instanceof Error ? error.message : 'Processing failed', leaseToken: null, leaseUntil: null } })
    } finally { clearInterval(heartbeat) }
  }
  await prisma.complianceRequest.updateMany({ where: { topic: 'customers/data_request', completedAt: { lt: new Date(Date.now() - 7 * 86400000) }, result: { not: Prisma.AnyNull } }, data: { result: Prisma.DbNull } })
}

export async function runRetentionBatch() {
  let cursor: string | undefined
  for (;;) {
    const shops = await prisma.shop.findMany({ where: { uninstalledAt: null, erasureStartedAt: null, billingStatus: { not: 'erasing' }, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, shopDomain: true, storageProvider: true, storageConfig: true }, orderBy: { id: 'asc' }, take: 100 })
    if (!shops.length) break
    for (const shop of shops) {
    try { await withTenantContext(shop.id, async () => {
    const expiredWhere = { shopId: shop.id, OR: [{ orderId: null, createdAt: { lt: new Date(Date.now() - 7 * 86400000) } }, { orderId: { not: null }, createdAt: { lt: new Date(Date.now() - 90 * 86400000) } }] }
    // Retention has the same late-PUT/queued-worker race as explicit erasure.
    // Mark first; a later pass deletes only after outstanding URLs have drained.
    await prisma.upload.updateMany({ where: { ...expiredWhere, privacyRedactedAt: null }, data: { status: 'blocked', privacyRedactedAt: new Date() } })
    const uploads = await prisma.upload.findMany({ where: { ...expiredWhere, privacyRedactedAt: { lte: new Date(Date.now() - 61 * 60000) } }, include: { items: true }, take: 50 })
    await eraseUploadFiles(shop, uploads)
    if (uploads.length) {
      const archiveWhere = { shopId: shop.id, uploadIds: { hasSome: uploads.map(upload => upload.id) } }
      await eraseExportFiles(shop, await prisma.exportJob.findMany({ where: archiveWhere, select: { storageKey: true, status: true } }))
      await prisma.exportJob.deleteMany({ where: archiveWhere })
    }
    if (uploads.length) await prisma.upload.deleteMany({ where: { shopId: shop.id, id: { in: uploads.map(upload => upload.id) } } })
    const expiredArchives = await prisma.exportJob.findMany({ where: { shopId: shop.id, status: 'completed', completedAt: { lt: new Date(Date.now() - 86400000) } }, select: { id: true, storageKey: true, status: true }, take: 50 })
    await eraseExportFiles(shop, expiredArchives)
    if (expiredArchives.length) await prisma.exportJob.deleteMany({ where: { shopId: shop.id, id: { in: expiredArchives.map(archive => archive.id) } } })
    await prisma.uploadLog.deleteMany({ where: { shopId: shop.id, createdAt: { lt: new Date(Date.now() - 30 * 86400000) } } })
    // Financial keys are the durable exactly-once ledger. Expiring them while
    // installed could bill a replay twice. Shop erasure removes this ledger.
    await prisma.auditLog.deleteMany({ where: { shopId: shop.id, createdAt: { lt: new Date(Date.now() - 365 * 86400000) } } })
    }) } catch (error) {
      // Discovery is not a lease: another worker may close/delete this shop
      // before its first retention write. Erasure owns that cleanup now.
      // Never hide storage failures or unrelated tenant-isolation violations.
      if (!(error instanceof TenantIsolationError) || error.message !== 'Tenant isolation violation: shop is being erased; writes are closed') throw error
      const current = await prisma.shop.findUnique({ where: { id: shop.id }, select: { erasureStartedAt: true, billingStatus: true } })
      if (current && !current.erasureStartedAt && current.billingStatus !== 'erasing') throw error
    }
    }
    cursor = shops[shops.length - 1].id
  }
}
