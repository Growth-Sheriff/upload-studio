
import { exec } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import { inflateSync } from 'zlib'

const execAsync = promisify(exec)







const DEFAULT_SHEET_WIDTH_IN = 22

interface DpiCandidate {
  dpi: number
  source: string
  priority: number
}

function parseResolutionNumber(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return 0
  const raw = String(value).trim()
  if (!raw) return 0

  const rational = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (rational) {
    const numerator = Number(rational[1])
    const denominator = Number(rational[2])
    return denominator > 0 ? numerator / denominator : 0
  }

  const parsed = Number(raw.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeResolutionUnit(value: unknown): 'inch' | 'centimeter' | 'meter' | null {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (raw === '2' || raw === 'inch' || raw === 'inches' || raw === 'pixelsperinch') {
    return 'inch'
  }
  if (
    raw === '3' ||
    raw === 'cm' ||
    raw === 'centimeter' ||
    raw === 'centimeters' ||
    raw === 'pixelspercentimeter'
  ) {
    return 'centimeter'
  }
  if (raw === 'm' || raw === 'meter' || raw === 'meters' || raw === 'pixelspermeter') {
    return 'meter'
  }
  return null
}

function buildDpiCandidate(
  xResolution: number,
  yResolution: number,
  unit: unknown,
  source: string,
  priority: number
): DpiCandidate | null {
  if (!(xResolution > 0) || !(yResolution > 0)) return null

  const normalizedUnit = normalizeResolutionUnit(unit)
  if (!normalizedUnit) return null

  const dpiX =
    normalizedUnit === 'meter'
      ? xResolution * 0.0254
      : normalizedUnit === 'centimeter'
        ? xResolution * 2.54
        : xResolution
  const dpiY =
    normalizedUnit === 'meter'
      ? yResolution * 0.0254
      : normalizedUnit === 'centimeter'
        ? yResolution * 2.54
        : yResolution
  const minDpi = Math.min(dpiX, dpiY)
  const maxDpi = Math.max(dpiX, dpiY)
  if (!(minDpi > 1) || maxDpi > 10000) return null


  if (maxDpi / minDpi > 1.05) return null

  return {
    dpi: Number(((dpiX + dpiY) / 2).toFixed(4)),
    source,
    priority,
  }
}

function chooseBestDpiCandidate(candidates: Array<DpiCandidate | null>): DpiCandidate | null {
  return candidates
    .filter((candidate): candidate is DpiCandidate => Boolean(candidate && candidate.dpi > 0))
    .sort((a, b) => b.priority - a.priority || b.dpi - a.dpi)[0] || null
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function getXmlField(source: string, fieldName: string): string | null {
  const attrMatch = source.match(
    new RegExp(`\\b(?:[A-Za-z0-9_-]+:)?${fieldName}\\s*=\\s*["']([^"']+)["']`, 'i')
  )
  if (attrMatch) return decodeXmlEntities(attrMatch[1])

  const tagMatch = source.match(
    new RegExp(`<[^>]*?(?:[A-Za-z0-9_-]+:)?${fieldName}[^>]*>([^<]+)<\\/[^>]+>`, 'i')
  )
  return tagMatch ? decodeXmlEntities(tagMatch[1]) : null
}

function parseXmpResolution(source: string, priority = 95): DpiCandidate | null {
  if (!source || !/xmp|rdf|resolution/i.test(source)) return null

  const xResolution = parseResolutionNumber(getXmlField(source, 'XResolution'))
  const yResolution = parseResolutionNumber(getXmlField(source, 'YResolution')) || xResolution
  const unit = getXmlField(source, 'ResolutionUnit') || '2'

  return buildDpiCandidate(xResolution, yResolution, unit, 'xmp_resolution', priority)
}

function parsePngTextChunk(chunkType: string, data: Buffer): string | null {
  try {
    if (chunkType === 'tEXt') {
      const separator = data.indexOf(0)
      return separator >= 0 ? data.subarray(separator + 1).toString('utf8') : data.toString('utf8')
    }

    if (chunkType === 'zTXt') {
      const separator = data.indexOf(0)
      if (separator < 0 || data[separator + 1] !== 0) return null
      return inflateSync(data.subarray(separator + 2)).toString('utf8')
    }

    if (chunkType === 'iTXt') {
      const keywordEnd = data.indexOf(0)
      if (keywordEnd < 0 || keywordEnd + 3 > data.length) return null

      const compressionFlag = data[keywordEnd + 1]
      const compressionMethod = data[keywordEnd + 2]
      let offset = keywordEnd + 3
      const languageEnd = data.indexOf(0, offset)
      if (languageEnd < 0) return null
      offset = languageEnd + 1
      const translatedKeywordEnd = data.indexOf(0, offset)
      if (translatedKeywordEnd < 0) return null
      offset = translatedKeywordEnd + 1

      const textBuffer = data.subarray(offset)
      if (compressionFlag === 1 && compressionMethod === 0) {
        return inflateSync(textBuffer).toString('utf8')
      }
      if (compressionFlag === 0) {
        return textBuffer.toString('utf8')
      }
    }
  } catch {
    return null
  }

  return null
}

export function parsePngInfo(buffer: Buffer) {
  if (buffer.length < 24) return null
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return null
  }

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const dpiCandidates: Array<DpiCandidate | null> = []
  let hasAlpha = false

  const colorType = buffer[25]
  hasAlpha = colorType === 4 || colorType === 6

  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8)
    const dataOffset = offset + 8
    if (dataOffset + length + 4 > buffer.length) break
    const chunkData = buffer.subarray(dataOffset, dataOffset + length)

    if (chunkType === 'pHYs' && length >= 9) {
      const pixelsPerUnitX = buffer.readUInt32BE(dataOffset)
      const pixelsPerUnitY = buffer.readUInt32BE(dataOffset + 4)
      const unitSpecifier = buffer[dataOffset + 8]
      dpiCandidates.push(
        unitSpecifier === 1
          ? buildDpiCandidate(pixelsPerUnitX, pixelsPerUnitY, 'pixelspermeter', 'png_phys', 80)
          : null
      )
    }

    if (chunkType === 'tRNS') {
      hasAlpha = true
    }

    if (chunkType === 'iTXt' || chunkType === 'tEXt' || chunkType === 'zTXt') {
      const text = parsePngTextChunk(chunkType, chunkData)
      if (text) {
        dpiCandidates.push(parseXmpResolution(text))
      }
    }

    offset += 12 + length
    if (chunkType === 'IEND') break
  }

  const dpiCandidate = chooseBestDpiCandidate(dpiCandidates)

  return {
    width,
    height,
    dpi: dpiCandidate?.dpi || 0,
    dpiSource: dpiCandidate?.source || null,
    colorspace: 'sRGB',
    hasAlpha,
    format: 'PNG',
  }
}

function parseJpegInfo(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  const dpiCandidates: Array<DpiCandidate | null> = []
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }

    const segmentLength = buffer.readUInt16BE(offset + 2)
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) break
    const segmentDataOffset = offset + 4
    const segmentData = buffer.subarray(segmentDataOffset, offset + 2 + segmentLength)

    if (marker === 0xe0 && buffer.toString('ascii', offset + 4, offset + 9) === 'JFIF\0') {
      const units = buffer[offset + 11]
      const xDensity = buffer.readUInt16BE(offset + 12)
      const yDensity = buffer.readUInt16BE(offset + 14)
      if (units === 1 || units === 2) {
        dpiCandidates.push(
          buildDpiCandidate(xDensity, yDensity, units === 2 ? 'centimeter' : 'inch', 'jpeg_jfif', 75)
        )
      }
    }

    if (marker === 0xe1) {
      if (segmentData.subarray(0, 6).equals(Buffer.from('Exif\0\0', 'ascii'))) {
        dpiCandidates.push(parseTiffResolutionCandidate(segmentData.subarray(6), 'exif_resolution', 90))
      } else {
        const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0'
        const header = segmentData.subarray(0, xmpHeader.length).toString('ascii')
        if (header === xmpHeader) {
          dpiCandidates.push(parseXmpResolution(segmentData.subarray(xmpHeader.length).toString('utf8')))
        } else if (/xmp|rdf|resolution/i.test(segmentData.toString('utf8', 0, Math.min(segmentData.length, 512)))) {
          dpiCandidates.push(parseXmpResolution(segmentData.toString('utf8')))
        }
      }
    }

    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = buffer.readUInt16BE(offset + 5)
      const width = buffer.readUInt16BE(offset + 7)
      const dpiCandidate = chooseBestDpiCandidate(dpiCandidates)
      return {
        width,
        height,
        dpi: dpiCandidate?.dpi || 0,
        dpiSource: dpiCandidate?.source || null,
        colorspace: 'sRGB',
        hasAlpha: false,
        format: 'JPEG',
      }
    }

    offset += 2 + segmentLength
  }

  return null
}

function parseWebpInfo(buffer: Buffer) {
  if (buffer.length < 30) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null
  }

  let width = 0
  let height = 0
  let hasAlpha = false
  const dpiCandidates: Array<DpiCandidate | null> = []

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + length > buffer.length) break

    const data = buffer.subarray(dataOffset, dataOffset + length)

    if (chunkType === 'VP8 ' && data.length >= 10) {
      width = data.readUInt16LE(6) & 0x3fff
      height = data.readUInt16LE(8) & 0x3fff
    } else if (chunkType === 'VP8L' && data.length >= 5) {
      const bits = data.readUInt32LE(1)
      width = (bits & 0x3fff) + 1
      height = ((bits >> 14) & 0x3fff) + 1
      hasAlpha = ((bits >> 28) & 0x1) === 1
    } else if (chunkType === 'VP8X' && data.length >= 10) {
      const flags = data[0]
      width = 1 + data.readUIntLE(4, 3)
      height = 1 + data.readUIntLE(7, 3)
      hasAlpha = (flags & 0x10) !== 0
    } else if (chunkType === 'EXIF') {
      if (data.subarray(0, 6).equals(Buffer.from('Exif\0\0', 'ascii'))) {
        dpiCandidates.push(parseTiffResolutionCandidate(data.subarray(6), 'exif_resolution', 90))
      } else {
        dpiCandidates.push(parseTiffResolutionCandidate(data, 'exif_resolution', 90))
      }
    } else if (chunkType === 'XMP ') {
      dpiCandidates.push(parseXmpResolution(data.toString('utf8')))
    }

    offset = dataOffset + length + (length % 2)
  }

  if (width > 0 && height > 0) {
    const dpiCandidate = chooseBestDpiCandidate(dpiCandidates)
    return {
      width,
      height,
      dpi: dpiCandidate?.dpi || 0,
      dpiSource: dpiCandidate?.source || null,
      colorspace: 'sRGB',
      hasAlpha,
      format: 'WEBP',
    }
  }

  return null
}

function readPsdFixed16_16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) return 0
  return buffer.readUInt32BE(offset) / 65536
}

function parsePsdResolutionCandidate(buffer: Buffer): DpiCandidate | null {
  if (buffer.length < 30) return null

  const colorModeLength = buffer.readUInt32BE(26)
  let offset = 30 + colorModeLength
  if (offset + 4 > buffer.length) return null

  const resourcesLength = buffer.readUInt32BE(offset)
  offset += 4
  const resourcesEnd = Math.min(buffer.length, offset + resourcesLength)

  while (offset + 12 <= resourcesEnd) {
    const signature = buffer.toString('ascii', offset, offset + 4)
    if (signature !== '8BIM' && signature !== '8B64') break

    const resourceId = buffer.readUInt16BE(offset + 4)
    offset += 6

    const nameLength = buffer[offset] || 0
    offset += 1 + nameLength
    if ((1 + nameLength) % 2 !== 0) offset += 1
    if (offset + 4 > resourcesEnd) break

    const dataLength = buffer.readUInt32BE(offset)
    offset += 4
    if (offset + dataLength > resourcesEnd) break

    if (resourceId === 1005 && dataLength >= 16) {
      const xResolution = readPsdFixed16_16(buffer, offset)
      const xResolutionUnit = buffer.readUInt16BE(offset + 4)
      const yResolution = readPsdFixed16_16(buffer, offset + 8)
      const yResolutionUnit = buffer.readUInt16BE(offset + 12)
      const unit =
        xResolutionUnit === 2 || yResolutionUnit === 2
          ? 'centimeter'
          : 'inch'
      return buildDpiCandidate(xResolution, yResolution || xResolution, unit, 'psd_resolution', 90)
    }

    offset += dataLength + (dataLength % 2)
  }

  return null
}

function parsePsdInfo(buffer: Buffer) {
  if (buffer.length < 26) return null
  if (buffer.toString('ascii', 0, 4) !== '8BPS') return null

  const channels = buffer.readUInt16BE(12)
  const height = buffer.readUInt32BE(14)
  const width = buffer.readUInt32BE(18)
  const dpiCandidate = parsePsdResolutionCandidate(buffer)

  if (!(width > 0) || !(height > 0)) {
    return null
  }

  return {
    width,
    height,
    dpi: dpiCandidate?.dpi || 0,
    dpiSource: dpiCandidate?.source || null,
    colorspace: 'PSD',
    hasAlpha: channels >= 4,
    format: 'PSD',
  }
}

function readTiffUInt(
  buffer: Buffer,
  offset: number,
  byteLength: 2 | 4,
  littleEndian: boolean
): number | null {
  if (offset < 0 || offset + byteLength > buffer.length) return null
  if (byteLength === 2) {
    return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset)
  }
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
}

function readTiffRational(buffer: Buffer, offset: number, littleEndian: boolean): number | null {
  const numerator = readTiffUInt(buffer, offset, 4, littleEndian)
  const denominator = readTiffUInt(buffer, offset + 4, 4, littleEndian)
  if (!(numerator != null) || !(denominator != null) || denominator === 0) {
    return null
  }
  return numerator / denominator
}

function parseTiffResolutionCandidate(
  buffer: Buffer,
  source: string,
  priority: number
): DpiCandidate | null {
  if (buffer.length < 8) return null

  const byteOrder = buffer.toString('ascii', 0, 2)
  const littleEndian = byteOrder === 'II'
  if (!littleEndian && byteOrder !== 'MM') return null

  const magic = readTiffUInt(buffer, 2, 2, littleEndian)
  if (magic !== 42) return null

  const firstIfdOffset = readTiffUInt(buffer, 4, 4, littleEndian)
  if (!(firstIfdOffset != null) || firstIfdOffset + 2 > buffer.length) return null

  const entryCount = readTiffUInt(buffer, firstIfdOffset, 2, littleEndian)
  if (!(entryCount != null)) return null

  let xResolution = 0
  let yResolution = 0
  let resolutionUnit = 2

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = firstIfdOffset + 2 + index * 12
    if (entryOffset + 12 > buffer.length) break

    const tag = readTiffUInt(buffer, entryOffset, 2, littleEndian)
    const type = readTiffUInt(buffer, entryOffset + 2, 2, littleEndian)
    const count = readTiffUInt(buffer, entryOffset + 4, 4, littleEndian)
    const valueOrOffset = readTiffUInt(buffer, entryOffset + 8, 4, littleEndian)

    if (tag == null || type == null || count == null || valueOrOffset == null) {
      continue
    }

    const scalar = getTiffEntryScalar(
      buffer,
      entryOffset,
      type,
      count,
      valueOrOffset,
      littleEndian
    )

    if (tag === 282 && scalar) xResolution = scalar
    if (tag === 283 && scalar) yResolution = scalar
    if (tag === 296 && scalar) resolutionUnit = scalar
  }

  return buildDpiCandidate(xResolution, yResolution || xResolution, resolutionUnit, source, priority)
}

function getTiffEntryScalar(
  buffer: Buffer,
  entryOffset: number,
  type: number,
  count: number,
  valueOrOffset: number,
  littleEndian: boolean
): number | null {
  if (count !== 1) return null

  if (type === 3) {
    return readTiffUInt(buffer, entryOffset + 8, 2, littleEndian)
  }

  if (type === 4) {
    return valueOrOffset
  }

  if (type === 5) {
    return readTiffRational(buffer, valueOrOffset, littleEndian)
  }

  return null
}

function parseTiffInfo(buffer: Buffer) {
  if (buffer.length < 8) return null

  const byteOrder = buffer.toString('ascii', 0, 2)
  const littleEndian = byteOrder === 'II'
  if (!littleEndian && byteOrder !== 'MM') {
    return null
  }

  const magic = readTiffUInt(buffer, 2, 2, littleEndian)
  if (magic !== 42) {
    return null
  }

  const firstIfdOffset = readTiffUInt(buffer, 4, 4, littleEndian)
  if (!(firstIfdOffset != null) || firstIfdOffset + 2 > buffer.length) {
    return null
  }

  const entryCount = readTiffUInt(buffer, firstIfdOffset, 2, littleEndian)
  if (!(entryCount != null)) {
    return null
  }

  let width = 0
  let height = 0
  let samplesPerPixel = 0
  let xResolution = 0
  let yResolution = 0
  let resolutionUnit = 2

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = firstIfdOffset + 2 + index * 12
    if (entryOffset + 12 > buffer.length) break

    const tag = readTiffUInt(buffer, entryOffset, 2, littleEndian)
    const type = readTiffUInt(buffer, entryOffset + 2, 2, littleEndian)
    const count = readTiffUInt(buffer, entryOffset + 4, 4, littleEndian)
    const valueOrOffset = readTiffUInt(buffer, entryOffset + 8, 4, littleEndian)

    if (
      tag == null ||
      type == null ||
      count == null ||
      valueOrOffset == null
    ) {
      continue
    }

    const scalar = getTiffEntryScalar(
      buffer,
      entryOffset,
      type,
      count,
      valueOrOffset,
      littleEndian
    )

    if (tag === 256 && scalar) width = scalar
    if (tag === 257 && scalar) height = scalar
    if (tag === 277 && scalar) samplesPerPixel = scalar
    if (tag === 282 && scalar) xResolution = scalar
    if (tag === 283 && scalar) yResolution = scalar
    if (tag === 296 && scalar) resolutionUnit = scalar
  }

  if (!(width > 0) || !(height > 0)) {
    return null
  }

  const dpiCandidate = buildDpiCandidate(
    xResolution,
    yResolution || xResolution,
    resolutionUnit,
    'tiff_resolution',
    90
  )

  return {
    width,
    height,
    dpi: dpiCandidate?.dpi || 0,
    dpiSource: dpiCandidate?.source || null,
    colorspace: 'TIFF',
    hasAlpha: samplesPerPixel >= 4,
    format: 'TIFF',
  }
}

function parseSvgLength(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) return fallback
  const match = String(rawValue).trim().match(/^([\d.]+)\s*(in|cm|mm|pt|pc|px)?$/i)
  if (!match) return fallback

  const numeric = Number(match[1])
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback

  const unit = (match[2] || 'px').toLowerCase()
  const inches =
    unit === 'in'
      ? numeric
      : unit === 'cm'
        ? numeric / 2.54
        : unit === 'mm'
          ? numeric / 25.4
          : unit === 'pt'
            ? numeric / 72
            : unit === 'pc'
              ? numeric / 6
              : null

  return Math.round(inches != null ? inches * 72 : numeric)
}

async function getImageInfoWithoutImagemagick(filePath: string, mimeType: string) {
  if (mimeType === 'application/pdf') {
    const pdfInfo = await getPdfInfo(filePath)
    if (pdfInfo.width > 0 && pdfInfo.height > 0) {
      return {
        width: pdfInfo.width,
        height: pdfInfo.height,
        dpi: 300,
        dpiSource: 'pdf_page_size',
        colorspace: 'PDF',
        hasAlpha: false,
        format: 'PDF',
      }
    }
    return null
  }

  if (mimeType === 'application/postscript') {
    try {
      // DOS EPS wrapper: measure the extracted pure PostScript instead.
      const extractedForBbox = await extractDosEpsPostScript(filePath).catch(() => null)
      if (extractedForBbox) filePath = extractedForBbox
      const { stdout, stderr } = await execAsync(`gs -q -dNOPAUSE -dBATCH -sDEVICE=bbox "${filePath}"`)
      const output = `${stdout}\n${stderr}`
      const match =
        output.match(/%%HiResBoundingBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/) ||
        output.match(/%%BoundingBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/)

      if (match) {
        const widthPt = parseFloat(match[3]) - parseFloat(match[1])
        const heightPt = parseFloat(match[4]) - parseFloat(match[2])
        if (widthPt > 0 && heightPt > 0) {
          return {
            width: Math.round((widthPt * 300) / 72),
            height: Math.round((heightPt * 300) / 72),
            dpi: 300,
            dpiSource: 'postscript_bbox',
            colorspace: 'PostScript',
            hasAlpha: false,
            format: 'EPS',
          }
        }
      }
    } catch (error) {
      console.warn('[Preflight] PostScript bbox fallback failed:', error)
    }
    return null
  }

  const buffer = await fs.readFile(filePath)

  if (mimeType === 'image/png') {
    return parsePngInfo(buffer)
  }

  if (mimeType === 'image/jpeg') {
    return parseJpegInfo(buffer)
  }

  if (mimeType === 'image/webp') {
    return parseWebpInfo(buffer)
  }

  if (mimeType === 'image/tiff') {
    return parseTiffInfo(buffer)
  }

  if (
    mimeType === 'image/vnd.adobe.photoshop' ||
    mimeType === 'application/x-photoshop' ||
    mimeType === 'image/x-psd'
  ) {
    return parsePsdInfo(buffer)
  }

  if (mimeType === 'image/svg+xml') {
    const source = buffer.toString('utf8')
    const widthMatch = source.match(/\bwidth="([^"]+)"/i)
    const heightMatch = source.match(/\bheight="([^"]+)"/i)
    const viewBoxMatch = source.match(/\bviewBox="[^"]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/i)
    const fallbackWidth = viewBoxMatch ? parseFloat(viewBoxMatch[1]) : 0
    const fallbackHeight = viewBoxMatch ? parseFloat(viewBoxMatch[2]) : 0
    return {
      width: parseSvgLength(widthMatch?.[1], fallbackWidth),
      height: parseSvgLength(heightMatch?.[1], fallbackHeight),
      dpi: 72,
      dpiSource: 'svg_document_size',
      colorspace: 'sRGB',
      hasAlpha: true,
      format: 'SVG',
    }
  }

  return null
}


export interface PreflightCheck {
  name: string
  status: 'ok' | 'warning' | 'error'
  value?: string | number | boolean
  message?: string
  details?: Record<string, unknown>
}

export interface PreflightResult {
  overall: 'ok' | 'warning' | 'error'
  checks: PreflightCheck[]
  thumbnailPath?: string
  convertedPath?: string
}

interface MeasuredImageInfo {
  width: number
  height: number
  dpi: number
  dpiSource?: string | null
  colorspace: string
  hasAlpha: boolean
  format: string
  trimmedWidth?: number
  trimmedHeight?: number
  trimmedOffsetX?: number
  trimmedOffsetY?: number
  effectiveDpi?: number
  measurementWidth?: number
  measurementHeight?: number
  measurementMode?: 'trimmed' | 'full'
}


export interface PreflightConfig {
  maxFileSizeMB: number
  minDPI: number
  requiredDPI: number
  maxPages: number
  allowedFormats: string[]
  requireTransparency: boolean





  sheetWidthIn?: number




  sheetLengthIn?: number
}

export const PLAN_CONFIGS: Record<string, PreflightConfig> = {
  free: {
    maxFileSizeMB: 1024, // 1GB - all plans support large files
    minDPI: 150,
    requiredDPI: 300,
    maxPages: 1,
    allowedFormats: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/tiff',
      'image/vnd.adobe.photoshop',
      'application/x-photoshop',
      'application/pdf',
      'application/postscript',
      'image/svg+xml',
    ],
    requireTransparency: false,
  },
  starter: {
    maxFileSizeMB: 1024, // 1GB
    minDPI: 150,
    requiredDPI: 300,
    maxPages: 1,
    allowedFormats: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/tiff',
      'image/vnd.adobe.photoshop',
      'application/x-photoshop',
      'application/pdf',
      'application/postscript',
      'image/svg+xml',
    ],
    requireTransparency: false,
  },
  pro: {
    maxFileSizeMB: 1453, // Pro gets 1453MB
    minDPI: 150,
    requiredDPI: 300,
    maxPages: 5,
    allowedFormats: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/tiff',
      'image/vnd.adobe.photoshop',
      'application/x-photoshop',
      'application/pdf',
      'application/postscript',
      'image/svg+xml',
    ],
    requireTransparency: false,
  },
  enterprise: {
    maxFileSizeMB: 10240, // Enterprise gets 10GB - no limits
    minDPI: 72, // No minimum DPI requirement
    requiredDPI: 150, // Lower requirement for enterprise
    maxPages: 999, // Unlimited pages
    allowedFormats: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/tiff',
      'image/vnd.adobe.photoshop',
      'application/x-photoshop',
      'application/pdf',
      'application/postscript',
      'image/svg+xml',
    ],
    requireTransparency: false,
  },
}


const MAGIC_BYTES: Record<string, Buffer> = {
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/webp': Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF header
  'image/tiff': Buffer.from([0x49, 0x49, 0x2a, 0x00]), // Little-endian TIFF (II)
  'image/tiff-be': Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), // Big-endian TIFF (MM)
  'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
  'image/svg+xml': Buffer.from([0x3c, 0x3f, 0x78, 0x6d, 0x6c]), // <?xml or <svg
  'image/vnd.adobe.photoshop': Buffer.from([0x38, 0x42, 0x50, 0x53]), // 8BPS - PSD signature
}


export async function detectFileType(filePath: string): Promise<string | null> {
  const buffer = Buffer.alloc(16)
  const fd = await fs.open(filePath, 'r')
  await fd.read(buffer, 0, 16, 0)
  await fd.close()

  for (const [mimeType, magic] of Object.entries(MAGIC_BYTES)) {
    if (buffer.subarray(0, magic.length).equals(magic)) {

      if (mimeType === 'image/tiff-be') {
        return 'image/tiff'
      }
      return mimeType
    }
  }


  const start = buffer.toString('utf8', 0, 4)
  if (start === '<svg' || start === '<?xm') {
    return 'image/svg+xml'
  }


  if (buffer.toString('utf8', 0, 2) === '%!') {
    return 'application/postscript'
  }

  // DOS EPS binary header (EPS saved with a TIFF/WMF preview — Illustrator's
  // "save with preview"): C5 D0 D3 C6, then little-endian offsets to the
  // embedded PostScript. Live incident 2026-09-03: these were rejected as
  // "unknown" and blocked paying customers.
  if (
    buffer[0] === 0xc5 &&
    buffer[1] === 0xd0 &&
    buffer[2] === 0xd3 &&
    buffer[3] === 0xc6
  ) {
    return 'application/postscript'
  }

  return null
}

/** If the file is a DOS EPS (binary preview header), extract the embedded
 *  PostScript segment to a sibling file and return its path; otherwise null.
 *  Ghostscript builds vary in how they treat the binary wrapper, so feeding
 *  the extracted pure PostScript is the deterministic path. */
export async function extractDosEpsPostScript(inputPath: string): Promise<string | null> {
  const header = Buffer.alloc(12)
  const fd = await fs.open(inputPath, 'r')
  try {
    await fd.read(header, 0, 12, 0)
    if (!(header[0] === 0xc5 && header[1] === 0xd0 && header[2] === 0xd3 && header[3] === 0xc6)) {
      return null
    }
    const psOffset = header.readUInt32LE(4)
    const psLength = header.readUInt32LE(8)
    const stats = await fs.stat(inputPath)
    if (psOffset <= 0 || psLength <= 0 || psOffset + psLength > stats.size) {
      console.warn('[Preflight] DOS EPS header offsets out of range; using file as-is')
      return null
    }
    const psBuffer = Buffer.alloc(psLength)
    await fd.read(psBuffer, 0, psLength, psOffset)
    const extractedPath = `${inputPath}.extracted.eps`
    await fs.writeFile(extractedPath, psBuffer)
    console.log(`[Preflight] DOS EPS detected; extracted ${psLength} bytes of PostScript`)
    return extractedPath
  } finally {
    await fd.close()
  }
}


export async function getImageInfo(filePath: string): Promise<{
  width: number
  height: number
  dpi: number
  dpiSource?: string | null
  colorspace: string
  hasAlpha: boolean
  format: string
} & Partial<MeasuredImageInfo>> {
  const detectedType = await detectFileType(filePath)
  const nativeInfo = detectedType
    ? await getImageInfoWithoutImagemagick(filePath, detectedType).catch(() => null)
    : null

  if (
    nativeInfo &&
    nativeInfo.width > 0 &&
    nativeInfo.height > 0 &&
    (detectedType === 'image/png' || detectedType === 'image/jpeg' || detectedType === 'image/webp')
  ) {
    return nativeInfo
  }

  try {

    const { stdout } = await execAsync(
      `identify -format "%w|%h|%x|%y|%U|%[colorspace]|%[channels]|%m" "${filePath}[0]"`
    )

    const parts = stdout.trim().split('|')
    const width = parseInt(parts[0]) || 0
    const height = parseInt(parts[1]) || 0
    const xDpi = parseFloat(parts[2]) || 0
    const yDpi = parseFloat(parts[3]) || 0
    const units = parts[4] || ''
    const colorspace = parts[5] || 'unknown'
    const channels = parts[6] || ''
    const format = parts[7] || 'unknown'

    const identifiedDpi = buildDpiCandidate(
      xDpi,
      yDpi,
      units,
      'imagemagick_density',
      60
    )
    const nativeDpi = nativeInfo && nativeInfo.dpi > 0 ? nativeInfo.dpi : 0
    // If the format-native parser found dimensions but no document DPI, do not
    // promote ImageMagick's density into document metadata. For PNG/JPEG/etc.
    // ImageMagick may report a synthetic/default density for files that do not
    // actually contain pHYs/JFIF/Exif resolution data.
    const canUseIdentifiedDpi = !nativeInfo || nativeDpi > 0
    const dpi = nativeDpi || (canUseIdentifiedDpi ? identifiedDpi?.dpi || 0 : 0)
    const dpiSource =
      nativeDpi > 0
        ? nativeInfo?.dpiSource || 'document_dpi'
        : canUseIdentifiedDpi
          ? identifiedDpi?.source || null
          : null


    const hasAlpha =
      channels.toLowerCase().includes('a') || channels.toLowerCase().includes('alpha')

    return {
      width: nativeInfo?.width || width,
      height: nativeInfo?.height || height,
      dpi,
      dpiSource,
      colorspace,
      hasAlpha: nativeInfo?.hasAlpha != null ? nativeInfo.hasAlpha : hasAlpha,
      format,
    }
  } catch (error) {
    console.error('[Preflight] ImageMagick identify failed:', error)

    if (detectedType) {
      const fallbackInfo = await getImageInfoWithoutImagemagick(filePath, detectedType)
      if (fallbackInfo && fallbackInfo.width > 0 && fallbackInfo.height > 0) {
        console.warn('[Preflight] Falling back to native image metadata parser:', detectedType)
        return fallbackInfo
      }
    }

    throw new Error('Failed to analyze image')
  }
}

async function getTrimmedImageBounds(
  filePath: string,
  imageInfo: Pick<MeasuredImageInfo, 'width' | 'height' | 'hasAlpha'>
): Promise<{
  trimmedWidth: number
  trimmedHeight: number
  trimmedOffsetX: number
  trimmedOffsetY: number
  measurementMode: 'trimmed' | 'full'
}> {
  if (!imageInfo.hasAlpha) {
    return {
      trimmedWidth: imageInfo.width,
      trimmedHeight: imageInfo.height,
      trimmedOffsetX: 0,
      trimmedOffsetY: 0,
      measurementMode: 'full',
    }
  }

  try {
    const { stdout } = await execAsync(
      `convert "${filePath}[0]" -alpha extract -auto-level -threshold 0 -trim -format "%@" info:`
    )
    const bounds = stdout.trim().match(/^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/)
    const trimmedWidth = bounds ? parseInt(bounds[1], 10) : 0
    const trimmedHeight = bounds ? parseInt(bounds[2], 10) : 0
    const trimmedOffsetX = bounds ? parseInt(bounds[3], 10) : 0
    const trimmedOffsetY = bounds ? parseInt(bounds[4], 10) : 0

    if (trimmedWidth > 0 && trimmedHeight > 0) {
      return {
        trimmedWidth,
        trimmedHeight,
        trimmedOffsetX: Math.max(0, trimmedOffsetX),
        trimmedOffsetY: Math.max(0, trimmedOffsetY),
        measurementMode:
          trimmedWidth !== imageInfo.width || trimmedHeight !== imageInfo.height ? 'trimmed' : 'full',
      }
    }
  } catch (error) {
    console.warn('[Preflight] Transparent trim analysis failed:', error)
  }

  return {
    trimmedWidth: imageInfo.width,
    trimmedHeight: imageInfo.height,
    trimmedOffsetX: 0,
    trimmedOffsetY: 0,
    measurementMode: 'full',
  }
}


export async function getPdfInfo(filePath: string): Promise<{
  pages: number
  width: number
  height: number
}> {
  try {

    const { stdout } = await execAsync(`pdfinfo "${filePath}"`)

    const pagesMatch = stdout.match(/Pages:\s+(\d+)/)
    const sizeMatch = stdout.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)/)

    const pages = pagesMatch ? parseInt(pagesMatch[1]) : 1

    const width = sizeMatch ? Math.round((parseFloat(sizeMatch[1]) * 300) / 72) : 0
    const height = sizeMatch ? Math.round((parseFloat(sizeMatch[2]) * 300) / 72) : 0

    return { pages, width, height }
  } catch (error) {
    console.error('[Preflight] pdfinfo failed:', error)
    return { pages: 1, width: 0, height: 0 }
  }
}




export async function convertPdfToPng(
  inputPath: string,
  outputPath: string,
  dpi: number = 300
): Promise<void> {

  const commands = [

    `gs -dSAFER -dBATCH -dNOPAUSE -dNOCACHE -dNOPLATFONTS -dPARANOIDSAFER -sDEVICE=png16m -r${dpi} -dFirstPage=1 -dLastPage=1 -dMaxBitmap=500000000 -dBufferSpace=1000000 -sOutputFile="${outputPath}" "${inputPath}"`,

    `gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -dFirstPage=1 -dLastPage=1 -sOutputFile="${outputPath}" "${inputPath}"`,

    `convert -density 150 "${inputPath}[0]" -colorspace sRGB -flatten -quality 90 "${outputPath}"`,
  ]

  let lastError: Error | null = null

  for (const cmd of commands) {
    try {

      await execAsync(cmd)

      const stats = await fs.stat(outputPath).catch(() => null)
      if (stats && stats.size > 100) {
        console.log('[Preflight] PDF conversion successful with command:', cmd.substring(0, 50))
        return
      }
    } catch (error) {
      console.warn('[Preflight] PDF conversion attempt failed:', (error as Error).message)
      lastError = error as Error
    }
  }

  console.error('[Preflight] All PDF conversion methods failed')
  throw lastError || new Error('PDF conversion failed')
}


export async function getPdfPageCount(inputPath: string): Promise<number> {
  const cmd = `gs -q -dNODISPLAY -c "(${inputPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}) (r) file runpdfbegin pdfpagecount = quit"`

  try {

    const { stdout } = await execAsync(cmd)
    const pageCount = parseInt(stdout.trim(), 10)
    return isNaN(pageCount) ? 1 : pageCount
  } catch (error) {

    try {
      const { stdout } = await execAsync(`pdfinfo "${inputPath}" | grep Pages`)
      const match = stdout.match(/Pages:\s*(\d+)/)
      return match ? parseInt(match[1], 10) : 1
    } catch {
      console.warn('[Preflight] Could not determine PDF page count, assuming 1')
      return 1
    }
  }
}


export async function convertEpsToPng(
  inputPath: string,
  outputPath: string,
  dpi: number = 300
): Promise<void> {
  // DOS EPS (binary preview wrapper): hand ghostscript the pure PostScript.
  const extracted = await extractDosEpsPostScript(inputPath).catch((err) => {
    console.warn('[Preflight] DOS EPS extraction failed, using original file:', err)
    return null
  })
  if (extracted) inputPath = extracted

  const commands = [

    `gs -dSAFER -dBATCH -dNOPAUSE -dNOCACHE -dNOPLATFONTS -dPARANOIDSAFER -sDEVICE=png16m -r${dpi} -dEPSCrop -dMaxBitmap=500000000 -dBufferSpace=1000000 -sOutputFile="${outputPath}" "${inputPath}"`,

    `gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -dFirstPage=1 -dLastPage=1 -sOutputFile="${outputPath}" "${inputPath}"`,

    `convert -density 150 "${inputPath}[0]" -colorspace sRGB -flatten -quality 90 "${outputPath}"`,
  ]

  let lastError: Error | null = null

  for (const cmd of commands) {
    try {

      await execAsync(cmd)

      const stats = await fs.stat(outputPath).catch(() => null)
      if (stats && stats.size > 100) {
        console.log('[Preflight] AI/EPS conversion successful with command:', cmd.substring(0, 50))
        return
      }
    } catch (error) {
      console.warn('[Preflight] AI/EPS conversion attempt failed:', (error as Error).message)
      lastError = error as Error
    }
  }

  console.error('[Preflight] All AI/EPS conversion methods failed')
  throw lastError || new Error('EPS/AI conversion failed')
}



export async function convertTiffToPng(inputPath: string, outputPath: string): Promise<void> {

  const cmd = `convert "${inputPath}[0]" -colorspace sRGB -flatten -quality 100 "${outputPath}"`

  try {

    await execAsync(cmd)
  } catch (error) {
    console.error('[Preflight] TIFF conversion failed:', error)
    throw new Error('TIFF conversion failed')
  }
}



export async function convertPsdToPng(inputPath: string, outputPath: string): Promise<void> {


  const cmd = `convert "${inputPath}[0]" -colorspace sRGB -flatten -quality 100 "${outputPath}"`

  try {

    await execAsync(cmd)
  } catch (error) {
    console.error('[Preflight] PSD conversion failed:', error)
    throw new Error('PSD conversion failed')
  }
}


export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  maxSize: number = 400
): Promise<void> {
  const cmd = `convert "${inputPath}[0]" -thumbnail ${maxSize}x${maxSize}\\> -quality 85 "${outputPath}"`

  try {

    await execAsync(cmd)

    const stats = await fs.stat(outputPath).catch(() => null)
    if (!stats || stats.size < 100) {
      throw new Error('Thumbnail file is empty or too small')
    }
  } catch (error) {
    console.error('[Preflight] Thumbnail generation failed:', error)


    try {
      console.log('[Preflight] Creating fallback placeholder thumbnail with file format label')

      const ext = path.extname(inputPath).toLowerCase().replace('.', '').toUpperCase() || 'FILE'
      const fallbackCmd = `convert -size ${maxSize}x${maxSize} xc:#f3f4f6 -gravity center -pointsize 64 -fill "#6b7280" -font "DejaVu-Sans-Bold" -annotate 0 "${ext}" -quality 85 "${outputPath}"`
      await execAsync(fallbackCmd)
      console.log('[Preflight] Fallback thumbnail created successfully with label:', ext)
      return
    } catch (fallbackError) {
      console.error('[Preflight] Fallback thumbnail also failed:', fallbackError)
    }

    throw new Error('Thumbnail generation failed')
  }
}


export async function runPreflightChecks(
  filePath: string,
  mimeType: string,
  fileSize: number,
  config: PreflightConfig
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = []
  let overall: 'ok' | 'warning' | 'error' = 'ok'


  const sizeMB = fileSize / (1024 * 1024)
  if (sizeMB > config.maxFileSizeMB) {
    checks.push({
      name: 'fileSize',
      status: 'error',
      value: sizeMB.toFixed(2),
      message: `File size (${sizeMB.toFixed(2)}MB) exceeds limit (${config.maxFileSizeMB}MB)`,
    })
    overall = 'error'
  } else {
    checks.push({
      name: 'fileSize',
      status: 'ok',
      value: sizeMB.toFixed(2),
      message: `File size: ${sizeMB.toFixed(2)}MB`,
    })
  }


  const detectedType = await detectFileType(filePath)



  const psdTypes = ['image/vnd.adobe.photoshop', 'application/x-photoshop', 'image/x-psd']
  const isPsd = psdTypes.includes(detectedType || '')
  const isPsdAllowed = psdTypes.some((t) => config.allowedFormats.includes(t))

  const isFormatAllowed =
    detectedType && (config.allowedFormats.includes(detectedType) || (isPsd && isPsdAllowed))

  if (!detectedType || !isFormatAllowed) {
    checks.push({
      name: 'format',
      status: 'error',
      value: detectedType || 'unknown',
      message: `Unsupported file format: ${detectedType || 'unknown'}`,
    })
    overall = 'error'
    return { overall, checks }
  }
  checks.push({
    name: 'format',
    status: 'ok',
    value: detectedType,
    message: `Format: ${detectedType}`,
  })


  if (detectedType === 'application/pdf') {
    const pdfInfo = await getPdfInfo(filePath)

    if (pdfInfo.pages > config.maxPages) {
      checks.push({
        name: 'pageCount',
        status: 'error',
        value: pdfInfo.pages,
        message: `PDF has ${pdfInfo.pages} pages (max: ${config.maxPages})`,
      })
      overall = 'error'
    } else if (pdfInfo.pages > 1) {
      checks.push({
        name: 'pageCount',
        status: 'warning',
        value: pdfInfo.pages,
        message: `PDF has ${pdfInfo.pages} pages. Only first page will be used.`,
      })
      if (overall === 'ok') overall = 'warning'
    } else {
      checks.push({
        name: 'pageCount',
        status: 'ok',
        value: 1,
        message: 'Single page PDF',
      })
    }
  }


  try {
    const imageInfo = await getImageInfo(filePath)
    const trimmedBounds = await getTrimmedImageBounds(filePath, imageInfo)
    const measurementWidth = imageInfo.width
    const measurementHeight = imageInfo.height








    const sheetWidthIn =
      typeof config.sheetWidthIn === 'number' && config.sheetWidthIn > 0
        ? config.sheetWidthIn
        : DEFAULT_SHEET_WIDTH_IN
    const sheetLengthIn =
      typeof config.sheetLengthIn === 'number' && config.sheetLengthIn > 0
        ? config.sheetLengthIn
        : undefined



    const shortSheetIn =
      sheetLengthIn !== undefined ? Math.min(sheetWidthIn, sheetLengthIn) : sheetWidthIn
    const shortSidePx = Math.min(measurementWidth, measurementHeight)
    const longSidePx = Math.max(measurementWidth, measurementHeight)
    const isPortrait = measurementHeight >= measurementWidth
    const longSideIn = shortSidePx > 0
      ? (longSidePx / shortSidePx) * shortSheetIn
      : shortSheetIn
    const widthIn = Number((isPortrait ? shortSheetIn : longSideIn).toFixed(2))
    const heightIn = Number((isPortrait ? longSideIn : shortSheetIn).toFixed(2))




    const effectiveDpi = shortSidePx > 0
      ? Math.round(shortSidePx / shortSheetIn)
      : 0
    const sizingSource = 'sheet_width_anchor'
    const sizingSourceDetail =
      imageInfo.dpi > 0
        ? `sheet_anchor (embedded_dpi=${imageInfo.dpi}, source=${imageInfo.dpiSource || 'unknown'})`
        : 'sheet_anchor (no_embedded_dpi)'


    if (effectiveDpi <= 0) {
      checks.push({
        name: 'dpi',
        status: 'warning',
        value: effectiveDpi,
        message: 'Could not determine artwork resolution.',
        details: { source: sizingSourceDetail, sheetWidthIn },
      })
    } else if (effectiveDpi < config.requiredDPI) {
      checks.push({
        name: 'dpi',
        status: 'warning',
        value: effectiveDpi,
        message: `Effective print DPI is ${effectiveDpi} (recommended ${config.requiredDPI}). Print may appear pixelated at full size.`,
        details: { source: sizingSourceDetail, sheetWidthIn },
      })
      if (overall === 'ok') overall = 'warning'
    } else {
      checks.push({
        name: 'dpi',
        status: 'ok',
        value: effectiveDpi,
        message: `Effective print DPI: ${effectiveDpi}`,
        details: { source: sizingSourceDetail, sheetWidthIn },
      })
    }


    checks.push({
      name: 'dimensions',
      status: 'ok',
      value: `${imageInfo.width}x${imageInfo.height}`,
      message: `Dimensions: ${imageInfo.width} x ${imageInfo.height} px (${widthIn}" x ${heightIn}")`,
      details: {
        width: imageInfo.width,
        height: imageInfo.height,
        trimmedWidth: trimmedBounds.trimmedWidth,
        trimmedHeight: trimmedBounds.trimmedHeight,
        trimmedOffsetX: trimmedBounds.trimmedOffsetX,
        trimmedOffsetY: trimmedBounds.trimmedOffsetY,
        measurementWidth,
        measurementHeight,
        documentDpi: imageInfo.dpi,
        documentDpiSource: imageInfo.dpiSource || null,
        embeddedDpi: imageInfo.dpi,
        embeddedDpiSource: imageInfo.dpiSource || null,
        effectiveDpi,
        sizingSource,
        sizingSourceDetail,
        sheetWidthIn,
        sheetLengthIn,
        measurementMode: 'full',
        widthIn,
        heightIn,
      },
    })


    checks.push({
      name: 'transparency',
      status: imageInfo.hasAlpha ? 'ok' : 'warning',
      value: imageInfo.hasAlpha,
      message: imageInfo.hasAlpha ? 'Has transparency (alpha channel)' : 'No transparency detected',
    })
    if (!imageInfo.hasAlpha && config.requireTransparency && overall === 'ok') {
      overall = 'warning'
    }


    const goodColorspaces = ['sRGB', 'RGB', 'CMYK']
    const colorOk = goodColorspaces.some((cs) =>
      imageInfo.colorspace.toLowerCase().includes(cs.toLowerCase())
    )
    checks.push({
      name: 'colorProfile',
      status: colorOk ? 'ok' : 'warning',
      value: imageInfo.colorspace,
      message: `Color profile: ${imageInfo.colorspace}`,
    })
    if (!colorOk && overall === 'ok') overall = 'warning'
  } catch (error) {
    checks.push({
      name: 'imageAnalysis',
      status: 'error',
      message: 'Failed to analyze image properties',
    })
    overall = 'error'
  }

  return { overall, checks }
}
