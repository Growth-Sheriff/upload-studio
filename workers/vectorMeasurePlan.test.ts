import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The worker module opens Redis and Prisma connections at import time, so the
// plan helper is exercised against a stubbed dimension probe instead.
const probe = vi.hoisted(() => vi.fn())

vi.mock('../app/lib/preflight.server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../app/lib/preflight.server')
  return { ...actual, getVectorRasterDimensionsFast: probe }
})

vi.mock('ioredis', () => ({
  default: class {
    on() {}
    set() {}
    eval() {}
    quit() {}
  },
}))

vi.mock('../app/db.server', () => ({ default: {}, prisma: {} }))

let dir = ''

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'measure-plan-'))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function loadPlan() {
  const mod = await import('./uploadPipeline.shared')
  return mod.getVectorMeasurePlan
}

describe('getVectorMeasurePlan', () => {
  it('renders an ordinary page at full resolution and still reports its box', async () => {
    const getVectorMeasurePlan = await loadPlan()
    // 22" x 12" at 300 DPI = 6600 x 3600 = 23.8 MP, just inside the budget.
    probe.mockResolvedValueOnce({ width: 6600, height: 3600 })

    await expect(getVectorMeasurePlan('/tmp/small.pdf', 'application/pdf')).resolves.toEqual({
      dpi: 300,
      override: { width: 6600, height: 3600, dpiSource: 'pdf_page_box' },
    })
  })

  it('downscales the raster for a 22"x240" sheet but keeps the 300 DPI size', async () => {
    const getVectorMeasurePlan = await loadPlan()
    // The sheet that stalled fast: 6600 x 72000 = 475 MP at print resolution.
    probe.mockResolvedValueOnce({ width: 6600, height: 72000 })

    const plan = await getVectorMeasurePlan('/tmp/huge.pdf', 'application/pdf')

    // Size the customer is charged for is unchanged.
    expect(plan.override).toEqual({ width: 6600, height: 72000, dpiSource: 'pdf_page_box' })
    expect(plan.dpi).toBeLessThan(300)
    // The raster the checks actually analyse stays inside the 24 MP budget.
    const scale = plan.dpi / 300
    const megapixels = (6600 * scale * (72000 * scale)) / 1_000_000
    expect(megapixels).toBeLessThanOrEqual(24)
  })

  it('never drops below a legible 36 DPI', async () => {
    const getVectorMeasurePlan = await loadPlan()
    probe.mockResolvedValueOnce({ width: 30000, height: 300000 })

    const plan = await getVectorMeasurePlan('/tmp/absurd.pdf', 'application/pdf')

    expect(plan.dpi).toBe(36)
  })

  it('labels an EPS box as a postscript measurement', async () => {
    const getVectorMeasurePlan = await loadPlan()
    probe.mockResolvedValueOnce({ width: 3300, height: 1800 })

    const plan = await getVectorMeasurePlan('/tmp/art.eps', 'application/postscript')

    expect(plan.override?.dpiSource).toBe('postscript_bbox')
  })

  it('falls back to the full-resolution path when the box cannot be read', async () => {
    const getVectorMeasurePlan = await loadPlan()
    probe.mockResolvedValueOnce(null)

    await expect(getVectorMeasurePlan('/tmp/broken.pdf', 'application/pdf')).resolves.toEqual({
      dpi: 300,
      override: null,
    })
  })

  it('falls back to the full-resolution path when the probe throws', async () => {
    const getVectorMeasurePlan = await loadPlan()
    probe.mockRejectedValueOnce(new Error('pdfinfo exploded'))

    await expect(getVectorMeasurePlan('/tmp/broken.pdf', 'application/pdf')).resolves.toEqual({
      dpi: 300,
      override: null,
    })
  })
})
