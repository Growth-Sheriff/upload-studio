import { Banner, Link } from '@shopify/polaris'

export function PaymentSetupBanner({ status, capUsd, usedUsd }: { status: string; capUsd: number; usedUsd: number }) {
  return <Banner tone={status === 'active' ? 'warning' : 'info'} title={status === 'active' ? 'Review your Shopify billing limit' : 'Approve Shopify app billing'}>
    <p>{status === 'active' ? `US$${usedUsd.toFixed(2)} of your US$${capUsd.toFixed(2)} usage limit is recorded.` : 'Approve 3.5% per paid app-served order, capped at US$6 per order, to enable uploads.'} <Link url="/app/billing">Review billing</Link>.</p>
  </Banner>
}
