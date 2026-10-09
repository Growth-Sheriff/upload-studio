import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), graphql: vi.fn(), upsert: vi.fn(), updateShop: vi.fn(), audit: vi.fn() }))
vi.mock('~/shopify.server', () => ({ authenticate: { admin: mocks.authenticate } }))
vi.mock('~/lib/publicLegal.server', () => ({ acceptMerchantLegalAgreement: vi.fn(), getPublicLegalOperator: vi.fn(), merchantLegalAgreementSatisfied: vi.fn() }))
vi.mock('~/lib/prisma.server', () => ({ default: {
  shop: { findUniqueOrThrow: vi.fn(async () => ({ id: 'shop-a' })) },
  $transaction: vi.fn(async run => run({
    productConfig: { findUnique: vi.fn(async () => null), upsert: mocks.upsert },
    shop: { update: mocks.updateShop }, auditLog: { create: mocks.audit },
  })),
} }))
import { action } from '../routes/app.setup'

describe('self-service decimal pricing inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({ session: { shop: 'shop-a.myshopify.com' }, admin: { graphql: mocks.graphql } })
    mocks.graphql.mockResolvedValue(new Response(JSON.stringify({ data: { product: { id: 'gid://shopify/Product/123' } } })))
  })

  it('does not impose an implicit whole-number step on setup rate or length', () => {
    const setup = readFileSync('app/routes/app.setup.tsx', 'utf8')
    for (const attribute of ['name="pricePerInch"', 'name="maxPrintableLengthIn"']) {
      const field = setup.match(new RegExp(`<TextField\\s+[^>]*${attribute}[^>]*?(?=\\s+value=)`))?.[0]
      expect(field, attribute).toBeTruthy()
      expect(field, attribute).toContain('type="text"')
      expect(field, attribute).toContain('inputMode="decimal"')
      expect(field, attribute).not.toContain('step=')
    }
  })

  it('persists ordinary and fractional-cent rates unchanged through server validation', async () => {
    for (const rate of ['.30', '.0025']) {
      mocks.graphql.mockResolvedValueOnce(new Response(JSON.stringify({ data: { product: { id: 'gid://shopify/Product/123' } } })))
      const body = new URLSearchParams({ productId: 'gid://shopify/Product/123', publicPricingMode: 'measured_length', maxPrintableWidthIn: '22.5', maxPrintableLengthIn: '240.5', fitToleranceIn: '.02', pricePerInch: rate })
      const response = await action({ request: new Request('https://app.example/app/setup', { method: 'POST', body }), params: {}, context: {} })
      expect(response.status).toBe(200)
      expect(mocks.upsert.mock.calls.at(-1)?.[0].create.builderConfig).toMatchObject({ pricePerInch: Number(rate), maxPrintableLengthIn: 240.5 })
    }
  })

  it('still rejects an invalid rate before any configuration or audit write', async () => {
    const body = new URLSearchParams({ productId: 'gid://shopify/Product/123', publicPricingMode: 'measured_length', maxPrintableWidthIn: '22.5', maxPrintableLengthIn: '240', fitToleranceIn: '.02', pricePerInch: 'not-a-number' })
    const response = await action({ request: new Request('https://app.example/app/setup', { method: 'POST', body }), params: {}, context: {} })
    expect(response.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
