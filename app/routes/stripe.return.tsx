import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { isStripeConfigured } from '~/lib/stripe.server'
import { applySuccessfulStripeCheckout } from '~/lib/stripeCheckout.server'

type StripeReturnData =
  | {
      status: 'success'
      shopDomain: string
      amount: number
      markedCount: number
      alreadyProcessed: boolean
    }
  | {
      status: 'cancelled'
      shopDomain: string | null
    }
  | {
      status: 'error'
      message: string
      shopDomain: string | null
    }

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')

  if (url.searchParams.get('cancelled') === '1') {
    return json<StripeReturnData>({
      status: 'cancelled',
      shopDomain,
    })
  }

  if (!isStripeConfigured()) {
    return json<StripeReturnData>(
      {
        status: 'error',
        message: 'Stripe is not configured.',
        shopDomain,
      },
      { status: 500 }
    )
  }

  const sessionId = url.searchParams.get('session_id')
  if (!sessionId) {
    return json<StripeReturnData>(
      {
        status: 'error',
        message: 'Missing Stripe session ID.',
        shopDomain,
      },
      { status: 400 }
    )
  }

  try {
    const result = await applySuccessfulStripeCheckout(sessionId, 'return')

    return json<StripeReturnData>({
      status: 'success',
      shopDomain: result.shopDomain,
      amount: result.amount,
      markedCount: result.markedCount,
      alreadyProcessed: result.alreadyProcessed,
    })
  } catch (error) {
    console.error('[Stripe Return] Failed to finalize checkout:', error)

    return json<StripeReturnData>(
      {
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Stripe checkout could not be finalized.',
        shopDomain,
      },
      { status: 500 }
    )
  }
}

export default function StripeReturnPage() {
  const data = useLoaderData<typeof loader>()

  const title =
    data.status === 'success'
      ? 'Payment confirmed'
      : data.status === 'cancelled'
        ? 'Payment cancelled'
        : 'Payment could not be confirmed'

  const description =
    data.status === 'success'
      ? `Stripe payment processed for ${data.markedCount} invoice item(s). You can close this tab and return to Upload Studio.`
      : data.status === 'cancelled'
        ? 'No payment was captured. You can close this tab and return to Upload Studio.'
        : data.message

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f3f4f6',
          color: '#111827',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <main
          style={{
            width: '100%',
            maxWidth: 560,
            margin: 24,
            padding: 32,
            borderRadius: 16,
            background: '#ffffff',
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
          }}
        >
          <p
            style={{
              margin: '0 0 12px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color:
                data.status === 'success'
                  ? '#047857'
                  : data.status === 'cancelled'
                    ? '#b45309'
                    : '#b91c1c',
            }}
          >
            Stripe Checkout
          </p>
          <h1 style={{ margin: '0 0 12px', fontSize: 28 }}>{title}</h1>
          <p style={{ margin: '0 0 20px', lineHeight: 1.6 }}>{description}</p>

          {data.status === 'success' && (
            <div
              style={{
                marginBottom: 20,
                padding: 16,
                borderRadius: 12,
                background: '#ecfdf5',
                color: '#065f46',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                ${(data.amount / 100).toFixed(2)} confirmed
              </div>
              <div>{data.alreadyProcessed ? 'This checkout was already finalized.' : 'Your invoice has been recorded successfully.'}</div>
            </div>
          )}

          {data.shopDomain && (
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>
              Shop: {data.shopDomain}
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.close()}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '12px 18px',
                background: '#111827',
                color: '#ffffff',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Close tab
            </button>
            <a
              href="/app/billing"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 999,
                padding: '12px 18px',
                background: '#e5e7eb',
                color: '#111827',
                textDecoration: 'none',
                fontWeight: 700,
              }}
            >
              Open billing
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
