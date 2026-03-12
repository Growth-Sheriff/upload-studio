/**
 * Commission Auto-Charge Worker
 *
 * Runs every 6 hours, checks all shops with vaulted PayPal payment methods.
 * If pending commission >= $49.99, charges automatically via PayPal Vault API.
 *
 * Usage:
 *   npx tsx workers/commission.worker.ts
 *
 * Systemd service: upload-studio-commission.service
 */

const CRON_SECRET = process.env.CRON_SECRET || 'upload-studio-cron-secret';
const APP_URL = process.env.APP_URL || process.env.SHOPIFY_APP_URL!;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let isShuttingDown = false;

async function runAutoCharge(): Promise<void> {
  const startTime = Date.now();
  console.log(`[CommissionWorker] Running auto-charge check at ${new Date().toISOString()}`);

  try {
    const response = await fetch(`${APP_URL}/api/paypal/auto-charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CommissionWorker] API error: ${response.status} - ${errorText}`);
      return;
    }

    const result = await response.json();
    const elapsed = Date.now() - startTime;

    console.log(
      `[CommissionWorker] Complete in ${elapsed}ms: ${result.charged}/${result.total} shops charged`
    );

    if (result.results) {
      for (const r of result.results) {
        if (r.status === 'charged') {
          console.log(`  ✅ ${r.shop}: $${r.amount} charged`);
        } else if (r.status === 'error') {
          console.log(`  ❌ ${r.shop}: ${r.error}`);
        } else {
          console.log(`  ⏳ ${r.shop}: $${r.amount} (below threshold)`);
        }
      }
    }
  } catch (error) {
    console.error(
      `[CommissionWorker] Error:`,
      error instanceof Error ? error.message : error
    );
  }
}

async function main(): Promise<void> {
  console.log('[CommissionWorker] Starting commission auto-charge worker');
  console.log(`[CommissionWorker] Check interval: ${CHECK_INTERVAL_MS / 1000 / 60 / 60}h`);
  console.log(`[CommissionWorker] App URL: ${APP_URL}`);
  console.log(`[CommissionWorker] Threshold: $49.99`);

  // Run immediately on startup
  await runAutoCharge();

  // Then run every 6 hours
  const interval = setInterval(async () => {
    if (isShuttingDown) return;
    await runAutoCharge();
  }, CHECK_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('[CommissionWorker] Shutting down gracefully...');
    clearInterval(interval);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('[CommissionWorker] Worker running. Waiting for next cycle...');
}

main().catch((err) => {
  console.error('[CommissionWorker] Fatal error:', err);
  process.exit(1);
});
