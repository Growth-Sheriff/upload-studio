import prisma from '~/lib/prisma.server'
import { BILLING_CAP_TIERS, BILLING_TERMS } from '~/lib/billing.server'
import { requireMerchantLegalAgreement } from '~/lib/publicLegal.server'

export interface BillingAdmin { graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> }
export class ShopifyBillingUserError extends Error {
  constructor(public messages: string[]) { super(messages.join('; ')); this.name = 'ShopifyBillingUserError' }
}
async function graphql(admin: BillingAdmin, query: string, variables?: Record<string, unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await admin.graphql(query, { variables })
        const payload = await response.json()
        if (!response.ok || payload.errors?.length) throw new Error(`Shopify billing API request failed: ${payload.errors?.map((error: any) => error.message).join('; ') || response.status}`)
        return payload.data
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Shopify billing response deadline exceeded; outcome unknown')), 30000) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}
function requireNoUserErrors(payload: any) {
  if (!payload) throw new Error('Shopify billing API returned no payload')
  if (payload.userErrors?.length) throw new ShopifyBillingUserError(payload.userErrors.map((error: any) => error.message))
}

/** Only provider-confirmed subscriptions/limits unlock billing and uploads. */
export async function syncShopifyBilling(shopId: string, admin: BillingAdmin) {
  const data = await graphql(admin, `query PublicBillingStatus {
    currentAppInstallation { activeSubscriptions {
      id status test currentPeriodEnd
      lineItems { id plan { pricingDetails { __typename ... on AppUsagePricing { cappedAmount { amount currencyCode } balanceUsed { amount currencyCode } } } } }
    } }
  }`)
  const usable = (data.currentAppInstallation?.activeSubscriptions || []).flatMap((subscription: any) =>
    subscription.status === 'ACTIVE' ? subscription.lineItems.filter((line: any) => line.plan.pricingDetails.__typename === 'AppUsagePricing').map((line: any) => ({ subscription, line })) : [])
  const previous = await prisma.shopBilling.findUnique({ where: { shopId } })
  if (usable.length !== 1 || usable[0].line.plan.pricingDetails.cappedAmount.currencyCode !== 'USD') {
    const status = usable.length ? 'review_required' : previous?.status === 'pending' ? 'pending' : 'inactive'
    return prisma.$transaction(async tx => {
      const owner = await tx.shop.updateMany({ where: { id: shopId, erasureStartedAt: null, uninstalledAt: null, billingStatus: { notIn: ['erasing', 'uninstalled'] } }, data: { billingStatus: 'inactive' } })
      if (!owner.count) throw new Error('Shop uninstalled or erasing; billing cannot reactivate it')
      return tx.shopBilling.upsert({ where: { shopId }, create: { shopId, status }, update: { status, syncedAt: new Date() } })
    })
  }
  const { subscription, line } = usable[0]
  const pricing = line.plan.pricingDetails
  const cap = Number(pricing.cappedAmount.amount)
  const approvalSatisfied = previous?.pendingCapUsd != null && cap >= Number(previous.pendingCapUsd)
  const approved = {
    subscriptionId: subscription.id, usageLineItemId: line.id, status: 'active',
    cappedAmountUsd: cap, balanceUsedUsd: Number(pricing.balanceUsed.amount),
    currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
    test: Boolean(subscription.test), syncedAt: new Date(),
    ...(!previous?.pendingCapUsd || approvalSatisfied ? { pendingApprovalUrl: null, pendingCapUsd: null } : {}),
  }
  return prisma.$transaction(async tx => {
    // Provider lookup is awaited above; uninstall/redaction may have arrived
    // meanwhile. Lock/check the immutable erasure marker before persisting.
    const owner = await tx.shop.updateMany({ where: { id: shopId, erasureStartedAt: null, uninstalledAt: null, billingStatus: { notIn: ['erasing', 'uninstalled'] } }, data: { billingStatus: 'active' } })
    if (!owner.count) throw new Error('Shop uninstalled or erasing; billing cannot reactivate it')
    return tx.shopBilling.upsert({ where: { shopId }, create: { shopId, ...approved }, update: approved })
  })
}

export async function requestShopifyBillingApproval(shopId: string, admin: BillingAdmin, capUsd: number, returnUrl: string): Promise<string> {
  if (!(BILLING_CAP_TIERS as readonly number[]).includes(capUsd)) throw new Error('Choose a displayed Shopify billing limit')
  await requireMerchantLegalAgreement(shopId)
  const state = await syncShopifyBilling(shopId, admin)
  let payload: any
  if (state.status === 'active' && state.usageLineItemId) {
    if (capUsd <= Number(state.cappedAmountUsd)) throw new Error('The new limit must exceed the approved limit')
    const data = await graphql(admin, `mutation PublicUsageCap($id: ID!, $cap: MoneyInput!) {
      appSubscriptionLineItemUpdate(id: $id, cappedAmount: $cap) { confirmationUrl userErrors { message } }
    }`, { id: state.usageLineItemId, cap: { amount: capUsd, currencyCode: 'USD' } })
    payload = data.appSubscriptionLineItemUpdate
  } else {
    const shopData = await graphql(admin, 'query PublicBillingShop { shop { plan { partnerDevelopment } } }')
    const data = await graphql(admin, `mutation PublicUsageSubscription($name: String!, $returnUrl: URL!, $items: [AppSubscriptionLineItemInput!]!, $test: Boolean!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $items, test: $test, trialDays: 0) {
        appSubscription { id } confirmationUrl userErrors { message }
      }
    }`, {
      name: 'Auto Gang Sheet Upload — 3.5%, max US$6/order', returnUrl,
      test: Boolean(shopData.shop?.plan?.partnerDevelopment),
      items: [{ plan: { appUsagePricingDetails: { terms: BILLING_TERMS, cappedAmount: { amount: capUsd, currencyCode: 'USD' } } } }],
    })
    payload = data.appSubscriptionCreate
  }
  requireNoUserErrors(payload)
  if (!payload.confirmationUrl) throw new Error('Shopify did not return a billing confirmation URL')
  // A URL is a request for consent, not consent. Effective cap is untouched.
  await prisma.shopBilling.update({ where: { shopId }, data: {
    pendingApprovalUrl: payload.confirmationUrl, pendingCapUsd: capUsd,
    ...(state.status === 'active' ? {} : { status: 'pending' }),
  } })
  await prisma.auditLog.create({ data: { shopId, action: 'shopify_billing_approval_requested', resourceType: 'billing', resourceId: shopId, metadata: { capUsd, existingCapUsd: Number(state.cappedAmountUsd) } } })
  return payload.confirmationUrl
}

export async function createShopifyUsageRecord(admin: BillingAdmin, input: { lineItemId: string; amountUsd: number; orderId: string; orderNumber?: string | null; idempotencyKey: string }): Promise<string> {
  const data = await graphql(admin, `mutation PublicOrderUsage($line: ID!, $price: MoneyInput!, $description: String!, $key: String!) {
    appUsageRecordCreate(subscriptionLineItemId: $line, price: $price, description: $description, idempotencyKey: $key) {
      appUsageRecord { id } userErrors { message }
    }
  }`, {
    line: input.lineItemId, price: { amount: input.amountUsd.toFixed(2), currencyCode: 'USD' },
    description: `Order ${input.orderNumber || input.orderId}: 3.5% of app-served captured lines, max US$6 (order ${input.orderId})`, key: input.idempotencyKey,
  })
  const payload = data.appUsageRecordCreate
  requireNoUserErrors(payload)
  if (!payload.appUsageRecord?.id) throw new Error('Shopify usage result missing record ID; outcome unknown')
  return payload.appUsageRecord.id
}

/** Reconciliation never creates usage. A terminal order with a lost response
 * may only settle a record proven to exist on the original subscription line. */
export async function findShopifyUsageRecord(admin: BillingAdmin, input: { subscriptionId: string; lineItemId: string; key: string; amountUsd: number; requestStartedAt: Date }): Promise<string | null> {
  let cursor: string | null = null
  for (let page = 0; page < 5; page++) {
    const data = await graphql(admin, `query PublicUsageLookup($subscription: ID!, $after: String) {
      node(id: $subscription) { ... on AppSubscription {
        lineItems { id usageRecords(first: 100, after: $after, reverse: true) {
          nodes { id idempotencyKey createdAt price { amount currencyCode } }
          pageInfo { hasNextPage endCursor }
        } }
      } }
    }`, { subscription: input.subscriptionId, after: cursor })
    const records = data.node?.lineItems?.find((line: any) => line.id === input.lineItemId)?.usageRecords
    if (!records) throw new Error('Original Shopify subscription line unavailable; usage outcome remains unknown')
    const match = records.nodes.find((record: any) => record.idempotencyKey === input.key)
    if (match) {
      if (match.price.currencyCode !== 'USD' || Math.round(Number(match.price.amount) * 100) !== Math.round(input.amountUsd * 100)) throw new Error('Provider usage amount differs from frozen claim; manual review required')
      return match.id
    }
    if (!records.pageInfo.hasNextPage || records.nodes.some((record: any) => new Date(record.createdAt).getTime() < input.requestStartedAt.getTime() - 5 * 60000)) return null
    cursor = records.pageInfo.endCursor
  }
  throw new Error('Usage lookup exceeded bounded pages; outcome remains quarantined')
}
