import prisma from '~/lib/prisma.server'
import { calculatePendingCommissions } from '~/lib/billing.server'
import { getOrCreateCustomer, retrieveCheckoutSession } from '~/lib/stripe.server'

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

  const ensuredCustomerId = customerId || (await getOrCreateCustomer(shopDomain, customerEmail))

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
  const orderIds = extractOrderIds(auditLog?.metadata)

  if (orderIds.length === 0) {
    throw new Error(`Could not resolve invoice order IDs for Stripe checkout ${sessionId}.`)
  }

  await saveStripePaymentMethod(
    shop.id,
    shopDomain,
    checkout.customerId,
    checkout.customerEmail,
    checkout.paymentMethodId
  )

  const existingProcessedCommissions = await prisma.commission.findMany({
    where: {
      shopId: shop.id,
      paymentRef: checkout.paymentIntentId,
      orderId: { in: orderIds },
    },
    select: { orderId: true },
  })
  const existingProcessedOrderIds = new Set(
    existingProcessedCommissions.map((commission) => commission.orderId)
  )

  if (existingProcessedOrderIds.size === orderIds.length) {
    return {
      shopDomain,
      paymentIntentId: checkout.paymentIntentId,
      amount: checkout.amount,
      markedCount: existingProcessedOrderIds.size,
      orderIds,
      alreadyProcessed: true,
    }
  }

  const { orderRates } = await calculatePendingCommissions(shop.id, orderIds)
  let markedCount = 0
  const paidAt = new Date()

  for (const orderId of orderIds) {
    const rate = orderRates.get(orderId) || 0.1

    await prisma.commission.upsert({
      where: {
        commission_shop_order: {
          shopId: shop.id,
          orderId,
        },
      },
      create: {
        shopId: shop.id,
        orderId,
        orderNumber: `#${orderId.slice(-6)}`,
        orderTotal: 0,
        orderCurrency: 'USD',
        commissionRate: 0,
        commissionAmount: rate,
        status: 'paid',
        paidAt,
        paymentRef: checkout.paymentIntentId,
        paymentProvider: 'stripe',
      },
      update: {
        status: 'paid',
        paidAt,
        paymentRef: checkout.paymentIntentId,
        paymentProvider: 'stripe',
      },
    })

    markedCount += 1
  }

  await prisma.auditLog.create({
    data: {
      shopId: shop.id,
      action: source === 'webhook' ? 'stripe_webhook_checkout_completed' : 'stripe_payment_captured',
      resourceType: source === 'webhook' ? 'stripe_webhook' : 'stripe_payment',
      resourceId: checkout.paymentIntentId,
      metadata: {
        source,
        sessionId,
        eventId: eventId || null,
        paymentIntentId: checkout.paymentIntentId,
        amount: checkout.amount,
        customerEmail: checkout.customerEmail,
        customerId: checkout.customerId,
        referenceId: checkout.referenceId,
        markedCount,
        orderIds,
      },
    },
  })

  return {
    shopDomain,
    paymentIntentId: checkout.paymentIntentId,
    amount: checkout.amount,
    markedCount,
    orderIds,
    alreadyProcessed: false,
  }
}
