import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Prisma } from '@prisma/client'
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import { Banner, BlockStack, Button, Card, InlineStack, Page, Text } from '@shopify/polaris'
import prisma from '~/lib/prisma.server'
import { authenticate } from '~/shopify.server'
import {
  applyCustomerPricingDefaultsForShop,
  buildCustomerPricingSettingsPayload,
  normalizeCustomerId,
  normalizeProductId,
} from '~/lib/customerPricing.server'
import {
  buildVolumeProgramPayload,
  normalizeVolumeProgram,
  resolveCustomerPricingModelState,
} from '~/lib/customerPricingModel.server'
import { isCustomerPricingModel, MAX_VOLUME_LOOKBACK_MONTHS, validateVolumeLookbackMonths, type VolumeTier } from '~/lib/customerPricingShared'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function number(form: FormData, field: string, allowZero = false): number {
  const raw = String(form.get(field) ?? '').trim()
  const value = Number(raw)
  if (!raw || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${field} must be ${allowZero ? 'zero or a positive' : 'a positive'} number.`)
  }
  return value
}

function customerId(value: unknown): string {
  const raw = String(value || '').trim()
  if (!/^\d+$/.test(raw) && !/^gid:\/\/shopify\/Customer\/\d+$/.test(raw)) {
    throw new Error('Enter the Shopify customer ID, not a name, email or browser identifier.')
  }
  const id = normalizeCustomerId(raw)
  if (!id || id === '0') throw new Error('A valid Shopify customer ID is required.')
  return id
}

function productId(value: unknown): string {
  const raw = String(value || '').trim()
  if (!/^\d+$/.test(raw) && !/^gid:\/\/shopify\/Product\/\d+$/.test(raw)) {
    throw new Error('Enter the Shopify product ID, not its title or handle.')
  }
  return normalizeProductId(raw)!
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } })
  if (!shop) throw new Response('Shop not found', { status: 404 })
  const config = applyCustomerPricingDefaultsForShop(shop.shopDomain, shop.settings)
  const program = normalizeVolumeProgram(shop.settings, shop.shopDomain)
  const model = resolveCustomerPricingModelState(shop.shopDomain, shop.settings)
  return json({
    config: { ...config, assignments: config.assignments.map(({ customerEmail: _email, customerName: _name, ...entry }) => entry), tagRules: [] },
    program: { ...program, eligibleTags: [], eligibleCustomers: program.eligibleCustomers.map(entry => ({ ...entry, email: '', name: '' })) },
    model,
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } })
  if (!shop) return json({ error: 'Shop not found' }, { status: 404 })
  const form = await request.formData()
  const intent = String(form.get('intent') || '')
  const settings = asRecord(shop.settings)
  const config = applyCustomerPricingDefaultsForShop(shop.shopDomain, shop.settings)
  const program = normalizeVolumeProgram(shop.settings, shop.shopDomain)
  try {
    if (intent === 'model') {
      const model = String(form.get('model'))
      if (!isCustomerPricingModel(model)) throw new Error('Choose a pricing model.')
      config.model = model
      config.priority = form.get('priority') === 'volume_first' ? 'volume_first' : 'status_first'
      config.enabled = model === 'status_rates' || model === 'both'
    } else if (intent === 'status') {
      const key = String(form.get('key') || '').trim().toLowerCase()
      if (!/^[a-z0-9_-]{1,64}$/.test(key)) throw new Error('Status key must contain letters, numbers, dashes or underscores.')
      const existing = config.statuses.find(status => status.key === key)
      const rate = number(form, 'rate', existing?.type === 'standard')
      const label = String(form.get('label') || key).trim().slice(0, 80)
      if (existing) {
        existing.label = label
        existing.pricePerInch = rate
        existing.active = form.get('active') === 'on'
      } else {
        config.statuses.push({ id: key, key, label, type: 'vip', active: true, pricePerInch: rate, productRules: [] })
      }
    } else if (intent === 'rule') {
      const status = config.statuses.find(entry => entry.key === String(form.get('status')))
      if (!status) throw new Error('Choose an existing status.')
      const rawProductId = String(form.get('productId') || '').trim()
      const ruleProductId = rawProductId === '*' ? '*' : productId(rawProductId)
      const pricingMode = form.get('pricingMode') === 'variant_length' ? 'variant_length' : 'measured_length'
      const rate = number(form, 'rate')
      const rule = status.productRules.find(entry => entry.productId === ruleProductId)
      if (rule) Object.assign(rule, { pricingMode, pricePerInch: rate, active: true })
      else status.productRules.push({ id: `${status.key}-${ruleProductId}`, productId: ruleProductId, productLabel: ruleProductId,
        active: true, pricingMode, pricePerInch: rate })
    } else if (intent === 'assignment') {
      const id = customerId(form.get('customerId'))
      const statusKey = String(form.get('status'))
      if (!config.statuses.some(status => status.key === statusKey && status.active)) throw new Error('Choose an active status.')
      const existing = config.assignments.find(entry => entry.customerId === id)
      if (existing) { existing.statusKey = statusKey; existing.active = true }
      else config.assignments.push({ customerId: id, statusKey, active: true, pricePerInchOverride: null, productOverrides: [] })
    } else if (intent === 'remove-assignment') {
      const id = customerId(form.get('customerId'))
      config.assignments = config.assignments.filter(entry => entry.customerId !== id)
    } else if (intent === 'volume') {
      const lines = String(form.get('tiers') || '').trim().split(/\r?\n/).filter(Boolean)
      const tiers: VolumeTier[] = lines.map(line => {
        const [minRaw, maxRaw, rateRaw] = line.split(',').map(value => value.trim())
        const min = Number(minRaw), max = maxRaw === '' ? null : Number(maxRaw), rate = Number(rateRaw)
        if (!minRaw || !rateRaw || !Number.isFinite(min) || min < 0 || !Number.isFinite(rate) || rate <= 0 ||
          (max !== null && (!Number.isFinite(max) || max < min))) throw new Error('Each tier must be minimum inches, maximum inches (blank for no limit), positive price per inch.')
        return { min_qty: min, max_qty: max, price_per_inch: rate, price_per_sqin: rate, label: `${min}+ inches` }
      }).sort((a, b) => a.min_qty - b.min_qty)
      if (!tiers.length) throw new Error('Enter at least one tier before saving volume pricing.')
      for (let index = 1; index < tiers.length; index++) {
        const previous = tiers[index - 1]
        if (previous.max_qty === null || tiers[index].min_qty <= previous.max_qty) throw new Error('Volume tier ranges must not overlap.')
      }
      const ids = [...new Set(String(form.get('eligibleIds') || '').split(/[\s,]+/).filter(Boolean).map(customerId))]
      const products = [...new Set(String(form.get('productIds') || '').split(/[\s,]+/).filter(Boolean).map(productId))]
      program.enabled = form.get('enabled') === 'on'
      program.tiers = tiers
      program.products = products.map(id => program.products.find(entry => entry.productId === id) || ({ productId: id, title: id }))
      program.eligibleCustomers = ids.map(id => program.eligibleCustomers.find(entry => entry.customerId === id) || {
        customerId: id, email: '', name: '', totalInches: 0, dtfInches: 0, uvInches: 0, orders: 0,
        lastOrder: '', lastOrderedAt: '', source: 'manual',
      })
      program.checkoutMode = form.get('checkoutMode') === 'standard_cart' ? 'standard_cart' : 'custom_checkout'
      program.billingBasis = form.get('billingBasis') === 'variant_length' ? 'variant_length' : 'measured_length'
      program.autoEligibility = { enabled: form.get('autoEnabled') === 'on', months: validateVolumeLookbackMonths(form.get('months')), minInches: number(form, 'minInches') }
    } else throw new Error('Unknown pricing action.')

    // Keep rates, product overrides, measurement policy and unrelated settings.
    // Contact fields and tag rules have no job in the public app's ID assignments.
    config.tagRules = []
    config.assignments = config.assignments.map(({ customerEmail: _email, customerName: _name, ...entry }) => entry)
    program.eligibleTags = []
    program.eligibleCustomers = program.eligibleCustomers.map(entry => ({ ...entry, email: '', name: '' }))
    const pricingPayload = { ...asRecord(settings.customerPricing), ...buildCustomerPricingSettingsPayload(config) }
    pricingPayload.assignments = config.assignments
    const next = { ...settings, customerPricing: pricingPayload,
      // An unrelated status edit must not serialize derived volume defaults.
      ...(intent === 'volume' ? { alphaProDiscount: buildVolumeProgramPayload(program, settings.alphaProDiscount) } : {}) }
    await prisma.shop.update({ where: { id: shop.id }, data: { settings: next as Prisma.InputJsonObject } })
    await prisma.auditLog.create({ data: { shopId: shop.id, action: 'customer_pricing_updated',
      resourceType: 'pricing', resourceId: shop.id, metadata: { intent } } })
    return json({ success: 'Pricing saved. New quotes use these settings; existing orders are unchanged.' })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Pricing could not be saved.' }, { status: 400 })
  }
}

const fieldStyle = { padding: '8px', border: '1px solid #8c9196', borderRadius: '4px', width: '100%', maxWidth: '480px' }
function Field({ label, name, value, multiline = false, max }: { label: string; name: string; value?: string | number; multiline?: boolean; max?: number }) {
  return <label style={{ display: 'block' }}><Text as="span">{label}</Text><br />
    {multiline ? <textarea name={name} defaultValue={value} rows={4} style={fieldStyle} /> : <input name={name} defaultValue={value} style={fieldStyle} autoComplete="off" type={max ? 'number' : 'text'} min={max ? 1 : undefined} max={max} step={max ? 1 : undefined} />}
  </label>
}
function StatusSelect({ statuses, value }: { statuses: Array<{ key: string; label: string }>; value?: string }) {
  return <label>Status <select name="status" defaultValue={value} style={fieldStyle}>{statuses.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}</select></label>
}

export default function CustomerPricingPage() {
  const { config, program, model } = useLoaderData<typeof loader>()
  const result = useActionData<typeof action>()
  const busy = useNavigation().state !== 'idle'
  return <Page title="Customer pricing" subtitle="Assign prices by Shopify customer ID. Film length is measured; quantity repeats the whole sheet.">
    <BlockStack gap="500">
      {result && 'error' in result ? <Banner tone="critical">{result.error}</Banner> : null}
      {result && 'success' in result ? <Banner tone="success">{result.success}</Banner> : null}
      <Banner>Customer IDs come from the signed Shopify storefront session. Names, emails, profiles and tags are not collected. Rates are in your store currency per inch.</Banner>
      <Card><Form method="post"><input type="hidden" name="intent" value="model" /><BlockStack gap="300">
        <Text as="h2" variant="headingMd">Pricing model</Text>
        <label>Model <select name="model" defaultValue={model.model} style={fieldStyle}>
          <option value="off">Standard product pricing</option><option value="status_rates">Assigned account rates</option>
          <option value="volume_tiers">Volume tiers</option><option value="both">Assigned rates and volume tiers</option>
        </select></label>
        <label>When both apply <select name="priority" defaultValue={model.priority} style={fieldStyle}><option value="status_first">Use assigned account rate</option><option value="volume_first">Use volume tier</option></select></label>
        <Text as="p">Turning off volume pricing removes expired customer-history links after production files expire. Enabling it again cannot recover removed history.</Text>
        <Button submit disabled={busy}>Save model</Button>
      </BlockStack></Form></Card>

      <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Account statuses</Text>
        {config.statuses.map(status => <Form method="post" key={status.key}><input type="hidden" name="intent" value="status" /><input type="hidden" name="key" value={status.key} />
          <BlockStack gap="200"><Field label={`Status ${status.key}`} name="label" value={status.label} /><Field label="Fallback price per inch" name="rate" value={status.pricePerInch} />
            <label><input type="checkbox" name="active" defaultChecked={status.active} /> Active</label><Button submit disabled={busy}>Save status</Button>
            {status.productRules.map(rule => <Text as="p" key={rule.id}>{rule.productLabel}: {rule.pricingMode}, {rule.pricePerInch}/in. Explicit product rules take precedence over the fallback rate.</Text>)}
          </BlockStack></Form>)}
        <Form method="post"><input type="hidden" name="intent" value="status" /><BlockStack gap="200">
          <Field label="New status key" name="key" /><Field label="Label" name="label" /><Field label="Price per inch" name="rate" />
          <Button submit disabled={busy}>Add status</Button>
        </BlockStack></Form>
      </BlockStack></Card>

      <Card><Form method="post"><input type="hidden" name="intent" value="rule" /><BlockStack gap="300">
        <Text as="h2" variant="headingMd">Product price rule</Text><StatusSelect statuses={config.statuses} />
        <Field label="Product ID (* for all products)" name="productId" value="*" />
        <label>Price by <select name="pricingMode" style={fieldStyle}><option value="measured_length">Measured finished-sheet length</option><option value="variant_length">Smallest covering variant length</option></select></label>
        <Field label="Price per inch" name="rate" /><Button submit disabled={busy}>Save product rule</Button>
      </BlockStack></Form></Card>

      <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Customer ID assignments</Text>
        <Text as="p">Copy the customer ID from Shopify's customer page URL. Signing in selects that account's price. No customer-directory permission is needed.</Text>
        {config.assignments.map(entry => <InlineStack key={entry.customerId} align="space-between">
          <Text as="p">ID {entry.customerId}: {entry.statusKey}{entry.pricePerInchOverride !== null ? ` (${entry.pricePerInchOverride}/in override)` : ''}</Text>
          <Form method="post"><input type="hidden" name="intent" value="remove-assignment" /><input type="hidden" name="customerId" value={entry.customerId} /><Button submit tone="critical" disabled={busy}>Remove assignment</Button></Form>
        </InlineStack>)}
        <Form method="post"><input type="hidden" name="intent" value="assignment" /><BlockStack gap="200"><Field label="Shopify customer ID" name="customerId" /><StatusSelect statuses={config.statuses} /><Button submit disabled={busy}>Assign status</Button></BlockStack></Form>
      </BlockStack></Card>

      <Card><Form method="post"><input type="hidden" name="intent" value="volume" /><BlockStack gap="300">
        <Text as="h2" variant="headingMd">Volume tiers</Text><label><input type="checkbox" name="enabled" defaultChecked={program.enabled} /> Enable program (the pricing model must also include volume tiers)</label>
        <Field label="Product IDs, separated by commas" name="productIds" value={program.products.map(product => product.productId).join(', ')} />
        <Field label="Eligible Shopify customer IDs, one per line" name="eligibleIds" value={program.eligibleCustomers.map(entry => entry.customerId).join('\n')} multiline />
        <Field label="Tiers: minimum inches, maximum inches (blank for unlimited), price per inch" name="tiers" value={program.tiers.map(tier => `${tier.min_qty},${tier.max_qty ?? ''},${tier.price_per_inch}`).join('\n')} multiline />
        <label>Checkout <select name="checkoutMode" defaultValue={program.checkoutMode} style={fieldStyle}><option value="custom_checkout">App quotes the tier price</option><option value="standard_cart">Shopify variant/discount supplies the price</option></select></label>
        <label>Billable length <select name="billingBasis" defaultValue={program.billingBasis} style={fieldStyle}><option value="measured_length">Measured file length</option><option value="variant_length">Selected sheet variant length</option></select></label>
        <label><input type="checkbox" name="autoEnabled" defaultChecked={program.autoEligibility.enabled} /> Qualify from paid sheet volume automatically</label>
        <Field label="Lookback months (1–12; default 12)" name="months" value={program.autoEligibility.months} max={MAX_VOLUME_LOOKBACK_MONTHS} /><Field label="Minimum paid inches" name="minInches" value={program.autoEligibility.minInches} />
        <Text as="p">A month is 30 days. Shortening this window or disabling automatic volume pricing removes older customer-history links after production files expire (normally 90 days). Later lengthening or re-enabling cannot recover removed history. Accounting and duplicate-charge protection stay intact.</Text>
        <Text as="p">Saving these visible numbers changes future quotes. Account/status edits preserve existing product rules and volume rates.</Text>
        <Button submit disabled={busy}>Save volume program</Button>
      </BlockStack></Form></Card>
    </BlockStack>
  </Page>
}
