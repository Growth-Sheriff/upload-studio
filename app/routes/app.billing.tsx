import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Form, useLoaderData, useNavigation } from '@remix-run/react'
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  DataTable,
  Divider,
  EmptyState,
  InlineStack,
  Layout,
  Modal,
  Page,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris'
import { useCallback, useEffect, useState } from 'react'
import prisma from '~/lib/prisma.server'
import { isPayPalConfigured } from '~/lib/paypal.server'
import { isStripeConfigured } from '~/lib/stripe.server'
import { authenticate } from '~/shopify.server'
import { COMMISSION_PERCENT, getOutstandingFeeSelection } from '~/lib/billing.server'

const PAYPAL_EMAIL = process.env.PAYPAL_EMAIL || 'billing@techifyboost.com'

interface CommissionSummary {
  recordedAmount: number
  pendingAmount: number
  paidAmount: number
  waivedAmount: number
  totalOrders: number
  pendingOrders: number
  paidOrders: number
  waivedOrders: number
}

interface OrderRecord {
  orderId: string
  orderNumber: string | null
  commissionAmount: number
  status: string
  createdAt: string
  paidAt: string | null
  paymentRef: string | null
}

interface MonthlyBreakdown {
  monthKey: string
  monthLabel: string
  totalOrders: number
  pendingOrders: number
  paidOrders: number
  waivedOrders: number
  totalAmount: number
  pendingAmount: number
  paidAmount: number
  waivedAmount: number
  orders: OrderRecord[]
}

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
  const orderDateMap = new Map(
    firstLinkRows.map((row) => [row.orderId, new Date(row.orderCreatedAt)])
  )

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


  const uploadStats = await prisma.uploadItem.aggregate({
    where: {
      upload: {
        shopId: shop.id,
      },
    },
    _sum: {
      fileSize: true,
    },
    _count: true,
  })

  const totalTransferBytes = uploadStats._sum.fileSize || 0
  const totalTransferGB = Number(totalTransferBytes) / (1024 * 1024 * 1024)

  const records: OrderRecord[] = allCommissions
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


  const monthMap = new Map<string, OrderRecord[]>()
  for (const record of records) {
    const date = new Date(record.createdAt)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, [])
    }
    monthMap.get(monthKey)!.push(record)
  }


  const monthlyBreakdowns: MonthlyBreakdown[] = [...monthMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, orders]) => {
      const [year, month] = monthKey.split('-').map(Number)
      const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
      })
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


  const totalOrders = records.length
  const paidOrders = records.filter((r) => r.status === 'paid').length
  const pendingOrders = records.filter((r) => r.status === 'pending').length
  const waivedOrders = records.filter((r) => r.status === 'waived').length

  const recordedAmount = records.reduce((sum, r) => sum + r.commissionAmount, 0)
  const pendingAmount = records.filter((r) => r.status === 'pending').reduce((sum, r) => sum + r.commissionAmount, 0)
  const paidAmount = records.filter((r) => r.status === 'paid').reduce((sum, r) => sum + r.commissionAmount, 0)
  const waivedAmount = records.filter((r) => r.status === 'waived').reduce((sum, r) => sum + r.commissionAmount, 0)

  const summary: CommissionSummary = {
    recordedAmount,
    pendingAmount,
    paidAmount,
    waivedAmount,
    totalOrders,
    pendingOrders,
    paidOrders,
    waivedOrders,
  }

  return json({
    shopDomain,
    summary,
    records,
    monthlyBreakdowns,
    totalTransferGB,
    totalFiles: uploadStats._count,
    commissionPercent: COMMISSION_PERCENT,
    paypalEmail: PAYPAL_EMAIL,
    paypalEnabled: isPayPalConfigured(),
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    autoChargeEnabled: shop.paypalAutoCharge,
    paypalVaulted: Boolean(shop.paypalVaultId),
    paypalPayerEmail: shop.paypalPayerEmail || null,
    autoChargeThreshold: 49.99,
    stripeEnabled: isStripeConfigured(),
    stripeAutoCharge: shop.stripeAutoCharge,
    stripeSaved: Boolean(shop.stripePaymentMethodId),
    stripeEmail: shop.stripeEmail || null,
    stripeCard: (() => {
      const billing =
        ((shop.settings as Record<string, any> | null) || {}).billing ||
        ({} as Record<string, any>)
      const card = billing.card as
        | {
            brand?: string | null
            last4?: string | null
            expMonth?: number | null
            expYear?: number | null
            funding?: string | null
          }
        | undefined
      if (!card || !card.last4) return null
      return {
        brand: card.brand || null,
        last4: card.last4 || null,
        expMonth: card.expMonth || null,
        expYear: card.expYear || null,
        funding: card.funding || null,
      }
    })(),
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
    const provider = formData.get('provider') as string || 'paypal'

    if (provider === 'stripe') {

      if (enabled && !shop.stripePaymentMethodId) {
        return json(
          { error: 'No saved Stripe payment method. Complete a Stripe payment first.' },
          { status: 400 }
        )
      }

      await prisma.shop.update({
        where: { id: shop.id },
        data: { stripeAutoCharge: enabled },
      })
    } else {

      if (enabled && !shop.paypalVaultId) {
        return json(
          { error: 'No saved payment method. Complete a PayPal payment first.' },
          { status: 400 }
        )
      }

      await prisma.shop.update({
        where: { id: shop.id },
        data: { paypalAutoCharge: enabled },
      })
    }

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: enabled ? 'auto_charge_enabled' : 'auto_charge_disabled',
        resourceType: 'billing',
        resourceId: shop.id,
        metadata: { enabled },
      },
    })

    return json({ success: true, message: `Auto-charge ${enabled ? 'enabled' : 'disabled'}` })
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
      return json({ error: 'No outstanding billed orders found for this payment' }, { status: 400 })
    }


    for (const orderId of outstandingSelection.orderIds) {
      const rate = outstandingSelection.feeByOrderId.get(orderId) || 0
      await prisma.commission.upsert({
        where: {
          commission_shop_order: {
            shopId: shop.id,
            orderId: orderId,
          },
        },
        create: {
          shopId: shop.id,
          orderId: orderId,
          orderNumber: `#${orderId.slice(-6)}`,
          orderTotal: 0, // Not tracking order total anymore
          orderCurrency: 'USD',
          commissionRate: 0,
          commissionAmount: rate,
          status: 'paid',
          paidAt: new Date(),
          paymentRef: paymentRef,
        },
        update: {
          status: 'paid',
          paidAt: new Date(),
          paymentRef: paymentRef,
        },
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

function cardBrandLabel(brand: string | null | undefined): string {
  if (!brand) return 'Card'
  const map: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'Amex',
    discover: 'Discover',
    diners: 'Diners',
    jcb: 'JCB',
    unionpay: 'UnionPay',
    cartes_bancaires: 'CB',
    troy: 'Troy',
    unknown: 'Card',
  }
  return map[brand.toLowerCase()] || (brand.charAt(0).toUpperCase() + brand.slice(1))
}

export default function BillingPage() {
  const {
    shopDomain,
    summary,
    records,
    monthlyBreakdowns,
    totalTransferGB,
    totalFiles,
    commissionPercent,
    paypalEmail,
    paypalEnabled,
    autoChargeEnabled,
    paypalVaulted,
    paypalPayerEmail,
    autoChargeThreshold,
    stripeEnabled,
    stripeAutoCharge,
    stripeSaved,
    stripeEmail,
    stripeCard,
  } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'


  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentRef, setPaymentRef] = useState('')


  const [paypalLoading, setPaypalLoading] = useState(false)
  const [paypalError, setPaypalError] = useState<string | null>(null)
  const [paypalSuccess, setPaypalSuccess] = useState(false)
  const [paypalCaptureId, setPaypalCaptureId] = useState<string | null>(null)


  const [stripeLoading, setStripeLoading] = useState(false)
  const [stripeError, setStripeError] = useState<string | null>(null)
  const [stripeSuccess, setStripeSuccess] = useState(false)


  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [monthPaymentLoading, setMonthPaymentLoading] = useState<string | null>(null)

  const toggleMonth = useCallback((monthKey: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(monthKey)) {
        next.delete(monthKey)
      } else {
        next.add(monthKey)
      }
      return next
    })
  }, [])

  const handlePayMonth = useCallback(async (monthKey: string, orderIds: string[], provider: 'stripe' | 'paypal') => {
    setMonthPaymentLoading(monthKey)

    try {
      const endpoint = provider === 'stripe' ? '/api/stripe/create-checkout' : '/api/paypal/create-order'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, monthKey }),
      })

      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to create ${provider} checkout`)
      }

      const url = provider === 'stripe' ? data.checkoutUrl : data.approvalUrl
      const newWindow = window.open(url, '_blank')
      if (!newWindow) {
        if (window.top) {
          window.top.location.href = url
        } else {
          window.location.href = url
        }
      }

      if (provider === 'paypal') {
        setPaypalCaptureId(data.paypalOrderId)
      }
    } catch (error) {
      console.error(`${provider} month payment error:`, error)
      if (provider === 'stripe') {
        setStripeError(error instanceof Error ? error.message : 'Payment failed')
      } else {
        setPaypalError(error instanceof Error ? error.message : 'Payment failed')
      }
    } finally {
      setMonthPaymentLoading(null)
    }
  }, [])

  const handlePaymentModalOpen = useCallback(() => setPaymentModalOpen(true), [])
  const handlePaymentModalClose = useCallback(() => {
    setPaymentModalOpen(false)
    setPaymentRef('')
  }, [])


  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const paypalStatus = urlParams.get('paypal')
    if (paypalStatus === 'cancelled') {
      setPaypalError('Payment was cancelled. You can try again.')
    }


    const stripeStatus = urlParams.get('stripe')
    const stripeSessionId = urlParams.get('session_id')
    if (stripeStatus === 'success' && stripeSessionId) {

      setStripeLoading(true)
      fetch('/api/stripe/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: stripeSessionId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setStripeSuccess(true)
            setTimeout(() => {
              window.location.href = '/app/billing'
            }, 2000)
          } else {
            setStripeError(data.error || 'Payment confirmation failed')
          }
        })
        .catch((err) => {
          setStripeError(err.message || 'Payment confirmation failed')
        })
        .finally(() => setStripeLoading(false))
    } else if (stripeStatus === 'cancelled') {
      setStripeError('Payment was cancelled. You can try again.')
    }
  }, [])


  const handlePayWithPayPal = useCallback(async () => {
    setPaypalLoading(true)
    setPaypalError(null)

    try {

      const createResponse = await fetch('/api/paypal/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const createData = await createResponse.json()

      if (!createResponse.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create PayPal order')
      }



      window.open(createData.approvalUrl, '_blank')


      setPaypalError(null)
      setPaypalLoading(false)



      setPaypalCaptureId(createData.paypalOrderId)
    } catch (error) {
      console.error('PayPal error:', error)
      setPaypalError(error instanceof Error ? error.message : 'PayPal payment failed')
      setPaypalLoading(false)
    }
  }, [])


  const handleCapturePayPal = useCallback(async () => {
    if (!paypalCaptureId) return

    setPaypalLoading(true)
    setPaypalError(null)

    try {
      const captureResponse = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paypalOrderId: paypalCaptureId }),
      })

      const captureData = await captureResponse.json()

      if (!captureResponse.ok || !captureData.success) {
        throw new Error(captureData.error || 'Failed to capture payment')
      }

      setPaypalSuccess(true)
      setPaypalCaptureId(null)


      setTimeout(() => {
        window.location.href = '/app/billing'
      }, 2000)
    } catch (error) {
      console.error('PayPal capture error:', error)
      setPaypalError(error instanceof Error ? error.message : 'Payment capture failed')
      setPaypalLoading(false)
    }
  }, [paypalCaptureId])


  const handlePayWithStripe = useCallback(async () => {
    setStripeLoading(true)
    setStripeError(null)

    try {
      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to create Stripe checkout')
      }



      const stripeWindow = window.open(data.checkoutUrl, '_blank')
      if (!stripeWindow) {

        if (window.top) {
          window.top.location.href = data.checkoutUrl
        } else {
          window.location.href = data.checkoutUrl
        }
      }
    } catch (error) {
      console.error('Stripe error:', error)
      setStripeError(error instanceof Error ? error.message : 'Stripe payment failed')
      setStripeLoading(false)
    }
  }, [])


  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatMoney = (amount: number) => `$${amount.toFixed(2)}`

  const formatOrderCount = (count: number) => count.toLocaleString('en-US')

  const getOrderStatusBadge = (status: string) => {
    if (status === 'paid') {
      return { tone: 'success', label: 'Paid' } as const
    }

    if (status === 'waived') {
      return { tone: 'info', label: 'Waived' } as const
    }

    return { tone: 'attention', label: 'Outstanding' } as const
  }

  const getMonthStatusBadge = (month: MonthlyBreakdown) => {
    if (month.pendingOrders > 0) {
      return {
        tone: 'attention',
        label: `${formatOrderCount(month.pendingOrders)} outstanding`,
      } as const
    }

    if (month.waivedOrders === month.totalOrders) {
      return { tone: 'info', label: 'Waived' } as const
    }

    if (month.paidOrders === month.totalOrders) {
      return { tone: 'success', label: 'All settled' } as const
    }

    return { tone: 'success', label: 'Settled / Waived' } as const
  }


  const pendingOrderIds = records
    .filter((r) => r.status === 'pending')
    .map((r) => r.orderId)
    .join(',')


  const tableRows = records.map((r) => [
    r.orderNumber,
    formatMoney(r.commissionAmount),
    <Badge key={r.orderId} tone={getOrderStatusBadge(r.status).tone}>
      {getOrderStatusBadge(r.status).label}
    </Badge>,
    formatDate(r.createdAt),
    r.status === 'waived' ? 'Waived' : r.paidAt ? formatDate(r.paidAt) : '-',
  ])

  return (
    <Page title="Billing & Order Fees" backAction={{ content: 'Dashboard', url: '/app' }}>
      <Layout>

        <Layout.Section>
          <Banner tone="info">
            <p>
              <strong>App-linked orders only.</strong> This page uses Upload Studio billing records, not your store's full Shopify order count.
              Each app-served order is billed {Math.round(commissionPercent * 100)}% of the app's own line items.
            </p>
          </Banner>
        </Layout.Section>


        <Layout.Section>
          <InlineStack gap="400" align="start" wrap={false}>

            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    App-Linked Orders
                  </Text>
                  <Text as="p" variant="headingXl">
                    {formatOrderCount(summary.totalOrders)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Recorded fees: {formatMoney(summary.recordedAmount)}
                  </Text>
                </BlockStack>
              </Card>
            </Box>


            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Outstanding Balance
                  </Text>
                  <Text as="p" variant="headingXl" tone="critical">
                    {formatMoney(summary.pendingAmount)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatOrderCount(summary.pendingOrders)} orders
                  </Text>
                </BlockStack>
              </Card>
            </Box>


            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Settled Charges
                  </Text>
                  <Text as="p" variant="headingXl" tone="success">
                    {formatMoney(summary.paidAmount)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatOrderCount(summary.paidOrders)} orders
                  </Text>
                </BlockStack>
              </Card>
            </Box>


            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Waived Charges
                  </Text>
                  <Text as="p" variant="headingXl" tone="info">
                    {formatMoney(summary.waivedAmount)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatOrderCount(summary.waivedOrders)} orders
                  </Text>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
          <Box paddingBlockStart="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Transfer tracked: {totalTransferGB >= 1
                ? `${totalTransferGB.toFixed(2)} GB`
                : `${(totalTransferGB * 1024).toFixed(0)} MB`} across {formatOrderCount(totalFiles)} uploaded files.
            </Text>
          </Box>
        </Layout.Section>


        {summary.pendingAmount > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">

                {paypalSuccess && (
                  <Banner tone="success" onDismiss={() => setPaypalSuccess(false)}>
                    <p>
                      Payment successful. Your outstanding commission have been updated. Page will refresh shortly.
                    </p>
                  </Banner>
                )}


                {paypalError && (
                  <Banner tone="critical" onDismiss={() => setPaypalError(null)}>
                    <p>{paypalError}</p>
                  </Banner>
                )}


                {stripeSuccess && (
                  <Banner tone="success" onDismiss={() => setStripeSuccess(false)}>
                    <p>
                      Stripe payment successful. Your outstanding commission have been updated. Page will refresh shortly.
                    </p>
                  </Banner>
                )}


                {stripeError && (
                  <Banner tone="critical" onDismiss={() => setStripeError(null)}>
                    <p>{stripeError}</p>
                  </Banner>
                )}

                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Outstanding Balance
                    </Text>
                    <Text as="p" variant="bodyMd">
                      Please send <strong>{formatMoney(summary.pendingAmount)}</strong> to settle{' '}
                      {formatOrderCount(summary.pendingOrders)} app-linked orders.
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">

                    {stripeEnabled && (
                      <Button
                        variant="primary"
                        onClick={handlePayWithStripe}
                        loading={stripeLoading}
                        disabled={stripeLoading || paypalLoading}
                      >
                        💳 Pay with Card (Stripe)
                      </Button>
                    )}

                    {paypalEnabled && !paypalCaptureId && (
                      <Button
                        variant="primary"
                        onClick={handlePayWithPayPal}
                        loading={paypalLoading}
                        disabled={paypalLoading || stripeLoading}
                      >
                        💳 Pay with PayPal
                      </Button>
                    )}

                    {paypalCaptureId && (
                      <Button
                        variant="primary"
                        tone="success"
                        onClick={handleCapturePayPal}
                        loading={paypalLoading}
                        disabled={paypalLoading}
                      >
                        ✅ I Completed Payment on PayPal
                      </Button>
                    )}

                    <Button onClick={handlePaymentModalOpen}>
                      I've Made Payment Manually
                    </Button>
                  </InlineStack>
                </InlineStack>

                <Divider />


                {paypalEnabled && !paypalCaptureId && (
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        🔒 Secure PayPal Checkout
                      </Text>
                      <Text as="p" variant="bodySm">
                        Click "Pay with PayPal" to pay securely. You'll be redirected to PayPal
                        to complete the payment. After completing, click "I Completed Payment" to
                        confirm.
                      </Text>
                    </BlockStack>
                  </Box>
                )}


                {paypalCaptureId && (
                  <Banner tone="warning">
                    <p>
                      A PayPal payment window has opened. Complete the payment there, then click
                      "I Completed Payment on PayPal" above.
                    </p>
                  </Banner>
                )}


                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Manual Payment Option
                    </Text>
                    <InlineStack gap="200">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        PayPal Email:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {paypalEmail}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Amount:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {formatMoney(summary.pendingAmount)} USD
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Reference:
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {shopDomain}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>

                <Text as="p" variant="bodySm" tone="subdued">
                  You can pay via Stripe (card), PayPal, or send payment manually to the email
                  above.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      ⚡ Automatic Payments
                    </Text>
                    {(autoChargeEnabled || stripeAutoCharge) ? (
                      <Badge tone="success">Active</Badge>
                    ) : (paypalVaulted || stripeSaved) ? (
                      <Badge tone="attention">Paused</Badge>
                    ) : (
                      <Badge>Not Set Up</Badge>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    When enabled, we'll automatically charge your saved payment method when
                    outstanding commission reach ${autoChargeThreshold.toFixed(2)}.
                  </Text>
                </BlockStack>
              </InlineStack>


              {stripeSaved && stripeEmail && (
                <>
                  <Divider />
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack gap="400" blockAlign="center" wrap>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Stripe payment method
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {stripeCard
                            ? `${cardBrandLabel(stripeCard.brand)} •••• ${stripeCard.last4}`
                            : 'Card on file'}
                        </Text>
                        {stripeCard && stripeCard.expMonth && stripeCard.expYear && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Expires {String(stripeCard.expMonth).padStart(2, '0')}/{String(stripeCard.expYear).slice(-2)}
                          </Text>
                        )}
                        <Text as="p" variant="bodySm" tone="subdued">
                          {stripeEmail}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Threshold
                        </Text>
                        <Text as="p" variant="bodyMd">
                          ${autoChargeThreshold.toFixed(2)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Status
                        </Text>
                        <Text as="p" variant="bodyMd">
                          {stripeAutoCharge ? '✅ Auto-charging' : '⏸️ Paused'}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200">
                        <Form method="post">
                          <input type="hidden" name="_action" value="toggle_auto_charge" />
                          <input type="hidden" name="provider" value="stripe" />
                          <input
                            type="hidden"
                            name="enabled"
                            value={stripeAutoCharge ? 'false' : 'true'}
                          />
                          <Button
                            submit
                            variant={stripeAutoCharge ? 'plain' : 'primary'}
                            tone={stripeAutoCharge ? 'critical' : undefined}
                          >
                            {stripeAutoCharge ? 'Disable' : 'Enable'}
                          </Button>
                        </Form>
                        <Button
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/stripe/customer-portal', { method: 'POST' })
                              const data = await res.json()
                              if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer')
                              else alert(data.error || 'Failed to open Stripe customer portal')
                            } catch (e) {
                              alert((e as Error).message || 'Network error')
                            }
                          }}
                        >
                          Manage payment method ↗
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                </>
              )}


              {paypalVaulted && paypalPayerEmail && (
                <>
                  <Divider />
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack gap="400" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          PayPal
                        </Text>
                        <Text as="p" variant="bodyMd">
                          PayPal ({paypalPayerEmail})
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Threshold
                        </Text>
                        <Text as="p" variant="bodyMd">
                          ${autoChargeThreshold.toFixed(2)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Status
                        </Text>
                        <Text as="p" variant="bodyMd">
                          {autoChargeEnabled ? '✅ Auto-charging' : '⏸️ Paused'}
                        </Text>
                      </BlockStack>
                      <Form method="post">
                        <input type="hidden" name="_action" value="toggle_auto_charge" />
                        <input type="hidden" name="provider" value="paypal" />
                        <input
                          type="hidden"
                          name="enabled"
                          value={autoChargeEnabled ? 'false' : 'true'}
                        />
                        <Button
                          submit
                          variant={autoChargeEnabled ? 'plain' : 'primary'}
                          tone={autoChargeEnabled ? 'critical' : undefined}
                        >
                          {autoChargeEnabled ? 'Disable' : 'Enable'}
                        </Button>
                      </Form>
                    </InlineStack>
                  </Box>
                </>
              )}

              {!paypalVaulted && !stripeSaved && (
                <Banner tone="info">
                  <p>
                    Complete your first payment above (Stripe or PayPal) to enable automatic
                    payments. Your payment method will be securely saved for future charges.
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        {monthlyBreakdowns.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Monthly Billing
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Grouped by the order&apos;s original app-linked date. Status remains order-based inside each month.
                </Text>

                {monthlyBreakdowns.map((mb) => {
                  const isExpanded = expandedMonths.has(mb.monthKey)
                  const isLoading = monthPaymentLoading === mb.monthKey
                  const monthStatusBadge = getMonthStatusBadge(mb)
                  const monthPendingOrderIds = mb.orders
                    .filter((o) => o.status === 'pending')
                    .map((o) => o.orderId)

                  const monthRows = mb.orders.map((r) => [
                    r.orderNumber,
                    formatMoney(r.commissionAmount),
                    <Badge key={r.orderId} tone={getOrderStatusBadge(r.status).tone}>
                      {getOrderStatusBadge(r.status).label}
                    </Badge>,
                    formatDate(r.createdAt),
                    r.status === 'waived' ? 'Waived' : r.paidAt ? formatDate(r.paidAt) : '-',
                  ])

                  return (
                    <Box
                      key={mb.monthKey}
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="300" blockAlign="center">
                            <Button
                              variant="plain"
                              onClick={() => toggleMonth(mb.monthKey)}
                            >
                              {isExpanded ? '▼' : '▶'} {mb.monthLabel}
                            </Button>
                            <Badge tone={monthStatusBadge.tone}>{monthStatusBadge.label}</Badge>
                          </InlineStack>

                          <InlineStack gap="300" blockAlign="center">
                            <BlockStack gap="0">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                {formatMoney(mb.totalAmount)} total commission
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {formatOrderCount(mb.totalOrders)} app-linked orders
                              </Text>
                            </BlockStack>

                            {mb.pendingOrders > 0 && (
                              <InlineStack gap="200">
                                {stripeEnabled && (
                                  <Button
                                    size="slim"
                                    variant="primary"
                                    onClick={() => handlePayMonth(mb.monthKey, monthPendingOrderIds, 'stripe')}
                                    loading={isLoading}
                                    disabled={isLoading}
                                  >
                                    Card {formatMoney(mb.pendingAmount)}
                                  </Button>
                                )}
                                {paypalEnabled && (
                                  <Button
                                    size="slim"
                                    onClick={() => handlePayMonth(mb.monthKey, monthPendingOrderIds, 'paypal')}
                                    loading={isLoading}
                                    disabled={isLoading}
                                  >
                                    PayPal {formatMoney(mb.pendingAmount)}
                                  </Button>
                                )}
                              </InlineStack>
                            )}
                          </InlineStack>
                        </InlineStack>


                        <InlineStack gap="200">
                          {mb.paidOrders > 0 && (
                            <Text as="p" variant="bodySm" tone="success">
                              Paid: {formatMoney(mb.paidAmount)} ({formatOrderCount(mb.paidOrders)})
                            </Text>
                          )}
                          {mb.waivedOrders > 0 && (
                            <Text as="p" variant="bodySm" tone="info">
                              Waived: {formatMoney(mb.waivedAmount)} ({formatOrderCount(mb.waivedOrders)})
                            </Text>
                          )}
                          {mb.pendingOrders > 0 && (
                            <Text as="p" variant="bodySm" tone="critical">
                              Outstanding: {formatMoney(mb.pendingAmount)} ({formatOrderCount(mb.pendingOrders)})
                            </Text>
                          )}
                        </InlineStack>

                        <Collapsible open={isExpanded} id={`month-${mb.monthKey}`}>
                          <Box paddingBlockStart="200">
                            <DataTable
                              columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                              headings={['Order', 'Fee', 'Status', 'Order Date', 'Resolved']}
                              rows={monthRows}
                            />
                          </Box>
                        </Collapsible>
                      </BlockStack>
                    </Box>
                  )
                })}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Commission History
              </Text>

              {records.length === 0 ? (
                <EmptyState
                  heading="No app-linked orders billed yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    When an order contains a gang sheet uploaded through this app, its 4% commission will appear here.
                  </p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['Order', 'Fee', 'Status', 'Order Date', 'Resolved']}
                  rows={tableRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                How Billing Works
              </Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  1. <strong>App-Linked Order Created</strong> - A Shopify order appears here only when it is linked to Upload Studio.
                </Text>
                <Text as="p" variant="bodyMd">
                  2. <strong>Commission Recorded</strong> - {Math.round(commissionPercent * 100)}% of the line items this app served in the order (net of line discounts). Orders without an app upload are never billed.
                </Text>
                <Text as="p" variant="bodyMd">
                  3. <strong>Pay with Stripe or PayPal</strong> - Use the payment buttons to settle only the currently outstanding commission.
                </Text>
                <Text as="p" variant="bodyMd">
                  4. <strong>Automatic Payments</strong> - After your first payment, auto-pay can charge your saved method when outstanding fees reach ${autoChargeThreshold.toFixed(2)}.
                </Text>
                <Text as="p" variant="bodyMd">
                  5. <strong>Status by Order</strong> - Every billed order is tracked individually as paid, outstanding, or waived.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner tone="info">Questions about billing? Contact support@{process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}</Banner>
        </Layout.Section>
      </Layout>


      <Modal
        open={paymentModalOpen}
        onClose={handlePaymentModalClose}
        title="Confirm Manual Payment"
        primaryAction={{
          content: isSubmitting ? 'Submitting...' : 'Confirm Payment',
          disabled: !paymentRef || isSubmitting,
          submit: true,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: handlePaymentModalClose,
          },
        ]}
      >
        <Form method="post">
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Enter your PayPal transaction ID to confirm payment of{' '}
                <strong>{formatMoney(summary.pendingAmount)}</strong> for {formatOrderCount(summary.pendingOrders)} outstanding orders.
              </Text>

              <input type="hidden" name="_action" value="mark_paid" />
              <input type="hidden" name="orderIds" value={pendingOrderIds} />

              <TextField
                label="Payment Reference"
                name="paymentRef"
                value={paymentRef}
                onChange={setPaymentRef}
                autoComplete="off"
                placeholder="e.g., 1AB23456CD789012E"
                helpText="Use the PayPal transaction ID or your manual payment reference"
              />

              {isSubmitting && (
                <InlineStack gap="200" align="center">
                  <Spinner size="small" />
                  <Text as="p" variant="bodySm">
                    Processing...
                  </Text>
                </InlineStack>
              )}
            </BlockStack>
          </Modal.Section>
        </Form>
      </Modal>
    </Page>
  )
}
