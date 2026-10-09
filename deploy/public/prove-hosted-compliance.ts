import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, AbortMultipartUploadCommand, ListObjectsV2Command, ListMultipartUploadsCommand } from '@aws-sdk/client-s3'
import { createTenantPrismaClient } from '../../app/lib/prisma.server'
import { withTenantContext } from '../../app/lib/tenantContext.server'

// One owner-approved run, never a general-purpose production fixture writer.
const run = 'ae4da577-bcd1-4f50-8332-af7040fb5e3d'
const marker = run.replaceAll('-', '')
const appUrl = 'https://auto-gang-sheet.actualscope.com'
assert.equal(process.env.PUBLIC_COMPLIANCE_PROOF_RUN_ID, run, 'exact approved run acknowledgment required')
assert.equal(process.env.PUBLIC_COMPLIANCE_ALLOWED_DROPLET, '607746803', 'exact new-host acknowledgment required')
assert.equal(process.env.PUBLIC_APP_RUNTIME, 'true')
assert.equal(process.env.SHOPIFY_API_KEY, '8822c01b1f0be2280240cfab7d4e9a79', 'wrong app')
assert.equal(process.env.SHOPIFY_APP_URL, appUrl, 'wrong app origin')
assert.ok(process.env.SHOPIFY_API_SECRET)
assert.equal(process.env.R2_ACCOUNT_ID, '3b964e63af3f0e752c640e35dab68c9b', 'wrong R2 account')
assert.equal(process.env.R2_BUCKET_NAME, 'auto-gang-sheet-public', 'wrong bucket')
assert.equal(process.env.R2_PUBLIC_URL || '', '', 'bucket must remain private')
const database = new URL(process.env.DATABASE_URL || '')
assert.equal(database.hostname, 'private-agsu-public-pg-do-user-33221790-0.a.db.ondigitalocean.com')
assert.equal(database.pathname, '/public_app')
assert.equal(decodeURIComponent(database.username), 'agsu_app')
assert.equal(database.searchParams.get('schema'), 'public')
assert.equal(database.searchParams.get('sslmode'), 'require')
assert.equal(database.searchParams.get('sslaccept'), 'strict')
const metadata = await fetch('http://169.254.169.254/metadata/v1/id', { signal: AbortSignal.timeout(3_000) })
assert.equal((await metadata.text()).trim(), '607746803', 'wrong DigitalOcean host')
assert.equal((await fetch(`${appUrl}/health`, { signal: AbortSignal.timeout(15_000) })).status, 200)

const client = createTenantPrismaClient()
const Bucket = process.env.R2_BUCKET_NAME!
const storage = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, maxAttempts: 2, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } })
const fixtures = ['subject', 'erase', 'control'].map(kind => {
  const shopDomain = `agsu-privacy-${kind}-${marker}.myshopify.com`
  return { kind, id: `hosted-privacy-${marker}-${kind}`, shopDomain, uploadId: `privacy-${marker}-${kind}`, sessionId: `offline_${shopDomain}`, prefix: `${shopDomain.replace(/[^a-zA-Z0-9-]/g, '_')}/` }
})
const [subject, erase, control] = fixtures
const customerId = '700000000000001'
const otherCustomerId = '700000000000002'
const keys = {
  original: `${subject.prefix}proof/${run}/original.png`,
  thumbnail: `${subject.prefix}proof/${run}/thumbnail.png`,
  preview: `${subject.prefix}proof/${run}/preview.png`,
  archive: `${subject.prefix}proof/${run}/archive.zip`,
  other: `${subject.prefix}proof/${run}/other-customer.png`,
  control: `${control.prefix}proof/${run}/control.png`,
  erase: `${erase.prefix}proof/${run}/original.png`,
  orphan: `${erase.prefix}proof/${run}/orphan.png`,
}
const multipartKey = `${erase.prefix}proof/${run}/unfinished.png`
const otherUploadId = `privacy-${marker}-other`
const archiveId = `privacy-${marker}-archive`
const topics = ['customers/data_request', 'customers/redact', 'shop/redact'] as const
const eventIds = topics.map((_, index) => `ae4da577-bcd1-4f50-8332-af7040fb5e3${index + 1}`)
const invalidEvent = 'ae4da577-bcd1-4f50-8332-af7040fb5e34'
const allEvents = [...eventIds, invalidEvent]
const started = Date.now()
const evidence: { startedAt: string; run: string; target: string; checks: Array<Record<string, unknown>>; completedAt?: string; cleanup?: string } = {
  startedAt: new Date().toISOString(), run, target: 'Droplet 607746803 / public_app / auto-gang-sheet-public', checks: [],
}
let multipartId: string | undefined
let fixturesStarted = false
function passed(name: string, facts: Record<string, unknown> = {}) {
  evidence.checks.push({ name, ...facts })
  console.log(`PASS ${name} ${JSON.stringify(facts)}`)
}
async function send(command: any): Promise<any> {
  return storage.send(command, { abortSignal: AbortSignal.timeout(30_000) }) as Promise<any>
}
async function exists(key: string) {
  try { await send(new HeadObjectCommand({ Bucket, Key: key })); return true }
  catch (error: any) { if (error.$metadata?.httpStatusCode === 404) return false; throw error }
}
async function until<T>(name: string, inspect: () => Promise<T | undefined>, timeoutMs = 65_000): Promise<T> {
  const limit = Date.now() + timeoutMs
  while (Date.now() < limit) {
    const result = await inspect()
    if (result !== undefined) return result
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`Timed out waiting for existing privacy worker: ${name}`)
}
function bodyFor(index: number) {
  return JSON.stringify({ shop_id: '700000000000099', shop_domain: index === 2 ? erase.shopDomain : subject.shopDomain, customer: { id: customerId, email: 'never-persist@example.invalid', phone: '+15550100000' }, orders_requested: [], orders_to_redact: [] })
}
async function post(index: number, invalid = false) {
  const body = bodyFor(index)
  const before = performance.now()
  const response = await fetch(`${appUrl}/webhooks/compliance`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), body,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Topic': topics[index], 'X-Shopify-Shop-Domain': index === 2 ? erase.shopDomain : subject.shopDomain, 'X-Shopify-Event-Id': invalid ? invalidEvent : eventIds[index], 'X-Shopify-Hmac-Sha256': invalid ? Buffer.alloc(32).toString('base64') : createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(body).digest('base64') },
  })
  const durationMs = Math.round(performance.now() - before)
  assert.equal(response.status, invalid ? 401 : 200, 'actual HTTPS webhook response')
  assert.ok(durationMs < 5_000, 'webhook acknowledgment exceeded five seconds')
  // Response content/signatures and generated exports never enter stdout.
  await response.arrayBuffer()
  return { status: response.status, durationMs }
}
async function receipt(index: number) {
  return client.complianceRequest.findUniqueOrThrow({ where: { compliance_shop_topic_event: { shopDomain: index === 2 ? erase.shopDomain : subject.shopDomain, topic: topics[index], eventId: eventIds[index] } } })
}
async function originalAndReplay(index: number) {
  const original = await post(index)
  const replay = await post(index)
  assert.equal(await client.complianceRequest.count({ where: { shopDomain: index === 2 ? erase.shopDomain : subject.shopDomain, topic: topics[index], eventId: eventIds[index] } }), 1)
  const row = await receipt(index)
  const serialized = JSON.stringify([row.payload, row.result])
  assert.ok(!serialized.includes('never-persist@example.invalid'))
  assert.ok(!serialized.includes('+15550100000'))
  passed(`${topics[index]}: real HTTP original/replay, one minimized durable receipt`, { original, replay })
  return row
}
async function ageSyntheticReceipt(index: number) {
  const row = await receipt(index)
  assert.equal(row.status, 'pending')
  assert.equal(row.leaseToken, null)
  assert.match(row.lastError || '', /capabilities to expire/)
  assert.ok(row.dueAt.getTime() > Date.now())
  const past = new Date(Date.now() - 62 * 60_000)
  if (index === 2) {
    const shop = await client.shop.findUniqueOrThrow({ where: { id: erase.id } })
    assert.equal(shop.shopDomain, erase.shopDomain)
    assert.ok(shop.erasureStartedAt)
    const changed = await withTenantContext(erase.id, () => client.shop.updateMany({ where: { id: erase.id, shopDomain: erase.shopDomain, erasureStartedAt: shop.erasureStartedAt }, data: { erasureStartedAt: past } }))
    assert.equal(changed.count, 1)
  }
  const changed = await client.complianceRequest.updateMany({ where: { id: row.id, shopDomain: row.shopDomain, topic: topics[index], eventId: eventIds[index], status: 'pending', leaseToken: null }, data: { createdAt: past, dueAt: new Date() } })
  assert.equal(changed.count, 1, 'do not overwrite a worker lease')
  passed(`${topics[index]}: simulated 62-minute fixture clock only`, { actualWaitMinutes: 0, productionDrainPolicyChanged: false })
}

try {
  // Refuse collisions before the first write: this run cannot overwrite a prior run.
  assert.equal(await client.shop.count({ where: { OR: [{ id: { in: fixtures.map(f => f.id) } }, { shopDomain: { in: fixtures.map(f => f.shopDomain) } }] } }), 0)
  assert.equal(await client.complianceRequest.count({ where: { shopDomain: { in: fixtures.map(f => f.shopDomain) } } }), 0)
  assert.equal(await client.session.count({ where: { id: { in: fixtures.map(f => f.sessionId) } } }), 0)
  for (const fixture of fixtures) {
    assert.equal((await send(new ListObjectsV2Command({ Bucket, Prefix: fixture.prefix, MaxKeys: 1 }))).KeyCount || 0, 0)
    assert.equal((await send(new ListMultipartUploadsCommand({ Bucket, Prefix: fixture.prefix }))).Uploads?.length || 0, 0)
  }
  fixturesStarted = true
  for (const fixture of fixtures) {
    await client.shop.create({ data: { id: fixture.id, shopDomain: fixture.shopDomain, accessToken: 'fixture-no-shopify-access', billingStatus: 'inactive', storageProvider: 'r2', settings: fixture === subject ? { customerPricing: { assignments: [{ customerId, rateId: 'synthetic-only' }, { customerId: otherCustomerId, rateId: 'unrelated' }] }, proofMarker: run } : { proofMarker: run } } })
  }
  const bytes = Buffer.from('Only synthetic privacy proof bytes; not a customer production file.\n')
  for (const key of Object.values(keys)) await send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: 'application/octet-stream' }))
  const createUpload = async (fixture: typeof subject, id: string, buyer: string, key: string, derived = false) => withTenantContext(fixture.id, () => client.upload.create({ data: { id, shopId: fixture.id, mode: 'dtf', status: 'draft', customerId: buyer, items: { create: { location: 'front', storageKey: `r2:${key}`, thumbnailKey: derived ? `r2:${keys.thumbnail}` : null, previewKey: derived ? `r2:${keys.preview}` : null, originalName: 'synthetic-proof.png', mimeType: 'image/png', fileSize: bytes.length } } } }))
  await createUpload(subject, subject.uploadId, customerId, keys.original, true)
  await createUpload(subject, otherUploadId, otherCustomerId, keys.other)
  await createUpload(control, control.uploadId, customerId, keys.control)
  await createUpload(erase, erase.uploadId, customerId, keys.erase)
  await withTenantContext(subject.id, () => client.exportJob.create({ data: { id: archiveId, shopId: subject.id, uploadIds: [subject.uploadId], storageKey: `r2:${keys.archive}`, status: 'completed', completedAt: new Date() } }))
  await client.session.create({ data: { id: erase.sessionId, shop: erase.shopDomain, state: 'synthetic-only', accessToken: 'fixture-no-shopify-access', isOnline: false } })
  const multipart = await send(new CreateMultipartUploadCommand({ Bucket, Key: multipartKey }))
  multipartId = multipart.UploadId
  assert.ok(multipartId)
  passed('Exact isolated fixtures created: three inactive synthetic shops, eight tiny R2 objects and one unfinished multipart; no orders, fees or queue jobs')

  passed('Invalid HTTP HMAC rejected', await post(0, true))
  assert.equal(await client.complianceRequest.count({ where: { eventId: invalidEvent, shopDomain: subject.shopDomain } }), 0)
  await originalAndReplay(0)
  const exportRow = await until('metadata export', async () => { const row = await receipt(0); return row.status === 'completed' ? row : undefined })
  const exported = exportRow.result as any
  assert.deepEqual(exported.uploads.map((upload: any) => upload.id), [subject.uploadId])
  for (const key of ['orderLinks', 'commissions', 'credits', 'paidSheetVolume']) assert.deepEqual(exported[key], [])
  assert.equal(exported.customerPricing['customerPricing.assignments'].length, 1)
  assert.equal(exported.customerPricing['customerPricing.assignments'][0].customerId, customerId)
  assert.equal(exportRow.payload, null)
  assert.equal(await exists(keys.original), true)
  const exportedAttempts = exportRow.attempts
  await post(0)
  assert.equal((await receipt(0)).attempts, exportedAttempts)
  passed('Existing deployed privacy worker exported only the requested synthetic subject, cleared payload and did not reprocess completed replay', { attempts: exportedAttempts, uploadCount: 1 })

  await originalAndReplay(1)
  await until('customer immediate block and capability drain', async () => {
    const row = await receipt(1)
    const upload = await withTenantContext(subject.id, () => client.upload.findUnique({ where: { id: subject.uploadId } }))
    return row.status === 'pending' && row.lastError?.includes('capabilities to expire') && upload?.status === 'blocked' && upload.privacyRedactedAt ? row : undefined
  })
  assert.equal(await exists(keys.original), true)
  passed('Customer erasure blocks immediately but preserves bytes while real 61-minute capability drain is pending')
  await ageSyntheticReceipt(1)
  const customerDone = await until('customer physical erasure', async () => { const row = await receipt(1); return row.status === 'completed' ? row : undefined })
  assert.equal((customerDone.result as any).erased, true)
  assert.equal(customerDone.payload, null)
  await withTenantContext(subject.id, async () => {
    assert.equal(await client.upload.count({ where: { id: subject.uploadId } }), 0)
    assert.equal(await client.exportJob.count({ where: { id: archiveId } }), 0)
    assert.equal(await client.upload.count({ where: { id: otherUploadId } }), 1)
    assert.equal(await client.auditLog.count({ where: { action: 'customer_data_erased' } }), 1)
  })
  for (const key of [keys.original, keys.thumbnail, keys.preview, keys.archive]) assert.equal(await exists(key), false)
  const fenced = await receipt(0)
  assert.equal(fenced.status, 'erased'); assert.equal(fenced.payload, null); assert.equal(fenced.result, null)
  const subjectSettings = (await client.shop.findUniqueOrThrow({ where: { id: subject.id } })).settings as any
  assert.deepEqual(subjectSettings.customerPricing.assignments, [{ customerId: otherCustomerId, rateId: 'unrelated' }])
  await post(0); assert.equal((await receipt(0)).status, 'erased')
  await post(1); assert.equal((await receipt(1)).attempts, customerDone.attempts)
  passed('Customer erasure completed: original/thumbnail/preview/archive HEAD404, upload/export rows removed, prior export fenced, selected assignment removed and replay immutable')

  await originalAndReplay(2)
  await until('shop closure and capability drain', async () => {
    const row = await receipt(2)
    const shop = await client.shop.findUnique({ where: { id: erase.id } })
    return row.status === 'pending' && row.lastError?.includes('capabilities to expire') && shop?.erasureStartedAt && shop.billingStatus === 'erasing' && shop.accessToken === '' ? row : undefined
  })
  assert.equal(await client.session.count({ where: { id: erase.sessionId, shop: erase.shopDomain } }), 0)
  assert.equal(await exists(keys.orphan), true)
  assert.equal((await send(new ListMultipartUploadsCommand({ Bucket, Prefix: multipartKey }))).Uploads?.length, 1)
  passed('Shop erasure closes token/session access immediately and preserves orphan/multipart during the real capability drain')
  await ageSyntheticReceipt(2)
  const shopDone = await until('shop prefix/multipart/database erasure', async () => { const row = await receipt(2); return row.status === 'completed' ? row : undefined })
  assert.equal((shopDone.result as any).erased, true)
  assert.equal(await client.shop.count({ where: { id: erase.id, shopDomain: erase.shopDomain } }), 0)
  assert.equal((await send(new ListObjectsV2Command({ Bucket, Prefix: erase.prefix }))).KeyCount || 0, 0)
  assert.equal((await send(new ListMultipartUploadsCommand({ Bucket, Prefix: erase.prefix }))).Uploads?.length || 0, 0)
  multipartId = undefined
  await post(2); assert.equal((await receipt(2)).attempts, shopDone.attempts)
  passed('Shop erasure completed: exact synthetic prefix including unreferenced orphan and unfinished multipart empty, shop cascades removed, replay immutable')
  assert.equal(await exists(keys.control), true)
  assert.equal(await exists(keys.other), true)
  await withTenantContext(control.id, async () => { assert.equal(await client.upload.count({ where: { id: control.uploadId, customerId } }), 1) })
  for (const fixture of [subject, control]) await withTenantContext(fixture.id, async () => {
    assert.equal(await client.orderLink.count(), 0)
    assert.equal(await client.commission.count(), 0)
    assert.equal(await client.paidSheetVolume.count(), 0)
  })
  passed('Same customer ID in control shop and another customer within subject shop remain unchanged; no order, commission or paid-volume rows exist')
} finally {
  try {
    if (fixturesStarted) {
      const cleanupErrors: unknown[] = []
      const cleanup = async (task: () => Promise<unknown>) => { try { await task() } catch (error) { cleanupErrors.push(error) } }
      // Revoke only this run's receipts before exact cleanup so an in-flight
      // worker cannot publish an export or claim another retry after cleanup.
      await cleanup(() => client.complianceRequest.updateMany({ where: { shopDomain: { in: fixtures.map(f => f.shopDomain) }, eventId: { in: allEvents } }, data: { status: 'erased', payload: Prisma.DbNull, result: Prisma.DbNull, leaseToken: null, leaseUntil: null, completedAt: new Date() } }))
      if (multipartId) {
        await cleanup(async () => {
          try { await send(new AbortMultipartUploadCommand({ Bucket, Key: multipartKey, UploadId: multipartId })) }
          catch (error: any) { if (error.$metadata?.httpStatusCode !== 404) throw error }
        })
      }
      for (const key of Object.values(keys)) await cleanup(async () => { await send(new DeleteObjectCommand({ Bucket, Key: key })); assert.equal(await exists(key), false) })
      for (const fixture of fixtures) {
        await cleanup(async () => {
          const shop = await client.shop.findUnique({ where: { id: fixture.id }, select: { shopDomain: true } })
          if (shop) { assert.equal(shop.shopDomain, fixture.shopDomain); await withTenantContext(fixture.id, () => client.shop.delete({ where: { id: fixture.id } })) }
        })
        await cleanup(() => client.session.deleteMany({ where: { id: fixture.sessionId, shop: fixture.shopDomain } }))
        await cleanup(async () => { assert.equal((await send(new ListObjectsV2Command({ Bucket, Prefix: fixture.prefix }))).KeyCount || 0, 0) })
        await cleanup(async () => { assert.equal((await send(new ListMultipartUploadsCommand({ Bucket, Prefix: fixture.prefix }))).Uploads?.length || 0, 0) })
      }
      await cleanup(() => client.complianceRequest.deleteMany({ where: { shopDomain: { in: fixtures.map(f => f.shopDomain) }, eventId: { in: allEvents } } }))
      await cleanup(async () => { assert.equal(await client.shop.count({ where: { id: { in: fixtures.map(f => f.id) } } }), 0) })
      await cleanup(async () => { assert.equal(await client.session.count({ where: { id: { in: fixtures.map(f => f.sessionId) } } }), 0) })
      await cleanup(async () => { assert.equal(await client.complianceRequest.count({ where: { shopDomain: { in: fixtures.map(f => f.shopDomain) } } }), 0) })
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Exact fixture cleanup incomplete; do not rerun until audited')
      evidence.cleanup = 'All eight exact R2 keys HEAD404; all three synthetic prefixes and multipart lists empty; exact shops/cascades, sessions and minimized receipts/export results removed. No queue flush or real shop/order/fee changes.'
      console.log(`CLEANUP verified: ${evidence.cleanup}`)
    }
  } finally { storage.destroy(); await client.$disconnect() }
}
evidence.completedAt = new Date().toISOString()
passed('Hosted proof complete', { durationMs: Date.now() - started, clockSimulation: '62 minutes on exact synthetic timestamps; not an actual 61-minute wait or 48-hour SLA proof' })
console.log(JSON.stringify(evidence, null, 2))
