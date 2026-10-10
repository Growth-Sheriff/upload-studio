import { json, type LoaderFunctionArgs } from '@remix-run/node'
import { Prisma } from '@prisma/client'
import { useLoaderData, useNavigate } from '@remix-run/react'
import { Page, Card, Text, BlockStack, DataTable, Badge, Button, InlineStack, Box, InlineGrid, Divider } from '@shopify/polaris'
import { OrderIcon, ProductIcon, ClockIcon, CartIcon } from '@shopify/polaris-icons'
import { authenticate } from '~/shopify.server'
import prisma from '~/lib/prisma.server'
import { StatCard } from '~/components/StatCard'
import { describeUploadStatus, preflightLabel, preflightTone } from '~/lib/uploadStatus'

// Missing JSON paths evaluate to SQL NULL, so NOT alone drops real uploads.
// Only the explicit missing-file operational placeholder is a ghost.
export const dashboardNonGhostUploads: Prisma.UploadWhereInput = {
  OR: [
    { preflightSummary: { path: ['errorType'], equals: Prisma.AnyNull } },
    { NOT: { preflightSummary: { path: ['errorType'], equals: 'missing_upload' } } },
  ],
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } })
  if (!shop) throw new Response('Shop installation not found. Reinstall the app to continue.', { status: 404 })

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const [uploads, monthlyUploads, productsConfigured, pendingQueue, monthlyOrders] = await Promise.all([
    prisma.upload.findMany({
      where: { shopId: shop.id, ...dashboardNonGhostUploads },
      include: { items: { select: { preflightStatus: true } } },
      orderBy: { createdAt: 'desc' }, take: 5,
    }),
    prisma.upload.count({ where: { shopId: shop.id, createdAt: { gte: startOfMonth }, ...dashboardNonGhostUploads } }),
    prisma.productConfig.count({ where: { shopId: shop.id, enabled: true } }),
    prisma.upload.count({ where: { shopId: shop.id, status: 'needs_review', ...dashboardNonGhostUploads } }),
    prisma.upload.findMany({
      where: { shopId: shop.id, orderId: { not: null }, createdAt: { gte: startOfMonth }, ...dashboardNonGhostUploads },
      select: { orderId: true }, distinct: ['orderId'],
    }).then(rows => rows.length),
  ])
  return json({
    stats: { monthlyUploads, productsConfigured, pendingQueue, monthlyOrders },
    uploads: uploads.map(upload => ({
      id: upload.id, mode: upload.mode, status: upload.status, orderId: upload.orderId,
      orderPaidAt: upload.orderPaidAt?.toISOString() || null,
      cartAddedAt: upload.cartAddedAt?.toISOString() || null,
      preflightStatus: upload.items.some(item => item.preflightStatus === 'error') ? 'error'
        : upload.items.some(item => item.preflightStatus === 'warning') ? 'warning'
        : upload.items.length > 0 && upload.items.every(item => item.preflightStatus === 'ok') ? 'ok' : 'pending',
      createdAt: upload.createdAt.toISOString(),
    })),
  })
}

export default function AppDashboard() {
  const { stats, uploads } = useLoaderData<typeof loader>()
  const navigate = useNavigate()
  const rows = uploads.map(upload => {
    const status = describeUploadStatus(upload)
    return [
      <Button key={`${upload.id}-open`} variant="plain" onClick={() => navigate(`/app/uploads/${upload.id}`)}>{upload.id.slice(0, 8)}</Button>,
      <Badge key={`${upload.id}-mode`} tone="info">{upload.mode}</Badge>,
      <Badge key={`${upload.id}-status`} tone={status.tone}>{status.label}</Badge>,
      <Badge key={`${upload.id}-preflight`} tone={preflightTone(upload.preflightStatus)}>{preflightLabel(upload.preflightStatus)}</Badge>,
      new Date(upload.createdAt).toLocaleDateString(),
    ]
  })
  return <Page title="Dashboard" subtitle="Auto Gang Sheet Upload" primaryAction={{ content: 'Set up a product', onAction: () => navigate('/app/setup') }}>
    <BlockStack gap="500">
      <Card><BlockStack gap="300">
        <Text as="h2" variant="headingMd">Finished sheets in. Production files out.</Text>
        <Text as="p">Customers upload the sheet they already arranged. Set your printable limits and sheet prices, approve Shopify app billing, then enable the matching theme block. We measure and price; nothing is nested or rearranged.</Text>
        <InlineStack gap="300"><Button url="/app/setup">Product setup</Button><Button url="/app/billing">Billing</Button><Button url="/app/legal/docs">Setup guide</Button></InlineStack>
      </BlockStack></Card>
      <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
        <StatCard title="Uploads this month" value={stats.monthlyUploads} icon={OrderIcon} />
        <StatCard title="Orders this month" value={stats.monthlyOrders} icon={CartIcon} subtitle="Orders linked to an uploaded file" />
        <StatCard title="Products with upload" value={stats.productsConfigured} icon={ProductIcon} subtitle="Enabled product settings" />
        <StatCard title="Ordered – check file" value={stats.pendingQueue} icon={ClockIcon} badge={stats.pendingQueue ? 'Action' : undefined} badgeTone="attention" action={<Button variant="plain" url="/app/queue">Open production queue</Button>} />
      </InlineGrid>
      <Card><BlockStack gap="400">
        <InlineStack align="space-between"><Text as="h2" variant="headingMd">Recent uploads</Text><Button variant="plain" url="/app/uploads">View all</Button></InlineStack>
        <Divider />
        {uploads.length ? <DataTable columnContentTypes={['text', 'text', 'text', 'text', 'text']} headings={['ID', 'Mode', 'Status', 'Preflight', 'Date']} rows={rows} />
          : <Box padding="400"><BlockStack gap="200"><Text as="p" tone="subdued">No uploads yet. Configure a product and add its upload block to start.</Text><Button url="/app/setup">Set up a product</Button></BlockStack></Box>}
      </BlockStack></Card>
      <Card><BlockStack gap="300">
        <Text as="h2" variant="headingMd">At the printer</Text>
        <Text as="p">Open Print Ready for the customer's production file. Sheet Identity explains the measurement; DPI records the file resolution. Quantity prints the whole sheet again.</Text>
        <InlineStack gap="300"><Button url="/app/queue">Production queue</Button><Button url="/app/support">Get help</Button></InlineStack>
      </BlockStack></Card>
    </BlockStack>
  </Page>
}
