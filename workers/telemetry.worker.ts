















import { PrismaClient } from '@prisma/client'
import { collectTelemetry } from '../app/lib/telemetry.server'



const INTERVAL_MS = 60_000




function resolveTenantSlug(): string {
  const raw = (process.env.TENANT_SLUG || '').trim()
  if (raw && raw !== 'default' && raw !== 'unknown') return raw
  const appUrl = (process.env.SHOPIFY_APP_URL || '').trim()
  if (appUrl) {
    const host = appUrl.replace(/^https?:\/\//, '').split('/')[0]
    const sub = host.split('.')[0]
    if (sub && sub !== 'localhost') return sub
  }
  return raw || 'unknown'
}

const TENANT_SLUG = resolveTenantSlug()
const BILLING_PANEL_URL = (process.env.BILLING_PANEL_URL || '').trim()
const BILLING_PANEL_KEY = (process.env.BILLING_PANEL_KEY || '').trim()



const prisma = new PrismaClient({
  log: ['error'],
})



let isShuttingDown = false
let intervalId: ReturnType<typeof setInterval> | null = null
let consecutiveErrors = 0
const MAX_CONSECUTIVE_ERRORS = 10



async function pushTelemetry(): Promise<void> {
  if (isShuttingDown) return

  try {
    const payload = await collectTelemetry(prisma)

    if (!BILLING_PANEL_URL) {

      console.log(
        `[Telemetry:${TENANT_SLUG}] Collected: ` +
        `uploads=${payload.usage.uploads.total}, ` +
        `orders=${payload.usage.orders.total}, ` +
        `storage=${formatBytes(payload.usage.storage.totalBytes)}, ` +
        `commission_pending=$${payload.commissions.pending.total.toFixed(2)}`
      )
      consecutiveErrors = 0
      return
    }

    let response: Response
    try {
      response = await fetch(BILLING_PANEL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Slug': TENANT_SLUG,
          'X-Api-Key': BILLING_PANEL_KEY,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000), // 15s timeout
      })
    } catch (fetchErr) {



      const e = fetchErr as any
      const cause = e && e.cause ? ` cause=${(e.cause as any).code || (e.cause as any).message}` : ''
      const name = e && e.name ? ` (${e.name})` : ''
      console.error(
        `[Telemetry:${TENANT_SLUG}] Upstream unreachable${name}: ${e?.message || String(e)}${cause} url=${BILLING_PANEL_URL}`
      )
      consecutiveErrors++
      return
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error(
        `[Telemetry:${TENANT_SLUG}] Push failed: ${response.status} ${text.slice(0, 200)}`
      )
      consecutiveErrors++
    } else {
      consecutiveErrors = 0
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Telemetry:${TENANT_SLUG}] Push OK (${response.status})`)
      }
    }
  } catch (error) {
    consecutiveErrors++
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[Telemetry:${TENANT_SLUG}] Error: ${msg}`)
  }


  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    console.warn(
      `[Telemetry:${TENANT_SLUG}] ${MAX_CONSECUTIVE_ERRORS} consecutive errors, ` +
      `backing off for 5 minutes`
    )
    consecutiveErrors = 0
    await sleep(300_000)
  }
}



function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}



function shutdown(): void {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`[Telemetry:${TENANT_SLUG}] Shutting down...`)
  if (intervalId) clearInterval(intervalId)
  prisma.$disconnect().then(() => {
    console.log(`[Telemetry:${TENANT_SLUG}] Disconnected.`)
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)



const tenantSource = process.env.TENANT_SLUG
  ? 'env'
  : process.env.SHOPIFY_APP_URL
    ? 'SHOPIFY_APP_URL'
    : 'fallback'
console.log(
  `[Telemetry:${TENANT_SLUG}] Starting (interval: ${INTERVAL_MS / 1000}s, tenant_source=${tenantSource})`
)
if (BILLING_PANEL_URL) {
  console.log(
    `[Telemetry:${TENANT_SLUG}] Target: ${BILLING_PANEL_URL} (api_key=${BILLING_PANEL_KEY ? 'set' : 'MISSING'})`
  )
} else {
  console.log(`[Telemetry:${TENANT_SLUG}] No BILLING_PANEL_URL - local logging only`)
}
if (TENANT_SLUG === 'unknown' || TENANT_SLUG === 'default') {
  console.warn(
    `[Telemetry:${TENANT_SLUG}] Tenant slug is a placeholder. Set TENANT_SLUG or SHOPIFY_APP_URL so metrics aren't attributed to a phantom tenant.`
  )
}


setTimeout(() => {
  pushTelemetry()
  intervalId = setInterval(pushTelemetry, INTERVAL_MS)
}, 10_000)
