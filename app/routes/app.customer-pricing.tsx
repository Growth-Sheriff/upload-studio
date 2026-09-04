import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { Prisma } from '@prisma/client'
import { json } from '@remix-run/node'
import { Form, useActionData, useLoaderData, useNavigation, useSubmit } from '@remix-run/react'
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  ContextualSaveBar,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Select,
  Text,
  TextField,
} from '@shopify/polaris'
import { useCallback, useEffect, useMemo, useState } from 'react'
import prisma from '~/lib/prisma.server'
import type {
  CustomerPricingAssignment,
  CustomerPricingSettings,
  CustomerPricingStatus,
  ProductRuleCatalogItem,
} from '~/lib/customerPricing.server'
import {
  CUSTOMER_PRICING_TEMPLATES,
  buildVolumeProgramPayload,
  normalizePolicy,
  normalizeVolumeProgram,
  normalizeVolumeTiers,
  resolveCustomerPricingModelState,
  derivePolicyDefaults,
  type CustomerPricingPolicy,
  type VolumeProgram,
  type VolumeProgramCustomer,
} from '~/lib/customerPricingModel.server'
import { isCustomerPricingModel, pickVolumeTier, type CustomerPricingModel, type VolumeTier } from '~/lib/customerPricingShared'
import { invalidatePricingRuntimeCaches } from '~/lib/customerPricingRuntime.server'
import { applyFullCanvasMeasurementMetadata, deriveUploadItemLifecycle } from '~/lib/uploadLifecycle.server'
import { authenticate } from '~/shopify.server'

// ── Shopify queries ────────────────────────────────────────────────────────

const CUSTOMER_SEARCH_QUERY = `#graphql
  query CustomerPricingSearch($query: String!) {
    customers(first: 25, query: $query) {
      edges {
        node {
          id
          legacyResourceId
          displayName
          email
          tags
        }
      }
    }
  }
`

const PRODUCT_TITLES_QUERY = `#graphql
  query CustomerPricingProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
      }
    }
  }
`

const PRODUCT_BY_HANDLE_QUERY = `#graphql
  query CustomerPricingProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
    }
  }
`

// ── Types ──────────────────────────────────────────────────────────────────

interface SearchCustomer {
  id: string
  displayName: string
  email: string | null
  tags: string[]
}

interface ResolvedProduct {
  id: string
  title: string
  handle?: string | null
}

interface ProductRuleEditor {
  id: string
  productId: string
  productLabel: string
  active: boolean
  pricingMode: 'standard_variant' | 'variant_length' | 'measured_length'
  pricePerInch: string
}

interface StatusEditor {
  id: string
  key: string
  label: string
  type: 'standard' | 'business' | 'vip'
  active: boolean
  pricePerInch: string
  productRules: ProductRuleEditor[]
}

interface TagRuleEditor {
  id: string
  tag: string
  statusKey: string
}

interface TierEditor {
  id: string
  minQty: string
  maxQty: string
  pricePerInch: string
  label: string
  popular: boolean
}

interface VolumeCustomerEditor {
  id: string
  customerId: string
  name: string
  email: string
  totalInches: string
  orders: string
  lastOrderedAt: string
  source: 'manual' | 'import' | 'auto'
}

interface PolicyEditor {
  measurementBasis: CustomerPricingPolicy['measurementBasis']
  sheetSelection: CustomerPricingPolicy['sheetSelection']
  fitToleranceIn: string
  maxSheetWidthIn: string
  artboardMarginIn: string
  imageMarginIn: string
}

interface VolumeCandidate {
  customerId: string
  email: string
  name: string
  totalInches: number
  orders: number
  lastOrderedAt: string
  alreadyEligible: boolean
}

interface SetupStep {
  key: string
  title: string
  description: string
  done: boolean
}

type CustomerPricingActionData = {
  success: boolean
  message?: string
  error?: string
}

// ── Small helpers ──────────────────────────────────────────────────────────

function customerIdFromGraphql(node: { legacyResourceId?: string | number | null; id: string }): string {
  if (node.legacyResourceId != null && node.legacyResourceId !== '') {
    return String(node.legacyResourceId)
  }
  const parts = String(node.id || '').split('/')
  return parts[parts.length - 1] || String(node.id || '')
}

function parseLocalizedPositiveNumber(value: unknown, fallback = 0): number {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[^0-9,.-]/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function formatEditableRate(value: number | null | undefined): string {
  if (!Number.isFinite(value) || Number(value) <= 0) return ''
  return Number(value).toFixed(4).replace(/\.?0+$/, '')
}

function formatEditableNumber(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value == null) return ''
  return Number(value).toFixed(3).replace(/\.?0+$/, '')
}

function formatRate(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value == null || Number(value) <= 0) return 'Not set'
  const normalized = Number(value)
  const formatted = normalized.toFixed(normalized % 0.01 === 0 ? 2 : 4).replace(/\.?0+$/, '')
  return `$${formatted} / in`
}

function formatMoney(value: number): string {
  return `$${(Number(value) || 0).toFixed(2)}`
}

function formatTierRange(tier: { min_qty: number; max_qty: number | null }): string {
  return tier.max_qty == null
    ? `${tier.min_qty.toLocaleString()}+ inches`
    : `${tier.min_qty.toLocaleString()}-${tier.max_qty.toLocaleString()} inches`
}

function normalizeProductIdLocal(value: string | number | null | undefined): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (raw === '*') return '*'
  return raw.startsWith('gid://') ? raw : `gid://shopify/Product/${raw}`
}

function slugifyStatusKey(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'status'
}

function buildUniqueStatusKey(statuses: Array<{ key: string }>, label: string): string {
  const baseKey = slugifyStatusKey(label)
  const existingKeys = new Set(statuses.map((status) => status.key))
  if (!existingKeys.has(baseKey)) return baseKey
  let index = 2
  while (existingKeys.has(`${baseKey}-${index}`)) index += 1
  return `${baseKey}-${index}`
}

function editorId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeProductGidInput(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (/^gid:\/\/shopify\/ProductVariant\//i.test(raw)) {
    throw new Error('Use a Shopify product, not a product variant.')
  }
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(raw)) return raw
  if (/^\d+$/.test(raw)) return `gid://shopify/Product/${raw}`
  return null
}

function extractProductHandle(value: string): string | null {
  const raw = value.trim()
  if (!raw || /^gid:\/\//i.test(raw) || /^\d+$/.test(raw)) return null
  try {
    const url = new URL(raw)
    const parts = url.pathname.split('/').filter(Boolean)
    const productIndex = parts.findIndex((part) => part.toLowerCase() === 'products')
    if (productIndex >= 0 && parts[productIndex + 1]) {
      return decodeURIComponent(parts[productIndex + 1]).trim()
    }
  } catch {
    // not a URL
  }
  const withoutQuery = raw.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '')
  const productPathMatch = withoutQuery.match(/(?:^|\/)products\/([^/]+)$/i)
  if (productPathMatch?.[1]) return decodeURIComponent(productPathMatch[1]).trim()
  if (/^[a-z0-9][a-z0-9-]*$/i.test(withoutQuery)) return withoutQuery
  return null
}

function pricingModeForStatusType(statusType: CustomerPricingStatus['type']): ProductRuleEditor['pricingMode'] {
  if (statusType === 'business') return 'variant_length'
  if (statusType === 'vip') return 'measured_length'
  return 'standard_variant'
}

function buildProductRuleId(statusKey: string, productId: string): string {
  const suffix = productId.split('/').pop() || productId.replace(/[^a-z0-9]+/gi, '-')
  return `${statusKey}_${suffix}`
}

async function resolveProduct(
  admin: Awaited<ReturnType<typeof authenticate.admin>>['admin'],
  input: string
): Promise<ResolvedProduct> {
  const raw = input.trim()
  if (!raw) throw new Error('Product URL, handle, or product ID is required.')

  const productId = normalizeProductGidInput(raw)
  if (productId) {
    const response = await admin.graphql(PRODUCT_TITLES_QUERY, { variables: { ids: [productId] } })
    const payload = await response.json()
    const node = Array.isArray(payload?.data?.nodes) ? payload.data.nodes[0] : null
    if (!node?.id) throw new Error('Product was not found in Shopify.')
    return { id: node.id, title: String(node.title || node.id), handle: node.handle || null }
  }

  const handle = extractProductHandle(raw)
  if (!handle) throw new Error('Enter a Shopify product URL, product handle, or numeric product ID.')
  const response = await admin.graphql(PRODUCT_BY_HANDLE_QUERY, { variables: { handle } })
  const payload = await response.json()
  const product = payload?.data?.productByHandle
  if (!product?.id) throw new Error(`No Shopify product found for handle "${handle}".`)
  return { id: product.id, title: String(product.title || product.id), handle: product.handle || handle }
}

function buildCustomerSearchQueries(search: string): string[] {
  if (!search) return []
  if (search.includes(':')) return [search]
  if (search.includes('@')) return [`email:${search}`, search]
  return [search]
}

// ── Editors <-> settings ───────────────────────────────────────────────────

function toStatusEditor(status: CustomerPricingStatus): StatusEditor {
  return {
    id: status.id,
    key: status.key,
    label: status.label,
    type: status.type,
    active: status.active,
    pricePerInch: formatEditableRate(status.pricePerInch),
    productRules: status.productRules.map((rule) => ({
      id: rule.id || buildProductRuleId(status.key, rule.productId),
      productId: normalizeProductIdLocal(rule.productId) || rule.productId,
      productLabel: rule.productLabel || rule.productId,
      active: rule.active,
      pricingMode: rule.pricingMode || pricingModeForStatusType(status.type),
      pricePerInch: formatEditableRate(rule.pricePerInch ?? status.pricePerInch),
    })),
  }
}

function serializeStatuses(statuses: StatusEditor[]) {
  return statuses.map((status) => ({
    id: status.id,
    key: status.key,
    label: status.label,
    type: status.type,
    active: status.active,
    pricePerInch: parseLocalizedPositiveNumber(status.pricePerInch, 0),
    productRules: status.productRules.map((rule) => ({
      id: rule.id,
      productId: rule.productId,
      productLabel: rule.productLabel,
      active: rule.active,
      pricingMode: rule.pricingMode,
      pricePerInch: parseLocalizedPositiveNumber(rule.pricePerInch, 0),
    })),
  }))
}

function toTierEditor(tier: VolumeTier, index: number): TierEditor {
  return {
    id: `tier_${index}_${tier.min_qty}_${tier.max_qty ?? 'up'}`,
    minQty: String(tier.min_qty),
    maxQty: tier.max_qty == null ? '' : String(tier.max_qty),
    pricePerInch: formatEditableRate(tier.price_per_inch),
    label: tier.label || formatTierRange(tier),
    popular: Boolean(tier.popular),
  }
}

function serializeTiers(tiers: TierEditor[]) {
  return tiers.map((tier) => ({
    min_qty: tier.minQty,
    max_qty: tier.maxQty,
    price_per_inch: tier.pricePerInch,
    label: tier.label,
    popular: tier.popular,
  }))
}

function toVolumeCustomerEditor(customer: VolumeProgramCustomer, index: number): VolumeCustomerEditor {
  return {
    id: `customer_${index}_${customer.customerId || customer.email || index}`,
    customerId: customer.customerId,
    name: customer.name,
    email: customer.email,
    totalInches: formatEditableNumber(customer.totalInches),
    orders: String(Math.round(customer.orders || 0)),
    lastOrderedAt: customer.lastOrderedAt,
    source: customer.source,
  }
}

function serializeVolumeCustomers(customers: VolumeCustomerEditor[]) {
  return customers.map((customer) => ({
    customerId: customer.customerId,
    name: customer.name,
    email: customer.email,
    totalInches: customer.totalInches,
    orders: customer.orders,
    lastOrderedAt: customer.lastOrderedAt,
    source: customer.source,
  }))
}

function toPolicyEditor(policy: CustomerPricingPolicy): PolicyEditor {
  return {
    measurementBasis: policy.measurementBasis,
    sheetSelection: policy.sheetSelection,
    fitToleranceIn: formatEditableNumber(policy.fitToleranceIn),
    maxSheetWidthIn: formatEditableNumber(policy.maxSheetWidthIn),
    artboardMarginIn: formatEditableNumber(policy.artboardMarginIn),
    imageMarginIn: formatEditableNumber(policy.imageMarginIn),
  }
}

function serializePolicy(policy: PolicyEditor) {
  return {
    measurementBasis: policy.measurementBasis,
    sheetSelection: policy.sheetSelection,
    fitToleranceIn: policy.fitToleranceIn,
    maxSheetWidthIn: policy.maxSheetWidthIn,
    artboardMarginIn: policy.artboardMarginIn,
    imageMarginIn: policy.imageMarginIn,
  }
}

function tierValidationMessage(tiers: TierEditor[]): string | null {
  const parsed = tiers.map((tier) => ({
    min: Math.round(parseLocalizedPositiveNumber(tier.minQty, 0)),
    max: tier.maxQty.trim() === '' ? null : Math.round(parseLocalizedPositiveNumber(tier.maxQty, 0)),
    rate: parseLocalizedPositiveNumber(tier.pricePerInch, 0),
  }))
  for (const tier of parsed) {
    if (!(tier.min >= 1)) return 'Every tier needs a minimum of at least 1 inch.'
    if (tier.max != null && tier.max < tier.min) return 'A tier maximum cannot be lower than its minimum.'
    if (!(tier.rate > 0)) return 'Every tier needs a price per inch above zero.'
  }
  const sorted = parsed.slice().sort((left, right) => left.min - right.min)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    if (previous.max == null) return 'Only the last tier can leave "Maximum inches" blank.'
    if (sorted[index].min <= previous.max) return 'Tier ranges overlap. Each tier must start after the previous one ends.'
  }
  return null
}

// ── Product config sync for volume products ────────────────────────────────

function buildVolumeBuilderConfig(
  existingBuilderConfig: unknown,
  productIds: string[],
  tiers: VolumeTier[],
  checkoutMode: VolumeProgram['checkoutMode']
): Prisma.InputJsonObject {
  const base = existingBuilderConfig && typeof existingBuilderConfig === 'object'
    ? (existingBuilderConfig as Record<string, unknown>)
    : {}
  return {
    ...base,
    pricingMode: base.pricingMode === 'sheet' ? 'sheet' : 'area',
    volumeDiscountTierUnit: 'linear_inches',
    volumeDiscountTiers: tiers as unknown as Prisma.InputJsonValue,
    alphaProDiscount: {
      enabled: true,
      unit: 'linear_inches',
      unitLabel: 'billable inches',
      products: productIds,
      checkoutMode,
      source: 'customer_pricing_editor',
    },
  } as Prisma.InputJsonObject
}

function buildDisabledVolumeBuilderConfig(existingBuilderConfig: unknown): Prisma.InputJsonObject {
  const base = existingBuilderConfig && typeof existingBuilderConfig === 'object'
    ? (existingBuilderConfig as Record<string, unknown>)
    : {}
  const existingDiscount = base.alphaProDiscount && typeof base.alphaProDiscount === 'object'
    ? (base.alphaProDiscount as Record<string, unknown>)
    : {}
  return {
    ...base,
    alphaProDiscount: { ...existingDiscount, enabled: false, source: 'customer_pricing_editor' },
  } as Prisma.InputJsonObject
}

async function syncVolumeProductConfigs(shopId: string, previous: VolumeProgram, next: VolumeProgram) {
  const activeProductIds = next.products.map((product) => product.productId)
  const previousProductIds = previous.products.map((product) => product.productId)
  const touched = Array.from(new Set(activeProductIds.concat(previousProductIds)))
  if (!touched.length) return []
  const existing = await prisma.productConfig.findMany({
    where: { shopId, productId: { in: touched } },
    select: { productId: true, builderConfig: true },
  })
  const existingMap = new Map(existing.map((config) => [config.productId, config.builderConfig]))
  const disabled = touched.filter((productId) => !activeProductIds.includes(productId))

  return [
    ...activeProductIds.map((productId) =>
      prisma.productConfig.upsert({
        where: { shopId_productId: { shopId, productId } },
        update: {
          enabled: true,
          uploadEnabled: true,
          mode: 'dtf',
          builderConfig: buildVolumeBuilderConfig(existingMap.get(productId), activeProductIds, next.tiers, next.checkoutMode),
        },
        create: {
          shopId,
          productId,
          enabled: true,
          uploadEnabled: true,
          mode: 'dtf',
          builderConfig: buildVolumeBuilderConfig(null, activeProductIds, next.tiers, next.checkoutMode),
        },
      })
    ),
    ...disabled
      .filter((productId) => existingMap.has(productId))
      .map((productId) =>
        prisma.productConfig.update({
          where: { shopId_productId: { shopId, productId } },
          data: { builderConfig: buildDisabledVolumeBuilderConfig(existingMap.get(productId)) },
        })
      ),
  ]
}

// ── CSV import ─────────────────────────────────────────────────────────────

function parseCustomerCsv(text: string): VolumeProgramCustomer[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const splitLine = (line: string) => line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ''))
  const first = splitLine(lines[0]).map((cell) => cell.toLowerCase())
  const looksLikeHeader = first.some((cell) => /email|customer|name|inch|order/.test(cell)) && !first.some((cell) => cell.includes('@'))
  const header = looksLikeHeader ? first : null
  const rows = looksLikeHeader ? lines.slice(1) : lines
  const columnIndex = (candidates: string[]) =>
    header ? header.findIndex((cell) => candidates.some((candidate) => cell.includes(candidate))) : -1

  const emailIndex = columnIndex(['email'])
  const idIndex = columnIndex(['customer id', 'customer_id', 'customerid', 'id'])
  const nameIndex = columnIndex(['name'])
  const inchesIndex = columnIndex(['total inch', 'inches', 'inch'])
  const ordersIndex = columnIndex(['order'])
  const lastIndex = columnIndex(['last order', 'ordered at', 'date'])

  const customers: VolumeProgramCustomer[] = []
  for (const line of rows) {
    const cells = splitLine(line)
    let email = ''
    let customerId = ''
    let name = ''
    let totalInches = 0
    let orders = 0
    let lastOrderedAt = ''
    if (header) {
      email = emailIndex >= 0 ? String(cells[emailIndex] || '') : ''
      customerId = idIndex >= 0 ? String(cells[idIndex] || '') : ''
      name = nameIndex >= 0 ? String(cells[nameIndex] || '') : ''
      totalInches = inchesIndex >= 0 ? parseLocalizedPositiveNumber(cells[inchesIndex], 0) : 0
      orders = ordersIndex >= 0 ? Math.round(parseLocalizedPositiveNumber(cells[ordersIndex], 0)) : 0
      lastOrderedAt = lastIndex >= 0 ? String(cells[lastIndex] || '') : ''
    } else {
      // Header-less lines: any cell with @ is the email, a long digit run is the id, the rest is the name.
      for (const cell of cells) {
        if (!email && cell.includes('@')) email = cell
        else if (!customerId && /^\d{6,}$/.test(cell)) customerId = cell
        else if (!name && cell && !/^\d+([.,]\d+)?$/.test(cell)) name = cell
        else if (!totalInches && /^\d+([.,]\d+)?$/.test(cell)) totalInches = parseLocalizedPositiveNumber(cell, 0)
      }
    }
    email = email.trim().toLowerCase()
    customerId = customerId.replace(/\D/g, '')
    if (!email && !customerId) continue
    customers.push({
      customerId,
      email,
      name: name.trim() || email || customerId,
      totalInches,
      dtfInches: 0,
      uvInches: 0,
      orders,
      lastOrder: '',
      lastOrderedAt: lastOrderedAt.trim(),
      source: 'import',
    })
  }
  return customers
}

function mergeVolumeCustomers(
  existing: VolumeProgramCustomer[],
  incoming: VolumeProgramCustomer[]
): { merged: VolumeProgramCustomer[]; added: number; updated: number } {
  const merged = existing.slice()
  let added = 0
  let updated = 0
  for (const customer of incoming) {
    const index = merged.findIndex(
      (entry) =>
        (customer.customerId && entry.customerId === customer.customerId) ||
        (customer.email && entry.email === customer.email)
    )
    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        customerId: merged[index].customerId || customer.customerId,
        email: merged[index].email || customer.email,
        name: customer.name || merged[index].name,
        totalInches: customer.totalInches || merged[index].totalInches,
        orders: customer.orders || merged[index].orders,
        lastOrderedAt: customer.lastOrderedAt || merged[index].lastOrderedAt,
      }
      updated += 1
    } else {
      merged.push(customer)
      added += 1
    }
  }
  return { merged, added, updated }
}

// ── Returning-customer suggestions from our own order data ─────────────────

async function findVolumeCandidates(
  shopId: string,
  months: number,
  minInches: number,
  basis: CustomerPricingPolicy['measurementBasis'],
  program: VolumeProgram
): Promise<VolumeCandidate[]> {
  const since = new Date(Date.now() - Math.max(1, months) * 30 * 24 * 3600 * 1000)
  const uploads = await prisma.upload.findMany({
    where: { shopId, orderPaidAt: { gte: since }, customerId: { not: null } },
    select: {
      customerId: true,
      customerEmail: true,
      requestedCopies: true,
      sheetsNeeded: true,
      orderPaidAt: true,
      items: { orderBy: { createdAt: 'asc' }, take: 1, select: { preflightStatus: true, preflightResult: true } },
    },
    take: 5000,
  })

  const totals = new Map<string, VolumeCandidate>()
  for (const upload of uploads) {
    const customerId = String(upload.customerId || '').replace(/\D/g, '')
    if (!customerId) continue
    const item = upload.items[0]
    if (!item) continue
    const lifecycle = deriveUploadItemLifecycle(item)
    const metadata = basis === 'full_page' ? applyFullCanvasMeasurementMetadata(lifecycle.metadata) : lifecycle.metadata
    if (!metadata || lifecycle.measurementStatus !== 'ready') continue
    const lengthIn = Math.max(Number(metadata.widthIn) || 0, Number(metadata.heightIn) || 0)
    const copies = Math.max(1, Number(upload.requestedCopies) || Number(upload.sheetsNeeded) || 1)
    const current = totals.get(customerId) || {
      customerId,
      email: String(upload.customerEmail || '').toLowerCase(),
      name: '',
      totalInches: 0,
      orders: 0,
      lastOrderedAt: '',
      alreadyEligible: false,
    }
    current.totalInches = Number((current.totalInches + lengthIn * copies).toFixed(2))
    current.orders += 1
    const paidAt = upload.orderPaidAt ? upload.orderPaidAt.toISOString() : ''
    if (paidAt > current.lastOrderedAt) current.lastOrderedAt = paidAt
    if (!current.email && upload.customerEmail) current.email = String(upload.customerEmail).toLowerCase()
    totals.set(customerId, current)
  }

  return Array.from(totals.values())
    .filter((candidate) => candidate.totalInches >= minInches)
    .map((candidate) => ({
      ...candidate,
      alreadyEligible: program.eligibleCustomers.some(
        (entry) => entry.customerId === candidate.customerId || (candidate.email && entry.email === candidate.email)
      ),
    }))
    .sort((left, right) => right.totalInches - left.totalInches)
    .slice(0, 200)
}

async function loadProductCatalog(
  admin: Awaited<ReturnType<typeof authenticate.admin>>['admin'],
  config: CustomerPricingSettings,
  program: VolumeProgram
): Promise<ProductRuleCatalogItem[]> {
  const productLabels = new Map<string, string>()
  const addProductLabel = (productIdInput: string, labelInput?: string | null) => {
    const productId = normalizeProductIdLocal(productIdInput)
    if (!productId || productId === '*') return
    productLabels.set(productId, String(labelInput || productId).trim() || productId)
  }
  for (const status of config.statuses) for (const rule of status.productRules) addProductLabel(rule.productId, rule.productLabel)
  for (const assignment of config.assignments) for (const override of assignment.productOverrides) addProductLabel(override.productId, null)
  for (const product of program.products) addProductLabel(product.productId, product.title)

  const productIds = Array.from(productLabels.keys())
  if (!productIds.length) return []
  try {
    const response = await admin.graphql(PRODUCT_TITLES_QUERY, { variables: { ids: productIds } })
    const payload = await response.json()
    const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : []
    const shopifyLabels = new Map<string, string>(
      nodes
        .filter((node: { id?: string } | null) => Boolean(node?.id))
        .map((node: { id: string; title?: string | null }) => [node.id, String(node.title || productLabels.get(node.id) || node.id)] as [string, string])
    )
    return productIds.map((productId) => ({
      productId,
      label: shopifyLabels.get(productId) || productLabels.get(productId) || productId,
    }))
  } catch (error) {
    console.error('[Customer Pricing] Product title lookup failed:', error)
    return productIds.map((productId) => ({ productId, label: productLabels.get(productId) || productId }))
  }
}

// ── Loader ─────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { applyCustomerPricingDefaultsForShop } = await import('~/lib/customerPricing.server')
  const { session, admin } = await authenticate.admin(request)
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, settings: true },
  })

  const shopSettings = (shop?.settings as Record<string, unknown> | null) || {}
  const config = applyCustomerPricingDefaultsForShop(session.shop, shopSettings)
  const modelState = resolveCustomerPricingModelState(session.shop, shopSettings)
  const program = normalizeVolumeProgram(shopSettings, session.shop)
  const productCatalog = await loadProductCatalog(admin, config, program)
  const url = new URL(request.url)
  const search = String(url.searchParams.get('q') || '').trim()
  const suggest = url.searchParams.get('suggest') === '1'
  let searchResults: SearchCustomer[] = []

  if (search) {
    const attemptedQueries = Array.from(new Set(buildCustomerSearchQueries(search)))
    for (const customerQuery of attemptedQueries) {
      try {
        const response = await admin.graphql(CUSTOMER_SEARCH_QUERY, { variables: { query: customerQuery } })
        const payload = await response.json()
        const edges = payload?.data?.customers?.edges || []
        const nextResults = edges.map(
          (edge: { node: { id: string; legacyResourceId?: string | number | null; displayName?: string; email?: string | null; tags?: string[] } }) => ({
            id: customerIdFromGraphql(edge.node),
            displayName: edge.node.displayName || edge.node.email || customerIdFromGraphql(edge.node),
            email: edge.node.email || null,
            tags: Array.isArray(edge.node.tags) ? edge.node.tags : [],
          })
        )
        if (nextResults.length) {
          searchResults = nextResults
          break
        }
      } catch (error) {
        console.error('[Customer Pricing] Customer search failed:', error)
      }
    }
  }

  const candidates = suggest && shop
    ? await findVolumeCandidates(shop.id, program.autoEligibility.months, program.autoEligibility.minInches, modelState.policy.measurementBasis, program)
    : null

  const [uploadCount, recentUploadCount] = shop
    ? await Promise.all([
        prisma.upload.count({ where: { shopId: shop.id } }),
        prisma.upload.count({ where: { shopId: shop.id, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } }),
      ])
    : [0, 0]

  const storeHandle = session.shop.replace(/\.myshopify\.com$/i, '')

  return json({
    config,
    modelState,
    program,
    policyDefaults: derivePolicyDefaults(session.shop),
    productCatalog,
    search,
    searchResults,
    candidates,
    uploadCount,
    recentUploadCount,
    themesUrl: `https://admin.shopify.com/store/${storeHandle}/themes`,
    templates: CUSTOMER_PRICING_TEMPLATES,
  })
}

// ── Action ─────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const {
    applyCustomerPricingDefaultsForShop,
    buildCustomerPricingSettingsPayload,
    normalizeCustomerId,
    normalizeCustomerPricingSettings,
  } = await import('~/lib/customerPricing.server')
  const { session, admin } = await authenticate.admin(request)
  const formData = await request.formData()
  const intent = String(formData.get('intent') || '')

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, settings: true },
  })
  if (!shop) {
    return json({ success: false, error: 'Shop not found' }, { status: 404 })
  }

  const existingSettings = (shop.settings as Record<string, unknown> | null) || {}
  const existingConfig = applyCustomerPricingDefaultsForShop(session.shop, existingSettings)
  const existingProgram = normalizeVolumeProgram(existingSettings, session.shop)
  const existingModel = resolveCustomerPricingModelState(session.shop, existingSettings)

  const statusPayloadFrom = (config: CustomerPricingSettings, overrides: Partial<CustomerPricingSettings> = {}) =>
    buildCustomerPricingSettingsPayload(
      normalizeCustomerPricingSettings({
        customerPricing: {
          version: 3,
          enabled: config.enabled,
          model: config.model || existingModel.model,
          priority: config.priority || existingModel.priority,
          policy: config.policy,
          tagRules: config.tagRules,
          businessPricePerInch: config.businessPricePerInch,
          statuses: config.statuses,
          assignments: config.assignments,
          ...overrides,
        },
      })
    )

  async function persist(
    statusPayload: Record<string, unknown>,
    programNext: VolumeProgram | null,
    extraWrites: Prisma.PrismaPromise<unknown>[] = []
  ) {
    const nextSettings = {
      ...existingSettings,
      customerPricing: statusPayload as unknown as Prisma.InputJsonValue,
      ...(programNext
        ? { alphaProDiscount: buildVolumeProgramPayload(programNext, existingSettings.alphaProDiscount) as unknown as Prisma.InputJsonValue }
        : {}),
    } as Prisma.InputJsonObject
    await prisma.$transaction([
      prisma.shop.update({ where: { shopDomain: session.shop }, data: { settings: nextSettings } }),
      ...extraWrites,
    ])
    invalidatePricingRuntimeCaches(session.shop)
  }

  /** Switching the model on automatically when the merchant configures the matching engine. */
  const ensureModelIncludes = (engine: 'status_rates' | 'volume_tiers'): CustomerPricingModel => {
    const current = existingModel.model
    if (engine === 'status_rates') return current === 'volume_tiers' ? 'both' : current === 'off' ? 'status_rates' : current
    return current === 'status_rates' ? 'both' : current === 'off' ? 'volume_tiers' : current
  }

  try {
    if (intent === 'save-all') {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(String(formData.get('payload') || '{}'))
      } catch {
        return json({ success: false, error: 'Invalid payload.' }, { status: 400 })
      }
      const model = isCustomerPricingModel(parsed.model) ? (parsed.model as CustomerPricingModel) : existingModel.model
      const priority = parsed.priority === 'volume_first' ? 'volume_first' : 'status_first'
      const policy = normalizePolicy(parsed.policy, derivePolicyDefaults(session.shop))
      const statuses = Array.isArray(parsed.statuses) ? parsed.statuses : existingConfig.statuses
      const tagRules = Array.isArray(parsed.tagRules) ? parsed.tagRules : existingConfig.tagRules
      const volume = parsed.volume && typeof parsed.volume === 'object' ? (parsed.volume as Record<string, unknown>) : null

      let programNext: VolumeProgram | null = null
      if (volume) {
        const tiers = normalizeVolumeTiers(volume.tiers)
        if (!tiers.length && (model === 'volume_tiers' || model === 'both')) {
          return json({ success: false, error: 'Add at least one volume tier with a price per inch.' }, { status: 400 })
        }
        programNext = normalizeVolumeProgram(
          {
            alphaProDiscount: {
              ...(existingSettings.alphaProDiscount as Record<string, unknown> | undefined),
              enabled: volume.enabled !== false,
              label: volume.label,
              products: Array.isArray(volume.products) ? volume.products : existingProgram.products,
              tiers,
              eligibleCustomers: Array.isArray(volume.eligibleCustomers) ? volume.eligibleCustomers : existingProgram.eligibleCustomers,
              eligibleTags: Array.isArray(volume.eligibleTags) ? volume.eligibleTags : existingProgram.eligibleTags,
              autoEligibility: volume.autoEligibility,
              checkoutMode: volume.checkoutMode,
              billingBasis: volume.billingBasis,
            },
          },
          session.shop
        )
      }

      const statusPayload = statusPayloadFrom(existingConfig, {
        enabled: parsed.enabled !== false,
        model,
        priority,
        policy: policy as unknown as Record<string, unknown>,
        statuses: statuses as CustomerPricingSettings['statuses'],
        tagRules: tagRules as CustomerPricingSettings['tagRules'],
      })
      const writes = programNext ? await syncVolumeProductConfigs(shop.id, existingProgram, programNext) : []
      await persist(statusPayload, programNext, writes)
      return json({ success: true, message: 'Customer special pricing saved.' })
    }

    if (intent === 'apply-template') {
      const template = CUSTOMER_PRICING_TEMPLATES.find((entry) => entry.key === String(formData.get('templateKey') || ''))
      if (!template) return json({ success: false, error: 'Unknown template.' }, { status: 400 })
      let statuses = existingConfig.statuses
      let programNext: VolumeProgram | null = null
      if (template.statuses) {
        for (const templateStatus of template.statuses) {
          const existing = statuses.find((status) => status.key === templateStatus.key)
          statuses = existing
            ? statuses.map((status) =>
                status.key === templateStatus.key
                  ? { ...status, label: templateStatus.label, type: templateStatus.type, active: true, pricePerInch: templateStatus.pricePerInch }
                  : status
              )
            : statuses.concat({
                id: templateStatus.key,
                key: templateStatus.key,
                label: templateStatus.label,
                type: templateStatus.type,
                active: true,
                pricePerInch: templateStatus.pricePerInch,
                productRules: [],
              })
        }
      }
      if (template.tiers) {
        programNext = { ...existingProgram, enabled: true, tiers: template.tiers.map((tier) => ({ ...tier })) }
      }
      const model: CustomerPricingModel =
        template.model === 'volume_tiers' ? ensureModelIncludes('volume_tiers') : ensureModelIncludes('status_rates')
      await persist(statusPayloadFrom(existingConfig, { statuses, model, enabled: true }), programNext)
      return json({ success: true, message: `Template "${template.title}" applied. Now add your products and customers.` })
    }

    if (intent === 'add-status') {
      const statusLabel = String(formData.get('statusLabel') || '').trim()
      const statusType: CustomerPricingStatus['type'] = String(formData.get('statusType') || '') === 'vip' ? 'vip' : 'business'
      if (!statusLabel) return json({ success: false, error: 'Status label is required.' }, { status: 400 })
      const statusKey = buildUniqueStatusKey(existingConfig.statuses, statusLabel)
      const nextStatus: CustomerPricingStatus = {
        id: statusKey,
        key: statusKey,
        label: statusLabel,
        type: statusType,
        active: true,
        pricePerInch: existingConfig.businessPricePerInch,
        productRules: [],
      }
      await persist(
        statusPayloadFrom(existingConfig, { statuses: existingConfig.statuses.concat(nextStatus), model: ensureModelIncludes('status_rates') }),
        null
      )
      return json({ success: true, message: `${statusLabel} status added.` })
    }

    if (intent === 'add-product-rule') {
      const statusKey = String(formData.get('statusKey') || '').trim()
      const productInput = String(formData.get('productInput') || '').trim()
      const pricePerInch = parseLocalizedPositiveNumber(formData.get('pricePerInch'), 0)
      const targetStatus = existingConfig.statuses.find((status) => status.key === statusKey && status.type !== 'standard')
      if (!targetStatus) return json({ success: false, error: 'Select a valid customer status.' }, { status: 400 })
      if (!(pricePerInch > 0)) return json({ success: false, error: 'Price per inch must be greater than zero.' }, { status: 400 })
      const product = await resolveProduct(admin, productInput)
      const productId = normalizeProductIdLocal(product.id) || product.id
      if (targetStatus.productRules.some((rule) => normalizeProductIdLocal(rule.productId) === productId)) {
        return json({ success: false, error: `${product.title} is already assigned to ${targetStatus.label}.` }, { status: 400 })
      }
      const nextStatuses = existingConfig.statuses.map((status) =>
        status.key === targetStatus.key
          ? {
              ...status,
              productRules: status.productRules.concat({
                id: buildProductRuleId(targetStatus.key, productId),
                productId,
                productLabel: product.title,
                active: true,
                pricingMode: pricingModeForStatusType(targetStatus.type),
                pricePerInch,
              }),
            }
          : status
      )
      await persist(statusPayloadFrom(existingConfig, { statuses: nextStatuses, model: ensureModelIncludes('status_rates'), enabled: true }), null)
      return json({ success: true, message: `${product.title} added to ${targetStatus.label}.` })
    }

    if (intent === 'save-assignment') {
      const customerId = normalizeCustomerId(String(formData.get('customerId') || '').trim())
      const customerEmail = String(formData.get('customerEmail') || '').trim() || null
      const customerName = String(formData.get('customerName') || '').trim() || null
      const statusKey = String(formData.get('statusKey') || '').trim()
      let productOverrides: Array<{ productId: string; pricePerInch: number }> = []
      try {
        const parsedOverrides = JSON.parse(String(formData.get('productOverridesJson') || '[]'))
        if (Array.isArray(parsedOverrides)) {
          productOverrides = parsedOverrides
            .map((entry) => {
              const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
              const productId = normalizeProductIdLocal(value.productId as string | number | null | undefined)
              const pricePerInch = parseLocalizedPositiveNumber(value.pricePerInch, 0)
              if (!productId || !(pricePerInch > 0)) return null
              return { productId, pricePerInch }
            })
            .filter((entry): entry is { productId: string; pricePerInch: number } => Boolean(entry))
        }
      } catch {
        return json({ success: false, error: 'Invalid override payload' }, { status: 400 })
      }
      if (!customerId || !statusKey) return json({ success: false, error: 'Customer and status are required.' }, { status: 400 })
      const nextAssignments = existingConfig.assignments
        .filter((assignment) => assignment.customerId !== customerId)
        .concat({
          customerId,
          customerEmail,
          customerName,
          statusKey,
          active: true,
          pricePerInchOverride: productOverrides[0]?.pricePerInch || null,
          productOverrides,
        })
      await persist(
        statusPayloadFrom(existingConfig, { assignments: nextAssignments, model: ensureModelIncludes('status_rates'), enabled: true }),
        null
      )
      return json({ success: true, message: `${customerName || customerEmail || customerId} now has ${statusKey} pricing.` })
    }

    if (intent === 'delete-assignment') {
      const customerId = normalizeCustomerId(String(formData.get('customerId') || '').trim())
      if (!customerId) return json({ success: false, error: 'Missing customer ID.' }, { status: 400 })
      await persist(
        statusPayloadFrom(existingConfig, {
          assignments: existingConfig.assignments.filter((assignment) => assignment.customerId !== customerId),
        }),
        null
      )
      return json({ success: true, message: 'Customer assignment removed.' })
    }

    if (intent === 'add-volume-product') {
      const product = await resolveProduct(admin, String(formData.get('productInput') || ''))
      const productId = normalizeProductIdLocal(product.id) || product.id
      if (existingProgram.products.some((entry) => entry.productId === productId)) {
        return json({ success: false, error: `${product.title} is already in the volume program.` }, { status: 400 })
      }
      const programNext: VolumeProgram = {
        ...existingProgram,
        enabled: true,
        products: existingProgram.products.concat({ productId, title: product.title }),
      }
      const writes = await syncVolumeProductConfigs(shop.id, existingProgram, programNext)
      await persist(statusPayloadFrom(existingConfig, { model: ensureModelIncludes('volume_tiers') }), programNext, writes)
      return json({ success: true, message: `${product.title} added to the volume program.` })
    }

    if (intent === 'remove-volume-product') {
      const productId = normalizeProductIdLocal(String(formData.get('productId') || ''))
      const programNext: VolumeProgram = {
        ...existingProgram,
        products: existingProgram.products.filter((entry) => entry.productId !== productId),
      }
      const writes = await syncVolumeProductConfigs(shop.id, existingProgram, programNext)
      await persist(statusPayloadFrom(existingConfig), programNext, writes)
      return json({ success: true, message: 'Product removed from the volume program.' })
    }

    if (intent === 'add-volume-customers') {
      let incoming: VolumeProgramCustomer[] = []
      const csv = String(formData.get('csv') || '')
      if (csv.trim()) {
        incoming = parseCustomerCsv(csv)
      } else {
        try {
          const parsedList = JSON.parse(String(formData.get('customersJson') || '[]'))
          incoming = (Array.isArray(parsedList) ? parsedList : [])
            .map((entry) => {
              const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
              const customerId = normalizeCustomerId(value.customerId as string | number | null | undefined) || ''
              const email = String(value.email || '').trim().toLowerCase()
              if (!customerId && !email) return null
              const source = String(value.source || 'manual')
              return {
                customerId,
                email,
                name: String(value.name || '').trim() || email || customerId,
                totalInches: parseLocalizedPositiveNumber(value.totalInches, 0),
                dtfInches: 0,
                uvInches: 0,
                orders: Math.round(parseLocalizedPositiveNumber(value.orders, 0)),
                lastOrder: '',
                lastOrderedAt: String(value.lastOrderedAt || '').trim(),
                source: source === 'auto' || source === 'import' ? source : 'manual',
              } satisfies VolumeProgramCustomer
            })
            .filter((entry): entry is VolumeProgramCustomer => Boolean(entry))
        } catch {
          return json({ success: false, error: 'Invalid customer payload.' }, { status: 400 })
        }
      }
      if (!incoming.length) {
        return json({ success: false, error: 'No customers found. Each line needs an email or a Shopify customer ID.' }, { status: 400 })
      }
      const { merged, added, updated } = mergeVolumeCustomers(existingProgram.eligibleCustomers, incoming)
      const programNext: VolumeProgram = { ...existingProgram, enabled: true, eligibleCustomers: merged }
      await persist(statusPayloadFrom(existingConfig, { model: ensureModelIncludes('volume_tiers') }), programNext)
      return json({ success: true, message: `${added} customer(s) added, ${updated} updated in the volume program.` })
    }

    if (intent === 'remove-volume-customer') {
      const customerId = normalizeCustomerId(String(formData.get('customerId') || '')) || ''
      const email = String(formData.get('email') || '').trim().toLowerCase()
      const programNext: VolumeProgram = {
        ...existingProgram,
        eligibleCustomers: existingProgram.eligibleCustomers.filter(
          (entry) => !((customerId && entry.customerId === customerId) || (email && entry.email === email))
        ),
      }
      await persist(statusPayloadFrom(existingConfig), programNext)
      return json({ success: true, message: 'Customer removed from the volume program.' })
    }

    return json({ success: false, error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    console.error('[Customer Pricing] action failed:', error)
    return json(
      { success: false, error: error instanceof Error ? error.message : 'Something went wrong. Please try again.' },
      { status: 400 }
    )
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

const MODEL_CARDS: Array<{
  model: CustomerPricingModel
  title: string
  who: string
  how: string
  example: string
}> = [
  {
    model: 'off',
    title: 'Standard Shopify prices only',
    who: 'Every customer',
    how: 'Nothing changes. Everyone pays your normal variant prices.',
    example: 'A 22" × 24" sheet costs whatever that variant costs.',
  },
  {
    model: 'status_rates',
    title: 'Account rates',
    who: 'Customers you pick (or tag)',
    how: 'Give a customer a status such as Business or VIP. Each status has a price per inch of sheet length.',
    example: 'Wholesale at $0.25/in: a 100-inch sheet costs $25.00.',
  },
  {
    model: 'volume_tiers',
    title: 'Volume tiers',
    who: 'Returning customers on a list, by tag, or by order history',
    how: 'The more inches in the order, the lower the price per inch.',
    example: '1+ in $0.28, 250+ in $0.22, 500+ in $0.20: a 300-inch order costs $66.00.',
  },
  {
    model: 'both',
    title: 'Both (advanced)',
    who: 'Mixed customer base',
    how: 'Run account rates and volume tiers together. You choose which wins when a customer qualifies for both.',
    example: 'A VIP with an account rate keeps it; everyone else on the list gets the tier price.',
  },
]

export default function CustomerPricingPage() {
  const data = useLoaderData<typeof loader>()
  const { config, modelState, program, productCatalog, search, searchResults, candidates, uploadCount, recentUploadCount, themesUrl, templates } = data
  const actionData = useActionData<CustomerPricingActionData>()
  const navigation = useNavigation()
  const submit = useSubmit()
  const isSubmitting = navigation.state === 'submitting'

  // ── editable state ──
  const [model, setModel] = useState<CustomerPricingModel>(modelState.model)
  const [priority, setPriority] = useState(modelState.priority)
  const [enabled, setEnabled] = useState(config.enabled)
  const [policy, setPolicy] = useState<PolicyEditor>(() => toPolicyEditor(modelState.policy))
  const [statuses, setStatuses] = useState<StatusEditor[]>(() => config.statuses.map(toStatusEditor))
  const [tagRules, setTagRules] = useState<TagRuleEditor[]>(() =>
    config.tagRules.map((rule, index) => ({ id: `tag_${index}_${rule.tag}`, tag: rule.tag, statusKey: rule.statusKey }))
  )
  const [volumeLabel, setVolumeLabel] = useState(program.label)
  const [volumeEnabled, setVolumeEnabled] = useState(program.enabled)
  const [tiers, setTiers] = useState<TierEditor[]>(() => program.tiers.map(toTierEditor))
  const [volumeCustomers, setVolumeCustomers] = useState<VolumeCustomerEditor[]>(() => program.eligibleCustomers.map(toVolumeCustomerEditor))
  const [volumeTags, setVolumeTags] = useState(program.eligibleTags.join(', '))
  const [autoEnabled, setAutoEnabled] = useState(program.autoEligibility.enabled)
  const [autoMonths, setAutoMonths] = useState(String(program.autoEligibility.months))
  const [autoMinInches, setAutoMinInches] = useState(String(program.autoEligibility.minInches))
  const [checkoutMode, setCheckoutMode] = useState(program.checkoutMode)
  const [billingBasis, setBillingBasis] = useState(program.billingBasis)

  // ── transient UI state ──
  const [searchInput, setSearchInput] = useState(search)
  const [assignmentFilter, setAssignmentFilter] = useState('')
  const [newStatusLabel, setNewStatusLabel] = useState('')
  const [newStatusType, setNewStatusType] = useState<CustomerPricingStatus['type']>('business')
  const [newRuleInputs, setNewRuleInputs] = useState<Record<string, { productInput: string; pricePerInch: string }>>({})
  const [newVolumeProduct, setNewVolumeProduct] = useState('')
  const [csvText, setCsvText] = useState('')
  const [newTagRule, setNewTagRule] = useState({ tag: '', statusKey: 'business' })
  const [simInches, setSimInches] = useState('100')
  const [simCopies, setSimCopies] = useState('1')
  const [simWho, setSimWho] = useState(() =>
    modelState.statusRatesEnabled
      ? `status:${config.statuses.find((status) => status.type !== 'standard' && status.active)?.key || 'business'}`
      : modelState.volumeTiersEnabled
        ? 'volume'
        : 'standard'
  )

  const resetFromLoader = useCallback(() => {
    setModel(modelState.model)
    setPriority(modelState.priority)
    setEnabled(config.enabled)
    setPolicy(toPolicyEditor(modelState.policy))
    setStatuses(config.statuses.map(toStatusEditor))
    setTagRules(config.tagRules.map((rule, index) => ({ id: `tag_${index}_${rule.tag}`, tag: rule.tag, statusKey: rule.statusKey })))
    setVolumeLabel(program.label)
    setVolumeEnabled(program.enabled)
    setTiers(program.tiers.map(toTierEditor))
    setVolumeCustomers(program.eligibleCustomers.map(toVolumeCustomerEditor))
    setVolumeTags(program.eligibleTags.join(', '))
    setAutoEnabled(program.autoEligibility.enabled)
    setAutoMonths(String(program.autoEligibility.months))
    setAutoMinInches(String(program.autoEligibility.minInches))
    setCheckoutMode(program.checkoutMode)
    setBillingBasis(program.billingBasis)
    setNewRuleInputs({})
    setNewStatusLabel('')
    setNewVolumeProduct('')
    setCsvText('')
  }, [config, modelState, program])

  useEffect(() => {
    resetFromLoader()
    setSearchInput(search)
  }, [resetFromLoader, search])

  const payload = useMemo(
    () => ({
      model,
      priority,
      enabled,
      policy: serializePolicy(policy),
      statuses: serializeStatuses(statuses),
      tagRules: tagRules.map((rule) => ({ tag: rule.tag, statusKey: rule.statusKey })),
      volume: {
        enabled: volumeEnabled,
        label: volumeLabel,
        products: program.products,
        tiers: serializeTiers(tiers),
        eligibleCustomers: serializeVolumeCustomers(volumeCustomers),
        eligibleTags: volumeTags.split(/[,\n;]/).map((tag) => tag.trim()).filter(Boolean),
        autoEligibility: { enabled: autoEnabled, months: autoMonths, minInches: autoMinInches },
        checkoutMode,
        billingBasis,
      },
    }),
    [model, priority, enabled, policy, statuses, tagRules, volumeEnabled, volumeLabel, program.products, tiers, volumeCustomers, volumeTags, autoEnabled, autoMonths, autoMinInches, checkoutMode, billingBasis]
  )

  const savedSnapshot = useMemo(
    () =>
      JSON.stringify({
        model: modelState.model,
        priority: modelState.priority,
        enabled: config.enabled,
        policy: serializePolicy(toPolicyEditor(modelState.policy)),
        statuses: serializeStatuses(config.statuses.map(toStatusEditor)),
        tagRules: config.tagRules.map((rule) => ({ tag: rule.tag, statusKey: rule.statusKey })),
        volume: {
          enabled: program.enabled,
          label: program.label,
          products: program.products,
          tiers: serializeTiers(program.tiers.map(toTierEditor)),
          eligibleCustomers: serializeVolumeCustomers(program.eligibleCustomers.map(toVolumeCustomerEditor)),
          eligibleTags: program.eligibleTags,
          autoEligibility: { enabled: program.autoEligibility.enabled, months: String(program.autoEligibility.months), minInches: String(program.autoEligibility.minInches) },
          checkoutMode: program.checkoutMode,
          billingBasis: program.billingBasis,
        },
      }),
    [config, modelState, program]
  )
  const isDirty = JSON.stringify(payload) !== savedSnapshot
  const tierError = tierValidationMessage(tiers)

  const saveAll = useCallback(() => {
    const form = new FormData()
    form.set('intent', 'save-all')
    form.set('payload', JSON.stringify(payload))
    submit(form, { method: 'post' })
  }, [payload, submit])

  // ── derived ──
  const statusEngineOn = model === 'status_rates' || model === 'both'
  const volumeEngineOn = model === 'volume_tiers' || model === 'both'
  const assignableStatuses = statuses.filter((status) => status.type !== 'standard' && status.active)
  const statusMap = statuses.reduce<Record<string, StatusEditor>>((acc, status) => {
    acc[status.key] = status
    return acc
  }, {})
  const assignments = config.assignments
  const assignmentLookup = assignments.reduce<Record<string, CustomerPricingAssignment>>((acc, assignment) => {
    acc[assignment.customerId] = assignment
    return acc
  }, {})
  const statusRuleCount = statuses.reduce((sum, status) => sum + status.productRules.filter((rule) => rule.active).length, 0)
  const parsedTiers = useMemo(
    () => normalizeVolumeTiersClient(tiers),
    [tiers]
  )

  const setupSteps: SetupStep[] = [
    {
      key: 'model',
      title: 'Choose a pricing model',
      description: 'Pick how special prices are calculated. You can change it any time; nothing is deleted.',
      done: modelState.explicit || modelState.model !== 'off',
    },
    {
      key: 'products',
      title: 'Pick the products',
      description: statusEngineOn && volumeEngineOn
        ? 'Add at least one product rule to a status and one product to the volume program.'
        : volumeEngineOn
          ? 'Add the gang-sheet products the tiers apply to.'
          : 'Add a product rule under a status with its price per inch.',
      done: model === 'off' ? true : (statusEngineOn ? statusRuleCount > 0 : true) && (volumeEngineOn ? program.products.length > 0 : true),
    },
    {
      key: 'rates',
      title: 'Set the rates',
      description: volumeEngineOn ? 'Fill in the price per inch for each tier.' : 'Every product rule needs a price per inch above zero.',
      done: model === 'off'
        ? true
        : (statusEngineOn ? statuses.some((status) => status.productRules.some((rule) => rule.active && parseLocalizedPositiveNumber(rule.pricePerInch, 0) > 0)) : true) &&
          (volumeEngineOn ? parsedTiers.length > 0 && !tierError : true),
    },
    {
      key: 'customers',
      title: 'Say who qualifies',
      description: volumeEngineOn
        ? 'Add customers to the list, use a Shopify tag, or turn on automatic eligibility by order history.'
        : 'Search a customer and give them a status, or map a Shopify tag to a status.',
      done: model === 'off'
        ? true
        : (statusEngineOn ? assignments.length > 0 || tagRules.length > 0 : false) ||
          (volumeEngineOn ? volumeCustomers.length > 0 || volumeTags.trim().length > 0 || autoEnabled : false),
    },
    {
      key: 'block',
      title: 'Put the upload block on the product page',
      description: 'Online Store → Themes → Customize → product page → Add block → Custom Price Sheet Upload (or Custom Price Upload Mod 2). This step turns green when the block sends its first upload.',
      done: uploadCount > 0,
    },
  ]
  const completedSteps = setupSteps.filter((step) => step.done).length
  const setupComplete = completedSteps === setupSteps.length

  // ── simulator ──
  const simOptions = useMemo(
    () => [
      { label: 'Standard customer', value: 'standard' },
      ...(statusEngineOn ? assignableStatuses.map((status) => ({ label: `${status.label} (account rate)`, value: `status:${status.key}` })) : []),
      ...(volumeEngineOn ? [{ label: `${volumeLabel || 'Volume tiers'} (volume tier)`, value: 'volume' }] : []),
    ],
    [statusEngineOn, volumeEngineOn, assignableStatuses, volumeLabel]
  )
  useEffect(() => {
    // Keep the simulated customer valid when the model or statuses change.
    if (!simOptions.some((option) => option.value === simWho)) {
      setSimWho(simOptions[1]?.value || 'standard')
    }
  }, [simOptions, simWho])

  const simulation = useMemo(() => {
    const inches = parseLocalizedPositiveNumber(simInches, 0)
    const copies = Math.max(1, Math.round(parseLocalizedPositiveNumber(simCopies, 1)))
    const totalInches = Number((inches * copies).toFixed(2))
    if (!(inches > 0)) return null
    if (simWho.startsWith('status:')) {
      const status = statusMap[simWho.slice(7)]
      if (!status) return null
      const rule = status.productRules.find((entry) => entry.active)
      const rate = parseLocalizedPositiveNumber(rule?.pricePerInch || status.pricePerInch, 0)
      const mode = rule?.pricingMode || pricingModeForStatusType(status.type)
      const basisLabel = mode === 'measured_length' ? 'exact measured length' : 'matched sheet length'
      return {
        title: `${status.label} customer`,
        lines: [
          `${copies} × ${inches}" = ${totalInches}" billable (${basisLabel})`,
          `${totalInches}" × ${formatRate(rate)} = ${formatMoney(totalInches * rate)}`,
        ],
        total: totalInches * rate,
        note: mode === 'measured_length'
          ? 'Pays only for the measured length of the file.'
          : 'Pays for the length of the sheet the file is matched to. The simulator uses the entered length as the sheet length.',
      }
    }
    if (simWho === 'volume') {
      const tier = pickVolumeTier(parsedTiers, totalInches)
      if (!tier) return null
      return {
        title: volumeLabel || 'Volume tier customer',
        lines: [
          `${copies} × ${inches}" = ${totalInches}" billable`,
          `Tier "${tier.label}" applies (${formatTierRange(tier)})`,
          `${totalInches}" × ${formatRate(tier.price_per_inch)} = ${formatMoney(totalInches * tier.price_per_inch)}`,
        ],
        total: totalInches * tier.price_per_inch,
        note: checkoutMode === 'custom_checkout'
          ? 'Charged exactly through the custom checkout.'
          : 'Shown as an estimate; your own Shopify discount applies the tier at checkout.',
      }
    }
    return {
      title: 'Standard customer',
      lines: ['Pays the normal Shopify variant price for the matched sheet.'],
      total: null,
      note: 'Special pricing does not apply.',
    }
  }, [simInches, simCopies, simWho, statusMap, parsedTiers, volumeLabel, checkoutMode])

  // ── handlers ──
  function updateStatusLabel(statusKey: string, label: string) {
    setStatuses((current) => current.map((status) => (status.key === statusKey ? { ...status, label } : status)))
  }
  function updateStatusRule(statusKey: string, productId: string, field: keyof ProductRuleEditor, value: string | boolean) {
    setStatuses((current) =>
      current.map((status) =>
        status.key !== statusKey
          ? status
          : { ...status, productRules: status.productRules.map((rule) => (rule.productId === productId ? { ...rule, [field]: value } : rule)) }
      )
    )
  }
  function removeStatusRule(statusKey: string, productId: string) {
    setStatuses((current) =>
      current.map((status) =>
        status.key === statusKey ? { ...status, productRules: status.productRules.filter((rule) => rule.productId !== productId) } : status
      )
    )
  }
  function removeStatus(statusKey: string) {
    setStatuses((current) => current.filter((status) => status.key !== statusKey))
  }
  function updateNewRuleInput(statusKey: string, field: 'productInput' | 'pricePerInch', value: string) {
    setNewRuleInputs((current) => ({
      ...current,
      [statusKey]: { productInput: current[statusKey]?.productInput || '', pricePerInch: current[statusKey]?.pricePerInch || '', [field]: value },
    }))
  }
  function updateTier(id: string, field: keyof TierEditor, value: string | boolean) {
    setTiers((current) => current.map((tier) => (tier.id === id ? { ...tier, [field]: value } : tier)))
  }
  function addTier() {
    setTiers((current) => {
      const last = current[current.length - 1]
      const lastMax = last ? parseLocalizedPositiveNumber(last.maxQty, 0) : 0
      return current.concat({ id: editorId('tier'), minQty: lastMax ? String(lastMax + 1) : '', maxQty: '', pricePerInch: '', label: '', popular: false })
    })
  }
  function removeTier(id: string) {
    setTiers((current) => current.filter((tier) => tier.id !== id))
  }
  function updateVolumeCustomer(id: string, field: keyof VolumeCustomerEditor, value: string) {
    setVolumeCustomers((current) => current.map((customer) => (customer.id === id ? { ...customer, [field]: value } : customer)))
  }
  function removeVolumeCustomerLocal(id: string) {
    setVolumeCustomers((current) => current.filter((customer) => customer.id !== id))
  }
  function addTagRule() {
    const tag = newTagRule.tag.trim().toLowerCase()
    if (!tag) return
    setTagRules((current) => current.filter((rule) => rule.tag !== tag).concat({ id: editorId('tag'), tag, statusKey: newTagRule.statusKey }))
    setNewTagRule({ tag: '', statusKey: newTagRule.statusKey })
  }

  const filteredAssignments = assignments.filter((assignment) => {
    const needle = assignmentFilter.trim().toLowerCase()
    if (!needle) return true
    const status = statusMap[assignment.statusKey]
    return [assignment.customerName || '', assignment.customerEmail || '', assignment.customerId, status?.label || assignment.statusKey]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })
  const filteredVolumeCustomers = volumeCustomers.filter((customer) => {
    const needle = assignmentFilter.trim().toLowerCase()
    if (!needle) return true
    return [customer.name, customer.email, customer.customerId].join(' ').toLowerCase().includes(needle)
  })

  const actionMessage = actionData?.message || null
  const actionError = actionData?.error || null

  return (
    <Page
      title="Customer Special Pricing"
      subtitle="Give chosen customers their own per-inch prices. Everyone else keeps your normal Shopify prices."
      backAction={{ content: 'Products', url: '/app/products' }}
    >
      {isDirty ? (
        <ContextualSaveBar
          message={tierError ? tierError : 'Unsaved pricing changes'}
          saveAction={{ onAction: saveAll, loading: isSubmitting, disabled: Boolean(tierError) }}
          discardAction={{ onAction: resetFromLoader }}
        />
      ) : null}

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionMessage ? <Banner tone="success" title={actionMessage} /> : null}
            {actionError ? <Banner tone="critical" title={actionError} /> : null}
            {!modelState.explicit && modelState.model !== 'off' ? (
              <Banner tone="info" title="Your existing setup was recognised">
                <p>
                  This store already used {modelState.model === 'volume_tiers' ? 'volume tiers' : modelState.model === 'both' ? 'both engines' : 'account rates'}.
                  Nothing changed. Save once to confirm the model shown below.
                </p>
              </Banner>
            ) : null}

            {/* ── Setup guide ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">{setupComplete ? 'Special pricing is live' : 'Set up special pricing'}</Text>
                    <Text as="p" tone="subdued">{completedSteps} of {setupSteps.length} steps done. Steps complete themselves as you configure.</Text>
                  </BlockStack>
                  <Badge tone={setupComplete ? 'success' : 'attention'}>{setupComplete ? 'Ready' : 'In progress'}</Badge>
                </InlineStack>
                <ProgressBar progress={Math.round((completedSteps / setupSteps.length) * 100)} size="small" tone={setupComplete ? 'success' : 'primary'} />
                <BlockStack gap="200">
                  {setupSteps.map((step, index) => (
                    <InlineStack key={step.key} gap="300" blockAlign="start" wrap={false}>
                      <Box minWidth="28px">
                        <Badge tone={step.done ? 'success' : undefined}>{step.done ? '✓' : String(index + 1)}</Badge>
                      </Box>
                      <BlockStack gap="050">
                        <Text as="p" fontWeight={step.done ? 'regular' : 'semibold'} tone={step.done ? 'subdued' : undefined}>{step.title}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{step.description}</Text>
                        {step.key === 'block' && !step.done ? (
                          <InlineStack gap="200">
                            <Button url={themesUrl} target="_blank" size="slim">Open theme editor</Button>
                            <Text as="span" variant="bodySm" tone="subdued">{recentUploadCount} uploads in the last 30 days</Text>
                          </InlineStack>
                        ) : null}
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* ── Model chooser ── */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">1. How should special prices be calculated?</Text>
                  <Text as="p" tone="subdued">Pick one. Switching models never deletes your rates, tiers or customer lists; the unused engine simply pauses.</Text>
                </BlockStack>
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                  {MODEL_CARDS.map((card) => {
                    const selected = model === card.model
                    return (
                      <div
                        key={card.model}
                        role="button"
                        tabIndex={0}
                        onClick={() => setModel(card.model)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setModel(card.model)
                          }
                        }}
                        style={{ cursor: 'pointer', height: '100%' }}
                      >
                        <Box
                          padding="400"
                          borderWidth="025"
                          borderRadius="300"
                          borderColor={selected ? 'border-emphasis' : 'border'}
                          background={selected ? 'bg-surface-selected' : 'bg-surface'}
                          minHeight="100%"
                        >
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingSm">{card.title}</Text>
                              {selected ? <Badge tone="success">Selected</Badge> : null}
                            </InlineStack>
                            <Text as="p" variant="bodySm"><strong>Who:</strong> {card.who}</Text>
                            <Text as="p" variant="bodySm">{card.how}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">Example: {card.example}</Text>
                          </BlockStack>
                        </Box>
                      </div>
                    )
                  })}
                </InlineGrid>
                {model === 'both' ? (
                  <ChoiceList
                    title="When a customer qualifies for both"
                    choices={[
                      { label: 'Account rate wins (recommended). A customer with an assigned status keeps that rate; the list, tag or history rule only applies to everyone else.', value: 'status_first' },
                      { label: 'Volume tier wins. The order-size tier applies even to customers with a status.', value: 'volume_first' },
                    ]}
                    selected={[priority]}
                    onChange={(values) => setPriority(values[0] === 'volume_first' ? 'volume_first' : 'status_first')}
                  />
                ) : null}
                {model === 'off' ? null : (
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="span" variant="bodySm" tone="subdued">Start from a template:</Text>
                    {templates
                      .filter((template) => (model === 'both' ? true : template.model === model))
                      .map((template) => (
                        <Form method="post" key={template.key}>
                          <input type="hidden" name="intent" value="apply-template" />
                          <input type="hidden" name="templateKey" value={template.key} />
                          <Button submit size="slim" loading={isSubmitting} disabled={isDirty}>{template.title}</Button>
                        </Form>
                      ))}
                    {isDirty ? <Text as="span" variant="bodySm" tone="subdued">Save your changes first.</Text> : null}
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            {/* ── Account rates ── */}
            {statusEngineOn ? (
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">2. Account rates</Text>
                      <Text as="p" tone="subdued">
                        A status is a price list. Put products under a status with a price per inch, then give customers that status.
                      </Text>
                    </BlockStack>
                    <Badge tone={enabled ? 'success' : 'attention'}>{enabled ? 'Active' : 'Paused'}</Badge>
                  </InlineStack>
                  <Checkbox label="Account rates are active on the storefront" checked={enabled} onChange={setEnabled} helpText="Turn off to pause account rates without losing anything." />

                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                    {statuses
                      .filter((status) => status.type !== 'standard')
                      .map((status) => {
                        const ruleDraft = newRuleInputs[status.key] || { productInput: '', pricePerInch: '' }
                        const assignmentCount = assignments.filter((assignment) => assignment.statusKey === status.key).length
                        const canRemoveStatus = status.key !== 'business' && status.key !== 'vip' && assignmentCount === 0
                        return (
                          <Card key={status.key} background="bg-surface-secondary">
                            <BlockStack gap="400">
                              <InlineStack align="space-between" blockAlign="center">
                                <BlockStack gap="050">
                                  <Text as="h3" variant="headingSm">{status.label}</Text>
                                  <Text as="p" variant="bodySm" tone="subdued">{assignmentCount} customer(s) assigned</Text>
                                </BlockStack>
                                <InlineStack gap="200" blockAlign="center">
                                  <Badge tone={status.type === 'business' ? 'success' : 'attention'}>{status.type === 'business' ? 'Sheet length' : 'Measured length'}</Badge>
                                  {canRemoveStatus ? <Button tone="critical" size="slim" onClick={() => removeStatus(status.key)}>Remove</Button> : null}
                                </InlineStack>
                              </InlineStack>
                              <TextField label="Name customers see" autoComplete="off" value={status.label} onChange={(value) => updateStatusLabel(status.key, value)} />

                              {!status.productRules.length ? (
                                <Banner tone="info">No products yet. Add the product that carries the upload block below.</Banner>
                              ) : null}
                              {status.productRules.map((rule) => {
                                const rate = parseLocalizedPositiveNumber(rule.pricePerInch, 0)
                                return (
                                  <Box key={`${status.key}_${rule.productId}`} padding="300" borderWidth="025" borderColor="border" borderRadius="200" background="bg-surface">
                                    <BlockStack gap="300">
                                      <InlineStack align="space-between" blockAlign="center">
                                        <BlockStack gap="050">
                                          <Text as="p" fontWeight="medium">{rule.productLabel}</Text>
                                          <Text as="p" variant="bodySm" tone="subdued">{rule.productId.split('/').pop()}</Text>
                                        </BlockStack>
                                        <InlineStack gap="200" blockAlign="center">
                                          <Checkbox label="Active" checked={rule.active} onChange={(value) => updateStatusRule(status.key, rule.productId, 'active', value)} />
                                          <Button tone="critical" size="slim" onClick={() => removeStatusRule(status.key, rule.productId)}>Remove</Button>
                                        </InlineStack>
                                      </InlineStack>
                                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                                        <TextField
                                          label="Price per inch"
                                          autoComplete="off"
                                          type="text"
                                          inputMode="decimal"
                                          prefix="$"
                                          value={rule.pricePerInch}
                                          onChange={(value) => updateStatusRule(status.key, rule.productId, 'pricePerInch', value)}
                                          error={rule.active && !(rate > 0) ? 'Enter a price above zero' : undefined}
                                        />
                                        <Select
                                          label="What the customer pays for"
                                          options={[
                                            { label: 'Length of the matched sheet', value: 'variant_length' },
                                            { label: 'Exact measured length of the file', value: 'measured_length' },
                                          ]}
                                          value={rule.pricingMode === 'measured_length' ? 'measured_length' : 'variant_length'}
                                          onChange={(value) => updateStatusRule(status.key, rule.productId, 'pricingMode', value)}
                                        />
                                      </InlineGrid>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        {rate > 0
                                          ? `Example: a 100" ${rule.pricingMode === 'measured_length' ? 'file' : 'sheet'} costs ${formatMoney(100 * rate)}.`
                                          : 'Set the rate to see an example.'}
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                )
                              })}

                              <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200" background="bg-surface">
                                <Form method="post">
                                  <input type="hidden" name="intent" value="add-product-rule" />
                                  <input type="hidden" name="statusKey" value={status.key} />
                                  <input type="hidden" name="productInput" value={ruleDraft.productInput} />
                                  <input type="hidden" name="pricePerInch" value={ruleDraft.pricePerInch} />
                                  <BlockStack gap="300">
                                    <Text as="h4" variant="headingSm">Add a product to {status.label}</Text>
                                    <InlineGrid columns={{ xs: 1, md: '2fr 1fr auto' }} gap="300">
                                      <TextField
                                        label="Product link, handle or ID"
                                        autoComplete="off"
                                        value={ruleDraft.productInput}
                                        onChange={(value) => updateNewRuleInput(status.key, 'productInput', value)}
                                        placeholder="products/upload-gang-sheet"
                                      />
                                      <TextField
                                        label="Price per inch"
                                        autoComplete="off"
                                        type="text"
                                        inputMode="decimal"
                                        prefix="$"
                                        value={ruleDraft.pricePerInch}
                                        onChange={(value) => updateNewRuleInput(status.key, 'pricePerInch', value)}
                                        placeholder="0.25"
                                      />
                                      <Box paddingBlockStart="600">
                                        <Button submit loading={isSubmitting} disabled={isDirty || !ruleDraft.productInput.trim() || !ruleDraft.pricePerInch.trim()}>Add product</Button>
                                      </Box>
                                    </InlineGrid>
                                    {isDirty ? <Text as="p" variant="bodySm" tone="subdued">Save your pending changes before adding a product.</Text> : null}
                                  </BlockStack>
                                </Form>
                              </Box>
                            </BlockStack>
                          </Card>
                        )
                      })}
                  </InlineGrid>

                  <Card background="bg-surface-secondary">
                    <Form method="post">
                      <input type="hidden" name="intent" value="add-status" />
                      <input type="hidden" name="statusLabel" value={newStatusLabel} />
                      <input type="hidden" name="statusType" value={newStatusType} />
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Need another status?</Text>
                        <InlineGrid columns={{ xs: 1, md: '2fr 1fr auto' }} gap="300">
                          <TextField label="Status name" autoComplete="off" value={newStatusLabel} onChange={setNewStatusLabel} placeholder="Wholesale" />
                          <Select
                            label="Customer pays for"
                            options={[
                              { label: 'Length of the matched sheet', value: 'business' },
                              { label: 'Exact measured length', value: 'vip' },
                            ]}
                            value={newStatusType}
                            onChange={(value) => setNewStatusType(value === 'vip' ? 'vip' : 'business')}
                          />
                          <Box paddingBlockStart="600">
                            <Button submit loading={isSubmitting} disabled={isDirty || !newStatusLabel.trim()}>Add status</Button>
                          </Box>
                        </InlineGrid>
                      </BlockStack>
                    </Form>
                  </Card>

                  <Divider />
                  <BlockStack gap="300">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">Give a status by Shopify customer tag</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Every customer carrying the tag gets the status automatically. Add the tag in Shopify → Customers. A direct assignment always wins over a tag.
                      </Text>
                    </BlockStack>
                    {tagRules.length ? (
                      <InlineStack gap="200" wrap>
                        {tagRules.map((rule) => (
                          <Badge key={rule.id} tone="info">{`${rule.tag} → ${statusMap[rule.statusKey]?.label || rule.statusKey}`}</Badge>
                        ))}
                      </InlineStack>
                    ) : null}
                    <InlineGrid columns={{ xs: 1, md: '2fr 1fr auto auto' }} gap="300">
                      <TextField label="Tag" autoComplete="off" value={newTagRule.tag} onChange={(value) => setNewTagRule((current) => ({ ...current, tag: value }))} placeholder="wholesale" />
                      <Select
                        label="Status"
                        options={assignableStatuses.map((status) => ({ label: status.label, value: status.key }))}
                        value={assignableStatuses.some((status) => status.key === newTagRule.statusKey) ? newTagRule.statusKey : assignableStatuses[0]?.key || ''}
                        onChange={(value) => setNewTagRule((current) => ({ ...current, statusKey: value }))}
                      />
                      <Box paddingBlockStart="600"><Button onClick={addTagRule} disabled={!newTagRule.tag.trim()}>Add tag rule</Button></Box>
                      <Box paddingBlockStart="600">
                        {tagRules.length ? <Button tone="critical" onClick={() => setTagRules([])}>Clear all</Button> : null}
                      </Box>
                    </InlineGrid>
                  </BlockStack>
                </BlockStack>
              </Card>
            ) : null}

            {/* ── Volume tiers ── */}
            {volumeEngineOn ? (
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">{statusEngineOn ? '3.' : '2.'} Volume tiers</Text>
                      <Text as="p" tone="subdued">
                        Customers on the list pay less per inch as the order grows. Tiers are measured in billable gang-sheet inches (length × copies), not cart quantity.
                      </Text>
                    </BlockStack>
                    <Badge tone={volumeEnabled ? 'success' : 'attention'}>{volumeEnabled ? 'Active' : 'Paused'}</Badge>
                  </InlineStack>
                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                    <TextField label="Name customers see" autoComplete="off" value={volumeLabel} onChange={setVolumeLabel} placeholder="Returning customer pricing" />
                    <Box paddingBlockStart="600">
                      <Checkbox label="Volume tiers are active on the storefront" checked={volumeEnabled} onChange={setVolumeEnabled} />
                    </Box>
                  </InlineGrid>

                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                    <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Products in the program</Text>
                        {!program.products.length ? <Banner tone="info">Add the gang-sheet product that carries the upload block.</Banner> : null}
                        {program.products.map((product) => (
                          <InlineStack key={product.productId} align="space-between" blockAlign="center">
                            <BlockStack gap="050">
                              <Text as="p" fontWeight="medium">{productCatalog.find((item) => item.productId === product.productId)?.label || product.title}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">{product.productId.split('/').pop()}</Text>
                            </BlockStack>
                            <Form method="post">
                              <input type="hidden" name="intent" value="remove-volume-product" />
                              <input type="hidden" name="productId" value={product.productId} />
                              <Button submit tone="critical" size="slim" loading={isSubmitting} disabled={isDirty}>Remove</Button>
                            </Form>
                          </InlineStack>
                        ))}
                        <Form method="post">
                          <input type="hidden" name="intent" value="add-volume-product" />
                          <input type="hidden" name="productInput" value={newVolumeProduct} />
                          <InlineGrid columns={{ xs: 1, md: '2fr auto' }} gap="300">
                            <TextField label="Product link, handle or ID" autoComplete="off" value={newVolumeProduct} onChange={setNewVolumeProduct} placeholder="products/dtf-gang-sheets" />
                            <Box paddingBlockStart="600"><Button submit loading={isSubmitting} disabled={isDirty || !newVolumeProduct.trim()}>Add product</Button></Box>
                          </InlineGrid>
                        </Form>
                        {isDirty ? <Text as="p" variant="bodySm" tone="subdued">Save your pending changes before adding or removing a product.</Text> : null}
                      </BlockStack>
                    </Box>

                    <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingSm">Tiers</Text>
                          <Button size="slim" onClick={addTier}>Add tier</Button>
                        </InlineStack>
                        {tierError ? <Banner tone="critical">{tierError}</Banner> : null}
                        {tiers.map((tier) => {
                          const rate = parseLocalizedPositiveNumber(tier.pricePerInch, 0)
                          return (
                            <Box key={tier.id} padding="300" borderWidth="025" borderColor="border" borderRadius="200" background="bg-surface-secondary">
                              <BlockStack gap="300">
                                <InlineStack align="space-between" blockAlign="center">
                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge tone={rate > 0 ? 'success' : 'critical'}>{rate > 0 ? formatRate(rate) : 'Rate missing'}</Badge>
                                    {tier.popular ? <Badge tone="attention">Highlighted</Badge> : null}
                                  </InlineStack>
                                  <Button tone="critical" size="slim" onClick={() => removeTier(tier.id)}>Remove</Button>
                                </InlineStack>
                                <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                                  <TextField label="From (inches)" autoComplete="off" type="text" inputMode="numeric" value={tier.minQty} onChange={(value) => updateTier(tier.id, 'minQty', value)} placeholder="250" />
                                  <TextField label="Up to (inches)" autoComplete="off" type="text" inputMode="numeric" value={tier.maxQty} onChange={(value) => updateTier(tier.id, 'maxQty', value)} placeholder="Blank = no limit" />
                                  <TextField label="Price per inch" autoComplete="off" type="text" inputMode="decimal" prefix="$" value={tier.pricePerInch} onChange={(value) => updateTier(tier.id, 'pricePerInch', value)} placeholder="0.22" />
                                </InlineGrid>
                                <InlineGrid columns={{ xs: 1, md: '2fr auto' }} gap="300">
                                  <TextField label="Label customers see" autoComplete="off" value={tier.label} onChange={(value) => updateTier(tier.id, 'label', value)} placeholder="250+ inches" />
                                  <Box paddingBlockStart="600"><Checkbox label="Highlight" checked={tier.popular} onChange={(value) => updateTier(tier.id, 'popular', value)} /></Box>
                                </InlineGrid>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {rate > 0 && parseLocalizedPositiveNumber(tier.minQty, 0) > 0
                                    ? `Example: ${Math.round(parseLocalizedPositiveNumber(tier.minQty, 0))}" costs ${formatMoney(parseLocalizedPositiveNumber(tier.minQty, 0) * rate)} in this tier.`
                                    : 'Fill in the range and rate to see an example.'}
                                </Text>
                              </BlockStack>
                            </Box>
                          )
                        })}
                      </BlockStack>
                    </Box>
                  </InlineGrid>

                  <Divider />
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">How the tier price is applied</Text>
                    <ChoiceList
                      title="Checkout"
                      titleHidden
                      choices={[
                        {
                          label: 'Custom checkout (recommended): the exact tier price is charged through a checkout we create for the customer.',
                          value: 'custom_checkout',
                          helpText: 'Works on any product. The customer clicks "Create custom checkout" on the product page.',
                        },
                        {
                          label: 'Standard cart: we only show the tier price; your own Shopify discount or per-inch variant applies it.',
                          value: 'standard_cart',
                          helpText: 'Use this if the product already has a $-per-inch variant and a quantity discount set up in Shopify.',
                        },
                      ]}
                      selected={[checkoutMode]}
                      onChange={(values) => setCheckoutMode(values[0] === 'standard_cart' ? 'standard_cart' : 'custom_checkout')}
                    />
                    {checkoutMode === 'custom_checkout' ? (
                      <Select
                        label="Inches counted"
                        options={[
                          { label: 'Exact measured length of the file × copies', value: 'measured_length' },
                          { label: 'Length of the matched sheet × sheets needed', value: 'variant_length' },
                        ]}
                        value={billingBasis}
                        onChange={(value) => setBillingBasis(value === 'variant_length' ? 'variant_length' : 'measured_length')}
                      />
                    ) : null}
                  </BlockStack>

                  <Divider />
                  <BlockStack gap="400">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">Who gets the tiers</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Any of the three ways below qualifies a customer. Customers match by Shopify customer ID first, then by email.</Text>
                    </BlockStack>

                    <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                      <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">By Shopify tag</Text>
                          <TextField
                            label="Tags"
                            autoComplete="off"
                            value={volumeTags}
                            onChange={setVolumeTags}
                            placeholder="returning, wholesale"
                            helpText="Comma separated. Customers with any of these tags qualify."
                          />
                        </BlockStack>
                      </Box>
                      <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">By order history (automatic)</Text>
                          <Checkbox label="Customers qualify automatically once they have ordered enough" checked={autoEnabled} onChange={setAutoEnabled} />
                          <InlineGrid columns={2} gap="300">
                            <TextField label="Looking back (months)" autoComplete="off" type="text" inputMode="numeric" value={autoMonths} onChange={setAutoMonths} disabled={!autoEnabled} />
                            <TextField label="Minimum inches ordered" autoComplete="off" type="text" inputMode="numeric" value={autoMinInches} onChange={setAutoMinInches} disabled={!autoEnabled} />
                          </InlineGrid>
                          <Form method="get">
                            <input type="hidden" name="suggest" value="1" />
                            <Button submit size="slim" loading={isSubmitting}>Show who would qualify now</Button>
                          </Form>
                        </BlockStack>
                      </Box>
                    </InlineGrid>

                    {candidates ? (
                      <Card background="bg-surface-secondary">
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h4" variant="headingSm">{candidates.length} customer(s) ordered {program.autoEligibility.minInches}+ inches in the last {program.autoEligibility.months} months</Text>
                            {candidates.some((candidate) => !candidate.alreadyEligible) ? (
                              <Form method="post">
                                <input type="hidden" name="intent" value="add-volume-customers" />
                                <input
                                  type="hidden"
                                  name="customersJson"
                                  value={JSON.stringify(candidates.filter((candidate) => !candidate.alreadyEligible).map((candidate) => ({ ...candidate, source: 'auto' })))}
                                />
                                <Button submit size="slim" variant="primary" loading={isSubmitting} disabled={isDirty}>Add all to the list</Button>
                              </Form>
                            ) : null}
                          </InlineStack>
                          {candidates.length ? (
                            <BlockStack gap="100">
                              {candidates.slice(0, 50).map((candidate) => (
                                <InlineStack key={candidate.customerId} align="space-between" blockAlign="center">
                                  <Text as="span" variant="bodySm">{candidate.email || candidate.customerId} · {Math.round(candidate.totalInches)}" over {candidate.orders} order(s)</Text>
                                  {candidate.alreadyEligible ? <Badge tone="success">On the list</Badge> : <Badge>New</Badge>}
                                </InlineStack>
                              ))}
                            </BlockStack>
                          ) : (
                            <Text as="p" variant="bodySm" tone="subdued">Nobody reaches that threshold yet. Lower the minimum or look further back.</Text>
                          )}
                        </BlockStack>
                      </Card>
                    ) : null}

                    <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                      <BlockStack gap="300">
                        <Text as="h4" variant="headingSm">By list</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Search a customer in the "Find a customer" box below and choose "Add to volume list", or paste a list here.</Text>
                        <Form method="post">
                          <input type="hidden" name="intent" value="add-volume-customers" />
                          <input type="hidden" name="csv" value={csvText} />
                          <BlockStack gap="200">
                            <TextField
                              label="Paste emails or a CSV export"
                              autoComplete="off"
                              multiline={4}
                              value={csvText}
                              onChange={setCsvText}
                              placeholder={'jane@example.com\njohn@example.com, John Smith\nor a CSV with an email / customer id column'}
                            />
                            <InlineStack align="end"><Button submit loading={isSubmitting} disabled={isDirty || !csvText.trim()}>Import list</Button></InlineStack>
                          </BlockStack>
                        </Form>
                      </BlockStack>
                    </Box>
                  </BlockStack>
                </BlockStack>
              </Card>
            ) : null}

            {/* ── Customers ── */}
            {model !== 'off' ? (
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Find a customer</Text>
                    <Text as="p" tone="subdued">Search by name or email, then give them a status or add them to the volume list.</Text>
                  </BlockStack>
                  <Form method="get">
                    <InlineGrid columns={{ xs: 1, md: '3fr auto' }} gap="300">
                      <TextField label="Name or email" labelHidden autoComplete="off" name="q" value={searchInput} placeholder="jane@example.com" onChange={setSearchInput} />
                      <Button submit>Search</Button>
                    </InlineGrid>
                  </Form>
                  {searchResults.length ? (
                    <BlockStack gap="300">
                      {searchResults.map((customer) => (
                        <Card key={customer.id} background="bg-surface-secondary">
                          <CustomerResult
                            customer={customer}
                            currentAssignment={assignmentLookup[customer.id] || null}
                            currentStatusLabel={statusMap[assignmentLookup[customer.id]?.statusKey || '']?.label || 'Standard'}
                            assignableStatuses={assignableStatuses}
                            productCatalog={productCatalog}
                            isSubmitting={isSubmitting}
                            statusEngineOn={statusEngineOn}
                            volumeEngineOn={volumeEngineOn}
                            onVolumeList={volumeCustomers.some((entry) => entry.customerId === customer.id || (customer.email && entry.email === customer.email.toLowerCase()))}
                            isDirty={isDirty}
                          />
                        </Card>
                      ))}
                    </BlockStack>
                  ) : search ? (
                    <Banner tone="info">No customers found for "{search}".</Banner>
                  ) : null}

                  <Divider />
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">Customers with special pricing</Text>
                    <InlineStack gap="200">
                      {statusEngineOn ? <Badge tone="success">{`${assignments.length} with a status`}</Badge> : null}
                      {volumeEngineOn ? <Badge tone="info">{`${volumeCustomers.length} on the volume list`}</Badge> : null}
                    </InlineStack>
                  </InlineStack>
                  <TextField label="Filter" labelHidden autoComplete="off" value={assignmentFilter} onChange={setAssignmentFilter} placeholder="Filter by name, email or status" />

                  {statusEngineOn && filteredAssignments.length ? (
                    <BlockStack gap="200">
                      {filteredAssignments.map((assignment) => {
                        const status = statusMap[assignment.statusKey]
                        return (
                          <Box key={assignment.customerId} padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                            <InlineGrid columns={{ xs: 1, md: '2fr 1fr auto' }} gap="300" alignItems="center">
                              <BlockStack gap="050">
                                <Text as="p" fontWeight="medium">{assignment.customerName || assignment.customerEmail || assignment.customerId}</Text>
                                <Text as="p" variant="bodySm" tone="subdued">{assignment.customerEmail || 'No email'} · ID {assignment.customerId}</Text>
                              </BlockStack>
                              <BlockStack gap="100">
                                <Badge tone={status?.type === 'vip' ? 'attention' : 'success'}>{status?.label || assignment.statusKey}</Badge>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {assignment.productOverrides.length
                                    ? assignment.productOverrides
                                        .map((override) => `${productCatalog.find((item) => item.productId === normalizeProductIdLocal(override.productId))?.label || 'Product'}: ${formatRate(override.pricePerInch)}`)
                                        .join(' · ')
                                    : 'Uses the status rates'}
                                </Text>
                              </BlockStack>
                              <Form method="post">
                                <input type="hidden" name="intent" value="delete-assignment" />
                                <input type="hidden" name="customerId" value={assignment.customerId} />
                                <Button submit tone="critical" size="slim" loading={isSubmitting} disabled={isDirty}>Remove</Button>
                              </Form>
                            </InlineGrid>
                          </Box>
                        )
                      })}
                    </BlockStack>
                  ) : null}

                  {volumeEngineOn && filteredVolumeCustomers.length ? (
                    <BlockStack gap="200">
                      {filteredVolumeCustomers.map((customer) => (
                        <Box key={customer.id} padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone="info">Volume list</Badge>
                                <Badge>{customer.source === 'auto' ? 'From order history' : customer.source === 'import' ? 'Imported' : 'Added manually'}</Badge>
                              </InlineStack>
                              <Button tone="critical" size="slim" onClick={() => removeVolumeCustomerLocal(customer.id)}>Remove</Button>
                            </InlineStack>
                            <InlineGrid columns={{ xs: 1, md: 4 }} gap="300">
                              <TextField label="Name" autoComplete="off" value={customer.name} onChange={(value) => updateVolumeCustomer(customer.id, 'name', value)} />
                              <TextField label="Email" autoComplete="off" value={customer.email} onChange={(value) => updateVolumeCustomer(customer.id, 'email', value)} />
                              <TextField label="Customer ID" autoComplete="off" value={customer.customerId} onChange={(value) => updateVolumeCustomer(customer.id, 'customerId', value)} />
                              <TextField label="Inches ordered" autoComplete="off" type="text" inputMode="decimal" value={customer.totalInches} onChange={(value) => updateVolumeCustomer(customer.id, 'totalInches', value)} />
                            </InlineGrid>
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  ) : null}

                  {(!statusEngineOn || !filteredAssignments.length) && (!volumeEngineOn || !filteredVolumeCustomers.length) ? (
                    <Banner tone="info">{assignmentFilter ? 'No customers match this filter.' : 'No customers have special pricing yet. Search above to add the first one.'}</Banner>
                  ) : null}
                </BlockStack>
              </Card>
            ) : null}

            {/* ── Policy ── */}
            {model !== 'off' ? (
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">How uploads are measured and matched</Text>
                    <Text as="p" tone="subdued">These rules decide how many inches a file counts as and which sheet it lands on. They apply to every upload block in this store.</Text>
                  </BlockStack>
                  <ChoiceList
                    title="What is measured"
                    choices={[
                      { label: 'The whole uploaded page', value: 'full_page', helpText: 'Bills the full document size, even if the artwork has empty space around it. Simplest to explain to customers.' },
                      { label: 'Only the artwork bounds', value: 'artwork_bounds', helpText: 'Trims empty space and bills the artwork itself. Cheaper for customers who upload loose files.' },
                    ]}
                    selected={[policy.measurementBasis]}
                    onChange={(values) => setPolicy((current) => ({ ...current, measurementBasis: values[0] === 'full_page' ? 'full_page' : 'artwork_bounds' }))}
                  />
                  <Select
                    label="Which sheet is chosen when several fit"
                    options={[
                      { label: 'Let each upload block decide (default)', value: 'block_default' },
                      { label: 'Smallest sheet the artwork fits on', value: 'smallest_fitting_sheet' },
                      { label: 'Cheapest total for the copies requested', value: 'lowest_total_cost' },
                    ]}
                    value={policy.sheetSelection}
                    onChange={(value) => setPolicy((current) => ({ ...current, sheetSelection: value as PolicyEditor['sheetSelection'] }))}
                    helpText={'Example: a 20" × 30" file with 2 copies. Smallest sheet picks 22" × 36" twice; cheapest total may pick one 22" × 60" if it costs less.'}
                  />
                  <InlineGrid columns={{ xs: 1, md: 4 }} gap="300">
                    <TextField label="Widest sheet (inches)" autoComplete="off" type="text" inputMode="decimal" value={policy.maxSheetWidthIn} onChange={(value) => setPolicy((current) => ({ ...current, maxSheetWidthIn: value }))} helpText="Your roll width." />
                    <TextField label="Fit tolerance (inches)" autoComplete="off" type="text" inputMode="decimal" value={policy.fitToleranceIn} onChange={(value) => setPolicy((current) => ({ ...current, fitToleranceIn: value }))} helpText="Artwork may exceed a sheet by this much and still fit." />
                    <TextField label="Sheet margin (inches)" autoComplete="off" type="text" inputMode="decimal" value={policy.artboardMarginIn} onChange={(value) => setPolicy((current) => ({ ...current, artboardMarginIn: value }))} helpText="Kept free around the sheet edge." />
                    <TextField label="Gap between designs (inches)" autoComplete="off" type="text" inputMode="decimal" value={policy.imageMarginIn} onChange={(value) => setPolicy((current) => ({ ...current, imageMarginIn: value }))} helpText="Space between copies on a sheet." />
                  </InlineGrid>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Defaults for this store: {modelState.policy.measurementBasis === 'full_page' ? 'whole page' : 'artwork bounds'}, {data.policyDefaults.maxSheetWidthIn}" roll, {data.policyDefaults.fitToleranceIn}" tolerance.
                  </Text>
                </BlockStack>
              </Card>
            ) : null}
          </BlockStack>
        </Layout.Section>

        {/* ── Aside ── */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {model !== 'off' ? (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Price simulator</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Try a file size and see exactly what a customer would pay with the settings on this page, saved or not.</Text>
                  <InlineGrid columns={2} gap="300">
                    <TextField label="Length (inches)" autoComplete="off" type="text" inputMode="decimal" value={simInches} onChange={setSimInches} />
                    <TextField label="Copies" autoComplete="off" type="text" inputMode="numeric" value={simCopies} onChange={setSimCopies} />
                  </InlineGrid>
                  <Select label="Customer" options={simOptions} value={simWho} onChange={setSimWho} />
                  {simulation ? (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">{simulation.title}</Text>
                        {simulation.lines.map((line) => (
                          <Text key={line} as="p" variant="bodySm">{line}</Text>
                        ))}
                        {simulation.total != null ? <Text as="p" variant="headingLg">{formatMoney(simulation.total)}</Text> : null}
                        <Text as="p" variant="bodySm" tone="subdued">{simulation.note}</Text>
                      </BlockStack>
                    </Box>
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">Enter a length above zero.</Text>
                  )}
                </BlockStack>
              </Card>
            ) : null}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">How the price is calculated</Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm"><strong>Account rate, sheet length:</strong> sheet length × sheets needed × rate. The file is matched to the smallest sheet it fits; the customer pays for that sheet's length.</Text>
                  <Text as="p" variant="bodySm"><strong>Account rate, measured length:</strong> measured length × copies × rate. No sheet matching; the customer pays only for the file.</Text>
                  <Text as="p" variant="bodySm"><strong>Volume tier:</strong> measured length × copies picks the tier; total inches × that tier's rate.</Text>
                  <Text as="p" variant="bodySm"><strong>Standard:</strong> the normal Shopify variant price of the matched sheet.</Text>
                </BlockStack>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Special prices are charged through a custom checkout the app creates for the customer. Standard customers add to cart as usual. Works with the Custom Price Sheet Upload, Custom Price Upload Mod 2 and Variant Gang Sheet Upload blocks.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Where customers see it</Text>
                <Text as="p" variant="bodySm">Logged-in customers with special pricing see their status and rate on the product page before uploading, and the exact total once the file is measured.</Text>
                <Text as="p" variant="bodySm">Guests and standard customers see nothing different.</Text>
                <Button url={themesUrl} target="_blank" size="slim">Open theme editor</Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  )
}

function normalizeVolumeTiersClient(tiers: TierEditor[]): VolumeTier[] {
  const parsed: VolumeTier[] = []
  for (const tier of tiers) {
    const min = Math.max(1, Math.round(parseLocalizedPositiveNumber(tier.minQty, 0)))
    const max = tier.maxQty.trim() === '' ? null : Math.round(parseLocalizedPositiveNumber(tier.maxQty, 0))
    const rate = parseLocalizedPositiveNumber(tier.pricePerInch, 0)
    if (!(rate > 0)) continue
    parsed.push({
      min_qty: min,
      max_qty: max,
      price_per_sqin: rate,
      price_per_inch: rate,
      label: tier.label || formatTierRange({ min_qty: min, max_qty: max }),
      popular: tier.popular,
    })
  }
  return parsed.sort((left, right) => left.min_qty - right.min_qty)
}

function CustomerResult({
  customer,
  currentAssignment,
  currentStatusLabel,
  assignableStatuses,
  productCatalog,
  isSubmitting,
  statusEngineOn,
  volumeEngineOn,
  onVolumeList,
  isDirty,
}: {
  customer: SearchCustomer
  currentAssignment: CustomerPricingAssignment | null
  currentStatusLabel: string
  assignableStatuses: StatusEditor[]
  productCatalog: ProductRuleCatalogItem[]
  isSubmitting: boolean
  statusEngineOn: boolean
  volumeEngineOn: boolean
  onVolumeList: boolean
  isDirty: boolean
}) {
  const [selectedStatusKey, setSelectedStatusKey] = useState(currentAssignment?.statusKey || assignableStatuses[0]?.key || 'business')
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>(() =>
    productCatalog.reduce<Record<string, string>>((acc, product) => {
      const currentOverride = currentAssignment?.productOverrides.find((override) => normalizeProductIdLocal(override.productId) === product.productId)
      acc[product.productId] = formatEditableRate(currentOverride?.pricePerInch)
      return acc
    }, {})
  )
  const [showOverrides, setShowOverrides] = useState(Boolean(currentAssignment?.productOverrides.length))

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="start">
        <BlockStack gap="050">
          <Text as="h3" variant="headingSm">{customer.displayName}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{customer.email || 'No email'} · ID {customer.id}</Text>
          {customer.tags.length ? <Text as="p" variant="bodySm" tone="subdued">Tags: {customer.tags.join(', ')}</Text> : null}
        </BlockStack>
        <InlineStack gap="200">
          <Badge tone={currentAssignment?.statusKey === 'vip' ? 'attention' : currentAssignment ? 'success' : 'info'}>{currentStatusLabel}</Badge>
          {onVolumeList ? <Badge tone="info">On volume list</Badge> : null}
        </InlineStack>
      </InlineStack>

      {statusEngineOn ? (
        <Form method="post">
          <input type="hidden" name="intent" value="save-assignment" />
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="customerEmail" value={customer.email || ''} />
          <input type="hidden" name="customerName" value={customer.displayName} />
          <input
            type="hidden"
            name="productOverridesJson"
            value={JSON.stringify(productCatalog.map((product) => ({ productId: product.productId, pricePerInch: overrideValues[product.productId] || '' })))}
          />
          <BlockStack gap="300">
            <InlineGrid columns={{ xs: 1, md: '2fr auto auto' }} gap="300" alignItems="end">
              <Select label="Status" name="statusKey" options={assignableStatuses.map((status) => ({ label: status.label, value: status.key }))} value={selectedStatusKey} onChange={setSelectedStatusKey} />
              <Button onClick={() => setShowOverrides((current) => !current)} disabled={!productCatalog.length}>{showOverrides ? 'Hide special rates' : 'Special rate for this customer'}</Button>
              <Button submit variant="primary" loading={isSubmitting} disabled={isDirty}>{currentAssignment ? 'Update status' : 'Give status'}</Button>
            </InlineGrid>
            {showOverrides ? (
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                {productCatalog.map((product) => (
                  <TextField
                    key={`${customer.id}_${product.productId}`}
                    label={`${product.label}: this customer's rate`}
                    autoComplete="off"
                    type="text"
                    inputMode="decimal"
                    prefix="$"
                    placeholder="Use status rate"
                    value={overrideValues[product.productId] || ''}
                    onChange={(value) => setOverrideValues((current) => ({ ...current, [product.productId]: value }))}
                  />
                ))}
              </InlineGrid>
            ) : null}
          </BlockStack>
        </Form>
      ) : null}

      {volumeEngineOn && !onVolumeList ? (
        <Form method="post">
          <input type="hidden" name="intent" value="add-volume-customers" />
          <input type="hidden" name="customersJson" value={JSON.stringify([{ customerId: customer.id, email: customer.email || '', name: customer.displayName, source: 'manual' }])} />
          <Button submit loading={isSubmitting} disabled={isDirty}>Add to volume list</Button>
        </Form>
      ) : null}
      {isDirty ? <Text as="p" variant="bodySm" tone="subdued">Save your pending changes first.</Text> : null}
    </BlockStack>
  )
}
