export interface BillingFxSnapshot { rate: number; source: string; observedAt: Date }
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
let cache: { expiresAt: number; date: Date; rates: Map<string, number> } | null = null

export function parseEcbRates(xml: string, now = new Date()): { date: Date; rates: Map<string, number> } {
  const dateString = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1]
  const date = new Date(`${dateString}T00:00:00Z`)
  // Weekends/ECB holidays are covered, stale feeds never become invented rates.
  if (!dateString || !Number.isFinite(date.getTime()) || now.getTime() - date.getTime() > 7 * 86400000 || date > now) throw new Error('ECB rate date missing or stale')
  const rates = new Map<string, number>([['EUR', 1]])
  for (const match of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const rate = Number(match[2])
    if (rate > 0 && Number.isFinite(rate)) rates.set(match[1], rate)
  }
  if (!rates.has('USD')) throw new Error('ECB USD rate unavailable')
  return { date, rates }
}

export async function getBillingFxSnapshot(currency: string): Promise<BillingFxSnapshot> {
  const normalized = currency.trim().toUpperCase()
  if (normalized === 'USD') return { rate: 1, source: 'USD identity', observedAt: new Date() }
  if (!cache || cache.expiresAt <= Date.now()) {
    const response = await fetch(ECB_URL, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`ECB rate download failed: ${response.status}`)
    const xml = await response.text()
    if (xml.length > 65536) throw new Error('ECB rate feed unexpectedly large')
    cache = { ...parseEcbRates(xml), expiresAt: Date.now() + 3600000 }
  }
  const localRate = cache.rates.get(normalized)
  if (!localRate) throw new Error(`No published ECB reference rate for ${normalized}; fee requires review`)
  return { rate: cache.rates.get('USD')! / localRate, source: ECB_URL, observedAt: cache.date }
}
