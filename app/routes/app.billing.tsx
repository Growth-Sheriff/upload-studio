import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import { Banner, BlockStack, Button, Card, DataTable, InlineStack, Page, Select, Text } from '@shopify/polaris'
import { useEffect, useState } from 'react'
import prisma from '~/lib/prisma.server'
import { authenticate } from '~/shopify.server'
import { BILLING_CAP_TIERS, BILLING_TERMS, billingCapState, recommendedBillingCap } from '~/lib/billingPolicy'
import { buildUsageIdempotencyKey } from '~/lib/billing.server'
import { requestShopifyBillingApproval, syncShopifyBilling } from '~/lib/shopifyBilling.server'
import { merchantLegalAgreementSatisfied } from '~/lib/publicLegal.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request)
  const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } })
  const state = await syncShopifyBilling(shop.id, admin)
  const records = await prisma.commission.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: 'desc' }, take: 100 })
  const credits = await prisma.billingCredit.findMany({ where: { shopId: shop.id }, orderBy: { requestedAt: 'desc' }, take: 100 })
  const recentTotal = records.filter((row) => row.createdAt > new Date(Date.now() - 30 * 86400000)).reduce((total, row) => total + Number(row.servedAmountUsd || 0), 0)
  return json({
    legalAccepted: merchantLegalAgreementSatisfied(shop),
    billing: { status: state.status, capUsd: Number(state.cappedAmountUsd), usedUsd: Number(state.balanceUsedUsd), pendingApprovalUrl: state.pendingApprovalUrl, pendingCapUsd: state.pendingCapUsd ? Number(state.pendingCapUsd) : null, periodEnd: state.currentPeriodEnd?.toISOString() || null, test: state.test },
    suggestedCapUsd: recommendedBillingCap(recentTotal),
    records: records.map((row) => ({ id: row.id, orderId: row.orderId, orderNumber: row.orderNumber, originalAmount: Number(row.attributableCapturedAmount || 0), originalCurrency: row.orderCurrency, amountUsd: Number(row.commissionAmount), status: row.status, reviewReason: row.reviewReason, usageRecordId: row.usageRecordId, fxRate: row.fxRate ? Number(row.fxRate) : null, fxDate: row.fxObservedAt?.toISOString().slice(0, 10) || null })),
    credits: credits.map((credit) => ({ commissionId: credit.commissionId, status: credit.status, amountUsd: Number(credit.amountUsd) })),
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request)
  const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } })
  const form = await request.formData()
  const action = String(form.get('_action') || '')
  if (action === 'approve_billing') {
    try {
      const appUrl = process.env.SHOPIFY_APP_URL
      if (!appUrl) throw new Error('Public app URL not configured')
      const returnUrl = new URL('/app/billing', appUrl)
      returnUrl.searchParams.set('shop', session.shop)
      const host = new URL(request.url).searchParams.get('host')
      if (host) returnUrl.searchParams.set('host', host)
      const approvalUrl = await requestShopifyBillingApproval(shop.id, admin, Number(form.get('capUsd')), returnUrl.toString())
      return json({ approvalUrl, error: null })
    } catch (error) { return json({ approvalUrl: null, error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  }
  if (action === 'request_credit') {
    const fee = await prisma.commission.findFirst({ where: { shopId: shop.id, id: String(form.get('commissionId')), status: 'paid', reviewRequiredAt: { not: null } } })
    if (!fee) return json({ approvalUrl: null, error: 'Only a recorded fee requiring review can request a credit.' }, { status: 400 })
    const key = `credit-${buildUsageIdempotencyKey(shop.id, fee.orderId)}`
    await prisma.$transaction(async (tx) => {
      await tx.billingCredit.upsert({ where: { idempotencyKey: key }, create: { shopId: shop.id, commissionId: fee.id, amountUsd: fee.commissionAmount, idempotencyKey: key, status: 'review' }, update: {} })
      await tx.auditLog.upsert({ where: { id: key }, create: { id: key, shopId: shop.id, action: 'shopify_app_credit_requested', resourceType: 'commission', resourceId: fee.orderId, metadata: { usageRecordId: fee.usageRecordId, amountUsd: Number(fee.commissionAmount) } }, update: {} })
    })
    return json({ approvalUrl: null, error: null })
  }
  return json({ approvalUrl: null, error: 'Unknown billing action' }, { status: 400 })
}

export default function PublicBillingPage() {
  const { billing, records, credits, suggestedCapUsd, legalAccepted } = useLoaderData<typeof loader>()
  const result = useActionData<typeof action>()
  const navigation = useNavigation()
  const [cap, setCap] = useState(String(suggestedCapUsd))
  useEffect(() => { if (result?.approvalUrl) window.open(result.approvalUrl, '_top') }, [result])
  const capState = billingCapState(billing.capUsd, billing.usedUsd)
  const options = BILLING_CAP_TIERS.filter((amount) => billing.status !== 'active' || amount > billing.capUsd).map((amount) => ({ label: `US$${amount} per billing interval`, value: String(amount) }))
  return <Page title="Shopify app billing"><BlockStack gap="400">
    {result?.error && <Banner tone="critical"><p>{result.error}</p></Banner>}
    {!legalAccepted && <Banner tone="warning"><p><a href="/app/setup">Review and accept the service and data processing terms in Setup</a> before activating app billing or customer uploads.</p></Banner>}
    {billing.test && <Banner tone="info"><p>Development-store test subscription. Shopify will not collect real app charges.</p></Banner>}
    <Card><BlockStack gap="300">
      <Text as="h2" variant="headingMd">3.5% per paid order · maximum US$6 per order</Text>
      <Text as="p">{BILLING_TERMS}</Text>
      <Text as="p">No fixed subscription charge or trial expiry. Billing starts only after Shopify approval. US$0 customer payments incur no fee.</Text>
      <Text as="p">Status: {billing.status}. Approved limit: US${billing.capUsd.toFixed(2)}. Used: US${billing.usedUsd.toFixed(2)}{billing.periodEnd ? `, interval ends ${billing.periodEnd.slice(0, 10)}` : ''}.</Text>
    </BlockStack></Card>
    {billing.status === 'active' && capState !== 'available' && <Banner tone="warning" title={capState === 'exhausted' ? 'Approved billing limit reached' : 'Approaching your approved limit'}><p>Unrecorded fees wait safely. Approve a higher limit to record them. Files and production orders remain accessible; no fee is silently discarded or charged above your approved limit.</p></Banner>}
    {options.length > 0 && <Card><Form method="post"><BlockStack gap="300">
      <input type="hidden" name="_action" value="approve_billing" />
      <Select label="Maximum app usage charges per Shopify billing interval" name="capUsd" options={options} value={options.some((option) => option.value === cap) ? cap : options[0].value} onChange={setCap} helpText="This is permission to bill usage, not a flat charge. Increasing it requires your approval on Shopify." />
      <Button submit variant="primary" disabled={!legalAccepted} loading={navigation.state === 'submitting'}>{billing.status === 'active' ? 'Request higher limit on Shopify' : 'Approve usage billing on Shopify'}</Button>
    </BlockStack></Form></Card>}
    {billing.pendingApprovalUrl && <Banner tone="info" title="Shopify approval is pending"><p>The effective limit has not changed. <a href={billing.pendingApprovalUrl} target="_top">Review US${billing.pendingCapUsd} limit on Shopify</a>.</p></Banner>}
    <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Latest 100 order fees</Text><DataTable columnContentTypes={['text', 'text', 'numeric', 'text', 'text']} headings={['Order', 'App-served captured amount', 'Fee USD', 'Status', 'FX snapshot / provider record']} rows={records.map((row) => {
      const label = row.status === 'paid' ? 'Recorded on Shopify' : row.status === 'charging' ? 'Provider reconciliation pending' : row.status === 'awaiting_payment' ? 'Awaiting customer payment' : row.status
      return [row.orderNumber || row.orderId, `${row.originalAmount.toFixed(2)} ${row.originalCurrency}`, row.amountUsd.toFixed(2), row.reviewReason ? `${label}: ${row.reviewReason}` : label, `${row.fxRate ?? '—'} · ${row.fxDate || '—'} · ${row.usageRecordId || 'not recorded'}`]
    })} /></BlockStack></Card>
    {records.filter((row) => row.status === 'paid' && row.reviewReason).map((row) => <Card key={row.id}><InlineStack align="space-between"><Text as="p">{row.orderNumber || row.orderId}: recorded fee preserved after cancellation/refund; support must review Shopify app credit.</Text>{credits.some((credit) => credit.commissionId === row.id) ? <Text as="p">Credit review requested</Text> : <Form method="post"><input type="hidden" name="_action" value="request_credit" /><input type="hidden" name="commissionId" value={row.id} /><Button submit>Request credit review</Button></Form>}</InlineStack></Card>)}
  </BlockStack></Page>
}
