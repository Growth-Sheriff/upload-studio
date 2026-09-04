// Billing page UI (loader/action live in app.billing.tsx). Three movements:
//   1. Where you stand: payment method on file + amount due + pay actions.
//   2. Month by month: counts and status per month; fees only inside a month
//      (expand or download), never a monthly total on the page.
//   3. What was settled: payment history and a short explanation of fees.
import { Form, useNavigation } from '@remix-run/react'
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
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris'
import { useCallback, useEffect, useMemo, useState } from 'react'

export interface BillingOrderRecord {
  orderId: string
  orderNumber: string | null
  commissionAmount: number
  status: string
  createdAt: string
  paidAt: string | null
  paymentRef: string | null
}

export interface BillingMonth {
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
  orders: BillingOrderRecord[]
}

export interface BillingPageData {
  shopDomain: string
  summary: { pendingAmount: number; pendingOrders: number; paidAmount: number; paidOrders: number; totalOrders: number }
  records: BillingOrderRecord[]
  monthlyBreakdowns: BillingMonth[]
  commissionPercent: number
  paypalEmail: string
  paypalEnabled: boolean
  autoChargeEnabled: boolean
  paypalVaulted: boolean
  paypalPayerEmail: string | null
  autoChargeThreshold: number
  stripeEnabled: boolean
  stripeAutoCharge: boolean
  stripeSaved: boolean
  stripeEmail: string | null
  stripeCard: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; funding: string | null } | null
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
  return map[brand.toLowerCase()] || brand.charAt(0).toUpperCase() + brand.slice(1)
}

const formatMoney = (amount: number) => `$${(Number(amount) || 0).toFixed(2)}`
const formatCount = (count: number) => count.toLocaleString('en-US')
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'

function orderStatus(status: string): { tone: 'success' | 'info' | 'attention'; label: string } {
  if (status === 'paid') return { tone: 'success', label: 'Settled' }
  if (status === 'waived') return { tone: 'info', label: 'Waived' }
  return { tone: 'attention', label: 'Due' }
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? '')
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Per-order fee rows for one month, no totals. Opens directly in Excel. */
function downloadMonthCsv(month: BillingMonth, shopDomain: string) {
  const header = ['Order', 'Order date', 'Fee (USD)', 'Status', 'Settled on', 'Payment reference']
  const rows = month.orders
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((order) => [
      order.orderNumber || order.orderId,
      formatDate(order.createdAt),
      (Number(order.commissionAmount) || 0).toFixed(2),
      orderStatus(order.status).label,
      order.status === 'paid' ? formatDate(order.paidAt) : '',
      order.paymentRef || '',
    ])
  const body = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `upload-studio-fees-${shopDomain.replace(/\.myshopify\.com$/, '')}-${month.monthKey}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Settlement {
  key: string
  date: string
  reference: string
  orders: number
  amount: number
}

function groupSettlements(records: BillingOrderRecord[]): Settlement[] {
  const map = new Map<string, Settlement>()
  for (const record of records) {
    if (record.status !== 'paid' || !record.paidAt) continue
    const day = record.paidAt.slice(0, 10)
    const key = `${day}|${record.paymentRef || ''}`
    const current = map.get(key) || { key, date: record.paidAt, reference: record.paymentRef || '', orders: 0, amount: 0 }
    current.orders += 1
    current.amount += Number(record.commissionAmount) || 0
    if (record.paidAt > current.date) current.date = record.paidAt
    map.set(key, current)
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date))
}

function settlementMethod(reference: string): string {
  if (/^pi_|^cs_/.test(reference)) return 'Card'
  if (/^[0-9A-Z]{17}$/.test(reference)) return 'PayPal'
  if (!reference) return 'Manual'
  return 'Manual'
}

export function BillingPageView(data: BillingPageData) {
  const {
    shopDomain,
    summary,
    records,
    monthlyBreakdowns,
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
  } = data
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentRef, setPaymentRef] = useState('')
  const [otherWaysOpen, setOtherWaysOpen] = useState(false)
  const [busy, setBusy] = useState<'stripe' | 'paypal' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'critical' | 'warning'; text: string } | null>(null)
  const [paypalCaptureId, setPaypalCaptureId] = useState<string | null>(null)
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [monthBusy, setMonthBusy] = useState<string | null>(null)

  const settlements = useMemo(() => groupSettlements(records), [records])
  const hasMethod = stripeSaved || paypalVaulted
  const autoPayOn = stripeAutoCharge || autoChargeEnabled
  const pendingOrderIds = records.filter((r) => r.status === 'pending').map((r) => r.orderId).join(',')

  const toggleMonth = useCallback((monthKey: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(monthKey)) next.delete(monthKey)
      else next.add(monthKey)
      return next
    })
  }, [])

  const openUrl = (url: string) => {
    const opened = window.open(url, '_blank')
    if (!opened) {
      if (window.top) window.top.location.href = url
      else window.location.href = url
    }
  }

  const startCheckout = useCallback(async (provider: 'stripe' | 'paypal', orderIds?: string[], monthKey?: string) => {
    setNotice(null)
    if (monthKey) setMonthBusy(monthKey)
    else setBusy(provider)
    try {
      const endpoint = provider === 'stripe' ? '/api/stripe/create-checkout' : '/api/paypal/create-order'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderIds ? { orderIds, monthKey } : {}),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not start the payment.')
      openUrl(provider === 'stripe' ? result.checkoutUrl : result.approvalUrl)
      if (provider === 'paypal') {
        setPaypalCaptureId(result.paypalOrderId)
        setNotice({ tone: 'warning', text: 'PayPal opened in a new tab. Finish there, then click "I completed the PayPal payment".' })
      }
    } catch (error) {
      setNotice({ tone: 'critical', text: error instanceof Error ? error.message : 'Payment failed.' })
    } finally {
      setBusy(null)
      setMonthBusy(null)
    }
  }, [])

  const capturePayPal = useCallback(async () => {
    if (!paypalCaptureId) return
    setBusy('paypal')
    try {
      const response = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paypalOrderId: paypalCaptureId }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not confirm the PayPal payment.')
      setPaypalCaptureId(null)
      setNotice({ tone: 'success', text: 'Payment received. Refreshing…' })
      setTimeout(() => {
        window.location.href = '/app/billing'
      }, 1500)
    } catch (error) {
      setNotice({ tone: 'critical', text: error instanceof Error ? error.message : 'Payment confirmation failed.' })
    } finally {
      setBusy(null)
    }
  }, [paypalCaptureId])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('paypal') === 'cancelled') setNotice({ tone: 'critical', text: 'PayPal payment was cancelled. You can try again.' })
    const stripeStatus = params.get('stripe')
    const sessionId = params.get('session_id')
    if (stripeStatus === 'success' && sessionId) {
      setBusy('stripe')
      fetch('/api/stripe/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
        .then((res) => res.json())
        .then((result) => {
          if (result.success) {
            setNotice({ tone: 'success', text: 'Card payment received. Refreshing…' })
            setTimeout(() => {
              window.location.href = '/app/billing'
            }, 1500)
          } else {
            setNotice({ tone: 'critical', text: result.error || 'Payment confirmation failed.' })
          }
        })
        .catch((error) => setNotice({ tone: 'critical', text: error.message || 'Payment confirmation failed.' }))
        .finally(() => setBusy(null))
    } else if (stripeStatus === 'cancelled') {
      setNotice({ tone: 'critical', text: 'Card payment was cancelled. You can try again.' })
    }
  }, [])

  const openStripePortal = async () => {
    try {
      const res = await fetch('/api/stripe/customer-portal', { method: 'POST' })
      const result = await res.json()
      if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
      else setNotice({ tone: 'critical', text: result.error || 'Could not open the card manager.' })
    } catch (error) {
      setNotice({ tone: 'critical', text: (error as Error).message || 'Network error' })
    }
  }

  return (
    <Page title="Billing" subtitle="Order fees for gang sheets uploaded through this app." backAction={{ content: 'Dashboard', url: '/app' }}>
      <Layout>
        {notice ? (
          <Layout.Section>
            <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
              <p>{notice.text}</p>
            </Banner>
          </Layout.Section>
        ) : null}

        {/* ── 1. Where you stand ── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Payment method</Text>
                  {hasMethod ? (
                    <Badge tone={autoPayOn ? 'success' : 'attention'}>{autoPayOn ? 'Auto-pay on' : 'Auto-pay off'}</Badge>
                  ) : (
                    <Badge>None on file</Badge>
                  )}
                </InlineStack>

                {stripeSaved ? (
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {stripeCard ? `${cardBrandLabel(stripeCard.brand)} •••• ${stripeCard.last4}` : 'Card on file'}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {stripeCard?.expMonth && stripeCard?.expYear
                            ? `Expires ${String(stripeCard.expMonth).padStart(2, '0')}/${String(stripeCard.expYear).slice(-2)}`
                            : ''}
                          {stripeEmail ? ` · ${stripeEmail}` : ''}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200">
                        <Button size="slim" onClick={openStripePortal}>Change card</Button>
                        <Form method="post">
                          <input type="hidden" name="_action" value="toggle_auto_charge" />
                          <input type="hidden" name="provider" value="stripe" />
                          <input type="hidden" name="enabled" value={stripeAutoCharge ? 'false' : 'true'} />
                          <Button submit size="slim" variant={stripeAutoCharge ? 'secondary' : 'primary'} loading={isSubmitting}>
                            {stripeAutoCharge ? 'Pause auto-pay' : 'Turn on auto-pay'}
                          </Button>
                        </Form>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ) : null}

                {paypalVaulted ? (
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">PayPal</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{paypalPayerEmail || ''}</Text>
                      </BlockStack>
                      <Form method="post">
                        <input type="hidden" name="_action" value="toggle_auto_charge" />
                        <input type="hidden" name="provider" value="paypal" />
                        <input type="hidden" name="enabled" value={autoChargeEnabled ? 'false' : 'true'} />
                        <Button submit size="slim" variant={autoChargeEnabled ? 'secondary' : 'primary'} loading={isSubmitting}>
                          {autoChargeEnabled ? 'Pause auto-pay' : 'Turn on auto-pay'}
                        </Button>
                      </Form>
                    </InlineStack>
                  </Box>
                ) : null}

                <Text as="p" variant="bodySm" tone="subdued">
                  {hasMethod
                    ? `With auto-pay on, fees are charged to this method automatically once they reach ${formatMoney(autoChargeThreshold)}.`
                    : `Pay once with card or PayPal and it is saved here. Auto-pay then settles fees automatically at ${formatMoney(autoChargeThreshold)}.`}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Amount due</Text>
                  <Badge tone={summary.pendingAmount > 0 ? 'attention' : 'success'}>
                    {summary.pendingAmount > 0 ? `${formatCount(summary.pendingOrders)} orders` : 'All settled'}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl" tone={summary.pendingAmount > 0 ? 'critical' : 'success'}>
                  {formatMoney(summary.pendingAmount)}
                </Text>
                {summary.pendingAmount > 0 ? (
                  <BlockStack gap="200">
                    <InlineStack gap="200" wrap>
                      {stripeEnabled ? (
                        <Button variant="primary" onClick={() => startCheckout('stripe')} loading={busy === 'stripe'} disabled={busy !== null}>
                          Pay with card
                        </Button>
                      ) : null}
                      {paypalEnabled && !paypalCaptureId ? (
                        <Button onClick={() => startCheckout('paypal')} loading={busy === 'paypal'} disabled={busy !== null}>
                          Pay with PayPal
                        </Button>
                      ) : null}
                      {paypalCaptureId ? (
                        <Button variant="primary" tone="success" onClick={capturePayPal} loading={busy === 'paypal'}>
                          I completed the PayPal payment
                        </Button>
                      ) : null}
                    </InlineStack>
                    <Button variant="plain" onClick={() => setOtherWaysOpen((open) => !open)} disclosure={otherWaysOpen ? 'up' : 'down'}>
                      Other ways to pay
                    </Button>
                    <Collapsible open={otherWaysOpen} id="other-ways-to-pay">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm">
                            Send {formatMoney(summary.pendingAmount)} USD by PayPal to <strong>{paypalEmail}</strong> with reference <strong>{shopDomain}</strong>, then confirm below.
                          </Text>
                          <InlineStack>
                            <Button size="slim" onClick={() => setPaymentModalOpen(true)}>I paid manually</Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    </Collapsible>
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">Nothing to pay right now. New fees appear here as orders come in.</Text>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* ── 2. Month by month ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Month by month</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Open a month to see each order's fee, or download it as a spreadsheet.
                </Text>
              </BlockStack>
              {monthlyBreakdowns.length === 0 ? (
                <EmptyState heading="No fees yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>When an order contains a gang sheet uploaded through this app, it appears here.</p>
                </EmptyState>
              ) : null}
              {monthlyBreakdowns.map((month) => {
                const expanded = expandedMonths.has(month.monthKey)
                const monthPendingIds = month.orders.filter((o) => o.status === 'pending').map((o) => o.orderId)
                const status =
                  month.pendingOrders > 0
                    ? { tone: 'attention' as const, label: `${formatCount(month.pendingOrders)} due` }
                    : month.waivedOrders === month.totalOrders
                      ? { tone: 'info' as const, label: 'Waived' }
                      : { tone: 'success' as const, label: 'Settled' }
                const rows = month.orders.map((order) => [
                  order.orderNumber || order.orderId,
                  formatDate(order.createdAt),
                  formatMoney(order.commissionAmount),
                  <Badge key={order.orderId} tone={orderStatus(order.status).tone}>{orderStatus(order.status).label}</Badge>,
                  order.status === 'paid' ? formatDate(order.paidAt) : order.status === 'waived' ? 'Waived' : '-',
                ])
                return (
                  <Box key={month.monthKey} borderWidth="025" borderColor="border" borderRadius="200" padding="300">
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <InlineStack gap="300" blockAlign="center">
                          <Button variant="plain" onClick={() => toggleMonth(month.monthKey)} disclosure={expanded ? 'up' : 'down'}>
                            {month.monthLabel}
                          </Button>
                          <Text as="span" variant="bodySm" tone="subdued">{formatCount(month.totalOrders)} orders</Text>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </InlineStack>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => downloadMonthCsv(month, shopDomain)}>Download for Excel</Button>
                          {month.pendingOrders > 0 && stripeEnabled ? (
                            <Button size="slim" variant="primary" onClick={() => startCheckout('stripe', monthPendingIds, month.monthKey)} loading={monthBusy === month.monthKey} disabled={monthBusy !== null}>
                              Pay this month by card
                            </Button>
                          ) : null}
                          {month.pendingOrders > 0 && paypalEnabled ? (
                            <Button size="slim" onClick={() => startCheckout('paypal', monthPendingIds, month.monthKey)} loading={monthBusy === month.monthKey} disabled={monthBusy !== null}>
                              PayPal
                            </Button>
                          ) : null}
                        </InlineStack>
                      </InlineStack>
                      <Collapsible open={expanded} id={`month-${month.monthKey}`}>
                        <Box paddingBlockStart="100">
                          <DataTable
                            columnContentTypes={['text', 'text', 'numeric', 'text', 'text']}
                            headings={['Order', 'Order date', 'Fee', 'Status', 'Settled on']}
                            rows={rows}
                            increasedTableDensity
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

        {/* ── 3. What was settled ── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: '2fr 1fr' }} gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Payments</Text>
                {settlements.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">No payments yet.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'numeric']}
                    headings={['Date', 'Method', 'Orders', 'Amount']}
                    rows={settlements.slice(0, 24).map((settlement) => [
                      formatDate(settlement.date),
                      settlementMethod(settlement.reference),
                      formatCount(settlement.orders),
                      formatMoney(settlement.amount),
                    ])}
                    increasedTableDensity
                  />
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">How fees work</Text>
                <Text as="p" variant="bodySm">
                  Only orders that contain a gang sheet uploaded through this app are billed. The fee is {Math.round(commissionPercent * 100)}% of the app's own line items on that order, after discounts.
                </Text>
                <Text as="p" variant="bodySm">
                  Fees are tracked per order. Pay everything due at once, pay a single month, or let auto-pay settle them at {formatMoney(autoChargeThreshold)}.
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">Questions? support@{typeof window === 'undefined' ? 'uploadstudio.app.techifyboost.com' : window.location.hostname}</Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>
      </Layout>

      <Modal
        open={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false)
          setPaymentRef('')
        }}
        title="Confirm a manual payment"
        primaryAction={{
          content: isSubmitting ? 'Submitting…' : 'Confirm payment',
          disabled: !paymentRef || isSubmitting,
          onAction: () => (document.getElementById('manual-payment-form') as HTMLFormElement | null)?.requestSubmit(),
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setPaymentModalOpen(false) }]}
      >
        <Form method="post" id="manual-payment-form">
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Enter the PayPal transaction ID for your payment of <strong>{formatMoney(summary.pendingAmount)}</strong> covering {formatCount(summary.pendingOrders)} orders.
              </Text>
              <input type="hidden" name="_action" value="mark_paid" />
              <input type="hidden" name="orderIds" value={pendingOrderIds} />
              <TextField
                label="Payment reference"
                name="paymentRef"
                value={paymentRef}
                onChange={setPaymentRef}
                autoComplete="off"
                placeholder="e.g. 1AB23456CD789012E"
                helpText="The PayPal transaction ID or your own payment reference."
              />
              {isSubmitting ? (
                <InlineStack gap="200" align="center">
                  <Spinner size="small" />
                  <Text as="p" variant="bodySm">Processing…</Text>
                </InlineStack>
              ) : null}
            </BlockStack>
          </Modal.Section>
        </Form>
      </Modal>
    </Page>
  )
}
