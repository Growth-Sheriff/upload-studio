import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { createTenantPrismaClient, TenantIsolationError } from '../../app/lib/prisma.server'
import { withTenantContext } from '../../app/lib/tenantContext.server'

// Deliberately not a general-purpose production test. Only the new public
// deployment may receive these short-lived, non-orderable synthetic rows.
const appUrl = 'https://auto-gang-sheet.actualscope.com'
assert.equal(process.env.PUBLIC_APP_RUNTIME, 'true', 'public runtime required')
assert.equal(process.env.SHOPIFY_API_KEY, '8822c01b1f0be2280240cfab7d4e9a79', 'wrong Shopify app')
assert.equal(process.env.SHOPIFY_APP_URL, appUrl, 'wrong app origin')
assert.equal(process.env.PUBLIC_ISOLATION_ALLOWED_DROPLET, '607746803', 'explicit new-host acknowledgment required')
assert.ok(process.env.SHOPIFY_API_SECRET, 'proxy signing secret required')
const database = new URL(process.env.DATABASE_URL || '')
assert.equal(database.pathname, '/public_app', 'wrong database')
assert.equal(decodeURIComponent(database.username), 'agsu_app', 'runtime role required')
assert.equal(database.hostname, 'private-agsu-public-pg-do-user-33221790-0.a.db.ondigitalocean.com', 'exact new private database required')
assert.equal(database.searchParams.get('schema'), 'public', 'public schema required')
assert.equal(database.searchParams.get('sslmode'), 'require', 'database TLS required')
assert.equal(database.searchParams.get('sslaccept'), 'strict', 'database certificate validation required')
const metadata = await fetch('http://169.254.169.254/metadata/v1/id', { signal: AbortSignal.timeout(3_000) })
assert.equal((await metadata.text()).trim(), '607746803', 'wrong DigitalOcean host')
const health = await fetch(`${appUrl}/health`, { signal: AbortSignal.timeout(15_000) })
assert.equal(health.status, 200, 'public TLS endpoint must be healthy before fixture creation')

const client = createTenantPrismaClient()
const marker = randomUUID().replace(/-/g, '')
const fixtures = Array.from({ length: 3 }, (_, index) => ({
  id: `hosted-isolation-${marker}-${index}`,
  shopDomain: `agsu-isolation-${index}-${marker}.myshopify.com`,
  uploadId: `fixture-${marker}-${index}`,
}))
let assertions = 0
function passed(label: string) { assertions++; console.log(`PASS ${label}`) }
async function allSettledOrThrow(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks)
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'isolation proof failed')
}
function proxyUrl(shopDomain: string, uploadId: string) {
  const parameters = { shop: shopDomain, timestamp: String(Math.floor(Date.now() / 1000)), path_prefix: '/apps/customizer' }
  const canonical = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('')
  const signature = createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(canonical).digest('hex')
  return `${appUrl}/api/upload/status/${uploadId}?${new URLSearchParams({ ...parameters, signature })}`
}
async function get(url: string) {
  // Signed URLs and response bodies can be capabilities; never print them.
  return fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
}
try {
  console.log(`Hosted isolation fixture ${marker}; target Droplet 607746803 / public_app; no objects, orders, billing or jobs created.`)
  for (const fixture of fixtures) {
    await client.shop.create({ data: { id: fixture.id, shopDomain: fixture.shopDomain, accessToken: 'fixture-no-shopify-access', billingStatus: 'inactive', storageProvider: 'r2' } })
    await withTenantContext(fixture.id, () => client.upload.create({ data: { id: fixture.uploadId, shopId: fixture.id, mode: 'dtf', status: 'draft' } }))
  }
  await allSettledOrThrow(fixtures.map((fixture, index) => withTenantContext(fixture.id, async () => {
    const foreign = fixtures[(index + 1) % fixtures.length]
    assert.deepEqual((await client.upload.findMany()).map(row => row.id), [fixture.uploadId])
    passed(`shop ${index + 1}: implicit read scope exposes only its own upload`)
    assert.equal(await client.upload.findUnique({ where: { id: foreign.uploadId } }), null)
    passed(`shop ${index + 1}: foreign unique ID is unreadable`)
    await assert.rejects(client.upload.update({ where: { id: foreign.uploadId }, data: { status: 'ready' } }))
    passed(`shop ${index + 1}: foreign update refused`)
    await assert.rejects(client.uploadItem.create({ data: { uploadId: foreign.uploadId, location: 'front', storageKey: 'r2:fixture-never-written' } }), /foreign/)
    passed(`shop ${index + 1}: foreign relation create refused`)
    await assert.rejects(client.upload.findMany({ where: { shopId: foreign.id } }), TenantIsolationError)
    passed(`shop ${index + 1}: injected shop predicate refused`)
  })))
  await allSettledOrThrow(fixtures.map(async (fixture, index) => {
    const own = await get(proxyUrl(fixture.shopDomain, fixture.uploadId))
    assert.equal(own.status, 200, `shop ${index + 1}: signed own-upload response`)
    assert.equal((await own.json()).uploadId, fixture.uploadId)
    passed(`shop ${index + 1}: deployed signed proxy returns its own upload`)
    const foreign = await get(proxyUrl(fixture.shopDomain, fixtures[(index + 1) % fixtures.length].uploadId))
    assert.equal(foreign.status, 404, `shop ${index + 1}: signed foreign-upload response`)
    passed(`shop ${index + 1}: deployed signed proxy denies foreign upload`)
  }))
  const unsigned = await get(`${appUrl}/api/upload/status/${fixtures[0].uploadId}?shop=${fixtures[0].shopDomain}`)
  assert.equal(unsigned.status, 400, 'unsigned proxy must fail authentication')
  passed('deployed proxy refuses an unsigned request')
  const tampered = new URL(proxyUrl(fixtures[0].shopDomain, fixtures[0].uploadId))
  tampered.searchParams.set('shop', fixtures[1].shopDomain)
  assert.equal((await get(tampered.toString())).status, 400, 'changed shop must invalidate the signature')
  passed('deployed proxy refuses a changed signed shop')
  for (const fixture of fixtures) {
    await withTenantContext(fixture.id, async () => {
      assert.equal((await client.upload.findUniqueOrThrow({ where: { id: fixture.uploadId } })).status, 'draft')
      assert.equal(await client.uploadItem.count(), 0)
      assert.equal(await client.commission.count(), 0)
    })
  }
  passed('all uploads stayed draft, with no upload items or commission rows')
  console.log(`PASS ${assertions} assertions across three simultaneous synthetic shops.`)
} finally {
  // Fixed IDs were chosen before create, so even an ambiguous create outcome
  // is cleaned up. Never delete by a wildcard, broad prefix or unverified ID.
  try {
    for (const fixture of fixtures) {
      const row = await client.shop.findUnique({ where: { id: fixture.id }, select: { shopDomain: true } })
      if (!row) continue
      assert.equal(row.shopDomain, fixture.shopDomain, 'cleanup owner mismatch')
      await withTenantContext(fixture.id, () => client.shop.delete({ where: { id: fixture.id } }))
    }
    assert.equal(await client.shop.count({ where: { id: { in: fixtures.map(fixture => fixture.id) } } }), 0)
    console.log('CLEANUP verified: all three exact fixture shops and cascading uploads deleted. Rate-limit keys expire in 60 seconds; no queue or storage changes.')
  } finally {
    await client.$disconnect()
  }
}
