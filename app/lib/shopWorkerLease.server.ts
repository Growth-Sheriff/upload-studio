import { randomUUID } from 'node:crypto'
import type Redis from 'ioredis'

export const SHOP_WORKER_RETRY_MS = 5_000
export class ShopWorkerBusyError extends Error {}
const acquireScript = `
redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1])
if redis.call('zcard', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('zadd', KEYS[1], ARGV[2], ARGV[4])
redis.call('pexpire', KEYS[1], ARGV[5])
return 1
`

/** Atomic distributed cap across measure, preview and export processes.
 * Busy jobs yield their BullMQ slot and do not consume a retry attempt.
 * Tokens cannot release another execution's slot. Crashes expire naturally. */
export async function acquireShopWorkerLease(redis: Pick<Redis, 'eval' | 'zrem'>, shopId: string, budgetMs: number, maxActive = 2): Promise<() => Promise<void>> {
  if (!shopId?.trim()) throw new Error('Worker shopId is required')
  const key = `auto-gang-sheet:shop-active:${shopId}`
  const token = randomUUID()
  const now = Date.now()
  // The cancellation deadline precedes lease expiry; a failed process cannot
  // hold capacity indefinitely or renew a stalled download forever.
  const ttl = budgetMs + 30_000
  const acquired = await redis.eval(acquireScript, 1, key, String(now), String(now + ttl), String(maxActive), token, String(ttl))
  if (Number(acquired) !== 1) throw new ShopWorkerBusyError('This shop already has active file processing')
  let released = false
  return async () => {
    if (released) return
    released = true
    await redis.zrem(key, token)
  }
}
