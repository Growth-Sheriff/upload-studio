import { describe, expect, it } from 'vitest'
import {
  asStorageFallback,
  generateUploadCapabilityToken,
  storageKeyMatchesObjectKey,
  validateLocalFileToken,
  validateUploadCapabilityToken,
} from './storage.server'

describe('upload capabilities', () => {
  it('never labels a local failover URL as R2', () => {
    const localResult = {
      url: 'https://app.example/api/upload/local',
      key: 'shop/upload/file.png',
      provider: 'local' as const,
      publicUrl: 'https://app.example/api/files/local',
      method: 'PUT' as const,
    }

    expect(asStorageFallback(localResult, 'r2')).toBeNull()
    expect(asStorageFallback(localResult, 'local')).toEqual({
      url: localResult.url,
      publicUrl: localResult.publicUrl,
      method: 'PUT',
    })
  })

  it('authorizes an issued object key independently of its provisional provider', () => {
    const key = 'shop/upload/item/file.png'
    expect(storageKeyMatchesObjectKey(`bunny:${key}`, key)).toBe(true)
    expect(storageKeyMatchesObjectKey(`r2:${key}`, key)).toBe(true)
    expect(storageKeyMatchesObjectKey(`local:${key}`, key)).toBe(true)
    expect(storageKeyMatchesObjectKey('bunny:other/file.png', key)).toBe(false)
  })

  it('binds a capability to provider, key, byte size and expiry', () => {
    const expiresAt = Date.now() + 60_000
    const token = generateUploadCapabilityToken('local', 'shop/upload/file.png', 1234, expiresAt)

    expect(validateUploadCapabilityToken('local', 'shop/upload/file.png', 1234, token)).toBe(true)
    expect(validateUploadCapabilityToken('local', 'shop/upload/file.png', 1235, token)).toBe(false)
    expect(validateUploadCapabilityToken('bunny', 'shop/upload/file.png', 1234, token)).toBe(false)
    expect(validateUploadCapabilityToken('local', 'shop/upload/other.png', 1234, token)).toBe(false)
  })

  it('rejects malformed signatures without throwing', () => {
    expect(validateLocalFileToken('key', `${Date.now() + 60_000}.not-hex`)).toBe(false)
  })
})
