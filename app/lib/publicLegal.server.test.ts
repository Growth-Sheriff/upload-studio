import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ shop: { findUnique: vi.fn(), updateMany: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn() }))
vi.mock('~/lib/prisma.server', () => ({ default: store }))
import { acceptMerchantLegalAgreement, getPublicLegalOperator, merchantLegalAgreementSatisfied, requireMerchantLegalAgreement } from './publicLegal.server'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PUBLIC_LEGAL_ENTITY_NAME', 'Fixture operator — not a real public identity')
  vi.stubEnv('PUBLIC_LEGAL_ENTITY_ADDRESS', 'Fixture address — tests only')
  vi.stubEnv('PUBLIC_LEGAL_REVIEW_APPROVED', 'true')
  store.shop.updateMany.mockResolvedValue({ count: 1 })
  store.$transaction.mockImplementation(run => run(store))
})
afterEach(() => vi.unstubAllEnvs())
describe('explicit merchant processing agreement', () => {
  it('fails closed without a confirmed legal identity, regardless of a receipt', async () => {
    const version = getPublicLegalOperator().version
    const receipt = { legalAgreementVersion: version, legalAgreementAcceptedAt: new Date(), legalAgreementActorId: '123' }
    expect(merchantLegalAgreementSatisfied(receipt)).toBe(true)
    vi.stubEnv('PUBLIC_LEGAL_ENTITY_NAME', '')
    expect(merchantLegalAgreementSatisfied(receipt)).toBe(false)
    await expect(acceptMerchantLegalAgreement('shop-a', '123', version)).rejects.toThrow('operator identity')
    expect(store.shop.updateMany).not.toHaveBeenCalled()
  })
  it('rejects stale terms and unverified actor IDs before any write', async () => {
    await expect(acceptMerchantLegalAgreement('shop-a', '123', 'old-version')).rejects.toThrow('terms changed')
    await expect(acceptMerchantLegalAgreement('shop-a', 'offline_shop', getPublicLegalOperator().version)).rejects.toThrow('verified Shopify administrator')
    expect(store.auditLog.create).not.toHaveBeenCalled()
    expect(store.shop.updateMany).not.toHaveBeenCalled()
  })
  it('records only the current version and verified actor under an erasure fence', async () => {
    const version = getPublicLegalOperator().version
    await acceptMerchantLegalAgreement('shop-a', '123', version)
    expect(store.shop.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'shop-a', erasureStartedAt: null, uninstalledAt: null, billingStatus: { notIn: ['erasing', 'uninstalled'] } }, data: { legalAgreementVersion: version, legalAgreementAcceptedAt: expect.any(Date), legalAgreementActorId: '123' } }))
    expect(store.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shopId: 'shop-a', action: 'merchant_processing_terms_accepted', metadata: expect.objectContaining({ actorId: '123', version }) }) }))
    store.shop.updateMany.mockResolvedValue({ count: 0 })
    store.auditLog.create.mockClear()
    await expect(acceptMerchantLegalAgreement('shop-a', '123', version)).rejects.toThrow('being erased')
    expect(store.auditLog.create).not.toHaveBeenCalled()
  })
  it('operator changes invalidate prior acceptance and billing requires a receipt', async () => {
    const receipt = { legalAgreementVersion: getPublicLegalOperator().version, legalAgreementAcceptedAt: new Date(), legalAgreementActorId: '123' }
    store.shop.findUnique.mockResolvedValue({ ...receipt, erasureStartedAt: null, uninstalledAt: null })
    await expect(requireMerchantLegalAgreement('shop-a')).resolves.toBeUndefined()
    vi.stubEnv('PUBLIC_LEGAL_ENTITY_ADDRESS', 'Changed fixture address')
    expect(merchantLegalAgreementSatisfied(receipt)).toBe(false)
    await expect(requireMerchantLegalAgreement('shop-a')).rejects.toThrow('before activating')
  })
  it('does not demand an invented street address when owner supplied the trading name', () => {
    vi.stubEnv('PUBLIC_LEGAL_ENTITY_NAME', 'Actual Scope')
    vi.stubEnv('PUBLIC_LEGAL_ENTITY_ADDRESS', '')
    const operator = getPublicLegalOperator()
    expect(operator).toMatchObject({ name: 'Actual Scope', address: '', ready: true })
    expect(merchantLegalAgreementSatisfied({ legalAgreementVersion: operator.version, legalAgreementAcceptedAt: new Date(), legalAgreementActorId: '123' })).toBe(true)
  })
})
