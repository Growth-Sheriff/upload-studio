import prisma from '~/lib/prisma.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  applyCustomerPricingDefaultsForShop,
  calculateMeasuredLengthQuote,
  calculateVariantLengthQuote,
  deriveVariantBasedLimits,
  extractVipUploadMeasurement,
  normalizeCustomerId,
  normalizeProductId,
  parseSheetSizeFromTitle,
  resolveCustomerPricingContext,
  validateCustomQuoteAgainstLimits,
  type BuilderLimits,
  type CustomPricedQuote,
  type CustomerPricingContext,
  type VipUploadMeasurement,
} from '~/lib/customerPricing.server'
import {
  resolveSheetVariant,
  type BuilderResolveConfig,
  type ProductOptionDef,
  type ProductVariantDef,
  type SheetVariantResolution,
} from '~/lib/dtfSheetResolver.server'

const PRODUCT_VARIANTS_QUERY = `
  query CustomPricingProductVariants($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      options {
        name
        values
      }
      variants(first: 100) {
        edges {
          node {
            id
            legacyResourceId
            title
            price
            availableForSale
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
    shop {
      currencyCode
    }
  }
`

interface ProductQueryResponse {
  product: {
    id: string
    title: string
    handle: string
    options: Array<{ name: string; values: string[] }>
    variants: {
      edges: Array<{
        node: {
          id: string
          legacyResourceId?: string | number | null
          title: string
          price: string
          availableForSale: boolean
          selectedOptions: Array<{ name: string; value: string }>
        }
      }>
    }
  } | null
  shop: {
    currencyCode?: string | null
  } | null
}

export interface PreparedCustomPricingQuote {
  shop: {
    id: string
    shopDomain: string
    accessToken: string
  }
  upload: {
    id: string
    productId: string | null
    variantId: string | null
    customerId: string | null
  }
  pricingContext: CustomerPricingContext
  measurement: VipUploadMeasurement
  quote: CustomPricedQuote
  currencyCode: string
  productTitle: string
  productHandle: string | null
  resolvedVariant: SheetVariantResolution | null
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function buildEffectiveResolveConfig(builderConfig: Record<string, unknown> | null | undefined): BuilderResolveConfig {
  const configuredMaxWidth = parsePositiveNumber(builderConfig?.maxWidthIn) || 0
  return {
    sheetOptionName:
      typeof builderConfig?.sheetOptionName === 'string' ? builderConfig.sheetOptionName : null,
    widthOptionName:
      typeof builderConfig?.widthOptionName === 'string' ? builderConfig.widthOptionName : null,
    heightOptionName:
      typeof builderConfig?.heightOptionName === 'string' ? builderConfig.heightOptionName : null,
    modalOptionNames: Array.isArray(builderConfig?.modalOptionNames)
      ? builderConfig!.modalOptionNames
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      : [],
    artboardMarginIn: 0,
    imageMarginIn: 0,
    maxWidthIn: configuredMaxWidth > 0 ? Math.max(configuredMaxWidth, 22) : 22,
  }
}

function buildVariantMatrix(
  payload: ProductQueryResponse['product']
): { optionDefs: ProductOptionDef[]; variants: ProductVariantDef[] } {
  const optionDefs: ProductOptionDef[] = (payload?.options || []).map((option) => ({
    name: option.name || '',
    values: Array.isArray(option.values) ? option.values.map((value) => String(value || '')) : [],
  }))

  const variants: ProductVariantDef[] = (payload?.variants.edges || []).map((edge) => {
    const node = edge.node
    const legacyId =
      node.legacyResourceId != null && node.legacyResourceId !== ''
        ? String(node.legacyResourceId)
        : String(node.id || '').split('/').pop() || String(node.id || '')

    return {
      id: legacyId,
      title: node.title || '',
      price: node.price,
      available: node.availableForSale !== false,
      availableForSale: node.availableForSale !== false,
      selectedOptions: Array.isArray(node.selectedOptions)
        ? node.selectedOptions.map((option) => ({
            name: option.name || '',
            value: option.value || '',
          }))
        : [],
      options: Array.isArray(node.selectedOptions)
        ? node.selectedOptions.map((option) => option.value || '')
        : [],
      option1: node.selectedOptions?.[0]?.value || null,
      option2: node.selectedOptions?.[1]?.value || null,
      option3: node.selectedOptions?.[2]?.value || null,
    }
  })

  return { optionDefs, variants }
}

function buildVariantLimits(
  product: ProductQueryResponse['product'],
  builderConfig: Record<string, unknown> | null | undefined
): BuilderLimits {
  const variantTitles = (product?.variants.edges || [])
    .map((edge) => edge.node?.title || '')
    .filter(Boolean)
  return deriveVariantBasedLimits(
    variantTitles,
    (builderConfig as BuilderLimits | null | undefined) || null
  )
}

export async function prepareCustomPricingQuote({
  shopDomain,
  loggedInCustomerId,
  uploadId,
  quantity,
  selectedVariantId,
}: {
  shopDomain: string
  loggedInCustomerId: string | null
  uploadId: string
  quantity: number
  selectedVariantId?: string | null
}): Promise<PreparedCustomPricingQuote> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      accessToken: true,
      settings: true,
    },
  })

  if (!shop?.accessToken) {
    throw new Error('Shop not found')
  }

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, shopId: shop.id },
    select: {
      id: true,
      productId: true,
      variantId: true,
      customerId: true,
      items: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          preflightStatus: true,
          preflightResult: true,
        },
      },
    },
  })

  if (!upload) {
    throw new Error('Upload not found')
  }

  const normalizedLoggedInCustomerId = normalizeCustomerId(loggedInCustomerId)
  const uploadCustomerId = normalizeCustomerId(upload.customerId)
  if (uploadCustomerId && normalizedLoggedInCustomerId && uploadCustomerId !== normalizedLoggedInCustomerId) {
    throw new Error('Upload does not belong to the logged in customer')
  }

  const settings = applyCustomerPricingDefaultsForShop(shop.shopDomain, shop.settings)
  const pricingContext = resolveCustomerPricingContext(
    settings,
    normalizedLoggedInCustomerId,
    upload.productId
  )

  if (!pricingContext.hasCustomPricing || pricingContext.pricingMode === 'standard_variant') {
    throw new Error('Custom pricing is not active for this customer and product')
  }

  const measurement = extractVipUploadMeasurement(upload.items)
  if (!measurement) {
    throw new Error('Upload measurement is not ready')
  }

  const productId = normalizeProductId(upload.productId)
  if (!productId) {
    throw new Error('Upload product is missing')
  }

  const [productConfig, productData] = await Promise.all([
    prisma.productConfig.findFirst({
      where: {
        shopId: shop.id,
        OR: [{ productId: upload.productId || '' }, { productId }],
      },
      select: {
        builderConfig: true,
      },
    }),
    shopifyGraphQL<ProductQueryResponse>(shop.shopDomain, shop.accessToken, PRODUCT_VARIANTS_QUERY, {
      id: productId,
    }),
  ])

  if (!productData?.product) {
    throw new Error('Product not found')
  }

  const builderConfig = (productConfig?.builderConfig as Record<string, unknown> | null) || null
  const { optionDefs, variants } = buildVariantMatrix(productData.product)
  const variantLimits = buildVariantLimits(productData.product, builderConfig)
  const pricePerInch = pricingContext.pricePerInch || pricingContext.businessPricePerInch
  let resolvedVariant: SheetVariantResolution | null = null
  let quote: CustomPricedQuote | null = null

  if (pricingContext.pricingMode === 'measured_length') {
    quote = calculateMeasuredLengthQuote(measurement, pricePerInch)
    const validation = validateCustomQuoteAgainstLimits(quote, variantLimits, 'Custom design')
    if (!validation.ok) {
      throw new Error(validation.reason || 'Design is outside product limits')
    }
  } else if (pricingContext.pricingMode === 'variant_length') {
    const resolution = resolveSheetVariant({
      widthIn: measurement.widthIn,
      heightIn: measurement.heightIn,
      quantity: Math.max(1, Math.floor(quantity)),
      variants,
      optionDefs,
      selectedVariantId: selectedVariantId || null,
      config: buildEffectiveResolveConfig(builderConfig),
    })

    if (!resolution) {
      throw new Error('No product variant can fit this upload with the current quantity and available sheet sizes.')
    }

    const variantLengthQuote = calculateVariantLengthQuote({
      measurement,
      pricePerInch,
      variantTitle: resolution.selectedVariantTitle,
      sheetsNeeded: resolution.sheetsNeeded,
    })

    if (!variantLengthQuote) {
      throw new Error('Failed to calculate business quote from the selected variant')
    }

    const parsedSheetSize = parseSheetSizeFromTitle(resolution.selectedVariantTitle)
    if (!parsedSheetSize || measurement.widthIn > parsedSheetSize.widthIn + 0.001) {
      throw new Error('Business design width exceeds the selected sheet width')
    }

    resolvedVariant = resolution
    quote = variantLengthQuote
  } else {
    throw new Error('Unsupported custom pricing mode')
  }

  if (!quote) {
    throw new Error('Failed to calculate custom quote')
  }

  return {
    shop: {
      id: shop.id,
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
    },
    upload: {
      id: upload.id,
      productId: upload.productId,
      variantId: upload.variantId,
      customerId: upload.customerId,
    },
    pricingContext,
    measurement,
    quote,
    currencyCode: String(productData.shop?.currencyCode || 'USD').toUpperCase(),
    productTitle: productData.product.title || 'Custom Transfer',
    productHandle: productData.product.handle || null,
    resolvedVariant,
  }
}
