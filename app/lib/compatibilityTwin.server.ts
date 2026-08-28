// Compatibility twin: a hidden duplicate product used for cart lines when a
// second storefront app also operates on the same product page. Cart lines
// on the twin are invisible to the other app's checkout rules (they are
// scoped to the product ids that app has registered), while customers see
// identical titles and prices.
//
// The page product's builderConfig carries:
//   cartProductHandle : storefront handle the widget resolves variants from
//   cartProductId     : twin product GID (webhook + health lookups)
//   cartAutoSync      : mirror page variant prices onto the twin (default on)
// The twin's own ProductConfig row carries builderConfig.compatibilityTwinOf
// = page product GID, which also guards the auto-sync webhook against loops.

import prisma from '~/lib/prisma.server'

export interface TwinVariantDiff {
  title: string
  pagePrice: string | null
  twinPrice: string | null
  twinVariantId: string | null
  inSync: boolean
}

export interface TwinStatus {
  exists: boolean
  status: string | null
  title: string | null
  handle: string | null
  variantDiffs: TwinVariantDiff[]
  pricesInSync: boolean
  matchedVariants: number
  totalPageVariants: number
}

interface AdminShop {
  shopDomain: string
  accessToken: string
}

async function adminGraphQL<T = any>(
  shop: AdminShop,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://${shop.shopDomain}/admin/api/2025-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shop.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  })
  const result = await response.json()
  if (result.errors?.length) {
    throw new Error(`Admin GraphQL error: ${JSON.stringify(result.errors).slice(0, 300)}`)
  }
  return result.data
}

const PRODUCT_VARIANTS_QUERY = `
  query productVariants($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      variants(first: 100) {
        nodes { id title price }
      }
    }
  }
`

/** Pure: title-keyed price comparison between page and twin variants. */
export function diffVariantsByTitle(
  pageVariants: Array<{ title: string; price: string }>,
  twinVariants: Array<{ id: string; title: string; price: string }>
): TwinVariantDiff[] {
  const twinByTitle = new Map(
    twinVariants.map((v) => [v.title.trim().toLowerCase(), v])
  )
  return pageVariants.map((pageVariant) => {
    const twin = twinByTitle.get(pageVariant.title.trim().toLowerCase()) || null
    return {
      title: pageVariant.title,
      pagePrice: pageVariant.price,
      twinPrice: twin ? twin.price : null,
      twinVariantId: twin ? twin.id : null,
      inSync: Boolean(twin && Number(twin.price) === Number(pageVariant.price)),
    }
  })
}

/** Health snapshot: does the twin exist, do variants match, are prices equal? */
export async function getTwinStatus(
  shop: AdminShop,
  pageProductGid: string,
  twinProductGid: string
): Promise<TwinStatus> {
  const [pageData, twinData] = await Promise.all([
    adminGraphQL(shop, PRODUCT_VARIANTS_QUERY, { id: pageProductGid }),
    adminGraphQL(shop, PRODUCT_VARIANTS_QUERY, { id: twinProductGid }),
  ])
  const page = pageData?.product
  const twin = twinData?.product

  if (!twin) {
    return {
      exists: false,
      status: null,
      title: null,
      handle: null,
      variantDiffs: [],
      pricesInSync: false,
      matchedVariants: 0,
      totalPageVariants: page?.variants?.nodes?.length || 0,
    }
  }

  const diffs = diffVariantsByTitle(page?.variants?.nodes || [], twin.variants?.nodes || [])
  const matched = diffs.filter((d) => d.twinVariantId).length
  return {
    exists: true,
    status: twin.status,
    title: twin.title,
    handle: twin.handle,
    variantDiffs: diffs,
    pricesInSync: diffs.length > 0 && diffs.every((d) => d.inSync),
    matchedVariants: matched,
    totalPageVariants: diffs.length,
  }
}

/** Mirror page variant prices onto the twin (title-matched). Returns the
 *  number of variants updated. */
export async function syncTwinPrices(
  shop: AdminShop,
  pageProductGid: string,
  twinProductGid: string
): Promise<number> {
  const status = await getTwinStatus(shop, pageProductGid, twinProductGid)
  if (!status.exists) throw new Error('Compatibility product no longer exists')

  const updates = status.variantDiffs
    .filter((d) => d.twinVariantId && !d.inSync)
    .map((d) => ({ id: d.twinVariantId, price: d.pagePrice }))
  if (!updates.length) return 0

  const data = await adminGraphQL(shop, `
    mutation syncTwin($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
  `, { productId: twinProductGid, variants: updates })
  const userErrors = data?.productVariantsBulkUpdate?.userErrors
  if (userErrors?.length) {
    throw new Error(`Price sync failed: ${JSON.stringify(userErrors).slice(0, 300)}`)
  }
  return updates.length
}

/** Create the twin (productDuplicate) and wire both ProductConfig rows.
 *  Idempotent enough for a "Recreate" button: always makes a fresh duplicate
 *  and repoints the page config at it. */
export async function createTwin(
  shop: AdminShop & { id: string },
  pageProductGid: string
): Promise<{ twinGid: string; handle: string; title: string }> {
  const pageData = await adminGraphQL(shop, PRODUCT_VARIANTS_QUERY, { id: pageProductGid })
  const pageTitle = pageData?.product?.title
  if (!pageTitle) throw new Error('Product not found')

  const dup = await adminGraphQL(shop, `
    mutation dup($productId: ID!, $newTitle: String!) {
      productDuplicate(productId: $productId, newTitle: $newTitle, includeImages: true, newStatus: ACTIVE) {
        newProduct { id handle title }
        userErrors { field message }
      }
    }
  `, { productId: pageProductGid, newTitle: pageTitle })
  const errors = dup?.productDuplicate?.userErrors
  if (errors?.length) {
    throw new Error(`Duplicate failed: ${JSON.stringify(errors).slice(0, 300)}`)
  }
  const twin = dup.productDuplicate.newProduct

  // Twin config: webhook matching/ghost logic treats twin lines as ours, and
  // compatibilityTwinOf guards the auto-sync webhook against loops.
  const existingPageConfig = await prisma.productConfig.findUnique({
    where: { shopId_productId: { shopId: shop.id, productId: pageProductGid } },
  })
  const pageBuilderConfig =
    (existingPageConfig?.builderConfig as Record<string, unknown> | null) || {}

  await prisma.productConfig.upsert({
    where: { shopId_productId: { shopId: shop.id, productId: twin.id } },
    update: {
      enabled: true,
      uploadEnabled: true,
      builderConfig: { compatibilityTwinOf: pageProductGid },
    },
    create: {
      shopId: shop.id,
      productId: twin.id,
      mode: existingPageConfig?.mode || 'dtf',
      enabled: true,
      uploadEnabled: true,
      builderConfig: { compatibilityTwinOf: pageProductGid },
    },
  })

  await prisma.productConfig.upsert({
    where: { shopId_productId: { shopId: shop.id, productId: pageProductGid } },
    update: {
      builderConfig: {
        ...pageBuilderConfig,
        cartProductHandle: twin.handle,
        cartProductId: twin.id,
        cartAutoSync: true,
      } as any,
    },
    create: {
      shopId: shop.id,
      productId: pageProductGid,
      mode: 'dtf',
      enabled: true,
      uploadEnabled: true,
      builderConfig: {
        cartProductHandle: twin.handle,
        cartProductId: twin.id,
        cartAutoSync: true,
      } as any,
    },
  })

  return { twinGid: twin.id, handle: twin.handle, title: twin.title }
}

/** Count of recent foreign-app order lines on this product — the signal that
 *  a second app is selling the same product (shown as a generic warning). */
export async function countForeignLineSignals(
  shopId: string,
  numericProductId: string,
  days = 30
): Promise<number> {
  return prisma.auditLog.count({
    where: {
      shopId,
      action: 'foreign_app_line_skipped',
      createdAt: { gte: new Date(Date.now() - days * 24 * 3600 * 1000) },
      metadata: { path: ['productId'], equals: Number(numericProductId) },
    },
  })
}
