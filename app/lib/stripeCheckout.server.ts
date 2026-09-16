import prisma from '~/lib/prisma.server'
import {
  parseHostedCheckoutReservation,
  settleHostedCheckoutReservation,
} from '~/lib/hostedCheckoutReservation.server'
import {
  getOrCreateCustomer,
  getStripeClient,
  retrieveCheckoutSession,
} from '~/lib/stripe.server'

type StripeCheckoutSource = 'confirm' | 'return' | 'webhook'

interface StripeCheckoutProcessingResult {
  shopDomain: string
  paymentIntentId: string
  amount: number
  markedCount: number
  orderIds: string[]
  alreadyProcessed: boolean
}

function extractOrderIds(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || !('orderIds' in metadata)) {
    return []
  }

  const rawOrderIds = (metadata as { orderIds?: unknown }).orderIds
  if (!Array.isArray(rawOrderIds)) {
    return []
  }

  return rawOrderIds
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
}

async function findCheckoutAuditLog(shopId: string, sessionId: string, referenceId?: string | null) {
  if (referenceId) {
    const auditLog = await prisma.auditLog.findUnique({
      where: { id: referenceId },
    })

    if (auditLog && auditLog.shopId === shopId) {
      return auditLog
    }
  }

  return prisma.auditLog.findFirst({
    where: {
      shopId,
      action: 'stripe_checkout_created',
      resourceId: sessionId,
    },
    orderBy: { createdAt: 'desc' },
  })
}

async function saveStripePaymentMethod(
  shopId: string,
  shopDomain: string,
  customerId: string | null,
  customerEmail: string | null,
  paymentMethodId: string | null
) {
  if (!paymentMethodId) return

  let ensuredCustomerId = customerId || (await getOrCreateCustomer(shopDomain, customerEmail))

  // Fetch card brand/last4/exp from Stripe so billing UI can display it inline
  let cardSnapshot: {
    brand: string | null
    last4: string | null
    expMonth: number | null
    expYear: number | null
    funding: string | null
    capturedAt: string
  } | null = null

  // Only a card attached to a Stripe customer can be charged off-session later.
  // A card from a one-off payment (no setup_future_usage, e.g. a shop that
  // already had a saved card paying again) is not reusable: saving it would
  // replace the good saved card and break auto-pay, as happened to alpha on
  // 2026-09-04. In that case the existing saved card is kept untouched.
  let reusable = false
  try {
    const stripe = getStripeClient()
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId)

    const pmCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id || null
    if (pmCustomer) {
      // The session attached the card to a customer; follow that customer.
      ensuredCustomerId = pmCustomer
      reusable = true
    } else {
      try {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: ensuredCustomerId })
        reusable = true
      } catch (attachErr) {
        console.warn(
          `[stripeCheckout] ${shopDomain}: payment card ${paymentMethodId} is single-use; keeping the saved card`,
          attachErr instanceof Error ? attachErr.message : attachErr
        )
      }
    }

    if (reusable) {
      try {
        await stripe.customers.update(ensuredCustomerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        })
      } catch (defaultErr) {
        console.warn('[stripeCheckout] default payment method update failed:', defaultErr)
      }

      const card = pm.card
      if (card) {
        cardSnapshot = {
          brand: card.brand || null,
          last4: card.last4 || null,
          expMonth: card.exp_month ?? null,
          expYear: card.exp_year ?? null,
          funding: card.funding || null,
          capturedAt: new Date().toISOString(),
        }
      }
    }
  } catch (cardErr) {
    console.warn('[stripeCheckout] Failed to retrieve payment card; keeping the saved card:', cardErr)
  }

  if (!reusable) return

  await prisma.shop.update({
    where: { id: shopId },
    data: {
      stripeCustomerId: ensuredCustomerId,
      stripePaymentMethodId: paymentMethodId,
      stripeAutoCharge: true,
      stripeEmail: customerEmail,
      stripeSetupAt: new Date(),
    },
  })

  if (cardSnapshot) {
    const cardJson = JSON.stringify(cardSnapshot)
    await prisma.$executeRaw`
      update shops
      set settings_json = jsonb_set(
        coalesce(settings_json, '{}'::jsonb),
        '{billing}',
        coalesce(coalesce(settings_json, '{}'::jsonb)->'billing', '{}'::jsonb)
          || jsonb_build_object('card', ${cardJson}::jsonb),
        true
      ), updated_at = now()
      where id = ${shopId}`
  }
}

export async function applySuccessfulStripeCheckout(
  sessionId: string,
  source: StripeCheckoutSource,
  eventId?: string
): Promise<StripeCheckoutProcessingResult> {
  const checkout = await retrieveCheckoutSession(sessionId)
  const shopDomain = String(checkout.shopDomain || '').trim()

  if (!shopDomain) {
    throw new Error('Stripe checkout session is missing shopDomain metadata.')
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    throw new Error(`Shop not found for Stripe checkout: ${shopDomain}`)
  }

  const auditLog = await findCheckoutAuditLog(shop.id, sessionId, checkout.referenceId)
  const snapshot = parseHostedCheckoutReservation(auditLog?.metadata)
  if (
    !snapshot ||
    !auditLog ||
    snapshot.reservationRef !== auditLog.id ||
    checkout.referenceId !== snapshot.reservationRef
  ) {
    const legacyOrderIds = extractOrderIds(auditLog?.metadata)
    throw new Error(
      legacyOrderIds.length > 0
        ? `Stripe checkout ${sessionId} predates atomic fee reservations and requires reconciliation before its rows can be changed.`
        : `Could not resolve the reserved invoice rows for Stripe checkout ${sessionId}.`
    )
  }

  const settlement = await settleHostedCheckoutReservation({
    shopId: shop.id,
    snapshot,
    provider: 'stripe',
    captureRef: checkout.paymentIntentId,
    providerSessionId: sessionId,
    providerAmountCents: checkout.amount,
    providerCurrency: checkout.currency,
    source,
    eventId: eventId || null,
    extraMetadata: {
      paymentIntentId: checkout.paymentIntentId,
      customerEmail: checkout.customerEmail,
      customerId: checkout.customerId,
      referenceId: checkout.referenceId,
    },
  })

  // Saving the reusable card is deliberately after exact amount/currency and
  // reservation verification. A forged or mismatched session cannot replace
  // the merchant's known-good payment method.
  await saveStripePaymentMethod(
    shop.id,
    shopDomain,
    checkout.customerId,
    checkout.customerEmail,
    checkout.paymentMethodId
  )

  return {
    shopDomain,
    paymentIntentId: checkout.paymentIntentId,
    amount: checkout.amount,
    markedCount: settlement.markedCount,
    orderIds: snapshot.orderIds,
    alreadyProcessed: settlement.alreadyProcessed,
  }
}
