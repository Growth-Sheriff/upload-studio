import { beforeEach, describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ shop: { findMany: vi.fn() } }))
vi.mock('~/lib/prisma.server', () => ({ default: store }))
import { enqueueBillingShopPage } from './billingQueueProducer.server'

describe('bounded shared billing enqueue', () => {
  beforeEach(() => vi.clearAllMocks())
  it('enqueues only one page with the scheduler dedupe key, then resumes after the last submitted shop', async () => {
    store.shop.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ id: `shop-${String(index).padStart(3, '0')}` })))
    const queue = { addBulk: vi.fn().mockResolvedValue([]) }
    expect(await enqueueBillingShopPage({ after: 'shop-old', tick: 123 }, queue)).toEqual({ scheduled: 100, nextCursor: 'shop-099' })
    expect(store.shop.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101, orderBy: { id: 'asc' }, where: expect.objectContaining({ id: { gt: 'shop-old' }, erasureStartedAt: null, uninstalledAt: null }) }))
    expect(queue.addBulk.mock.calls[0][0]).toHaveLength(100)
    expect(queue.addBulk.mock.calls[0][0][0]).toMatchObject({ name: 'record-captured-orders', data: { shopId: 'shop-000' }, opts: { jobId: 'usage-shop-000-123' } })
  })
  it('does not contact Redis or providers when no shops are eligible', async () => {
    store.shop.findMany.mockResolvedValue([])
    const queue = { addBulk: vi.fn() }
    expect(await enqueueBillingShopPage({}, queue)).toEqual({ scheduled: 0, nextCursor: null })
    expect(queue.addBulk).not.toHaveBeenCalled()
  })
})
