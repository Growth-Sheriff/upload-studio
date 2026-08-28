import { describe, expect, it } from 'vitest'
import {
  extractUploadIdFromFileUrl,
  extractUploadIdFromIdentityUrl,
  matchUploadFromLineItem,
  normalizeCartToken,
} from './orderMatching.server'

const UPLOAD_ID = 'cmsyu40ee0lsuiy654lp88k2l'
const ITEM_ID = 'cmsyu41xy9abcd1234efgh567'

describe('normalizeCartToken', () => {
  it('strips the /cart.js ?key= suffix so it equals order.cart_token', () => {
    expect(normalizeCartToken('Z2NwLXVzOjAxSjc0S05UVA?key=abc123')).toBe('Z2NwLXVzOjAxSjc0S05UVA')
    expect(normalizeCartToken('0f8c8f57f0e1a2b3c4d5e6f708192a3b')).toBe(
      '0f8c8f57f0e1a2b3c4d5e6f708192a3b'
    )
    expect(normalizeCartToken('  tok?key=x  ')).toBe('tok')
    expect(normalizeCartToken(null)).toBe('')
  })
})

describe('extractUploadIdFromIdentityUrl', () => {
  it('parses absolute identity URLs', () => {
    expect(
      extractUploadIdFromIdentityUrl(`https://fastdtftransfer.example.com/i/${UPLOAD_ID}`)
    ).toBe(UPLOAD_ID)
  })

  it('parses proxy-relative identity URLs', () => {
    expect(extractUploadIdFromIdentityUrl(`/apps/customizer/i/${UPLOAD_ID}`)).toBe(UPLOAD_ID)
  })

  it('parses .json identity URLs', () => {
    expect(extractUploadIdFromIdentityUrl(`https://x.com/i/${UPLOAD_ID}.json`)).toBe(UPLOAD_ID)
  })

  it('ignores URLs without an identity segment', () => {
    expect(extractUploadIdFromIdentityUrl('https://x.com/products/foo')).toBeNull()
    expect(extractUploadIdFromIdentityUrl('https://x.com/i/UPPERCASE-NOT-ID')).toBeNull()
    expect(extractUploadIdFromIdentityUrl(null)).toBeNull()
    expect(extractUploadIdFromIdentityUrl(42)).toBeNull()
  })
})

describe('extractUploadIdFromFileUrl', () => {
  it('parses bunny CDN storage paths (uploadId precedes itemId)', () => {
    const url = `https://cdn.example.b-cdn.net/fast-dtf-transfer_myshopify_com/prod/${UPLOAD_ID}/${ITEM_ID}/design%20file.png`
    expect(extractUploadIdFromFileUrl(url)).toBe(UPLOAD_ID)
  })

  it('parses app-served file URLs', () => {
    const url = `https://app.example.com/api/files/shop/${UPLOAD_ID}/${ITEM_ID}/art.pdf?token=abc`
    expect(extractUploadIdFromFileUrl(url)).toBe(UPLOAD_ID)
  })

  it('returns null when no consecutive id pair exists', () => {
    expect(extractUploadIdFromFileUrl(`https://x.com/${UPLOAD_ID}/file.png`)).toBeNull()
    expect(extractUploadIdFromFileUrl('not-a-url')).toBeNull()
  })
})

describe('matchUploadFromLineItem', () => {
  it('prefers the hidden legacy property', () => {
    const match = matchUploadFromLineItem({
      properties: [
        { name: '_ul_upload_id', value: UPLOAD_ID },
        { name: 'Design Identity', value: `https://x.com/i/${ITEM_ID}` },
      ],
    })
    expect(match).toEqual({ uploadId: UPLOAD_ID, source: 'property' })
  })

  it('falls back to the Design Identity URL when the hidden property is stripped', () => {
    const match = matchUploadFromLineItem({
      properties: [{ name: 'Design Identity', value: `https://x.com/i/${UPLOAD_ID}` }],
    })
    expect(match).toEqual({ uploadId: UPLOAD_ID, source: 'identity_url' })
  })

  it('falls back to the Design File URL path', () => {
    const match = matchUploadFromLineItem({
      properties: [
        {
          name: 'Design File',
          value: `https://cdn.x.com/shop/prod/${UPLOAD_ID}/${ITEM_ID}/art.png`,
        },
      ],
    })
    expect(match).toEqual({ uploadId: UPLOAD_ID, source: 'file_url' })
  })

  it('recovers an identity URL under a renamed property key', () => {
    const match = matchUploadFromLineItem({
      properties: [{ name: 'Custom Design Link', value: `https://x.com/i/${UPLOAD_ID}` }],
    })
    expect(match).toEqual({ uploadId: UPLOAD_ID, source: 'identity_url' })
  })

  it('supports object-shaped properties (cart payloads)', () => {
    const match = matchUploadFromLineItem({
      properties: { 'Design Identity': `/apps/customizer/i/${UPLOAD_ID}` },
    })
    expect(match).toEqual({ uploadId: UPLOAD_ID, source: 'identity_url' })
  })

  it('honors the dtf-upload sheet flow `_upload_id` carrier', () => {
    const match = matchUploadFromLineItem({
      properties: [{ name: '_upload_id', value: UPLOAD_ID }],
    })
    expect(match).toEqual({ uploadId: UPLOAD_ID, source: 'property' })
  })

  it('returns null for lines without any upload carrier', () => {
    expect(matchUploadFromLineItem({ properties: [] })).toBeNull()
    expect(matchUploadFromLineItem({ properties: null })).toBeNull()
    expect(
      matchUploadFromLineItem({ properties: [{ name: 'Gift note', value: 'hello' }] })
    ).toBeNull()
  })

  it('rejects malformed ids in the hidden property and keeps scanning', () => {
    const match = matchUploadFromLineItem({
      properties: [
        { name: '_ul_upload_id', value: 'DROP TABLE uploads' },
        { name: 'Design Identity', value: `https://x.com/i/${UPLOAD_ID}` },
      ],
    })
    expect(match).toEqual({ uploadId: UPLOAD_ID, source: 'identity_url' })
  })
})
