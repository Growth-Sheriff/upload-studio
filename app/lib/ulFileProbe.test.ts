import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// The probe ships as a theme-extension asset (UMD, browser-first). The repo is
// "type: module", so evaluate the file with a CommonJS shim instead of require.
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../../extensions/theme-extension/assets/ul-file-probe.js'), 'utf8')
const shim: { exports: any } = { exports: {} }
new Function('module', 'exports', 'window', source)(shim, shim.exports, undefined)
const probe = shim.exports as { parseBytes: (head: ArrayBuffer, tail?: ArrayBuffer) => any }

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0))
}

describe('ULFileProbe.parseBytes', () => {
  it('PNG: IHDR size, pHYs dpi, alpha from color type', () => {
    const ihdr = [...u32(13), ...ascii('IHDR'), ...u32(6600), ...u32(3600), 8, 6, 0, 0, 0, 0, 0, 0, 0]
    const ppm = Math.round(300 / 0.0254) // 300 dpi in pixels per metre
    const phys = [...u32(9), ...ascii('pHYs'), ...u32(ppm), ...u32(ppm), 1, 0, 0, 0, 0]
    const r = probe.parseBytes(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...phys]))
    expect(r.format).toBe('PNG')
    expect(r.widthPx).toBe(6600)
    expect(r.heightPx).toBe(3600)
    expect(r.dpi).toBe(300)
    expect(r.widthIn).toBe(22)
    expect(r.heightIn).toBe(12)
    expect(r.hasAlpha).toBe(true)
    expect(r.confident).toBe(true)
  })

  it('JPEG: SOF0 size + JFIF dpi', () => {
    const jfif = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 1, 0x00, 0x96, 0x00, 0x96, 0, 0] // 150 dpi
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 8, 0x04, 0xb0, 0x06, 0x40, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1] // 1200x1600
    const r = probe.parseBytes(buf([0xff, 0xd8, ...jfif, ...sof0, 0xff, 0xd9]))
    expect(r.format).toBe('JPG')
    expect(r.widthPx).toBe(1600)
    expect(r.heightPx).toBe(1200)
    expect(r.dpi).toBe(150)
    expect(r.widthIn).toBeCloseTo(10.67, 1)
  })

  it('TIFF little-endian: IFD size + resolution', () => {
    // header + IFD with 5 entries: 256,257,277,282(RATIONAL->offset),296
    const le16 = (n: number) => [n & 255, (n >> 8) & 255]
    const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
    const ifdOffset = 8
    const entries = 5
    const ratOffset = ifdOffset + 2 + entries * 12 + 4
    const entry = (tag: number, type: number, count: number, value: number[]) => [...le16(tag), ...le16(type), ...le32(count), ...value]
    const bytes = [
      0x49, 0x49, 0x2a, 0x00, ...le32(ifdOffset),
      ...le16(entries),
      ...entry(256, 4, 1, le32(3000)),
      ...entry(257, 4, 1, le32(1500)),
      ...entry(277, 3, 1, [...le16(4), 0, 0]),
      ...entry(282, 5, 1, le32(ratOffset)),
      ...entry(296, 3, 1, [...le16(2), 0, 0]),
      ...le32(0),
      ...le32(300), ...le32(1),
    ]
    const r = probe.parseBytes(buf(bytes))
    expect(r.format).toBe('TIFF')
    expect(r.widthPx).toBe(3000)
    expect(r.heightPx).toBe(1500)
    expect(r.dpi).toBe(300)
    expect(r.hasAlpha).toBe(true)
    expect(r.widthIn).toBe(10)
  })

  it('PSD: header size + 0x03ED resolution resource', () => {
    const header = [...ascii('8BPS'), 0, 1, 0, 0, 0, 0, 0, 0, 0, 4, ...u32(1200), ...u32(2400), 0, 8, 0, 3]
    const colorMode = [...u32(0)]
    const resData = [...u32(300 * 65536), 0, 1, 0, 1, ...u32(300 * 65536), 0, 1, 0, 1] // 16 bytes
    const resource = [...ascii('8BIM'), 0x03, 0xed, 0, 0, ...u32(resData.length), ...resData]
    const r = probe.parseBytes(buf([...header, ...colorMode, ...u32(resource.length), ...resource]))
    expect(r.format).toBe('PSD')
    expect(r.widthPx).toBe(2400)
    expect(r.heightPx).toBe(1200)
    expect(r.dpi).toBe(300)
    expect(r.hasAlpha).toBe(true)
    expect(r.widthIn).toBe(8)
  })

  it('PDF: MediaBox in points', () => {
    const r = probe.parseBytes(buf(ascii('%PDF-1.7\n1 0 obj << /Type /Page /MediaBox [0 0 1584 864] >> endobj')))
    expect(r.format).toBe('PDF')
    expect(r.widthIn).toBe(22)
    expect(r.heightIn).toBe(12)
    expect(r.confident).toBe(true)
  })

  it('EPS: plain and DOS-wrapped bounding boxes', () => {
    const plain = probe.parseBytes(buf(ascii('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 1584 864\n')))
    expect(plain.format).toBe('EPS')
    expect(plain.widthIn).toBe(22)
    expect(plain.heightIn).toBe(12)

    const ps = ascii('%!PS-Adobe-3.0 EPSF-3.0\n%%HiResBoundingBox: 0 0 792 432\n')
    const psOffset = 30
    const header = [0xc5, 0xd0, 0xd3, 0xc6, psOffset & 255, (psOffset >> 8) & 255, 0, 0, ps.length & 255, (ps.length >> 8) & 255, 0, 0]
    const pad = new Array(psOffset - header.length).fill(0)
    const dos = probe.parseBytes(buf([...header, ...pad, ...ps]))
    expect(dos.format).toBe('EPS')
    expect(dos.widthIn).toBe(11)
    expect(dos.heightIn).toBe(6)
  })

  it('SVG: unit dimensions, else viewBox', () => {
    const withUnits = probe.parseBytes(buf(ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="11in" height="6in"></svg>')))
    expect(withUnits.format).toBe('SVG')
    expect(withUnits.widthIn).toBe(11)
    const viewBox = probe.parseBytes(buf(ascii('<svg viewBox="0 0 960 480"></svg>')))
    expect(viewBox.widthIn).toBe(10)
    expect(viewBox.heightIn).toBe(5)
  })

  it('unknown bytes are not confident', () => {
    const r = probe.parseBytes(buf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    expect(r.format).toBe('unknown')
    expect(r.confident).toBe(false)
  })
})
