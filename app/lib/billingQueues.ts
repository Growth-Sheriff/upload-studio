export const BILLING_CRON_QUEUE_NAME = 'billing-cron';
export const BILLING_CRON_JOB_NAME = 'daily-fanout';
export const BILLING_CRON_REPEAT_PATTERN = process.env.BILLING_CRON_PATTERN || '0 3 * * *';

export const RETRY_BACKOFF_DAYS = [1, 3, 7] as const;
export const MAX_RETRY_ATTEMPTS = RETRY_BACKOFF_DAYS.length;
export const RETRYABLE_STRIPE_CODES = new Set([
  'processing_error',
  'rate_limit',
  'lock_timeout',
  'api_connection_error',
  'api_error',
]);
export const HARD_DECLINE_STRIPE_CODES = new Set([
  'card_declined',
  'insufficient_funds',
  'expired_card',
  'incorrect_cvc',
  'payment_method_not_available',
  'authentication_required',
]);
