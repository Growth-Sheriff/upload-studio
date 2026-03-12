/**
 * Stripe Server Library
 *
 * Handles Stripe Checkout Sessions, Payment Intents, webhook verification,
 * and saved payment method (auto-charge) flows for commission billing.
 *
 * Mirrors paypal.server.ts structure for consistency.
 */
import Stripe from 'stripe';

// ── Config ──
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.SHOPIFY_APP_URL || 'https://customizerapp.dev';

// ── Stripe Client (lazy singleton) ──
let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!stripeClient) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripeClient = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2026-02-25.clover',
      typescript: true,
    });
  }
  return stripeClient;
}

// ── Types ──
export interface StripeCheckoutResult {
  sessionId: string;
  checkoutUrl: string;
  amount: string;
  orderCount: number;
}

export interface StripeCaptureResult {
  paymentIntentId: string;
  status: string;
  amount: number;
  customerEmail: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
}

export interface StripeAutoChargeResult {
  paymentIntentId: string;
  status: string;
  amount: number;
}

// ── Public Functions ──

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return Boolean(STRIPE_SECRET_KEY);
}

/**
 * Create a Stripe Checkout Session for commission payment.
 * Uses `setup_future_usage: 'off_session'` on first payment to save the card
 * for future auto-charges (mirrors PayPal vault behavior).
 */
export async function createCheckoutSession(
  amount: string,
  shopDomain: string,
  description: string,
  referenceId: string,
  hasExistingPaymentMethod: boolean
): Promise<StripeCheckoutResult> {
  const stripe = getStripeClient();
  const amountCents = Math.round(parseFloat(amount) * 100);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: 'Upload Lift Commission',
            description,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${APP_URL}/app/billing?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/app/billing?stripe=cancelled`,
    metadata: {
      shopDomain,
      referenceId,
      type: 'commission_payment',
    },
    client_reference_id: referenceId,
  };

  // Save payment method on first payment for future auto-charges
  if (!hasExistingPaymentMethod) {
    sessionParams.payment_intent_data = {
      setup_future_usage: 'off_session',
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  return {
    sessionId: session.id,
    checkoutUrl: session.url,
    amount,
    orderCount: 0,
  };
}

/**
 * Retrieve a completed Checkout Session and extract payment details.
 * Called after merchant returns from Stripe Checkout.
 */
export async function retrieveCheckoutSession(
  sessionId: string
): Promise<StripeCaptureResult> {
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent', 'customer'],
  });

  if (session.payment_status !== 'paid') {
    throw new Error(`Payment not completed. Status: ${session.payment_status}`);
  }

  const paymentIntent = session.payment_intent as Stripe.PaymentIntent;
  const customer = session.customer as Stripe.Customer | null;

  return {
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    customerEmail: session.customer_details?.email || customer?.email || null,
    customerId: customer?.id || (typeof session.customer === 'string' ? session.customer : null),
    paymentMethodId: typeof paymentIntent.payment_method === 'string'
      ? paymentIntent.payment_method
      : paymentIntent.payment_method?.id || null,
  };
}

/**
 * Charge a saved payment method off-session (auto-charge).
 * Mirrors PayPal's chargeWithVault functionality.
 */
export async function chargeWithSavedMethod(
  customerId: string,
  paymentMethodId: string,
  amount: string,
  shopDomain: string,
  description: string
): Promise<StripeAutoChargeResult> {
  const stripe = getStripeClient();
  const amountCents = Math.round(parseFloat(amount) * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    payment_method: paymentMethodId,
    off_session: true,
    confirm: true,
    description,
    metadata: {
      shopDomain,
      type: 'auto_charge_commission',
    },
  });

  if (paymentIntent.status !== 'succeeded') {
    throw new Error(`Auto-charge failed. Status: ${paymentIntent.status}`);
  }

  return {
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
  };
}

/**
 * Verify Stripe webhook signature.
 * Returns the parsed event if valid, throws on invalid signature.
 */
export function verifyWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const stripe = getStripeClient();

  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  return stripe.webhooks.constructEvent(
    payload,
    signature,
    STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Create or get a Stripe Customer for a shop.
 * Used to link payment methods to the shop for future charges.
 */
export async function getOrCreateCustomer(
  shopDomain: string,
  email?: string | null
): Promise<string> {
  const stripe = getStripeClient();

  // Search for existing customer by metadata
  const existing = await stripe.customers.list({
    limit: 1,
    email: email || undefined,
  });

  if (existing.data.length > 0) {
    // Verify it's the right shop
    const customer = existing.data.find(
      (c) => c.metadata?.shopDomain === shopDomain
    );
    if (customer) return customer.id;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { shopDomain },
    description: `Upload Lift merchant: ${shopDomain}`,
  });

  return customer.id;
}
