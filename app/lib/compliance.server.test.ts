import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const storage = vi.hoisted(() => ({ deleteFile: vi.fn(), deleteShopStorageObjects: vi.fn(), realDelete: null as any }))
vi.mock('./storage.server', async importOriginal => {
  const actual = await importOriginal<typeof import('./storage.server')>()
  storage.realDelete = actual.deleteFile
  return { ...actual, deleteFile: storage.deleteFile, deleteShopStorageObjects: storage.deleteShopStorageObjects }
})

// Never run integration mutations against a supplied production DATABASE_URL.
// This opt-in variable must point to the disposable local database created for
// public-app verification; test cleanup only removes its own UUID shop prefix.
const integrationUrl = process.env.PUBLIC_APP_TEST_DATABASE_URL
const integration = integrationUrl && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/public_app_test(?:\?|$)/.test(integrationUrl)
const describeDb = integration ? describe : describe.skip
let compliance: typeof import('./compliance.server')
let prisma: typeof import('./prisma.server').default
let withTenantContext: typeof import('./tenantContext.server').withTenantContext
let directory = ''
const domains: string[] = []
const secret = 'local-compliance-test-secret'
const past = () => new Date(Date.now() - 62 * 60_000)

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agsu-compliance-'))
  process.env.LOCAL_STORAGE_PATH = directory
  process.env.SHOPIFY_API_SECRET = secret
  if (integration) process.env.DATABASE_URL = integrationUrl
  compliance = await import('./compliance.server')
  prisma = (await import('./prisma.server')).default
  withTenantContext = (await import('./tenantContext.server')).withTenantContext
  storage.deleteFile.mockImplementation((...args: any[]) => storage.realDelete(...args))
  storage.deleteShopStorageObjects.mockImplementation(async (_config: unknown, domain: string) => {
    // Actual isolated temp-file deletion; R2 transport is mocked, not claimed
    // to prove provider credentials, bucket settings or pagination.
    await rm(join(directory, domain.replace(/[^a-zA-Z0-9-]/g, '_')), { recursive: true, force: true })
    return 1
  })
})
afterAll(async () => {
  if (integration) {
    await prisma.shop.deleteMany({ where: { shopDomain: { in: domains } } })
    await prisma.complianceRequest.deleteMany({ where: { shopDomain: { in: domains } } })
    await prisma.$disconnect()
  }
  if (directory) await rm(directory, { recursive: true, force: true })
})

function request(topic: string, shop: string, event: string, extra: Record<string, unknown> = {}, invalid = false) {
  const body = JSON.stringify({ shop_domain: shop, ...extra })
  return new Request('http://localhost/webhooks/compliance', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Shopify-Topic': topic, 'X-Shopify-Shop-Domain': shop, 'X-Shopify-Event-Id': event, 'X-Shopify-Hmac-Sha256': invalid ? 'invalid' : createHmac('sha256', secret).update(body).digest('base64') } })
}
async function fixture() {
  const domain = `privacy-${randomUUID()}.myshopify.com`; domains.push(domain)
  const shop = await prisma.shop.create({ data: { shopDomain: domain, accessToken: 'disposable-not-a-provider-token', billingStatus: 'active', storageProvider: 'local', settings: { untouched: 'keep', customerPricing: { assignments: [{ customerId: '7', profileId: 'special' }, { customerId: '8', profileId: 'keep' }] }, alphaProDiscount: { eligibleCustomers: [{ customerId: 'gid://shopify/Customer/7', tier: 2 }, { customerId: '8', tier: 3 }] } } } })
  const key = `${domain.replace(/[^a-zA-Z0-9-]/g, '_')}/prod/file.png`
  await mkdir(dirname(join(directory, key)), { recursive: true }); await writeFile(join(directory, key), 'isolated fixture artwork')
  const archiveKey = `${domain.replace(/[^a-zA-Z0-9-]/g, '_')}/exports/fixture.zip`
  await mkdir(dirname(join(directory, archiveKey)), { recursive: true }); await writeFile(join(directory, archiveKey), 'isolated archive')
  const upload = await withTenantContext(shop.id, () => prisma.upload.create({ data: { shopId: shop.id, mode: 'gang_sheet', status: 'ready', customerId: '7', orderId: '101', items: { create: { location: 'front', storageKey: `local:${key}`, originalName: 'fixture.png', fileSize: 23 } } } }))
  await withTenantContext(shop.id, async () => {
    await prisma.orderLink.create({ data: { shopId: shop.id, orderId: '101', uploadId: upload.id, lineItemId: '3' } })
    const fee = await prisma.commission.create({ data: { shopId: shop.id, orderId: '101', orderTotal: 100, commissionAmount: 3.5, status: 'paid', usageRecordId: `gid://shopify/AppUsageRecord/${randomUUID()}`, attributableCapturedAmount: 100 } })
    await prisma.billingCredit.create({ data: { shopId: shop.id, commissionId: fee.id, amountUsd: 3.5, idempotencyKey: `credit-${randomUUID()}` } })
    await prisma.uploadLog.create({ data: { shopId: shop.id, uploadId: upload.id, event: 'fixture', level: 'info' } })
    await prisma.exportJob.create({ data: { shopId: shop.id, uploadIds: [upload.id], status: 'completed', storageKey: `local:${archiveKey}`, completedAt: new Date() } })
  })
  return { shop, upload, key, archiveKey }
}
async function due(domain: string, event: string) {
  await prisma.complianceRequest.updateMany({ where: { shopDomain: domain, eventId: event }, data: { dueAt: new Date(), createdAt: past() } })
}

describe('privacy payload authentication and minimization', () => {
  it('authenticates exact bytes and never stores contact-only identifiers', () => {
    const body = '{"exact":"bytes"}'
    const signature = createHmac('sha256', secret).update(body).digest('base64')
    expect(compliance.verifyComplianceHmac(body, signature, secret)).toBe(true)
    expect(compliance.verifyComplianceHmac(`${body} `, signature, secret)).toBe(false)
    expect(compliance.verifyComplianceHmac(body, 'invalid', secret)).toBe(false)
    expect(compliance.minimizeCompliancePayload({ customer: { email: 'buyer@example.com', phone: 'private', id: 7 }, orders_requested: [101, 101, 'invalid'] }, 'test.myshopify.com')).toEqual({ shop_domain: 'test.myshopify.com', customer: { id: '7' }, orders_requested: ['101'], orders_to_redact: [] })
    expect(compliance.minimizeCompliancePayload({ customer: { email: 'only@example.com' } }, 'test.myshopify.com').customer.id).toBeNull()
  })
  it('rejects an oversized untrusted stream before buffering or database work', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(512 * 1024)); controller.enqueue(new Uint8Array(512 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close() } })
    const request = new Request('http://localhost/webhooks/compliance', { method: 'POST', body, duplex: 'half' } as RequestInit)
    expect((await compliance.receiveComplianceRequest(request)).status).toBe(413)
  })
})

describeDb('real HMAC requests and disposable database erasure', () => {
  it('rejects invalid HMAC, deduplicates, exports finance and actually erases customer files/rows on retry', async () => {
    const { shop, upload, key, archiveKey } = await fixture()
    const data = { customer: { id: 7, email: 'never-persist@example.com', phone: 'never-persist' }, orders_requested: [101] }
    expect((await compliance.receiveComplianceRequest(request('customers/data_request', shop.shopDomain, 'export', data, true))).status).toBe(401)
    expect(await prisma.complianceRequest.count({ where: { shopDomain: shop.shopDomain } })).toBe(0)
    for (let i = 0; i < 2; i++) expect((await compliance.receiveComplianceRequest(request('customers/data_request', shop.shopDomain, 'export', data))).status).toBe(200)
    expect(await prisma.complianceRequest.count({ where: { shopDomain: shop.shopDomain } })).toBe(1)
    const accepted = await prisma.complianceRequest.findFirstOrThrow({ where: { shopDomain: shop.shopDomain } })
    expect(JSON.stringify(accepted.payload)).not.toMatch(/email|phone|never-persist/)
    await compliance.runComplianceBatch()
    const exported: any = (await prisma.complianceRequest.findFirstOrThrow({ where: { shopDomain: shop.shopDomain, eventId: 'export' } })).result
    expect(exported.uploads[0].id).toBe(upload.id)
    expect(exported.commissions[0].commissionAmount).toBe('3.5')
    expect(exported.credits[0].status).toBe('review')
    expect(exported.orderLinks[0].orderId).toBe('101')
    expect(exported.customerPricing['alphaProDiscount.eligibleCustomers']).toHaveLength(1)
    await compliance.receiveComplianceRequest(request('customers/redact', shop.shopDomain, 'erase', { customer: { id: 7 }, orders_to_redact: [101] }))
    await compliance.runComplianceBatch()
    const blocked = await withTenantContext(shop.id, () => prisma.upload.findUniqueOrThrow({ where: { id: upload.id } }))
    expect(blocked.privacyRedactedAt).not.toBeNull()
    expect(blocked.status).toBe('blocked')
    expect(await readFile(join(directory, key), 'utf8')).toBe('isolated fixture artwork')
    storage.deleteFile.mockRejectedValueOnce(new Error('simulated storage failure'))
    await due(shop.shopDomain, 'erase'); await compliance.runComplianceBatch()
    expect((await prisma.complianceRequest.findFirstOrThrow({ where: { shopDomain: shop.shopDomain, eventId: 'erase' } })).status).toBe('pending')
    expect(await withTenantContext(shop.id, () => prisma.upload.count({ where: { id: upload.id } }))).toBe(1)
    await due(shop.shopDomain, 'erase'); await compliance.runComplianceBatch()
    await expect(readFile(join(directory, key))).rejects.toThrow()
    await expect(readFile(join(directory, archiveKey))).rejects.toThrow()
    await withTenantContext(shop.id, async () => {
      expect(await prisma.upload.count({ where: { id: upload.id } })).toBe(0)
      expect(await prisma.orderLink.count({ where: { orderId: '101' } })).toBe(0)
      expect(await prisma.uploadLog.count({ where: { uploadId: upload.id } })).toBe(0)
      expect(await prisma.exportJob.count({ where: { uploadIds: { has: upload.id } } })).toBe(0)
      expect(await prisma.commission.count({ where: { orderId: '101' } })).toBe(1)
    })
    const settings: any = (await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).settings
    expect(settings.untouched).toBe('keep')
    expect(settings.customerPricing.assignments).toEqual([{ customerId: '8', profileId: 'keep' }])
    expect(settings.alphaProDiscount.eligibleCustomers).toEqual([{ customerId: '8', tier: 3 }])
    expect((await prisma.complianceRequest.findFirstOrThrow({ where: { shopDomain: shop.shopDomain, eventId: 'export' } })).result).toBeNull()
  })

  it('accepts contact-only requests without matching anonymous uploads or storing contacts', async () => {
    const { shop } = await fixture()
    await compliance.receiveComplianceRequest(request('customers/data_request', shop.shopDomain, 'contact-only', { customer: { email: 'private@example.com' } }))
    await compliance.runComplianceBatch()
    const row = await prisma.complianceRequest.findFirstOrThrow({ where: { shopDomain: shop.shopDomain, eventId: 'contact-only' } })
    expect(row.status).toBe('completed')
    expect((row.result as any).uploads).toEqual([])
    expect(JSON.stringify(row)).not.toContain('private@example.com')
  })

  it('does not cascade shop rows until object sweep succeeds, then deletes the entire shop', async () => {
    const { shop, key } = await fixture()
    await prisma.shop.update({ where: { id: shop.id }, data: { erasureStartedAt: past() } })
    await compliance.receiveComplianceRequest(request('shop/redact', shop.shopDomain, 'shop-erase'))
    storage.deleteShopStorageObjects.mockRejectedValueOnce(new Error('simulated sweep failure'))
    await compliance.runComplianceBatch()
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).billingStatus).toBe('erasing')
    expect(await readFile(join(directory, key), 'utf8')).toBe('isolated fixture artwork')
    await due(shop.shopDomain, 'shop-erase'); await compliance.runComplianceBatch()
    expect(await prisma.shop.findUnique({ where: { id: shop.id } })).toBeNull()
    await expect(readFile(join(directory, key))).rejects.toThrow()
    const row = await prisma.complianceRequest.findFirstOrThrow({ where: { shopDomain: shop.shopDomain, eventId: 'shop-erase' } })
    expect(row.status).toBe('completed'); expect(row.payload).toBeNull()
    expect((await compliance.receiveComplianceRequest(request('shop/redact', shop.shopDomain, 'shop-erase'))).status).toBe(200)
    expect(await prisma.complianceRequest.count({ where: { shopDomain: shop.shopDomain } })).toBe(1)
  })

  it('a worker losing its lease cannot delete rows or falsely complete erasure', async () => {
    const { shop, upload } = await fixture()
    await compliance.receiveComplianceRequest(request('customers/redact', shop.shopDomain, 'lease-race', { customer: { id: 7 } }))
    await due(shop.shopDomain, 'lease-race')
    storage.deleteFile.mockImplementationOnce(async (...args: any[]) => {
      await storage.realDelete(...args)
      await prisma.complianceRequest.updateMany({ where: { shopDomain: shop.shopDomain, eventId: 'lease-race' }, data: { leaseToken: 'other-worker' } })
    })
    await compliance.runComplianceBatch()
    expect(await withTenantContext(shop.id, () => prisma.upload.count({ where: { id: upload.id } }))).toBe(1)
    const row = await prisma.complianceRequest.findFirstOrThrow({ where: { shopDomain: shop.shopDomain, eventId: 'lease-race' } })
    expect(row.status).toBe('processing'); expect(row.leaseToken).toBe('other-worker')
  })

  it('retention blocks late upload work before draining capabilities and deleting files', async () => {
    const { shop, upload, key, archiveKey } = await fixture()
    await withTenantContext(shop.id, () => prisma.upload.update({ where: { id: upload.id }, data: { orderId: null, createdAt: new Date(Date.now() - 8 * 86400000) } }))
    await compliance.runRetentionBatch()
    expect((await withTenantContext(shop.id, () => prisma.upload.findUniqueOrThrow({ where: { id: upload.id } }))).privacyRedactedAt).not.toBeNull()
    expect(await readFile(join(directory, key), 'utf8')).toBe('isolated fixture artwork')
    // Fixture changes the clock marker in this disposable DB only. Normal
    // application writes cannot reopen a privacy-blocked upload.
    const { withTenantSql } = await import('./tenantContext.server')
    await withTenantContext(shop.id, () => withTenantSql(owner => prisma.$executeRaw`UPDATE uploads SET privacy_redacted_at = ${past()} WHERE id = ${upload.id} AND shop_id = ${owner}`))
    await compliance.runRetentionBatch()
    await expect(readFile(join(directory, key))).rejects.toThrow()
    await expect(readFile(join(directory, archiveKey))).rejects.toThrow()
    expect(await withTenantContext(shop.id, () => prisma.upload.count({ where: { id: upload.id } }))).toBe(0)
  })
})
