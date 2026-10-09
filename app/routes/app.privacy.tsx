import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { Banner, BlockStack, Card, DataTable, Page, Text } from '@shopify/polaris'
import { authenticate } from '~/shopify.server'
import prisma from '~/lib/prisma.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const id = new URL(request.url).searchParams.get('export')
  if (id) {
    const row = await prisma.complianceRequest.findFirst({ where: { id, shopDomain: session.shop, topic: 'customers/data_request', status: 'completed', completedAt: { gte: new Date(Date.now() - 7 * 86400000) } }, select: { result: true } })
    if (!row?.result) throw new Response('Privacy export unavailable or expired', { status: 404 })
    return new Response(JSON.stringify(row.result, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="customer-data.json"', 'Cache-Control': 'no-store' } })
  }
  const rows = await prisma.complianceRequest.findMany({ where: { shopDomain: session.shop }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, topic: true, status: true, createdAt: true, completedAt: true, dueAt: true, lastError: true, result: true } })
  return json({ rows: rows.map(row => ({ ...row, result: undefined, exportAvailable: row.topic === 'customers/data_request' && row.status === 'completed' && Boolean(row.result) && Boolean(row.completedAt && row.completedAt.getTime() > Date.now() - 7 * 86400000) })) }, { headers: { 'Cache-Control': 'no-store' } })
}

export default function PrivacyRequestsPage() {
  const { rows } = useLoaderData<typeof loader>()
  return <Page title="Privacy requests"><BlockStack gap="400">
    <Banner tone="info"><p>Shopify requests are received securely and processed automatically. Customer exports are available here for seven days: download and deliver them to the requester through your own verified channel.</p></Banner>
    <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Erasure and accounting</Text><Text as="p">Erasure first blocks further processing and waits 61 minutes for existing upload links to expire. Production files and customer rate assignments are then deleted. Minimal order-fee records remain for merchant accounting and duplicate-charge prevention while the app is installed, with no buyer contacts. Uninstall erases the whole shop, including its object-storage prefix.</Text></BlockStack></Card>
    <Card><DataTable columnContentTypes={['text', 'text', 'text', 'text', 'text']} headings={['Request', 'Received', 'Status', 'Next attempt / issue', 'Customer export']} rows={rows.map((row: { id: string; topic: string; createdAt: string; status: string; lastError: string | null; dueAt: string; exportAvailable: boolean }) => [row.topic, row.createdAt.slice(0, 16), row.status, row.lastError || (row.status === 'pending' ? row.dueAt.slice(0, 16) : '—'), row.exportAvailable ? <a href={`?export=${encodeURIComponent(row.id)}`} key={row.id}>Download JSON</a> : '—'])} /></Card>
  </BlockStack></Page>
}
