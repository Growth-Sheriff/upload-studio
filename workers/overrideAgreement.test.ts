import { describe, expect, it, vi } from 'vitest'

// uploadPipeline.shared opens Redis/Prisma at import time; the guard under test
// is pure, so those are stubbed out rather than connected.
vi.mock('ioredis', () => ({
  default: class {
    on() {}
    set() {}
    eval() {}
    quit() {}
  },
}))
vi.mock('../app/db.server', () => ({ default: {}, prisma: {} }))

const { validateOverrideAgainstRaster } = await import('./uploadPipeline.shared')

const box = (width: number, height: number) => ({ width, height, dpiSource: 'pdf_page_box' })

/**
 * The override decides the price. These assertions run with no external tools,
 * so they execute on a developer machine and in CI, unlike the end-to-end
 * measurement tests which need ImageMagick.
 */
describe('validateOverrideAgainstRaster', () => {
  it('accepts a 22"x240" sheet rendered at the reduced measure DPI', () => {
    // 6600x72000 at 300 DPI, rasterised at 55 DPI -> 1210x13200.
    expect(validateOverrideAgainstRaster(box(6600, 72000), 1210, 13200, 55)).toEqual(
      box(6600, 72000)
    )
  })

  it('accepts a full-resolution render of an ordinary page', () => {
    expect(validateOverrideAgainstRaster(box(6600, 3600), 6600, 3600, 300)).toEqual(box(6600, 3600))
  })

  it('tolerates the rounding a low-DPI render introduces', () => {
    // 6600x72000 at 36 DPI is 792x8640; a renderer that rounds to 791x8639
    // must not invalidate a page box that is essentially correct.
    expect(validateOverrideAgainstRaster(box(6600, 72000), 791, 8639, 36)).toEqual(
      box(6600, 72000)
    )
  })

  it('rejects a /UserUnit page whose box understates the real size', () => {
    // MediaBox says 1584x1728 pt -> 6600x7200 px, but UserUnit 10 means the
    // renderer produces ten times that. The box must not be billed.
    expect(validateOverrideAgainstRaster(box(6600, 7200), 66000, 72000, 300)).toBeNull()
  })

  it('rejects a page whose width and height are swapped', () => {
    // The /Rotate 90 failure mode: box read as 72000x6600, renderer says
    // 6600x72000. Billing the swap would price a 22" roll as a 240" one.
    expect(validateOverrideAgainstRaster(box(72000, 6600), 6600, 72000, 300)).toBeNull()
  })

  it('rejects when the raster could not be probed', () => {
    expect(validateOverrideAgainstRaster(box(6600, 72000), 0, 0, 55)).toBeNull()
    expect(validateOverrideAgainstRaster(box(6600, 72000), 1210, 13200, 0)).toBeNull()
  })

  it('passes a null override through unchanged', () => {
    expect(validateOverrideAgainstRaster(null, 1210, 13200, 55)).toBeNull()
  })
})
