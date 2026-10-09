// Installed in the public image under /app/app/operations; not an HTTP route.
// Records only owner-verified Shopify history. It cannot issue a credit/refund.
class OperatorInputError extends Error {}
let disconnect: (() => Promise<void>) | undefined

async function main() {
  if (process.argv.slice(2).join(' ') !== '--record-provider-result') throw new OperatorInputError('Use --record-provider-result and one JSON object on stdin')
  if (process.env.PUBLIC_APP_RUNTIME !== 'true' || process.env.PUBLIC_BILLING_ALLOWED_DROPLET !== '607746803' ||
      process.env.SHOPIFY_API_KEY !== '8822c01b1f0be2280240cfab7d4e9a79' ||
      process.env.SHOPIFY_APP_URL !== 'https://auto-gang-sheet.actualscope.com') throw new OperatorInputError('Independent public app target acknowledgement is required')
  const target = new URL(process.env.DATABASE_URL || '')
  if (target.username !== 'agsu_app' || target.hostname !== 'private-agsu-public-pg-do-user-33221790-0.a.db.ondigitalocean.com' || target.pathname !== '/public_app' || target.searchParams.get('schema') !== 'public' || target.searchParams.get('sslmode') !== 'require' || target.searchParams.get('sslaccept') !== 'strict') throw new OperatorInputError('Wrong database target; no write attempted')
  const host = await fetch('http://169.254.169.254/metadata/v1/id', { signal: AbortSignal.timeout(3000) })
  if (!host.ok || (await host.text()).trim() !== '607746803') throw new OperatorInputError('Wrong host; no write attempted')
  let payload = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    payload += chunk.toString('utf8')
    if (Buffer.byteLength(payload, 'utf8') > 16384) throw new OperatorInputError('Input exceeds 16KiB')
  }
  let input: unknown
  try { input = JSON.parse(payload) } catch { throw new OperatorInputError('Stdin must contain one JSON object') }
  const { recordManualBillingAdjustment } = await import('../lib/billingAdjustment.server')
  const { default: prisma } = await import('../lib/prisma.server')
  disconnect = () => prisma.$disconnect()
  const result = await recordManualBillingAdjustment(input)
  console.log(JSON.stringify(result))
}

main().catch(error => {
  console.error(error instanceof OperatorInputError || error?.name === 'BillingAdjustmentError' ? error.message : 'Adjustment was not confirmed locally. Inspect the exact review/audit before retrying; no provider operation was sent by this tool.')
  process.exitCode = 1
}).finally(async () => {
  await disconnect?.()
})
