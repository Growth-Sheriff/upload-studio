import { describe, expect, it, vi } from 'vitest'
const producer = vi.hoisted(() => ({ enqueueBillingShopPage: vi.fn() }))
vi.mock('~/lib/billingQueueProducer.server', () => producer)
import { action } from '../routes/api.cron.billing.run'

describe('owner billing trigger', () => {
  it('requires the public operations credential and acknowledges only bounded enqueue', async () => {
    process.env.PUBLIC_OPERATIONS_TOKEN = 'isolated-operations-token'
    producer.enqueueBillingShopPage.mockResolvedValue({ scheduled: 100, nextCursor: 'shop-099' })
    const denied = await action({ request: new Request('http://localhost/api/cron/billing/run', { method: 'POST' }) } as any)
    expect(denied.status).toBe(404)
    expect(producer.enqueueBillingShopPage).not.toHaveBeenCalled()
    const accepted = await action({ request: new Request('http://localhost/api/cron/billing/run?after=shop-old', { method: 'POST', headers: { Authorization: 'Bearer isolated-operations-token' } }) } as any)
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ success: true, scheduled: 100, nextCursor: 'shop-099' })
    expect(producer.enqueueBillingShopPage).toHaveBeenCalledWith({ after: 'shop-old' })
  })
})
