import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUploadCheckoutToken, verifyUploadCheckoutToken } from './uploadCheckoutCapability.server'

const tenant = vi.hoisted(() => ({ shopId: 'shop-a' }))
vi.mock('./tenantContext.server', () => ({ requireTenantShopId: () => tenant.shopId }))
afterEach(() => { vi.unstubAllEnvs(); tenant.shopId = 'shop-a' })

describe('guest checkout upload possession', () => {
  it('cannot reuse a token for another upload or shop, and rejects missing/tampered tokens', () => {
    vi.stubEnv('SECRET_KEY', 'test-secret-not-production')
    const token = createUploadCheckoutToken('upload-a')
    expect(verifyUploadCheckoutToken('upload-a', token)).toBe(true)
    expect(verifyUploadCheckoutToken('upload-b', token)).toBe(false)
    expect(verifyUploadCheckoutToken('upload-a', null)).toBe(false)
    expect(verifyUploadCheckoutToken('upload-a', `${token.slice(0, 42)}!`)).toBe(false)
    tenant.shopId = 'shop-b'
    expect(verifyUploadCheckoutToken('upload-a', token)).toBe(false)
  })
})
