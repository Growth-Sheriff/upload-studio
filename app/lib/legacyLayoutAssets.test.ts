import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it, vi } from 'vitest'
import { loader as extAssetsLoader } from '../routes/api.ext-assets.$'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '../../extensions/theme-extension/assets')
const dtfUploadSource = readFileSync(join(assetsDir, 'dtf-upload.js'), 'utf8')
const autoSheetSource = readFileSync(join(assetsDir, 'ul-auto-sheet.js'), 'utf8')
const nestingSource = readFileSync(join(assetsDir, 'ul-nesting-engine.js'), 'utf8')
const optimizerSource = readFileSync(join(assetsDir, 'ul-sheet-optimizer.js'), 'utf8')

type Listener = () => unknown

function element(tagName = 'div') {
  const attributes = new Map<string, string>()
  const listeners = new Map<string, Listener>()
  const children: any[] = []
  return {
    tagName: tagName.toUpperCase(),
    id: '',
    type: '',
    hidden: false,
    textContent: '',
    href: '',
    style: { cssText: '' },
    dataset: {} as Record<string, string>,
    children,
    setAttribute(name: string, value: unknown) {
      attributes.set(name, String(value))
    },
    getAttribute(name: string) {
      if (name === 'href' && this.href) return this.href
      return attributes.get(name) ?? null
    },
    addEventListener(name: string, listener: Listener) {
      listeners.set(name, listener)
    },
    appendChild(child: any) {
      children.push(child)
      return child
    },
    click: vi.fn(() => listeners.get('click')?.()),
    focus: vi.fn(),
    scrollIntoView: vi.fn(),
    querySelector: vi.fn((_selector: string) => null as any),
    closest: vi.fn((_selector: string) => null as any),
  }
}

function browserEnvironment(options?: {
  canonicalProductId?: string
  pageData?: unknown[]
  pathname?: string
}) {
  const canonicalTrigger = element('button')
  const canonicalRoot = element('section')
  if (options?.canonicalProductId) {
    canonicalRoot.setAttribute('data-product-id', options.canonicalProductId)
    canonicalRoot.querySelector.mockImplementation((selector: string) => (
      selector === '[data-ump-upload-trigger]' ? canonicalTrigger : null
    ))
  }

  const pageDataScript = element('script')
  pageDataScript.textContent = JSON.stringify(options?.pageData || [])
  const appended: any[] = []
  const elementsById = new Map<string, any>()
  const body = element('body')
  body.appendChild = vi.fn((child: any) => {
    appended.push(child)
    if (child.id) elementsById.set(child.id, child)
    return child
  })

  const document = {
    readyState: 'loading',
    body,
    documentElement: body,
    createElement: vi.fn((tagName: string) => element(tagName)),
    createTextNode: vi.fn((text: string) => ({ textContent: text })),
    addEventListener: vi.fn(),
    getElementById: vi.fn((id: string) => elementsById.get(id) || null),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '[data-ul-main-product-upload-app]') {
        return options?.canonicalProductId ? [canonicalRoot] : []
      }
      if (selector === '#dtf-listing-products, script[id^="ul-hero-slot-data-"]') {
        return options?.pageData ? [pageDataScript] : []
      }
      if (selector === '[data-product-id]') return []
      return []
    }),
  }

  const assign = vi.fn()
  const pathname = options?.pathname || '/collections/transfers'
  const window = {
    location: {
      href: `https://shop.example${pathname}`,
      origin: 'https://shop.example',
      pathname,
      assign,
    },
  } as any
  const fetch = vi.fn()
  const timeout = vi.fn()

  return { window, document, fetch, timeout, assign, canonicalRoot, canonicalTrigger, appended }
}

function evaluate(source: string, environment: ReturnType<typeof browserEnvironment>) {
  new Function('window', 'document', 'URL', 'setTimeout', 'fetch', source)(
    environment.window,
    environment.document,
    URL,
    environment.timeout,
    environment.fetch,
  )
}

describe('retired layout assets', () => {
  it('contains no network or legacy private-property cart plumbing', () => {
    for (const source of [dtfUploadSource, autoSheetSource, nestingSource, optimizerSource]) {
      expect(source).not.toMatch(/\bfetch\s*\(/)
      expect(source).not.toContain('/cart/add.js')
      expect(source).not.toContain('_designs_per_sheet')
      expect(source).not.toContain('_artboard_margin_in')
      expect(source).not.toContain('_image_margin_in')
      expect(source).not.toMatch(/Math\.ceil\([^)]*designsPerSheet/)
    }
  })

  it('keeps DtfUploadBlock compatible while handing the click to the canonical uploader', async () => {
    const environment = browserEnvironment({ canonicalProductId: '123' })
    evaluate(dtfUploadSource, environment)

    const block = new environment.window.DtfUploadBlock({ productId: 123 })
    await expect(block.fetchConfigFallback()).resolves.toEqual({ productId: 123 })
    block.fileInput.click()
    block.addToCart()

    expect(environment.canonicalRoot.scrollIntoView).toHaveBeenCalledTimes(2)
    expect(environment.canonicalTrigger.click).toHaveBeenCalledTimes(1)
    expect(environment.canonicalTrigger.focus).toHaveBeenCalledTimes(2)
    expect(environment.fetch).not.toHaveBeenCalled()
    expect(environment.assign).not.toHaveBeenCalled()
  })

  it('redirects a copied DtfUploadBlock snippet using its embedded product data', () => {
    const environment = browserEnvironment({
      pageData: [{ id: 456, handle: 'finished-gang-sheet' }],
    })
    evaluate(dtfUploadSource, environment)

    const block = new environment.window.DtfUploadBlock({ productId: 456 })
    block.openModal()

    expect(environment.assign).toHaveBeenCalledWith('/products/finished-gang-sheet')
    expect(environment.fetch).not.toHaveBeenCalled()
  })

  it('never invokes the old auto-sheet selection callback', () => {
    const environment = browserEnvironment({ canonicalProductId: '789' })
    evaluate(autoSheetSource, environment)
    const onSelect = vi.fn()

    const result = environment.window.ULAutoSheet.openModal({ productId: 789, onSelect })

    expect(result.status).toBe('CANONICAL_UPLOADER')
    expect(environment.canonicalTrigger.click).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(environment.fetch).not.toHaveBeenCalled()
  })

  it('returns no orderable result from the retired nesting API', () => {
    const environment = browserEnvironment()
    evaluate(nestingSource, environment)

    const nested = environment.window.ULNestingEngine.nestDesigns(
      { widthInch: 4, heightInch: 4, quantity: 20 },
      { widthInch: 22, heightInch: 24 },
    )
    const grid = environment.window.ULNestingEngine.calculateGridFit()

    expect(nested).toMatchObject({
      retired: true,
      error: 'LEGACY_LAYOUT_RETIRED',
      designsPerSheet: 0,
      sheetsNeeded: 0,
      recommended: false,
    })
    expect(grid).toMatchObject({ retired: true, count: 0, error: 'LEGACY_LAYOUT_RETIRED' })
    expect(environment.window.ULNestingEngine.nestAllVariants()).toEqual([])
  })

  it('never recommends a sheet or a quantity adjustment from the retired optimizer', () => {
    const environment = browserEnvironment()
    evaluate(optimizerSource, environment)

    const result = environment.window.ULSheetOptimizer.optimize([{
      designsPerSheet: 100,
      sheetsNeeded: 1,
      totalCost: 1,
      wastePercent: 0,
    }])

    expect(result).toMatchObject({
      retired: true,
      error: 'LEGACY_LAYOUT_RETIRED',
      recommended: null,
      alternatives: [],
      savings: null,
    })
    expect(environment.window.ULSheetOptimizer.suggestQuantityAdjust({}, 1)).toBeNull()
    expect(environment.window.ULSheetOptimizer.isSuboptimal({}, {})).toBe(false)
  })

  it('serves retired assets with a non-cacheable diagnostic response', async () => {
    for (const filename of [
      'dtf-upload.js',
      'ul-auto-sheet.js',
      'ul-nesting-engine.js',
      'ul-sheet-optimizer.js',
    ]) {
      const response = await extAssetsLoader({
        params: { '*': filename },
        request: new Request(`https://app.example/api/ext-assets/${filename}`),
        context: {},
      } as any)

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0')
      expect(response.headers.get('X-Upload-Studio-Legacy-Asset')).toBe('retired')
      expect(await response.text()).toContain('LEGACY_LAYOUT_RETIRED')
    }
  })
})
