import { describe, expect, it } from 'vitest'
import {
  canReuseUploadByFingerprint,
  normalizeUploadFingerprint,
} from './uploadFingerprint'

describe('upload fingerprint reuse', () => {
  const digest = 'a'.repeat(64)

  it('keeps sampled v1 fingerprints for resume but never skips file transfer with them', () => {
    const value = normalizeUploadFingerprint(`v1-81300000-${digest}`)
    expect(value).toBe(`v1-81300000-${digest}`)
    expect(canReuseUploadByFingerprint(value)).toBe(false)
  })

  it('permits reuse only for a future full-content digest', () => {
    const value = normalizeUploadFingerprint(`v2-full-81300000-${digest}`)
    expect(canReuseUploadByFingerprint(value)).toBe(true)
  })
})
