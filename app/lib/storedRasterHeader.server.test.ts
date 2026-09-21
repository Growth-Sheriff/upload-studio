import { describe, expect, it, vi } from 'vitest'
import {
  STORED_RASTER_HEADER_BYTES,
  STORED_RASTER_HEADER_RETRY_BYTES,
  validateStoredRasterHeader,
} from './storedRasterHeader.server'

const config = {
  maxFileSizeMB: 1024,
  minDPI: 150,
  requiredDPI: 300,
  maxPages: 1,
  allowedFormats: ['image/png', 'image/jpeg'],
  requireTransparency: false,
  measurementBasis: 'full_page' as const,
  maxPrintableWidthIn: 22.5,
  fitToleranceIn: 0.02,
}

function png(width: number, height: number, dpi: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(data.length, 0)
    header.write(type, 4, 4, 'ascii')
    return Buffer.concat([header, data, Buffer.alloc(4)])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const phys = Buffer.alloc(9)
  const ppm = Math.round(dpi / 0.0254)
  phys.writeUInt32BE(ppm, 0)
  phys.writeUInt32BE(ppm, 4)
  phys[8] = 1
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IEND', Buffer.alloc(0))])
}

function jpeg(width: number, height: number, dpi: number): Buffer {
  const jfif = Buffer.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x01,
    (dpi >> 8) & 0xff, dpi & 0xff,
    (dpi >> 8) & 0xff, dpi & 0xff,
    0x00, 0x00,
  ])
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, sof, Buffer.from([0xff, 0xd9])])
}

describe('stored PNG/JPEG header validation', () => {
  it('uses bounded stored bytes as authority over a tampered browser report', async () => {
    for (const bytes of [png(6600, 3600, 300), jpeg(1600, 1200, 150)]) {
      const readPrefix = vi.fn(async (_storage, _key, maxBytes) => {
        expect(maxBytes).toBe(STORED_RASTER_HEADER_BYTES)
        return bytes
      })
      const result = await validateStoredRasterHeader({
        storageConfig: { provider: 'local' },
        storageKey: 'local:tenant/sheet',
        fileSize: bytes.length,
        clientProbe: { widthPx: 1, heightPx: 2, dpi: 9999, dpiSource: 'browser' },
        config,
        readPrefix,
      })

      expect(result.kind).toBe('ready')
      expect(readPrefix).toHaveBeenCalledTimes(1)
      if (result.kind === 'ready') {
        expect(result.metadata.widthPx).toBe(bytes[0] === 0x89 ? 6600 : 1600)
        expect(result.metadata.heightPx).toBe(bytes[0] === 0x89 ? 3600 : 1200)
        expect(
          (result.preflightResult.headerValidation as Record<string, unknown>)
            .pixelDimensionsMatched
        ).toBe(false)
      }
    }
  })

  it('reads a camera JPEG whose size marker sits past the first window', async () => {
    // Same layout as a real Sony upload: 50 KB EXIF + 56 KB XMP before SOF.
    const appSegment = (length: number) => {
      const segment = Buffer.alloc(2 + length)
      segment[0] = 0xff
      segment[1] = 0xe1
      segment.writeUInt16BE(length, 2)
      return segment
    }
    const base = jpeg(5504, 4128, 350)
    const bytes = Buffer.concat([
      base.subarray(0, 2),
      appSegment(50 * 1024),
      appSegment(56 * 1024),
      base.subarray(2),
      Buffer.alloc(200 * 1024),
    ])
    const readPrefix = vi.fn(async (_storage, _key, maxBytes: number) => bytes.subarray(0, maxBytes))

    const result = await validateStoredRasterHeader({
      storageConfig: { provider: 'local' },
      storageKey: 'local:tenant/DSC00947.jpeg',
      fileSize: bytes.length,
      config,
      readPrefix,
    })

    expect(result.kind).toBe('ready')
    expect(readPrefix.mock.calls.map((call) => call[2])).toEqual([
      STORED_RASTER_HEADER_BYTES,
      STORED_RASTER_HEADER_RETRY_BYTES,
    ])
    if (result.kind === 'ready') {
      expect(result.metadata.widthPx).toBe(5504)
      expect(result.metadata.heightPx).toBe(4128)
    }
  })

  it('blocks missing and unreadable objects without a full-read fallback', async () => {
    const missing = vi.fn(async () => {
      throw new Error('NoSuchKey')
    })
    const missingResult = await validateStoredRasterHeader({
      storageConfig: { provider: 'local' },
      storageKey: 'local:tenant/missing.png',
      fileSize: 10,
      config,
      readPrefix: missing,
    })
    expect(missingResult.kind).toBe('blocked')
    expect(missing).toHaveBeenCalledTimes(1)

    const truncated = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const truncatedResult = await validateStoredRasterHeader({
      storageConfig: { provider: 'local' },
      storageKey: 'local:tenant/truncated.png',
      fileSize: 4,
      config,
      readPrefix: truncated,
    })
    expect(truncatedResult.kind).toBe('blocked')
    expect(truncated).toHaveBeenCalledTimes(1)

    const malformedJpeg = vi.fn(async () =>
      Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0xff, 0xd9])
    )
    const malformedResult = await validateStoredRasterHeader({
      storageConfig: { provider: 'local' },
      storageKey: 'local:tenant/malformed.jpg',
      fileSize: 8,
      config,
      readPrefix: malformedJpeg,
    })
    expect(malformedResult.kind).toBe('blocked')
    expect(malformedJpeg).toHaveBeenCalledTimes(1)
  })
})
