import { Banner, Link } from '@shopify/polaris'
import { billingCapState } from '~/lib/billingPolicy'

export interface BillingBannerState { status: string; capUsd: number; usedUsd: number }

/** Parent and child loaders run concurrently. Billing's provider-reconciled
 * result wins over the parent's earlier DB snapshot, without another query. */
export function billingBannerForRender(parent: BillingBannerState | null, childData: unknown): BillingBannerState | null {
  const state = (childData as { billing?: Partial<BillingBannerState> } | null)?.billing
  if (!state || typeof state.status !== 'string' || typeof state.capUsd !== 'number' || !Number.isFinite(state.capUsd) || typeof state.usedUsd !== 'number' || !Number.isFinite(state.usedUsd)) return parent
  const billing = state as BillingBannerState
  return billing.status === 'active' && billingCapState(billing.capUsd, billing.usedUsd) === 'available' ? null : billing
}

/** Preserve the reconciled result after leaving Billing. Only the parent's
 * existing DB loader reruns; ordinary navigation adds no provider lookup. */
export function revalidateAfterBilling(currentPath: string, nextPath: string, defaultShouldRevalidate: boolean): boolean {
  return defaultShouldRevalidate || (currentPath.replace(/\/$/, '') === '/app/billing' && nextPath.replace(/\/$/, '') !== '/app/billing')
}

export function PaymentSetupBanner({ status, capUsd, usedUsd }: BillingBannerState) {
  return <Banner tone={status === 'active' ? 'warning' : 'info'} title={status === 'active' ? 'Review your Shopify billing limit' : 'Approve Shopify app billing'}>
    <p>{status === 'active' ? `US$${usedUsd.toFixed(2)} of your US$${capUsd.toFixed(2)} usage limit is recorded.` : 'Approve 3.5% per paid app-served order, capped at US$6 per order, to enable uploads.'} <Link url="/app/billing">Review billing</Link>.</p>
  </Banner>
}
