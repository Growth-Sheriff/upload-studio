import { describe, expect, it } from 'vitest'
import { parsePngInfo } from './preflight.server'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function buildChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, data, Buffer.alloc(4)])
}

function buildPng(chunks: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(927, 0)
  ihdr.writeUInt32BE(496, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    ...chunks,
    buildChunk('IEND', Buffer.alloc(0)),
  ])
}

function buildPhysChunk(dpi: number): Buffer {
  const pixelsPerMeter = Math.round(dpi / 0.0254)
  const data = Buffer.alloc(9)
  data.writeUInt32BE(pixelsPerMeter, 0)
  data.writeUInt32BE(pixelsPerMeter, 4)
  data[8] = 1
  return buildChunk('pHYs', data)
}

function buildXmpTextChunk(dpi: number): Buffer {
  const xmp = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/"',
    ` tiff:XResolution="${dpi}/1"`,
    ` tiff:YResolution="${dpi}/1"`,
    ' tiff:ResolutionUnit="2" />',
    '</rdf:RDF>',
    '</x:xmpmeta>',
  ].join('')
  return buildChunk('tEXt', Buffer.from(`XML:com.adobe.xmp\0${xmp}`, 'utf8'))
}

describe('parsePngInfo', () => {
  it('uses PNG pHYs density as document DPI', () => {
    const info = parsePngInfo(buildPng([buildPhysChunk(300)]))

    expect(info?.width).toBe(927)
    expect(info?.height).toBe(496)
    expect(info?.dpi).toBe(300)
    expect(info?.dpiSource).toBe('png_phys')
  })

  it('reads Adobe XMP TIFF resolution when pHYs is missing', () => {
    const info = parsePngInfo(buildPng([buildXmpTextChunk(300)]))

    expect(info?.dpi).toBe(300)
    expect(info?.dpiSource).toBe('xmp_resolution')
  })

  it('prefers Adobe XMP over conflicting default pHYs density', () => {
    const info = parsePngInfo(buildPng([buildPhysChunk(72), buildXmpTextChunk(300)]))

    expect(info?.dpi).toBe(300)
    expect(info?.dpiSource).toBe('xmp_resolution')
  })

  it('leaves DPI unset when no physical document metadata exists', () => {
    const info = parsePngInfo(buildPng())

    expect(info?.dpi).toBe(0)
    expect(info?.dpiSource).toBeNull()
  })
})
