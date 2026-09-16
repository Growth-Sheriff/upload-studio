import { describe, expect, it } from 'vitest'
import { redactUploadLogLocation } from './uploadLogger.server'

describe('upload log redaction', () => {
  it('removes signed query strings and fragments', () => {
    expect(
      redactUploadLogLocation('https://storage.example/file.png?X-Amz-Signature=secret#fragment')
    ).toBe('https://storage.example/file.png')
    expect(redactUploadLogLocation('r2:shop/file.png?token=secret')).toBe('r2:shop/file.png')
  })
})
