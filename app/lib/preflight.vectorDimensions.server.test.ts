import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  getVectorRasterDimensionsFast,
  parseEpsHeaderBox,
  parsePdfinfoBoxes,
} from './preflight.server'
import { shouldSerializeVectorRaster } from './uploadQueues'

let dir = ''

async function writeFixture(name: string, content: string | Buffer): Promise<string> {
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, content)
  return filePath
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-dims-'))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('parseEpsHeaderBox', () => {
  it('sizes an EPSF header BoundingBox at 300 DPI', () => {
    expect(
      parseEpsHeaderBox('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 792 432\n%%EndComments\nshowpage\n')
    ).toEqual({ width: 3300, height: 1800 })
  })

  it('prefers HiResBoundingBox and honours a non-zero origin', () => {
    expect(
      parseEpsHeaderBox(
        '%!PS-Adobe-3.0 EPSF-3.0\r\n%%BoundingBox: 10 20 802 452\r\n%%HiResBoundingBox: 10.5 20 802.5 452\r\n'
      )
    ).toEqual({ width: 3300, height: 1800 })
  })

  it('never reads the box of a document embedded after the header', () => {
    const eps = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      '%%BoundingBox: 0 0 1584 14400',
      '%%EndComments',
      '%%BeginDocument: logo.eps',
      '%%HiResBoundingBox: 0 0 72 72',
      '%%EndDocument',
    ].join('\n')
    expect(parseEpsHeaderBox(eps)).toEqual({ width: 6600, height: 60000 })
  })

  it('returns null for deferred boxes and for PostScript that is not EPSF', () => {
    expect(parseEpsHeaderBox('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: (atend)\n%%EndComments\n')).toBeNull()
    expect(parseEpsHeaderBox('%!PS-Adobe-3.0\n%%BoundingBox: 0 0 792 432\n')).toBeNull()
  })
})

describe('parsePdfinfoBoxes', () => {
  const pdfinfo = [
    'Pages:           1',
    'Page    1 size:  1584 x 7200 pts',
    'Page    1 MediaBox:     0.00     0.00  1584.00 14400.00',
    'Page    1 CropBox:      0.00     0.00  1584.00  7200.00',
  ].join('\n')

  it('uses the MediaBox Ghostscript renders, not a smaller CropBox', () => {
    expect(parsePdfinfoBoxes(pdfinfo, false)).toEqual({ width: 6600, height: 60000 })
  })

  it('treats /UserUnit pages and missing boxes as unknown', () => {
    expect(parsePdfinfoBoxes(pdfinfo, true)).toBeNull()
    expect(parsePdfinfoBoxes('Pages: 1\n', false)).toBeNull()
  })
})

describe('getVectorRasterDimensionsFast', () => {
  it('reads an EPS header from the file prefix', async () => {
    const file = await writeFixture(
      'sheet.eps',
      '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 792 432\n%%EndComments\nshowpage\n'
    )
    await expect(getVectorRasterDimensionsFast(file, 'application/postscript')).resolves.toEqual({
      width: 3300,
      height: 1800,
    })
  })

  it('follows a DOS EPS binary header to its PostScript section', async () => {
    const postScript = Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 792 432\n%%EndComments\n', 'latin1')
    const header = Buffer.alloc(30)
    header.writeUInt32BE(0xc5d0d3c6, 0)
    header.writeUInt32LE(30, 4)
    header.writeUInt32LE(postScript.length, 8)
    const file = await writeFixture('dos.eps', Buffer.concat([header, postScript]))
    await expect(getVectorRasterDimensionsFast(file, 'application/postscript')).resolves.toEqual({
      width: 3300,
      height: 1800,
    })
  })

  it('ignores formats it does not size', async () => {
    const file = await writeFixture('image.png', 'not a vector')
    await expect(getVectorRasterDimensionsFast(file, 'image/png')).resolves.toBeNull()
  })
})

describe('shouldSerializeVectorRaster', () => {
  it('lets only small known pages skip the large-image slot', () => {
    expect(shouldSerializeVectorRaster(6600, 3600)).toBe(false)
    expect(shouldSerializeVectorRaster(6600, 36000)).toBe(true)
    expect(shouldSerializeVectorRaster(null, null)).toBe(true)
  })
})
