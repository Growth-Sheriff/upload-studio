import { Banner, Link as PolarisLink } from '@shopify/polaris';
import { useEffect, useState } from 'react';

export interface PaymentSetupBannerProps {
  pendingAmount: string;
  pendingOrderCount: number;
  hasOverdueRetry: boolean;
  retryNextAt?: string | null;
}

const DISMISS_KEY = 'us:billing-notice:dismissed';

// One quiet line about outstanding commission, dismissible for the session.
// It sits in the content column (never under the sidebar) and never talks
// about "features": there is one plan and nothing is gated.
export function PaymentSetupBanner({
  pendingAmount,
  pendingOrderCount,
  hasOverdueRetry,
  retryNextAt,
}: PaymentSetupBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(DISMISS_KEY) === '1') setDismissed(true);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };

  if (dismissed) return null;

  if (hasOverdueRetry) {
    const when = retryNextAt
      ? new Date(retryNextAt).toLocaleString('en-US', { dateStyle: 'medium' })
      : 'soon';
    return (
      <Banner tone="warning" title="Payment retry scheduled" onDismiss={dismiss}>
        <p>
          The last automatic payment failed; the next attempt is on <strong>{when}</strong>.{' '}
          <PolarisLink url="/app/billing">Update the payment method</PolarisLink> or pay manually.
        </p>
      </Banner>
    );
  }

  return (
    <Banner tone="info" title="Outstanding order fees" onDismiss={dismiss}>
      <p>
        <strong>${pendingAmount}</strong> across {pendingOrderCount}{' '}
        {pendingOrderCount === 1 ? 'order' : 'orders'} is waiting to be settled.{' '}
        <PolarisLink url="/app/billing">Add a payment method</PolarisLink> to settle it automatically.
      </p>
    </Banner>
  );
}
