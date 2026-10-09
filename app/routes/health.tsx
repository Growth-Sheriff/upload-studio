import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import Redis from 'ioredis'
import { publicRedisUrl } from '~/lib/publicRedis.server'

/** Liveness contains no tenant records, queue counters or schema detail. */
export async function loader(_args: LoaderFunctionArgs) {
  const redis = new Redis(publicRedisUrl(), { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000 })
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()])
    return json({ status: 'healthy' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return json({ status: 'degraded' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  } finally { redis.disconnect() }
}
