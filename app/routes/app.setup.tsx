import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/node'
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import { Page, Card, BlockStack, Text, TextField, Select, Button, Banner, InlineStack } from '@shopify/polaris'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { authenticate } from '~/shopify.server'
import prisma from '~/lib/prisma.server'
import { resolveFinishedSheetSettings } from '~/lib/finishedSheetMeasurement'

const SetupInput = z.object({
  productId: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
  publicPricingMode: z.enum(['variant', 'measured_length']),
  maxPrintableWidthIn: z.coerce.number().min(0.1).max(120),
  maxPrintableLengthIn: z.coerce.number().min(1).max(10000),
  fitToleranceIn: z.coerce.number().min(0.01).max(0.03),
  pricePerInch: z.coerce.number().min(0).max(10000),
}).refine(value => value.publicPricingMode !== 'measured_length' || value.pricePerInch > 0, { path: ['pricePerInch'], message: 'Enter your per-inch price for measured-length pricing.' })

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request)
  const url = new URL(request.url)
  const query = (url.searchParams.get('q') || '').slice(0, 150)
  const response = await admin.graphql(`query SetupProducts($query: String) { products(first: 50, query: $query) { nodes { id title } } }`, { variables: { query: query || null } })
  const result: any = await response.json()
  if (result.errors || !result.data?.products) throw new Response('Products could not be loaded. Please retry.', { status: 502 })
  const products: Array<{ id: string; title: string }> = result.data.products.nodes
  const selected = products.find(product => product.id === url.searchParams.get('productId')) || products[0]
  const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } })
  const config = selected ? await prisma.productConfig.findUnique({ where: { shopId_productId: { shopId: shop.id, productId: selected.id } } }) : null
  const builder = (config?.builderConfig || {}) as Record<string, unknown>
  return json({ products, selectedId: selected?.id || '', query, settings: resolveFinishedSheetSettings(builder), mode: builder.publicPricingMode === 'measured_length' ? 'measured_length' : 'variant', rate: Number(builder.pricePerInch || 0), onboardingCompleted: shop.onboardingCompleted })
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request)
  const parsed = SetupInput.safeParse(Object.fromEntries(await request.formData()))
  if (!parsed.success) return json({ error: parsed.error.issues[0].message, saved: false }, { status: 400 })
  const input = parsed.data
  const check = await admin.graphql(`query SetupProduct($id: ID!) { product(id: $id) { id } }`, { variables: { id: input.productId } })
  const verified: any = await check.json()
  if (verified.errors || !verified.data?.product) return json({ error: 'Choose a product belonging to this store.', saved: false }, { status: 400 })
  const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } })
  await prisma.$transaction(async tx => {
    const existing = await tx.productConfig.findUnique({ where: { shopId_productId: { shopId: shop.id, productId: input.productId } } })
    const builder = { ...((existing?.builderConfig || {}) as Record<string, any>), maxPrintableWidthIn: input.maxPrintableWidthIn, maxPrintableLengthIn: input.maxPrintableLengthIn, fitToleranceIn: input.fitToleranceIn, publicPricingMode: input.publicPricingMode, pricePerInch: input.pricePerInch }
    await tx.productConfig.upsert({ where: { shopId_productId: { shopId: shop.id, productId: input.productId } }, update: { enabled: true, uploadEnabled: true, builderConfig: builder }, create: { shopId: shop.id, productId: input.productId, mode: 'dtf', enabled: true, uploadEnabled: true, builderConfig: builder } })
    await tx.shop.update({ where: { id: shop.id }, data: { onboardingCompleted: true, onboardingStep: 2 } })
    await tx.auditLog.create({ data: { shopId: shop.id, action: 'product_setup_saved', resourceType: 'product', resourceId: input.productId, metadata: { ...input } } })
  })
  return json({ error: null, saved: true })
}

export default function Setup() {
  const data = useLoaderData<typeof loader>()
  const result = useActionData<typeof action>()
  const navigation = useNavigation()
  const [mode, setMode] = useState(data.mode)
  const [width, setWidth] = useState(String(data.settings.maxPrintableWidthIn))
  const [length, setLength] = useState(String(data.settings.maxPrintableLengthIn))
  const [tolerance, setTolerance] = useState(String(data.settings.fitToleranceIn))
  const [rate, setRate] = useState(data.rate ? String(data.rate) : '')
  useEffect(() => {
    setMode(data.mode); setWidth(String(data.settings.maxPrintableWidthIn)); setLength(String(data.settings.maxPrintableLengthIn)); setTolerance(String(data.settings.fitToleranceIn)); setRate(data.rate ? String(data.rate) : '')
  }, [data.selectedId, data.mode, data.rate, data.settings.maxPrintableWidthIn, data.settings.maxPrintableLengthIn, data.settings.fitToleranceIn])
  return <Page title="Set up Auto Gang Sheet Upload"><BlockStack gap="400">
    {result?.error && <Banner tone="critical">{result.error}</Banner>}
    {result?.saved && <Banner tone="success">Product settings saved. Approve billing and add the matching app block to this product template.</Banner>}
    <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">1. Choose a product</Text>
      <Form method="get"><BlockStack gap="300"><label>Search products <input name="q" defaultValue={data.query} /></label><Button submit>Search</Button></BlockStack></Form>
      {data.products.length ? <Form method="get"><BlockStack gap="300"><input type="hidden" name="q" value={data.query} /><label>Product <select name="productId" defaultValue={data.selectedId}>{data.products.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}</select></label><Button submit>Load product settings</Button></BlockStack></Form> : <Text as="p">No products found. Create a Shopify product, then return here.</Text>}
    </BlockStack></Card>
    {data.selectedId && <Card><Form method="post"><BlockStack gap="400">
      <Text as="h2" variant="headingMd">2. Enter your printable limits and pricing</Text><input type="hidden" name="productId" value={data.selectedId} />
      <Select name="publicPricingMode" label="Pricing" value={mode} onChange={setMode} options={[{ label: 'Smallest fitting Shopify sheet variant', value: 'variant' }, { label: 'Measured length × my per-inch rate', value: 'measured_length' }]} />
      <TextField name="maxPrintableWidthIn" label="Maximum printable width (inches)" type="number" min={0.1} max={120} step={0.01} value={width} onChange={setWidth} autoComplete="off" helpText="This is the usable press width. No hidden margins are subtracted." />
      <TextField name="maxPrintableLengthIn" label="Maximum printable length — custom pricing (inches)" type="number" min={1} max={10000} value={length} onChange={setLength} autoComplete="off" helpText="Variant pricing uses your largest sheet variant as its length ceiling instead." />
      <TextField name="fitToleranceIn" label="Export rounding tolerance (inches)" type="number" min={0.01} max={0.03} step={0.001} value={tolerance} onChange={setTolerance} autoComplete="off" helpText="Only absorbs tiny export rounding; genuine overflow is rejected." />
      <TextField name="pricePerInch" label="Custom price per inch (store currency)" type="number" min={0} value={rate} onChange={setRate} autoComplete="off" helpText="Required for measured-length pricing. Variant mode uses Shopify’s variant prices." />
      <Text as="p">One upload is one finished sheet. Quantity prints the entire sheet again; nothing is nested or rearranged.</Text>
      <Button submit variant="primary" loading={navigation.state === 'submitting'}>Save product settings</Button>
    </BlockStack></Form></Card>}
    <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">3. Approve billing and enable your block</Text><Text as="p">Shopify collects 3.5% of paid attributable merchandise, at most USD 6 per order. Your approved spending limit can be changed only with your confirmation. Add Variant Gang Sheet Upload for variants or Custom Price Upload Mod 2 for measured-length pricing in the Shopify theme editor.</Text><InlineStack gap="300"><Button url="/app/billing">Review and approve billing</Button><Button url="/app/products">Advanced product settings</Button><Button url="/app/legal/docs">Setup guide</Button></InlineStack></BlockStack></Card>
  </BlockStack></Page>
}
