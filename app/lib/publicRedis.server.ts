/** A single Redis database serves every shop. Accidentally carrying a tenant
 * DB index into the public deployment must fail at startup, not split queues. */
export function publicRedisUrl(value = process.env.REDIS_URL || 'redis://localhost:6379'): string {
  const url = new URL(value)
  if (!['redis:', 'rediss:'].includes(url.protocol) || !['', '/', '/0'].includes(url.pathname)) throw new Error('Public app Redis must use shared database 0')
  url.pathname = '/0'
  return url.toString()
}
