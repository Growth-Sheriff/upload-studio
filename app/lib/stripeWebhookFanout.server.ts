import type Stripe from 'stripe'
import { TENANT_SLUGS, getTenantInternalUrl, type TenantSlug } from './tenants.server'

const FAN_OUT_TIMEOUT_MS = 8_000

type FanOutResult = {
  slug: TenantSlug
  matched?: boolean
  detail?: string
  error?: string
}

export async function fanOutToTenants(
  event: Stripe.Event,
  internalSecret: string
): Promise<{ results: FanOutResult[] }> {
  const payload = JSON.stringify(event)
  const settled = await Promise.allSettled(
    TENANT_SLUGS.map(async (slug): Promise<FanOutResult> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FAN_OUT_TIMEOUT_MS)
      try {
        const res = await fetch(getTenantInternalUrl(slug, '/api/webhooks/stripe-internal'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret,
          },
          body: payload,
          signal: controller.signal,
        })
        const data = (await res.json().catch(() => ({}))) as {
          matched?: boolean
          detail?: string
          error?: string
        }
        if (!res.ok) {
          return {
            slug,
            error: `HTTP ${res.status}: ${data.error || data.detail || 'tenant processing failed'}`,
          }
        }
        return { slug, matched: !!data.matched, detail: data.detail }
      } catch (err) {
        return { slug, error: err instanceof Error ? err.message : 'unknown' }
      } finally {
        clearTimeout(timeout)
      }
    })
  )
  const results = settled.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : { slug: TENANT_SLUGS[index], error: String(result.reason) }
  )
  return { results }
}
