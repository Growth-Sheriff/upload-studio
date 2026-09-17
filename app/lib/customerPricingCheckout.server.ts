import prisma from '~/lib/prisma.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import {
  applyFinishedSheetMeasurementPolicy,
  FINISHED_SHEET_MEASUREMENT_POLICY,
  getFinishedSheetSizes,
} from '~/lib/mainProductMeasurement.server'
import {
  resolveFinishedSheetSettings,
  validateFinishedSheetFit,
} from '~/lib/finishedSheetMeasurement'
import {
  applyCustomerPricingDefaultsForShop,
  calculateMeasuredLengthQuote,
  calculateVariantLengthQuote,
  matchesTrustedUploadOwner,
  normalizeCustomerId,
  parseSheetSizeFromTitle,
  validateMeasuredFinishedSheetFit,
  type CustomPricedQuote,
  type CustomerPricingContext,
  type VipUploadMeasurement,
} from '~/lib/customerPricing.server'
import {
  getRuntimeMeasurementBasis,
  type PricingSource,
  type VolumeTier,
} from '~/lib/customerPricingModel.server'
import {
  loadTrustedCustomerProfile,
  resolveEffectivePricingForShop,
} from '~/lib/customerPricingRuntime.server'
import {
  getFinishedSheetWidthFailure,
  resolveSheetVariant,
  type BuilderResolveConfig,
  type ProductOptionDef,
  type ProductVariantDef,
  type SheetVariantResolution,
} from '~/lib/dtfSheetResolver.server'
import {
  applyMeasurementBasisMetadata,
  deriveUploadItemLifecycle,
  getStoredMeasurementBasis,
} from '~/lib/uploadLifecycle.server'
import { persistMainProductMeasurementProjection } from '~/lib/mainProductMeasurementPersistence.server'
import {
  canonicalShopifyProductId,
  shopifyProductIdCandidates,
} from '~/lib/shopifyProductIdentity'
import { selectProductConfigForIdentity } from '~/lib/productConfigIdentity.server'
import { collectShopifyConnectionPages } from '~/lib/shopifyVariantPagination.server'
import { hasUploadOrderHistory } from '~/lib/uploadQuantitySemantics'
export const HISTORICAL_UPLOAD_REUPLOAD_REQUIRED =
  'Upload this file again before ordering so the previous order record stays unchanged.'

const PRODUCT_VARIANTS_QUERY = `
  query CustomPricingProductVariants($id: ID!, $after: String) {
    product(id: $id) {
      id
      title
      handle
      options {
        name
        values
      }
      variants(first: 250, after: $after) {
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
        pageInfo {
          hasNextPage
          endCursor
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
      pageInfo: {
        hasNextPage: boolean
        endCursor: string | null
      }
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
  /** Which engine produced the price: assigned status rate or a volume tier. */
  pricingSource: PricingSource
  volumeTier: VolumeTier | null
  measurement: VipUploadMeasurement
  quote: CustomPricedQuote
  currencyCode: string
  productTitle: string
  productHandle: string | null
  resolvedVariant: SheetVariantResolution | null
  checkoutVariantId: string | null
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

function buildEffectiveResolveConfig(
  builderConfig: Record<string, unknown> | null | undefined
): BuilderResolveConfig {
  const settings = resolveFinishedSheetSettings(builderConfig)
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
    maxPrintableWidthIn: settings.maxPrintableWidthIn,
    fitToleranceIn: settings.fitToleranceIn,
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

  if (!shop || !shop.accessToken) {
    throw new Error('Shop not found')
  }

  const activeShop = shop
  const normalizedLoggedInCustomerId = normalizeCustomerId(loggedInCustomerId)
  if (!normalizedLoggedInCustomerId) {
    throw new Error('Upload does not belong to the logged in customer')
  }
  const trustedCustomer = await loadTrustedCustomerProfile(
    activeShop,
    normalizedLoggedInCustomerId
  )
  if (!trustedCustomer) {
    throw new Error('Upload does not belong to the logged in customer')
  }
  const trustedCustomerProfile = trustedCustomer
  const settings = applyCustomerPricingDefaultsForShop(activeShop.shopDomain, activeShop.settings)
  const measurementBasis = getRuntimeMeasurementBasis(activeShop.shopDomain, activeShop.settings)
  const storageConfig = getStorageConfig({
    storageProvider: activeShop.storageProvider,
    storageConfig: (activeShop.storageConfig as Record<string, string> | null) || null,
  })
  const productCache = new Map<
    string,
    {
      builderConfig: Record<string, unknown> | null
      productData: ProductQueryResponse
      optionDefs: ProductOptionDef[]
      variants: ProductVariantDef[]
    }
  >()

  async function prepareSingleItem(
    itemInput: CustomPricingJobItemInput
  ): Promise<PreparedCustomPricingQuote> {
    const upload = await prisma.upload.findFirst({
      where: { id: itemInput.uploadId, shopId: activeShop.id },
      select: {
        id: true,
        productId: true,
        variantId: true,
        customerId: true,
        customerEmail: true,
        orderId: true,
        quantitySemantics: true,
        requestedCopies: true,
        designsPerSheet: true,
        sheetsNeeded: true,
        ordersLink: {
          select: { orderId: true },
          take: 1,
        },
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
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

    if (
      !matchesTrustedUploadOwner({
        loggedInCustomerId: normalizedLoggedInCustomerId,
        trustedCustomerEmail: trustedCustomerProfile.email,
        uploadCustomerId: upload.customerId,
        uploadCustomerEmail: upload.customerEmail,
      })
    ) {
      throw new Error('Upload does not belong to the logged in customer')
    }

    const hasOrderHistory = hasUploadOrderHistory(upload)
    if (hasOrderHistory) {
      throw new Error(HISTORICAL_UPLOAD_REUPLOAD_REQUIRED)
    }

    const itemLifecycles = upload.items.map((item) => ({
      item,
      lifecycle: deriveUploadItemLifecycle(item),
    }))
    if (!itemLifecycles.length || itemLifecycles.some(({ lifecycle }) => !lifecycle.canAddToCart)) {
      throw new Error('Upload is blocked by preflight checks')
    }
    const measuredItem = itemLifecycles
      .find(({ lifecycle }) => lifecycle.measurementStatus === 'ready' && lifecycle.metadata)
    const rawMeasurement = measuredItem
      ? applyMeasurementBasisMetadata(
          measuredItem.lifecycle.metadata,
          getStoredMeasurementBasis(measuredItem.item.preflightResult, measurementBasis)
        )
      : null
    if (!rawMeasurement || !measuredItem) {
      throw new Error('Upload measurement is not ready')
    }

    const productId = canonicalShopifyProductId(upload.productId)
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
      const [productConfigs, productData] = await Promise.all([
        prisma.productConfig.findMany({
          where: {
            shopId: activeShop.id,
            productId: { in: shopifyProductIdCandidates(upload.productId) },
          },
          select: {
            productId: true,
            builderConfig: true,
          },
        }),
        collectShopifyConnectionPages({
          fetchPage: (after) =>
            shopifyGraphQL<ProductQueryResponse>(
              activeShop.shopDomain,
              activeShop.accessToken,
              PRODUCT_VARIANTS_QUERY,
              { id: productId, after }
            ),
          getConnection: (page) => page.product?.variants,
        }).then((paginated) =>
          paginated.firstPage.product && paginated.connection
            ? {
                ...paginated.firstPage,
                product: {
                  ...paginated.firstPage.product,
                  variants: paginated.connection,
                },
              }
            : paginated.firstPage
        ),
      ])

      if (!productData?.product) {
        throw new Error('Product not found')
      }

      const productConfig = selectProductConfigForIdentity({
        rows: productConfigs,
        productId: upload.productId,
        shopId: activeShop.id,
        source: 'customerPricingCheckout',
      })
      const builderConfig =
        (productConfig?.builderConfig as Record<string, unknown> | null) || null
      const { optionDefs, variants } = buildVariantMatrix(productData.product)

      cachedProduct = {
        builderConfig,
        productData,
        optionDefs,
        variants,
      }
      productCache.set(productId, cachedProduct)
    }

    const finishedSheetSettings = resolveFinishedSheetSettings(cachedProduct.builderConfig)
    const measurement = applyFinishedSheetMeasurementPolicy(rawMeasurement, {
      measurementPolicy: FINISHED_SHEET_MEASUREMENT_POLICY,
      maxPrintableWidthIn: finishedSheetSettings.maxPrintableWidthIn,
      fitToleranceIn: finishedSheetSettings.fitToleranceIn,
      sheetSizes: getFinishedSheetSizes(cachedProduct.variants),
    })
    await persistMainProductMeasurementProjection(
      measuredItem.item.id,
      measurement,
      finishedSheetSettings
    )

    // First resolve eligibility and pricing mode. Variant-length tiers are
    // selected a second time below after sheet matching determines the exact
    // billable sheet inches.
    const measuredLengthIn = Math.max(measurement.widthIn, measurement.heightIn)
    let effective = await resolveEffectivePricingForShop({
      shop: activeShop,
      settings,
      customerId: normalizedLoggedInCustomerId,
      customerEmail: trustedCustomerProfile.email,
      productId: upload.productId,
      billableInches: Number((measuredLengthIn * itemInput.quantity).toFixed(2)),
    })
    let pricingContext = effective.context

    if (!pricingContext.hasCustomPricing || pricingContext.pricingMode === 'standard_variant') {
      throw new Error('Custom pricing is not active for this customer and product')
    }

    let pricePerInch = pricingContext.pricePerInch || pricingContext.businessPricePerInch
    let resolvedVariant: SheetVariantResolution | null = null
    let checkoutVariantId: string | null = null
    let quote: CustomPricedQuote | null = null

    if (pricingContext.pricingMode === 'measured_length') {
      quote = calculateMeasuredLengthQuote(measurement, pricePerInch, itemInput.quantity)
      const measuredFit = validateMeasuredFinishedSheetFit({
        measurement,
        ...finishedSheetSettings,
      })
      if (!measuredFit.ok) {
        throw new Error(measuredFit.reason || 'The file is outside this product’s printable limits')
      }
      const requestedVariantId = String(
        itemInput.selectedVariantId || upload.variantId || ''
      )
        .trim()
        .match(/(\d+)$/)?.[1]
      checkoutVariantId = requestedVariantId
        ? cachedProduct.variants.find(
            (variant) =>
              String(variant.id).match(/(\d+)$/)?.[1] === requestedVariantId &&
              variant.availableForSale !== false &&
              variant.available !== false
          )?.id || null
        : null
    } else if (pricingContext.pricingMode === 'variant_length') {
      const resolveConfig = buildEffectiveResolveConfig(cachedProduct.builderConfig)
      const resolution = resolveSheetVariant({
        widthIn: measurement.widthIn,
        heightIn: measurement.heightIn,
        quantity: itemInput.quantity,
        variants: cachedProduct.variants,
        optionDefs: cachedProduct.optionDefs,
        selectedVariantId: itemInput.selectedVariantId || null,
        config: resolveConfig,
      })

      if (!resolution) {
        const widthFailure = getFinishedSheetWidthFailure({
          widthIn: measurement.widthIn,
          heightIn: measurement.heightIn,
          config: resolveConfig,
        })
        const maxVariantLengthIn = getFinishedSheetSizes(cachedProduct.variants).reduce(
          (largest, size) => Math.max(largest, size.heightIn),
          0
        )
        const fitFailure = maxVariantLengthIn > 0
          ? validateFinishedSheetFit({
              widthIn: measurement.widthIn,
              heightIn: measurement.heightIn,
              maxPrintableWidthIn: finishedSheetSettings.maxPrintableWidthIn,
              maxPrintableLengthIn: maxVariantLengthIn,
              fitToleranceIn: finishedSheetSettings.fitToleranceIn,
            })
          : null
        throw new Error(
          widthFailure?.message ||
            (fitFailure && !fitFailure.ok ? fitFailure.message : null) ||
            'No product variant can fit this upload with the available sheet sizes.'
        )
      }

      const parsedSheetSize = parseSheetSizeFromTitle(resolution.selectedVariantTitle)
      if (!parsedSheetSize) throw new Error('Selected sheet length could not be parsed')

      const billableSheetLengthIn = Number(
        (
          parsedSheetSize.lengthIn *
          Math.max(1, resolution.wholeSheetCopies)
        ).toFixed(2)
      )
      effective = await resolveEffectivePricingForShop({
        shop: activeShop,
        settings,
        customerId: normalizedLoggedInCustomerId,
        customerEmail: trustedCustomerProfile.email,
        productId: upload.productId,
        billableInches: billableSheetLengthIn,
      })
      pricingContext = effective.context
      if (!pricingContext.hasCustomPricing || pricingContext.pricingMode !== 'variant_length') {
        throw new Error('Variant-length pricing changed while resolving the authoritative sheet quote')
      }
      pricePerInch = pricingContext.pricePerInch || pricingContext.businessPricePerInch
      const variantLengthQuote = calculateVariantLengthQuote({
        measurement,
        pricePerInch,
        variantTitle: resolution.selectedVariantTitle,
        sheetsNeeded: resolution.wholeSheetCopies,
      })
      if (!variantLengthQuote) {
        throw new Error('Failed to calculate business quote from the selected variant')
      }

      resolvedVariant = resolution
      checkoutVariantId = resolution.selectedVariantId
      quote = variantLengthQuote
    } else {
      throw new Error('Unsupported custom pricing mode')
    }

    if (!quote) {
      throw new Error('Failed to calculate custom quote')
    }
    const volumeTier =
      effective.source === 'volume_tiers' && pricingContext.pricePerInch
        ? effective.volumeTiers.find((tier) => tier.price_per_inch === pricingContext.pricePerInch) || null
        : null

    return {
      shop: {
        id: activeShop.id,
        shopDomain: activeShop.shopDomain,
        accessToken: activeShop.accessToken,
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
      pricingSource: effective.source,
      volumeTier,
      measurement,
      quote,
      currencyCode: String(cachedProduct.productData.shop?.currencyCode || 'USD').toUpperCase(),
      productTitle: cachedProduct.productData.product?.title || 'Custom Transfer',
      productHandle: cachedProduct.productData.product?.handle || null,
      resolvedVariant,
      checkoutVariantId,
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
