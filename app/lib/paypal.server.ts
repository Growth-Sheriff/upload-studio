/**
 * PayPal REST API v2 Integration
 *
 * Handles:
 * - OAuth token generation
 * - Order creation (for merchant commission payments)
 * - Order capture (after merchant approves)
 * - Webhook signature verification
 *
 * Mode: LIVE (production)
 * Docs: https://developer.paypal.com/docs/api/orders/v2/
 */

// ===== CONFIG =====
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_MODE = (process.env.PAYPAL_MODE || 'live') as 'sandbox' | 'live';

const PAYPAL_BASE_URL =
  PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

// ===== TYPES =====
export interface PayPalAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface PayPalOrderResponse {
  id: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

export interface PayPalCaptureResponse {
  id: string;
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED';
  purchase_units: Array<{
    reference_id: string;
    payments: {
      captures: Array<{
        id: string;
        status: string;
        amount: {
          currency_code: string;
          value: string;
        };
      }>;
    };
  }>;
  payer: {
    email_address: string;
    payer_id: string;
    name: {
      given_name: string;
      surname: string;
    };
  };
}

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource_type: string;
  resource: {
    id: string;
    status: string;
    purchase_units?: Array<{
      reference_id: string;
      payments?: {
        captures?: Array<{
          id: string;
          status: string;
          amount: {
            currency_code: string;
            value: string;
          };
        }>;
      };
    }>;
    payer?: {
      email_address: string;
      payer_id: string;
    };
    amount?: {
      currency_code: string;
      value: string;
    };
  };
  create_time: string;
  event_version: string;
}

// ===== TOKEN CACHE =====
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Get PayPal OAuth2 access token (cached)
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && tokenExpiresAt > now + 60_000) {
    return cachedToken;
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET env vars.');
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[PayPal] Token error:', response.status, errorText);
    throw new Error(`PayPal token request failed: ${response.status}`);
  }

  const data: PayPalAccessToken = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;

  console.log('[PayPal] Access token obtained, expires in', data.expires_in, 'seconds');
  return cachedToken;
}

/**
 * Create a PayPal order for commission payment
 *
 * @param amount - USD amount (e.g. "5.00")
 * @param shopDomain - Merchant shop domain (reference)
 * @param description - Payment description
 * @param orderIds - Comma-separated order IDs being paid
 * @returns PayPal order with approval URL
 */
export async function createPayPalOrder(
  amount: string,
  shopDomain: string,
  description: string,
  orderIds: string
): Promise<PayPalOrderResponse> {
  const accessToken = await getAccessToken();

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: shopDomain,
        description: description,
        custom_id: orderIds, // Store order IDs for webhook reference
        amount: {
          currency_code: 'USD',
          value: amount,
        },
      },
    ],
    application_context: {
      brand_name: process.env.APP_NAME || 'Upload Studio',
      landing_page: 'NO_PREFERENCE',
      user_action: 'PAY_NOW',
      return_url: `${process.env.SHOPIFY_APP_URL || 'https://localhost:3000'}/app/billing?paypal=success`,
      cancel_url: `${process.env.SHOPIFY_APP_URL || 'https://localhost:3000'}/app/billing?paypal=cancelled`,
    },
  };

  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[PayPal] Create order error:', response.status, errorText);
    throw new Error(`PayPal create order failed: ${response.status} - ${errorText}`);
  }

  const order: PayPalOrderResponse = await response.json();
  console.log('[PayPal] Order created:', order.id, 'status:', order.status);
  return order;
}

/**
 * Capture a PayPal order after merchant approval
 *
 * @param paypalOrderId - PayPal order ID from createPayPalOrder
 * @returns Capture response with transaction details
 */
export async function capturePayPalOrder(
  paypalOrderId: string
): Promise<PayPalCaptureResponse> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[PayPal] Capture error:', response.status, errorText);
    throw new Error(`PayPal capture failed: ${response.status} - ${errorText}`);
  }

  const capture: PayPalCaptureResponse = await response.json();
  console.log('[PayPal] Order captured:', capture.id, 'status:', capture.status);
  return capture;
}

/**
 * Verify PayPal webhook signature
 *
 * Uses PayPal's webhook signature verification API
 * Docs: https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature
 */
export async function verifyWebhookSignature(
  webhookId: string,
  headers: Record<string, string>,
  body: string
): Promise<boolean> {
  const accessToken = await getAccessToken();

  const verifyPayload = {
    auth_algo: headers['paypal-auth-algo'] || '',
    cert_url: headers['paypal-cert-url'] || '',
    transmission_id: headers['paypal-transmission-id'] || '',
    transmission_sig: headers['paypal-transmission-sig'] || '',
    transmission_time: headers['paypal-transmission-time'] || '',
    webhook_id: webhookId,
    webhook_event: JSON.parse(body),
  };

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(verifyPayload),
    }
  );

  if (!response.ok) {
    console.error('[PayPal] Webhook verify error:', response.status);
    return false;
  }

  const result = await response.json();
  const verified = result.verification_status === 'SUCCESS';

  if (!verified) {
    console.warn('[PayPal] Webhook signature verification FAILED:', result.verification_status);
  }

  return verified;
}

/**
 * Get PayPal order details
 */
export async function getPayPalOrder(
  paypalOrderId: string
): Promise<PayPalCaptureResponse> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${paypalOrderId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal get order failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Create a PayPal order WITH vault (save payment method for future auto-charges)
 *
 * On first payment, we include vault instructions so PayPal saves the payment method.
 * Future payments can then be charged automatically without merchant interaction.
 */
export async function createPayPalOrderWithVault(
  amount: string,
  shopDomain: string,
  description: string,
  customId: string
): Promise<PayPalOrderResponse> {
  const accessToken = await getAccessToken();

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: shopDomain,
        description: description,
        custom_id: customId,
        amount: {
          currency_code: 'USD',
          value: amount,
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: process.env.APP_NAME || 'Upload Studio',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          return_url: `${process.env.SHOPIFY_APP_URL || 'https://localhost:3000'}/app/billing?paypal=success`,
          cancel_url: `${process.env.SHOPIFY_APP_URL || 'https://localhost:3000'}/app/billing?paypal=cancelled`,
        },
        attributes: {
          vault: {
            store_in_vault: 'ON_SUCCESS',
            usage_type: 'MERCHANT',
            permit_multiple_payment_tokens: false,
          },
        },
      },
    },
  };

  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      'PayPal-Request-Id': `vault-${shopDomain}-${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[PayPal] Create vault order error:', response.status, errorText);
    throw new Error(`PayPal create vault order failed: ${response.status} - ${errorText}`);
  }

  const order: PayPalOrderResponse = await response.json();
  console.log('[PayPal] Vault order created:', order.id, 'status:', order.status);
  return order;
}

/**
 * Charge a vaulted (saved) payment method without buyer interaction
 *
 * This is used for automatic charges when commission threshold ($49.99) is reached.
 * The payment token was saved during the first manual payment.
 */
export async function chargeWithVault(
  vaultId: string,
  payerId: string,
  amount: string,
  shopDomain: string,
  description: string,
  customId: string
): Promise<PayPalCaptureResponse> {
  const accessToken = await getAccessToken();

  // Step 1: Create order with saved payment source
  const createPayload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: shopDomain,
        description: description,
        custom_id: customId,
        amount: {
          currency_code: 'USD',
          value: amount,
        },
      },
    ],
    payment_source: {
      paypal: {
        vault_id: vaultId,
        experience_context: {
          brand_name: process.env.APP_NAME || 'Upload Studio',
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          shipping_preference: 'NO_SHIPPING',
        },
      },
    },
  };

  const createResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      'PayPal-Request-Id': `auto-${shopDomain}-${Date.now()}`,
    },
    body: JSON.stringify(createPayload),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error('[PayPal] Vault charge create error:', createResponse.status, errorText);
    throw new Error(`PayPal vault charge create failed: ${createResponse.status} - ${errorText}`);
  }

  const order: PayPalOrderResponse = await createResponse.json();
  console.log('[PayPal] Vault order created for auto-charge:', order.id, 'status:', order.status);

  // Step 2: If order is COMPLETED (auto-captured with vault), we're done
  // With vault + IMMEDIATE_PAYMENT_REQUIRED, PayPal may auto-capture
  if (order.status === 'COMPLETED') {
    // Fetch full capture details
    return getPayPalOrder(order.id);
  }

  // Step 3: If not auto-captured, capture manually
  const captureResponse = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${order.id}/capture`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    }
  );

  if (!captureResponse.ok) {
    const errorText = await captureResponse.text();
    console.error('[PayPal] Vault charge capture error:', captureResponse.status, errorText);
    throw new Error(`PayPal vault charge capture failed: ${captureResponse.status} - ${errorText}`);
  }

  const capture: PayPalCaptureResponse = await captureResponse.json();
  console.log('[PayPal] Vault charge captured:', capture.id, 'status:', capture.status);
  return capture;
}

/**
 * Check if PayPal is configured
 */
export function isPayPalConfigured(): boolean {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

/**
 * Get PayPal mode (sandbox/live)
 */
export function getPayPalMode(): 'sandbox' | 'live' {
  return PAYPAL_MODE;
}
