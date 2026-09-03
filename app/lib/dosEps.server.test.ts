import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { detectFileType, extractDosEpsPostScript } from './preflight.server'

const PS_CONTENT = Buffer.from(
  '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 200\nshowpage\n',
  'latin1'
)

/** DOS EPS binary: C5D0D3C6 magic, LE uint32 psOffset + psLength, then a
 *  fake TIFF preview blob before the PostScript segment. */
function buildDosEps(): Buffer {
  const header = Buffer.alloc(30)
  header[0] = 0xc5
  header[1] = 0xd0
  header[2] = 0xd3
  header[3] = 0xc6
  const preview = Buffer.from('II*\0fake-tiff-preview-bytes', 'latin1')
  const psOffset = header.length + preview.length
  header.writeUInt32LE(psOffset, 4)
  header.writeUInt32LE(PS_CONTENT.length, 8)
  return Buffer.concat([header, preview, PS_CONTENT])
}

describe('DOS EPS handling (2026-09-03 live incident)', () => {
  it('detects DOS EPS binary headers as postscript', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doseps-'))
    const file = join(dir, 'preview.eps')
    await writeFile(file, buildDosEps())
    expect(await detectFileType(file)).toBe('application/postscript')
  })

  it('still detects plain %! postscript', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doseps-'))
    const file = join(dir, 'plain.eps')
    await writeFile(file, PS_CONTENT)
    expect(await detectFileType(file)).toBe('application/postscript')
  })

  it('extracts the embedded PostScript segment from a DOS EPS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doseps-'))
    const file = join(dir, 'preview.eps')
    await writeFile(file, buildDosEps())
    const extracted = await extractDosEpsPostScript(file)
    expect(extracted).toBeTruthy()
    const content = await readFile(extracted as string)
    expect(content.equals(PS_CONTENT)).toBe(true)
    expect(content.toString('latin1')).toContain('%%BoundingBox: 0 0 100 200')
  })

  it('returns null for plain postscript and out-of-range headers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doseps-'))
    const plain = join(dir, 'plain.eps')
    await writeFile(plain, PS_CONTENT)
    expect(await extractDosEpsPostScript(plain)).toBeNull()

    const broken = join(dir, 'broken.eps')
    const header = Buffer.alloc(12)
    header[0] = 0xc5; header[1] = 0xd0; header[2] = 0xd3; header[3] = 0xc6
    header.writeUInt32LE(9999, 4) // offset beyond EOF
    header.writeUInt32LE(5000, 8)
    await writeFile(broken, header)
    expect(await extractDosEpsPostScript(broken)).toBeNull()
  })
})
