import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '~/lib/prisma.server'
import { prepareCustomPricingJobQuote } from './customerPricingCheckout.server'
import { createUploadCheckoutToken } from './uploadCheckoutCapability.server'
import { withTenantContext } from './tenantContext.server'

vi.mock('~/lib/prisma.server', () => ({ default: {
  shop: { findUnique: vi.fn() }, upload: { findFirst: vi.fn() }, productConfig: { findMany: vi.fn() },
} }))
vi.mock('~/lib/shopify.server', () => ({ shopifyGraphQL: vi.fn(async () => ({
  product: { id: 'gid://shopify/Product/1', title: 'Finished film', handle: 'film', options: [],
    variants: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } }, shop: { currencyCode: 'USD' },
})) }))
vi.mock('~/lib/storage.server', () => ({ getStorageConfig: vi.fn(() => ({})),
  getDownloadSignedUrl: vi.fn(async () => 'https://files.example/print.png') }))
vi.mock('~/lib/mainProductMeasurementPersistence.server', () => ({ persistMainProductMeasurementProjection: vi.fn() }))

const upload = { id: 'upload-a', productId: '1', variantId: null, customerId: null, orderId: null, ordersLink: [],
  items: [{ id: 'item-a', originalName: 'sheet.png', storageKey: 'sheet.png', thumbnailKey: null, preflightStatus: 'ok',
    preflightResult: { measurementBasis: 'full_page', metadata: { widthPx: 6600, heightPx: 1800,
      measurementWidthPx: 6600, measurementHeightPx: 1800, widthIn: 22, heightIn: 6,
      dpi: 300, documentDpi: 300, documentDpiSource: 'png_phys', effectiveDpi: 300,
      sizingSource: 'document_dpi', measurementMode: 'full' } } }] }

afterEach(() => vi.unstubAllEnvs())

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SECRET_KEY', 'public-checkout-test-secret')
  vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: 'shop-a', shopDomain: 'example.myshopify.com',
    accessToken: 'test', settings: {}, storageProvider: 'r2', storageConfig: {} } as never)
  vi.mocked(prisma.upload.findFirst).mockResolvedValue(upload as never)
  vi.mocked(prisma.productConfig.findMany).mockResolvedValue([{ productId: '1', builderConfig: {
    publicPricingMode: 'measured_length', pricePerInch: 0.3,
    maxPrintableWidthIn: 22.5, maxPrintableLengthIn: 240, fitToleranceIn: 0.02,
  } }] as never)
})

describe('public custom measured checkout', () => {
  it('quotes a guest upload at its explicit product rate without an account or carrier variant', async () => {
    const result = await withTenantContext('shop-a', () => prepareCustomPricingJobQuote({
      shopDomain: 'example.myshopify.com', loggedInCustomerId: null,
      items: [{ uploadId: upload.id, checkoutToken: createUploadCheckoutToken(upload.id), quantity: 2 }],
    }))
    expect(result.totalPrice).toBe(3.6)
    expect(result.totalBillableLengthIn).toBe(12)
    expect(result.items[0]).toMatchObject({ pricingSource: 'product_rate', checkoutVariantId: null,
      requestedQuantity: 2, quote: { pageWidthIn: 22, pageLengthIn: 6, sheetsNeeded: 2 } })
  })

  it('rejects a guessed guest upload ID with no possession token', async () => {
    await expect(withTenantContext('shop-a', () => prepareCustomPricingJobQuote({
      shopDomain: 'example.myshopify.com', loggedInCustomerId: null,
      items: [{ uploadId: upload.id, quantity: 1 }],
    }))).rejects.toThrow('This upload session could not be verified. Upload the file again before checkout.')
  })

  it('cannot use a guest token to buy another signed-in account upload', async () => {
    vi.mocked(prisma.upload.findFirst).mockResolvedValue({ ...upload, customerId: '42' } as never)
    await expect(withTenantContext('shop-a', () => prepareCustomPricingJobQuote({
      shopDomain: 'example.myshopify.com', loggedInCustomerId: '43',
      items: [{ uploadId: upload.id, checkoutToken: createUploadCheckoutToken(upload.id), quantity: 1 }],
    }))).rejects.toThrow('Upload does not belong to the logged in customer')
  })
})
