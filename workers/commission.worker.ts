import { initBillingScheduler } from '../app/lib/billingScheduler.server'

// Public deployment owns one central scheduler; no per-tenant HTTP fanout,
// merchant card vault or implicit cron secret exists in this worker.
process.env.CRON_RUNNER = 'true'
initBillingScheduler()
