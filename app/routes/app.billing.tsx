import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import prisma from '~/lib/prisma.server'
import { isPayPalConfigured } from '~/lib/paypal.server'
import { isStripeConfigured } from '~/lib/stripe.server'
import { authenticate } from '~/shopify.server'
import { COMMISSION_PERCENT, getOutstandingFeeSelection } from '~/lib/billing.server'
import { BillingPageView, type BillingMonth, type BillingOrderRecord } from '~/components/BillingPageView'

const PAYPAL_EMAIL = process.env.PAYPAL_EMAIL || 'billing@techifyboost.com'

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || '',
        plan: 'commission',
        billingStatus: 'active',
        storageProvider: 'bunny',
        settings: {},
      },
    })
  }

  const firstLinkRows = await prisma.$queryRaw<Array<{ orderId: string; orderCreatedAt: Date }>>`
    select order_id as "orderId", min(created_at) as "orderCreatedAt"
    from orders_link
    where shop_id = ${shop.id}
    group by order_id
  `
  const orderDateMap = new Map(firstLinkRows.map((row) => [row.orderId, new Date(row.orderCreatedAt)]))

  const allCommissions = await prisma.commission.findMany({
    where: { shopId: shop.id },
    select: {
      orderId: true,
      orderNumber: true,
      commissionAmount: true,
      status: true,
      createdAt: true,
      paidAt: true,
      paymentRef: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const records: BillingOrderRecord[] = allCommissions
    .map((commission) => ({
      orderId: commission.orderId,
      orderNumber: commission.orderNumber || `#${commission.orderId.slice(-6)}`,
      commissionAmount: Number(commission.commissionAmount),
      status: commission.status,
      createdAt: (orderDateMap.get(commission.orderId) || commission.createdAt).toISOString(),
      paidAt: commission.paidAt?.toISOString() || null,
      paymentRef: commission.paymentRef || null,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const monthMap = new Map<string, BillingOrderRecord[]>()
  for (const record of records) {
    const date = new Date(record.createdAt)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, [])
    monthMap.get(monthKey)!.push(record)
  }

  const monthlyBreakdowns: BillingMonth[] = [...monthMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, orders]) => {
      const [year, month] = monthKey.split('-').map(Number)
      const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
      const pendingOrders = orders.filter((o) => o.status === 'pending')
      const paidOrders = orders.filter((o) => o.status === 'paid')
      const waivedOrders = orders.filter((o) => o.status === 'waived')
      return {
        monthKey,
        monthLabel,
        totalOrders: orders.length,
        pendingOrders: pendingOrders.length,
        paidOrders: paidOrders.length,
        waivedOrders: waivedOrders.length,
        totalAmount: orders.reduce((sum, o) => sum + o.commissionAmount, 0),
        pendingAmount: pendingOrders.reduce((sum, o) => sum + o.commissionAmount, 0),
        paidAmount: paidOrders.reduce((sum, o) => sum + o.commissionAmount, 0),
        waivedAmount: waivedOrders.reduce((sum, o) => sum + o.commissionAmount, 0),
        orders,
      }
    })

  const pending = records.filter((r) => r.status === 'pending')
  const paid = records.filter((r) => r.status === 'paid')
  const summary = {
    pendingAmount: pending.reduce((sum, r) => sum + r.commissionAmount, 0),
    pendingOrders: pending.length,
    paidAmount: paid.reduce((sum, r) => sum + r.commissionAmount, 0),
    paidOrders: paid.length,
    totalOrders: records.length,
  }

  const billingSettings = ((shop.settings as Record<string, any> | null) || {}).billing || ({} as Record<string, any>)
  const card = billingSettings.card as
    | { brand?: string | null; last4?: string | null; expMonth?: number | null; expYear?: number | null; funding?: string | null }
    | undefined

  return json({
    shopDomain,
    summary,
    records,
    monthlyBreakdowns,
    commissionPercent: COMMISSION_PERCENT,
    paypalEmail: PAYPAL_EMAIL,
    paypalEnabled: isPayPalConfigured(),
    autoChargeEnabled: shop.paypalAutoCharge,
    paypalVaulted: Boolean(shop.paypalVaultId),
    paypalPayerEmail: shop.paypalPayerEmail || null,
    autoChargeThreshold: 49.99,
    stripeEnabled: isStripeConfigured(),
    stripeAutoCharge: shop.stripeAutoCharge,
    stripeSaved: Boolean(shop.stripePaymentMethodId),
    stripeEmail: shop.stripeEmail || null,
    stripeCard:
      card && card.last4
        ? {
            brand: card.brand || null,
            last4: card.last4 || null,
            expMonth: card.expMonth || null,
            expYear: card.expYear || null,
            funding: card.funding || null,
          }
        : null,
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const formData = await request.formData()
  const actionType = formData.get('_action') as string

  if (actionType === 'toggle_auto_charge') {
    const enabled = formData.get('enabled') === 'true'
    const provider = (formData.get('provider') as string) || 'paypal'

    if (provider === 'stripe') {
      if (enabled && !shop.stripePaymentMethodId) {
        return json({ error: 'No saved card. Pay once with card first.' }, { status: 400 })
      }
      await prisma.shop.update({ where: { id: shop.id }, data: { stripeAutoCharge: enabled } })
    } else {
      if (enabled && !shop.paypalVaultId) {
        return json({ error: 'No saved PayPal account. Pay once with PayPal first.' }, { status: 400 })
      }
      await prisma.shop.update({ where: { id: shop.id }, data: { paypalAutoCharge: enabled } })
    }

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: enabled ? 'auto_charge_enabled' : 'auto_charge_disabled',
        resourceType: 'billing',
        resourceId: shop.id,
        metadata: { enabled, provider },
      },
    })

    return json({ success: true, message: `Auto-pay ${enabled ? 'enabled' : 'paused'}` })
  }

  if (actionType === 'mark_paid') {
    const paymentRef = formData.get('paymentRef') as string
    const orderIds = formData.get('orderIds') as string

    if (!paymentRef || !orderIds) {
      return json({ error: 'Payment reference and order IDs required' }, { status: 400 })
    }

    const ids = orderIds.split(',').filter(Boolean)
    const outstandingSelection = await getOutstandingFeeSelection(shop.id, ids)
    if (outstandingSelection.orderIds.length === 0) {
      return json({ error: 'No outstanding fees found for this payment' }, { status: 400 })
    }

    for (const orderId of outstandingSelection.orderIds) {
      const rate = outstandingSelection.feeByOrderId.get(orderId) || 0
      await prisma.commission.upsert({
        where: { commission_shop_order: { shopId: shop.id, orderId } },
        create: {
          shopId: shop.id,
          orderId,
          orderNumber: `#${orderId.slice(-6)}`,
          orderTotal: 0,
          orderCurrency: 'USD',
          commissionRate: 0,
          commissionAmount: rate,
          status: 'paid',
          paidAt: new Date(),
          paymentRef,
        },
        update: { status: 'paid', paidAt: new Date(), paymentRef },
      })
    }

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'commissions_marked_paid',
        resourceType: 'commission',
        resourceId: paymentRef,
        metadata: {
          orderIds: outstandingSelection.orderIds,
          paymentRef,
          count: outstandingSelection.orderIds.length,
          totalAmount: outstandingSelection.totalAmount,
        },
      },
    })

    return json({ success: true, message: `${outstandingSelection.orderIds.length} orders marked as paid` })
  }

  return json({ error: 'Unknown action' }, { status: 400 })
}

export default function BillingPage() {
  const data = useLoaderData<typeof loader>()
  return <BillingPageView {...data} />
}
