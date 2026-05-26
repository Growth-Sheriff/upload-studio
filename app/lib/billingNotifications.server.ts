import { sendEmail } from '~/lib/email.server';
import { resolveAppUrlForShop } from '~/lib/stripe.server';

const APP_NAME = process.env.APP_NAME || 'Upload Studio';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@uploadstudio.app';

export interface ChargeFailurePayload {
  shopDomain: string;
  to: string;
  amount: string;
  attemptNumber: number;
  maxAttempts: number;
  nextRetryAt?: Date | null;
  reason: string;
  willDisableVault: boolean;
}

function billingUrl(shopDomain: string): string {
  const base = resolveAppUrlForShop(shopDomain);
  return `${base}/app/billing`;
}

export async function sendChargeRetryEmail(p: ChargeFailurePayload) {
  if (!p.to) return { success: false, error: 'no_recipient' };

  const retryDate = p.nextRetryAt
    ? p.nextRetryAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : 'soon';

  const html = `
    <p>Hi,</p>
    <p>We tried to charge your saved card on file <strong>$${p.amount}</strong> for outstanding ${APP_NAME} order fees on <strong>${p.shopDomain}</strong>, but the charge did not succeed.</p>
    <p><strong>Reason:</strong> ${escapeHtml(p.reason)}</p>
    <p>We will automatically retry on <strong>${escapeHtml(retryDate)}</strong> (attempt ${p.attemptNumber + 1} of ${p.maxAttempts}). No action is required if this was a temporary issue.</p>
    <p>You can also pay manually or update your card here: <a href="${billingUrl(p.shopDomain)}">${billingUrl(p.shopDomain)}</a></p>
    <p>If you have questions, reply to this email or contact ${SUPPORT_EMAIL}.</p>
    <p>— ${APP_NAME}</p>
  `;
  return sendEmail({
    to: p.to,
    subject: `[${APP_NAME}] Payment retry scheduled for ${p.shopDomain}`,
    html,
  });
}

export async function sendChargeFinalFailureEmail(p: ChargeFailurePayload) {
  if (!p.to) return { success: false, error: 'no_recipient' };

  const html = `
    <p>Hi,</p>
    <p>We were unable to charge your saved payment method <strong>$${p.amount}</strong> for outstanding ${APP_NAME} order fees on <strong>${p.shopDomain}</strong> after ${p.maxAttempts} attempts.</p>
    <p><strong>Last reason:</strong> ${escapeHtml(p.reason)}</p>
    <p>Auto-charge has been temporarily disabled. To resume billing and avoid service disruption, please update your payment method:</p>
    <p><a href="${billingUrl(p.shopDomain)}" style="display:inline-block;padding:10px 18px;background:#5c6ac4;color:#fff;text-decoration:none;border-radius:4px">Update payment method</a></p>
    <p>If you have questions, reply to this email or contact ${SUPPORT_EMAIL}.</p>
    <p>— ${APP_NAME}</p>
  `;
  return sendEmail({
    to: p.to,
    subject: `[${APP_NAME}] Action required: update your payment method for ${p.shopDomain}`,
    html,
  });
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
