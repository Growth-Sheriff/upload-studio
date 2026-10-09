import { describe, expect, it } from 'vitest'
import { acquireShopWorkerLease } from './shopWorkerLease.server'

/** This fake tests lease ownership, shop separation and cleanup contract.
 * Real Redis/Lua execution is an explicitly separate integration check. */
function leaseStore() {
  const stores = new Map<string, Map<string, number>>()
  return {
    eval: async (_script: string, _keys: number, key: string, now: string, expires: string, max: string, token: string) => {
      const store = stores.get(key) ?? new Map<string, number>()
      stores.set(key, store)
      for (const [entry, deadline] of store) if (deadline <= Number(now)) store.delete(entry)
      if (store.size >= Number(max)) return 0
      store.set(token, Number(expires)); return 1
    },
    zrem: async (key: string, token: string) => stores.get(key)?.delete(token) ? 1 : 0,
  }
}

describe('per-shop shared worker cap', () => {
  it('one shop cannot hold every slot; another shop can proceed', async () => {
    const redis = leaseStore()
    const releases = await Promise.all([acquireShopWorkerLease(redis as any, 'shop_one', 5000), acquireShopWorkerLease(redis as any, 'shop_one', 5000)])
    await expect(acquireShopWorkerLease(redis as any, 'shop_one', 5000)).rejects.toThrow('active')
    const other = await acquireShopWorkerLease(redis as any, 'shop_two', 5000)
    await releases[0](); await releases[0]()
    const next = await acquireShopWorkerLease(redis as any, 'shop_one', 5000)
    await expect(acquireShopWorkerLease(redis as any, 'shop_one', 5000)).rejects.toThrow('active')
    await Promise.all([releases[1](), other(), next()])
  })
})
