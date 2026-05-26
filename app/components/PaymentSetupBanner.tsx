import { Banner, Link as PolarisLink } from '@shopify/polaris';

export interface PaymentSetupBannerProps {
  pendingAmount: string;
  pendingOrderCount: number;
  hasOverdueRetry: boolean;
  retryNextAt?: string | null;
}

export function PaymentSetupBanner({
  pendingAmount,
  pendingOrderCount,
  hasOverdueRetry,
  retryNextAt,
}: PaymentSetupBannerProps) {
  if (hasOverdueRetry) {
    const when = retryNextAt
      ? new Date(retryNextAt).toLocaleString('en-US', { dateStyle: 'medium' })
      : 'soon';
    return (
      <Banner tone="warning" title="Payment retry scheduled">
        <p>
          Your last payment attempt failed and a retry is scheduled for{' '}
          <strong>{when}</strong>. To avoid service interruption, please{' '}
          <PolarisLink url="/app/billing">update your payment method</PolarisLink> or pay manually.
        </p>
      </Banner>
    );
  }

  return (
    <Banner tone="critical" title="Payment method required">
      <p>
        You have <strong>${pendingAmount}</strong> in outstanding fees across{' '}
        {pendingOrderCount} {pendingOrderCount === 1 ? 'order' : 'orders'}. To enable automatic
        billing and continue using all features, please{' '}
        <PolarisLink url="/app/billing">save a payment method</PolarisLink>.
      </p>
    </Banner>
  );
}
