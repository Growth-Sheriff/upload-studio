import type { LoaderFunctionArgs } from '@remix-run/node'
import { timingSafeEqual } from 'node:crypto'
import { json } from '@remix-run/node'
import Redis from 'ioredis'
import { publicRedisUrl } from '~/lib/publicRedis.server'
import { Queue } from 'bullmq'
import { MEASURE_PREFLIGHT_QUEUE_NAME, PREVIEW_RENDER_QUEUE_NAME, EXPORT_QUEUE_NAME } from '~/lib/uploadQueues'

/** Global operational counts are restricted to the public deployment owner. */
export async function loader({ request }: LoaderFunctionArgs) {
  const expected = Buffer.from(process.env.PUBLIC_OPERATIONS_TOKEN || '')
  const supplied = Buffer.from((request.headers.get('Authorization') || '').replace(/^Bearer /, ''))
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response('Not found', { status: 404 })
  const redis = new Redis(publicRedisUrl(), { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 5000 })
  const queues = [MEASURE_PREFLIGHT_QUEUE_NAME, PREVIEW_RENDER_QUEUE_NAME, EXPORT_QUEUE_NAME].map(name => new Queue(name, { connection: redis }))
  try {
    const counts = await Promise.all(queues.map(queue => queue.getJobCounts('waiting', 'active', 'delayed', 'failed')))
    return json({ queues: Object.fromEntries(queues.map((queue, index) => [queue.name, counts[index]])) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return json({ status: 'unavailable' }, { status: 503 }) }
  finally { await Promise.allSettled(queues.map(queue => queue.close())); redis.disconnect() }
}
