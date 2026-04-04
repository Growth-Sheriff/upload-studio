import prisma from '~/lib/prisma.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import {
  applyCustomerPricingDefaultsForShop,
  calculateMeasuredLengthQuote,
  calculateVariantLengthQuote,
  deriveVariantBasedLimits,
  extractVipUploadMeasurement,
  getMaxWidthLimitForShop,
  isDtfPrintHouseShop,
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
    fileName: string | null
    uploadUrl: string | null
    thumbnailUrl: string | null
  }
  pricingContext: CustomerPricingContext
  measurement: VipUploadMeasurement
  quote: CustomPricedQuote
  currencyCode: string
  productTitle: string
  productHandle: string | null
  resolvedVariant: SheetVariantResolution | null
  requestedQuantity: number
}

export interface CustomPricingJobItemInput {
  uploadId: string
  quantity: number
  selectedVariantId?: string | null
}

export interface PreparedCustomPricingJobQuote {
  shop: {
    id: string
    shopDomain: string
    accessToken: string
  }
  pricingContext: CustomerPricingContext
  currencyCode: string
  totalPrice: number
  formattedTotalPrice: string
  totalBillableLengthIn: number
  totalRequestedQuantity: number
  items: PreparedCustomPricingQuote[]
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function buildEffectiveResolveConfig(
  builderConfig: Record<string, unknown> | null | undefined,
  shopDomain: string
): BuilderResolveConfig {
  const configuredMaxWidth = parsePositiveNumber(builderConfig?.maxWidthIn) || 0
  const maxWidthLimit = getMaxWidthLimitForShop(shopDomain)
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
    maxWidthIn: configuredMaxWidth > 0 ? Math.max(configuredMaxWidth, maxWidthLimit) : maxWidthLimit,
    fitToleranceIn: isDtfPrintHouseShop(shopDomain) ? 0.5 : 0,
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
  builderConfig: Record<string, unknown> | null | undefined,
  shopDomain: string
): BuilderLimits {
  const variantTitles = (product?.variants.edges || [])
    .map((edge) => edge.node?.title || '')
    .filter(Boolean)
  const limits = deriveVariantBasedLimits(
    variantTitles,
    (builderConfig as BuilderLimits | null | undefined) || null
  )
  const maxWidthLimit = getMaxWidthLimitForShop(shopDomain)
  return {
    ...limits,
    maxWidthIn: Math.max(parsePositiveNumber(limits.maxWidthIn) || 0, maxWidthLimit),
  }
}

export async function prepareCustomPricingQuote({
  shopDomain,
  loggedInCustomerId,
  loggedInCustomerEmail,
  uploadId,
  quantity,
  selectedVariantId,
}: {
  shopDomain: string
  loggedInCustomerId: string | null
  loggedInCustomerEmail?: string | null
  uploadId: string
  quantity: number
  selectedVariantId?: string | null
}): Promise<PreparedCustomPricingQuote> {
  const preparedJob = await prepareCustomPricingJobQuote({
    shopDomain,
    loggedInCustomerId,
    loggedInCustomerEmail,
    items: [{ uploadId, quantity, selectedVariantId }],
  })

  return preparedJob.items[0]
}

export async function prepareCustomPricingJobQuote({
  shopDomain,
  loggedInCustomerId,
  loggedInCustomerEmail,
  items,
}: {
  shopDomain: string
  loggedInCustomerId: string | null
  loggedInCustomerEmail?: string | null
  items: CustomPricingJobItemInput[]
}): Promise<PreparedCustomPricingJobQuote> {
  const normalizedItems = items
    .map((item) => ({
      uploadId: String(item.uploadId || '').trim(),
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      selectedVariantId:
        item.selectedVariantId != null && String(item.selectedVariantId).trim()
          ? String(item.selectedVariantId).trim()
          : null,
    }))
    .filter((item) => item.uploadId)

  if (!normalizedItems.length) {
    throw new Error('Missing uploadId')
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      accessToken: true,
      settings: true,
      storageProvider: true,
      storageConfig: true,
    },
  })

  if (!shop?.accessToken) {
    throw new Error('Shop not found')
  }

  const normalizedLoggedInCustomerId = normalizeCustomerId(loggedInCustomerId)
  const settings = applyCustomerPricingDefaultsForShop(shop.shopDomain, shop.settings)
  const storageConfig = getStorageConfig({
    storageProvider: shop.storageProvider,
    storageConfig: (shop.storageConfig as Record<string, string> | null) || null,
  })
  const productCache = new Map<
    string,
    {
      builderConfig: Record<string, unknown> | null
      productData: ProductQueryResponse
      optionDefs: ProductOptionDef[]
      variants: ProductVariantDef[]
      variantLimits: BuilderLimits
    }
  >()

  async function prepareSingleItem(
    itemInput: CustomPricingJobItemInput
  ): Promise<PreparedCustomPricingQuote> {
    const upload = await prisma.upload.findFirst({
      where: { id: itemInput.uploadId, shopId: shop.id },
      select: {
        id: true,
        productId: true,
        variantId: true,
        customerId: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            originalName: true,
            storageKey: true,
            thumbnailKey: true,
            preflightStatus: true,
            preflightResult: true,
          },
        },
      },
    })

    if (!upload) {
      throw new Error('Upload not found')
    }

    const uploadCustomerId = normalizeCustomerId(upload.customerId)
    if (
      uploadCustomerId &&
      normalizedLoggedInCustomerId &&
      uploadCustomerId !== normalizedLoggedInCustomerId
    ) {
      throw new Error('Upload does not belong to the logged in customer')
    }

    const pricingContext = resolveCustomerPricingContext(
      settings,
      normalizedLoggedInCustomerId,
      upload.productId,
      loggedInCustomerEmail
    )

    if (!pricingContext.hasCustomPricing || pricingContext.pricingMode === 'standard_variant') {
      throw new Error('Custom pricing is not active for this customer and product')
    }

    const measurement = extractVipUploadMeasurement(upload.items, shop.shopDomain)
    if (!measurement) {
      throw new Error('Upload measurement is not ready')
    }

    const productId = normalizeProductId(upload.productId)
    if (!productId) {
      throw new Error('Upload product is missing')
    }

    const firstItem = upload.items[0]
    const uploadUrl = firstItem?.storageKey
      ? await getDownloadSignedUrl(storageConfig, firstItem.storageKey, 30 * 24 * 3600)
      : null
    const thumbnailSource = firstItem?.thumbnailKey || firstItem?.storageKey || null
    const thumbnailUrl = thumbnailSource
      ? await getDownloadSignedUrl(storageConfig, thumbnailSource, 30 * 24 * 3600)
      : null

    let cachedProduct = productCache.get(productId)
    if (!cachedProduct) {
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
        shopifyGraphQL<ProductQueryResponse>(
          shop.shopDomain,
          shop.accessToken,
          PRODUCT_VARIANTS_QUERY,
          {
            id: productId,
          }
        ),
      ])

      if (!productData?.product) {
        throw new Error('Product not found')
      }

      const builderConfig =
        (productConfig?.builderConfig as Record<string, unknown> | null) || null
      const { optionDefs, variants } = buildVariantMatrix(productData.product)
      const variantLimits = buildVariantLimits(productData.product, builderConfig, shop.shopDomain)

      cachedProduct = {
        builderConfig,
        productData,
        optionDefs,
        variants,
        variantLimits,
      }
      productCache.set(productId, cachedProduct)
    }

    const pricePerInch = pricingContext.pricePerInch || pricingContext.businessPricePerInch
    let resolvedVariant: SheetVariantResolution | null = null
    let quote: CustomPricedQuote | null = null

    if (pricingContext.pricingMode === 'measured_length') {
      quote = calculateMeasuredLengthQuote(measurement, pricePerInch)
      quote.billableLengthIn = Number((quote.billableLengthIn * itemInput.quantity).toFixed(2))
      quote.totalPrice = Number((quote.billableLengthIn * quote.pricePerInch).toFixed(2))
      quote.formattedTotalPrice = quote.totalPrice.toFixed(2)
      const validation = validateCustomQuoteAgainstLimits(quote, cachedProduct.variantLimits, 'Custom design')
      if (!validation.ok) {
        throw new Error(validation.reason || 'Design is outside product limits')
      }
    } else if (pricingContext.pricingMode === 'variant_length') {
      const resolution = resolveSheetVariant({
        widthIn: measurement.widthIn,
        heightIn: measurement.heightIn,
        quantity: itemInput.quantity,
        variants: cachedProduct.variants,
        optionDefs: cachedProduct.optionDefs,
        selectedVariantId: itemInput.selectedVariantId || null,
        config: buildEffectiveResolveConfig(cachedProduct.builderConfig, shop.shopDomain),
      })

      if (!resolution) {
        throw new Error(
          'No product variant can fit this upload with the current quantity and available sheet sizes.'
        )
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
      const selectedSheetMaxWidth =
        parsedSheetSize?.widthIn != null
          ? Math.max(parsedSheetSize.widthIn, getMaxWidthLimitForShop(shop.shopDomain))
          : 0
      if (!parsedSheetSize || measurement.widthIn > selectedSheetMaxWidth + 0.001) {
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
        fileName: firstItem?.originalName || null,
        uploadUrl,
        thumbnailUrl,
      },
      pricingContext,
      measurement,
      quote,
      currencyCode: String(cachedProduct.productData.shop?.currencyCode || 'USD').toUpperCase(),
      productTitle: cachedProduct.productData.product?.title || 'Custom Transfer',
      productHandle: cachedProduct.productData.product?.handle || null,
      resolvedVariant,
      requestedQuantity: itemInput.quantity,
    }
  }

  const preparedItems = await Promise.all(normalizedItems.map((item) => prepareSingleItem(item)))
  const firstPrepared = preparedItems[0]

  for (const preparedItem of preparedItems) {
    if (preparedItem.currencyCode !== firstPrepared.currencyCode) {
      throw new Error('Custom pricing items returned mismatched currencies')
    }
  }

  const totalPrice = Number(
    preparedItems.reduce((sum, item) => sum + item.quote.totalPrice, 0).toFixed(2)
  )
  const totalBillableLengthIn = Number(
    preparedItems.reduce((sum, item) => sum + item.quote.billableLengthIn, 0).toFixed(2)
  )
  const totalRequestedQuantity = preparedItems.reduce(
    (sum, item) => sum + Math.max(1, item.requestedQuantity),
    0
  )

  return {
    shop: firstPrepared.shop,
    pricingContext: firstPrepared.pricingContext,
    currencyCode: firstPrepared.currencyCode,
    totalPrice,
    formattedTotalPrice: totalPrice.toFixed(2),
    totalBillableLengthIn,
    totalRequestedQuantity,
    items: preparedItems,
  }
}
