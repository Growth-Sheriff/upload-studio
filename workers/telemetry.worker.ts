/**
 * Telemetry Push Worker
 *
 * Runs every 60 seconds inside each tenant container.
 * Collects metrics from the local DB and POSTs them to the
 * central billing panel.
 *
 * Usage: npx tsx workers/telemetry.worker.ts
 *
 * Required ENV:
 *   TENANT_SLUG        - Container/tenant identifier
 *   DATABASE_URL       - PostgreSQL connection string
 *   BILLING_PANEL_URL  - Central panel endpoint (e.g. https://panel.techifyboost.com/api/telemetry)
 *   BILLING_PANEL_KEY  - Auth key for the billing panel
 */

import { PrismaClient } from '@prisma/client'
import { collectTelemetry } from '../app/lib/telemetry.server'

// ──────────────────── Config ────────────────────

const INTERVAL_MS = 60_000 // 60 seconds
const TENANT_SLUG = process.env.TENANT_SLUG || 'unknown'
const BILLING_PANEL_URL = process.env.BILLING_PANEL_URL || ''
const BILLING_PANEL_KEY = process.env.BILLING_PANEL_KEY || ''

// ──────────────────── Prisma ────────────────────

const prisma = new PrismaClient({
  log: ['error'],
})

// ──────────────────── State ────────────────────

let isShuttingDown = false
let intervalId: ReturnType<typeof setInterval> | null = null
let consecutiveErrors = 0
const MAX_CONSECUTIVE_ERRORS = 10

// ──────────────────── Main Loop ────────────────────

async function pushTelemetry(): Promise<void> {
  if (isShuttingDown) return

  try {
    const payload = await collectTelemetry(prisma)

    if (!BILLING_PANEL_URL) {
      // No panel configured - just log summary
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

    const response = await fetch(BILLING_PANEL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': TENANT_SLUG,
        'X-Api-Key': BILLING_PANEL_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000), // 15s timeout
    })

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

  // Back off if too many consecutive errors
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    console.warn(
      `[Telemetry:${TENANT_SLUG}] ${MAX_CONSECUTIVE_ERRORS} consecutive errors, ` +
      `backing off for 5 minutes`
    )
    consecutiveErrors = 0
    await sleep(300_000) // 5 min extra wait
  }
}

// ──────────────────── Helpers ────────────────────

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

// ──────────────────── Lifecycle ────────────────────

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

// ──────────────────── Start ────────────────────

console.log(`[Telemetry:${TENANT_SLUG}] Starting (interval: ${INTERVAL_MS / 1000}s)`)
if (BILLING_PANEL_URL) {
  console.log(`[Telemetry:${TENANT_SLUG}] Target: ${BILLING_PANEL_URL}`)
} else {
  console.log(`[Telemetry:${TENANT_SLUG}] No BILLING_PANEL_URL - local logging only`)
}

// Initial push after 10s delay (let app start first)
setTimeout(() => {
  pushTelemetry()
  intervalId = setInterval(pushTelemetry, INTERVAL_MS)
}, 10_000)
