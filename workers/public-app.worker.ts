import { publicRedisUrl } from '../app/lib/publicRedis.server'

/** Independent public deployment only. Each process runs one explicit role;
 * no import of the tenant bootstrap/shell scripts and no implicit all-worker
 * start. Container memory limits therefore isolate image work from the web. */
async function main() {
  if (process.env.PUBLIC_APP_RUNTIME !== 'true') throw new Error('Public workers require PUBLIC_APP_RUNTIME=true')
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('Public workers require dedicated database and Redis URLs')
  publicRedisUrl()
  const role = process.env.PUBLIC_WORKER_ROLE
  if (role === 'measure') await import('./measure-preflight.worker')
  else if (role === 'preview') await import('./preview-render.worker')
  else if (role === 'export') {
    const worker = (await import('./export.worker')).createExportWorker()
    const close = () => { void worker.close().finally(() => process.exit(0)) }
    process.once('SIGTERM', close); process.once('SIGINT', close)
  } else if (role === 'billing') (await import('../app/lib/billingScheduler.server')).initBillingScheduler()
  else if (role === 'privacy') {
    const { runComplianceBatch, runRetentionBatch } = await import('../app/lib/compliance.server')
    let running = false
    let nextRetention = 0
    const tick = async () => {
      if (running) return
      running = true
      try {
        await runComplianceBatch()
        if (Date.now() >= nextRetention) { await runRetentionBatch(); nextRetention = Date.now() + 3600_000 }
      }
      catch (error) { console.error('[PublicPrivacyWorker]', error) }
      finally { running = false }
    }
    void tick()
    setInterval(() => void tick(), 5_000)
  } else if (role === 'flow') await import('./flow.worker')
  else throw new Error('PUBLIC_WORKER_ROLE must be measure, preview, export, billing, privacy or flow')
  console.log(`[PublicWorker] ${role} started`)
}

void main().catch(error => { console.error('[PublicWorker] Startup failed', error); process.exitCode = 1 })
