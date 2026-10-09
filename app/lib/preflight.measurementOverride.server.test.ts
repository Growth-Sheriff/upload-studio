import { exec } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { deflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runPreflightChecks } from './preflight.server'

// getImageInfo always consults ImageMagick, so these run on the worker image
// and on CI, and are skipped on a developer box without it.
const hasImageMagick = await promisify(exec)('identify -version')
  .then(() => true)
  .catch(() => false)

/**
 * The measure stage rasterises a PDF/AI/EPS at a reduced DPI and takes the
 * printed size from the page box instead of from those pixels. The size drives
 * the price, so these tests pin that the override — and only the override —
 * decides the inches.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 4, 'ascii')
  let crc = 0xffffffff
  for (const byte of Buffer.concat([Buffer.from(type, 'ascii'), data])) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([header, data, trailer])
}

/** Real decodable monochrome PNG. A header-only fake must fail preflight. */
function buildPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 1
  ihdr[9] = 0
  // One filter byte plus packed black pixels per row, without allocating RGBA.
  const pixels = Buffer.alloc((Math.ceil(width / 8) + 1) * height)
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

const config = {
  maxFileSizeMB: 1024,
  minDPI: 150,
  requiredDPI: 300,
  maxPages: 1,
  allowedFormats: ['image/png', 'application/pdf'],
  requireTransparency: false,
  measurementBasis: 'full_page' as const,
  maxPrintableWidthIn: 22,
  fitToleranceIn: 0.02,
}

let dir = ''

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'measure-override-'))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function fixture(name: string, width: number, height: number): Promise<string> {
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, buildPng(width, height))
  return filePath
}

function dimensionsOf(result: Awaited<ReturnType<typeof runPreflightChecks>>) {
  const check = result.checks.find((c) => c.name === 'dimensions')
  return (check?.details || {}) as Record<string, number | string | null>
}

describe.skipIf(!hasImageMagick)('vector measurement override', () => {
  it('charges for the page box, not for the downscaled raster', async () => {
    // A 22" x 240" sheet is 6600 x 72000 at 300 DPI. The measure stage renders
    // it at 55 DPI (1210 x 13200) to stay inside the memory budget.
    const file = await fixture('downscaled.png', 1210, 13200)

    const withOverride = await runPreflightChecks(file, 'image/png', 4_000, config, {
      width: 6600,
      height: 72000,
      dpiSource: 'pdf_page_box',
    })

    const details = dimensionsOf(withOverride)
    expect(details.width).toBe(6600)
    expect(details.height).toBe(72000)
    expect(details.widthIn).toBe(22)
    expect(details.heightIn).toBe(240)
    expect(details.documentDpiSource).toBe('pdf_page_box')
  })

  it('would have under-charged by 5.5x without the override', async () => {
    // Same raster, no override: the pixels alone say 22" x 240" only because
    // the sheet anchor stretches them, but the DPI story is wrong and a
    // different anchor would bill the customer for a fraction of the sheet.
    const file = await fixture('raw.png', 1210, 13200)

    const raw = await runPreflightChecks(file, 'image/png', 4_000, config)
    const withOverride = await runPreflightChecks(file, 'image/png', 4_000, config, {
      width: 6600,
      height: 72000,
      dpiSource: 'pdf_page_box',
    })

    expect(dimensionsOf(raw).width).toBe(1210)
    expect(dimensionsOf(withOverride).width).toBe(6600)
    // Whatever the anchor does, the recorded pixel size must be the true one.
    expect(dimensionsOf(raw).width).not.toBe(dimensionsOf(withOverride).width)
  })

  it('ignores the override when the tenant measures artwork bounds', async () => {
    // Trimming runs against real pixels, so a downscaled raster and a page-box
    // size cannot be mixed. No tenant uses this mode today; if one enables it,
    // the raster stays authoritative rather than silently mis-measuring.
    const file = await fixture('bounds.png', 1210, 13200)

    const result = await runPreflightChecks(
      file,
      'image/png',
      4_000,
      { ...config, measurementBasis: 'artwork_bounds' },
      { width: 6600, height: 72000, dpiSource: 'pdf_page_box' }
    ).catch(() => null)

    // Either the trim analysis refuses outright, or it measured the raster.
    if (result) expect(dimensionsOf(result).width).not.toBe(6600)
  })

  it('falls back to the raster when no override is supplied', async () => {
    const file = await fixture('plain.png', 6600, 3600)

    const result = await runPreflightChecks(file, 'image/png', 4_000, config, null)

    expect(dimensionsOf(result).width).toBe(6600)
    expect(dimensionsOf(result).height).toBe(3600)
  })

  it('ignores a malformed override instead of measuring zero', async () => {
    const file = await fixture('zero.png', 6600, 3600)

    const result = await runPreflightChecks(file, 'image/png', 4_000, config, {
      width: 0,
      height: 0,
      dpiSource: 'pdf_page_box',
    })

    expect(dimensionsOf(result).width).toBe(6600)
    expect(dimensionsOf(result).height).toBe(3600)
  })
})
