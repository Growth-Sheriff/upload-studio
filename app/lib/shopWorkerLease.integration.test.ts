import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { describe, expect, it } from 'vitest'
import { acquireShopWorkerLease } from './shopWorkerLease.server'

const target = process.env.PUBLIC_TENANCY_TEST_REDIS_URL
describe.skipIf(!target)('shared per-shop lease Redis integration', () => {
  it('atomically limits concurrent processes, releases only its token and expires abandoned leases', async () => {
    const url = new URL(target!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '56389' || url.pathname !== '/0') throw new Error('Lease fixture requires the explicit isolated local Redis at56389 DB0')
    const first = new Redis(target!, { maxRetriesPerRequest: 1 })
    const second = new Redis(target!, { maxRetriesPerRequest: 1 })
    const shop = `fixture_${randomUUID()}`
    const otherShop = `fixture_${randomUUID()}`
    const key = `auto-gang-sheet:shop-active:${shop}`
    const otherKey = `auto-gang-sheet:shop-active:${otherShop}`
    const releases: Array<() => Promise<void>> = []
    try {
      const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => acquireShopWorkerLease(index % 2 ? first : second, shop, 1000)))
      for (const result of attempts) if (result.status === 'fulfilled') releases.push(result.value)
      expect(releases).toHaveLength(2)
      expect(await first.zcard(key)).toBe(2)
      releases.push(await acquireShopWorkerLease(second, otherShop, 1000))
      const [token] = await first.zrange(key, 0, 0)
      await first.zadd(key, Date.now() - 1, token)
      releases.push(await acquireShopWorkerLease(second, shop, 1000))
      expect(await first.zcard(key)).toBe(2)
      await releases[0](); await releases[0]()
      expect(await first.zcard(otherKey)).toBe(1)
    } finally {
      await Promise.allSettled(releases.map(release => release()))
      await first.del(key, otherKey)
      await Promise.all([first.quit(), second.quit()])
    }
  })
})
