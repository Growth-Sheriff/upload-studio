// Preflight check utilities
import { exec } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)
const PRODUCTION_DPI = 300

function parsePngInfo(buffer: Buffer) {
  if (buffer.length < 24) return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  let dpi = 72
  let hasAlpha = false

  const colorType = buffer[25]
  hasAlpha = colorType === 4 || colorType === 6

  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8)
    const dataOffset = offset + 8

    if (chunkType === 'pHYs' && dataOffset + 9 <= buffer.length) {
      const pixelsPerUnitX = buffer.readUInt32BE(dataOffset)
      const pixelsPerUnitY = buffer.readUInt32BE(dataOffset + 4)
      const unitSpecifier = buffer[dataOffset + 8]
      if (unitSpecifier === 1 && pixelsPerUnitX > 0 && pixelsPerUnitY > 0) {
        const dpiX = pixelsPerUnitX * 0.0254
        const dpiY = pixelsPerUnitY * 0.0254
        dpi = Math.round((dpiX + dpiY) / 2)
      }
    }

    offset += 12 + length
    if (chunkType === 'IEND') break
  }

  return {
    width,
    height,
    dpi,
    colorspace: 'sRGB',
    hasAlpha,
    format: 'PNG',
  }
}

function parseJpegInfo(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let dpi = 72
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

    if (marker === 0xe0 && buffer.toString('ascii', offset + 4, offset + 9) === 'JFIF\0') {
      const units = buffer[offset + 11]
      const xDensity = buffer.readUInt16BE(offset + 12)
      const yDensity = buffer.readUInt16BE(offset + 14)
      if (units === 1 && xDensity > 0 && yDensity > 0) {
        dpi = Math.round((xDensity + yDensity) / 2)
      } else if (units === 2 && xDensity > 0 && yDensity > 0) {
        dpi = Math.round(((xDensity * 2.54) + (yDensity * 2.54)) / 2)
      }
    }

    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = buffer.readUInt16BE(offset + 5)
      const width = buffer.readUInt16BE(offset + 7)
      return {
        width,
        height,
        dpi,
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

  const chunkType = buffer.toString('ascii', 12, 16)
  if (chunkType === 'VP8 ') {
    const width = buffer.readUInt16LE(26) & 0x3fff
    const height = buffer.readUInt16LE(28) & 0x3fff
    return { width, height, dpi: 72, colorspace: 'sRGB', hasAlpha: false, format: 'WEBP' }
  }

  if (chunkType === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    const alpha = (bits >> 28) & 0x1
    return { width, height, dpi: 72, colorspace: 'sRGB', hasAlpha: alpha === 1, format: 'WEBP' }
  }

  if (chunkType === 'VP8X' && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3)
    const height = 1 + buffer.readUIntLE(27, 3)
    const flags = buffer[20]
    return {
      width,
      height,
      dpi: 72,
      colorspace: 'sRGB',
      hasAlpha: (flags & 0x10) !== 0,
      format: 'WEBP',
    }
  }

  return null
}

function parseSvgLength(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) return fallback
  const numeric = parseFloat(rawValue)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback
}

async function getImageInfoWithoutImagemagick(filePath: string, mimeType: string) {
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
      colorspace: 'sRGB',
      hasAlpha: true,
      format: 'SVG',
    }
  }

  return null
}

// Preflight check result types
export interface PreflightCheck {
  name: string
  status: 'ok' | 'warning' | 'error'
  value?: string | number
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
  colorspace: string
  hasAlpha: boolean
  format: string
  trimmedWidth?: number
  trimmedHeight?: number
  effectiveDpi?: number
  measurementWidth?: number
  measurementHeight?: number
  measurementMode?: 'trimmed' | 'full'
}

// Plan-based configuration
export interface PreflightConfig {
  maxFileSizeMB: number
  minDPI: number
  requiredDPI: number
  maxPages: number
  allowedFormats: string[]
  requireTransparency: boolean
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

// Magic bytes for file type detection
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

// Detect file type from magic bytes
export async function detectFileType(filePath: string): Promise<string | null> {
  const buffer = Buffer.alloc(16)
  const fd = await fs.open(filePath, 'r')
  await fd.read(buffer, 0, 16, 0)
  await fd.close()

  for (const [mimeType, magic] of Object.entries(MAGIC_BYTES)) {
    if (buffer.subarray(0, magic.length).equals(magic)) {
      // Normalize TIFF big-endian to standard TIFF MIME type
      if (mimeType === 'image/tiff-be') {
        return 'image/tiff'
      }
      return mimeType
    }
  }

  // Check for SVG (might start with <svg instead of <?xml)
  const start = buffer.toString('utf8', 0, 4)
  if (start === '<svg' || start === '<?xm') {
    return 'image/svg+xml'
  }

  // Check for AI/EPS (PostScript)
  if (buffer.toString('utf8', 0, 2) === '%!') {
    return 'application/postscript'
  }

  return null
}

// Get image info using ImageMagick identify
export async function getImageInfo(filePath: string): Promise<{
  width: number
  height: number
  dpi: number
  colorspace: string
  hasAlpha: boolean
  format: string
} & Partial<MeasuredImageInfo>> {
  const detectedType = await detectFileType(filePath)

  try {
    // v4.5.0: No timeout - large files (10GB+) need unlimited time
    const { stdout } = await execAsync(
      `identify -format "%w|%h|%x|%y|%[colorspace]|%[channels]|%m" "${filePath}[0]"`
    )

    const parts = stdout.trim().split('|')
    const width = parseInt(parts[0]) || 0
    const height = parseInt(parts[1]) || 0
    const xDpi = parseFloat(parts[2]) || 72
    const yDpi = parseFloat(parts[3]) || 72
    const colorspace = parts[4] || 'unknown'
    const channels = parts[5] || ''
    const format = parts[6] || 'unknown'

    // Average DPI
    const dpi = Math.round((xDpi + yDpi) / 2)

    // Check for alpha channel
    const hasAlpha =
      channels.toLowerCase().includes('a') || channels.toLowerCase().includes('alpha')

    return { width, height, dpi, colorspace, hasAlpha, format }
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
): Promise<{ trimmedWidth: number; trimmedHeight: number; measurementMode: 'trimmed' | 'full' }> {
  if (!imageInfo.hasAlpha) {
    return {
      trimmedWidth: imageInfo.width,
      trimmedHeight: imageInfo.height,
      measurementMode: 'full',
    }
  }

  try {
    const { stdout } = await execAsync(
      `convert "${filePath}[0]" -alpha extract -auto-level -threshold 0 -trim -format "%w|%h" info:`
    )
    const parts = stdout.trim().split('|')
    const trimmedWidth = parseInt(parts[0], 10)
    const trimmedHeight = parseInt(parts[1], 10)

    if (trimmedWidth > 0 && trimmedHeight > 0) {
      return {
        trimmedWidth,
        trimmedHeight,
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
    measurementMode: 'full',
  }
}

// Get PDF info using pdfinfo
export async function getPdfInfo(filePath: string): Promise<{
  pages: number
  width: number
  height: number
}> {
  try {
    // v4.5.0: No timeout for PDF info extraction
    const { stdout } = await execAsync(`pdfinfo "${filePath}"`)

    const pagesMatch = stdout.match(/Pages:\s+(\d+)/)
    const sizeMatch = stdout.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)/)

    const pages = pagesMatch ? parseInt(pagesMatch[1]) : 1
    // PDF points to pixels (72 dpi base)
    const width = sizeMatch ? Math.round((parseFloat(sizeMatch[1]) * 300) / 72) : 0
    const height = sizeMatch ? Math.round((parseFloat(sizeMatch[2]) * 300) / 72) : 0

    return { pages, width, height }
  } catch (error) {
    console.error('[Preflight] pdfinfo failed:', error)
    return { pages: 1, width: 0, height: 0 }
  }
}

// Convert PDF to PNG using Ghostscript
// Security: -dSAFER prevents file system access, -dNOCACHE prevents disk caching
// -dNOPLATFONTS disables platform font access, -dSANDBOX enables full sandbox mode
export async function convertPdfToPng(
  inputPath: string,
  outputPath: string,
  dpi: number = 300
): Promise<void> {
  // Try multiple approaches for better PDF compatibility
  const commands = [
    // Standard high-quality conversion
    `gs -dSAFER -dBATCH -dNOPAUSE -dNOCACHE -dNOPLATFONTS -dPARANOIDSAFER -sDEVICE=png16m -r${dpi} -dFirstPage=1 -dLastPage=1 -dMaxBitmap=500000000 -dBufferSpace=1000000 -sOutputFile="${outputPath}" "${inputPath}"`,
    // Fallback: Lower DPI for problematic PDFs
    `gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -dFirstPage=1 -dLastPage=1 -sOutputFile="${outputPath}" "${inputPath}"`,
    // Last resort: Use ImageMagick with density
    `convert -density 150 "${inputPath}[0]" -colorspace sRGB -flatten -quality 90 "${outputPath}"`,
  ]

  let lastError: Error | null = null

  for (const cmd of commands) {
    try {
      // v4.5.0: No timeout - large PDF files need unlimited time
      await execAsync(cmd)
      // Verify the output file exists and is valid
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

// Get PDF page count using Ghostscript
export async function getPdfPageCount(inputPath: string): Promise<number> {
  const cmd = `gs -q -dNODISPLAY -c "(${inputPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}) (r) file runpdfbegin pdfpagecount = quit"`

  try {
    // v4.5.0: No timeout - large files need unlimited time
    const { stdout } = await execAsync(cmd)
    const pageCount = parseInt(stdout.trim(), 10)
    return isNaN(pageCount) ? 1 : pageCount
  } catch (error) {
    // Fallback: try with pdfinfo if available
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

// Convert AI/EPS to PNG using Ghostscript
export async function convertEpsToPng(
  inputPath: string,
  outputPath: string,
  dpi: number = 300
): Promise<void> {
  // Try multiple approaches for better AI/EPS compatibility
  const commands = [
    // Standard EPS conversion with crop
    `gs -dSAFER -dBATCH -dNOPAUSE -dNOCACHE -dNOPLATFONTS -dPARANOIDSAFER -sDEVICE=png16m -r${dpi} -dEPSCrop -dMaxBitmap=500000000 -dBufferSpace=1000000 -sOutputFile="${outputPath}" "${inputPath}"`,
    // Fallback: Without EPS crop (for AI files that are PDF-based)
    `gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -dFirstPage=1 -dLastPage=1 -sOutputFile="${outputPath}" "${inputPath}"`,
    // Last resort: ImageMagick (works for many AI files)
    `convert -density 150 "${inputPath}[0]" -colorspace sRGB -flatten -quality 90 "${outputPath}"`,
  ]

  let lastError: Error | null = null

  for (const cmd of commands) {
    try {
      // v4.5.0: No timeout - AI/EPS files need unlimited time
      await execAsync(cmd)
      // Verify the output file exists and is valid
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

// Convert TIFF to PNG using ImageMagick
// ImageMagick handles all TIFF variants (LZW, ZIP, uncompressed, CMYK, etc.)
export async function convertTiffToPng(inputPath: string, outputPath: string): Promise<void> {
  // Use [0] to get first page/layer, -colorspace sRGB to convert CMYK if needed
  const cmd = `convert "${inputPath}[0]" -colorspace sRGB -flatten -quality 100 "${outputPath}"`

  try {
    // v4.5.0: No timeout - large TIFF files need unlimited time
    await execAsync(cmd)
  } catch (error) {
    console.error('[Preflight] TIFF conversion failed:', error)
    throw new Error('TIFF conversion failed')
  }
}

// Convert PSD to PNG using ImageMagick
// ImageMagick's PSD support handles layers, CMYK, 16-bit depth, etc.
export async function convertPsdToPng(inputPath: string, outputPath: string): Promise<void> {
  // [0] gets the flattened composite, -flatten merges transparency
  // -colorspace sRGB handles CMYK to RGB conversion
  const cmd = `convert "${inputPath}[0]" -colorspace sRGB -flatten -quality 100 "${outputPath}"`

  try {
    // v4.5.0: No timeout - large PSD files (10GB+) need unlimited time
    await execAsync(cmd)
  } catch (error) {
    console.error('[Preflight] PSD conversion failed:', error)
    throw new Error('PSD conversion failed')
  }
}

// Generate WebP thumbnail
export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  maxSize: number = 400
): Promise<void> {
  const cmd = `convert "${inputPath}[0]" -thumbnail ${maxSize}x${maxSize}\\> -quality 85 "${outputPath}"`

  try {
    // v4.5.0: No timeout - thumbnail generation needs time for large files
    await execAsync(cmd)
    // Verify thumbnail was created and is valid
    const stats = await fs.stat(outputPath).catch(() => null)
    if (!stats || stats.size < 100) {
      throw new Error('Thumbnail file is empty or too small')
    }
  } catch (error) {
    console.error('[Preflight] Thumbnail generation failed:', error)

    // v4.5.0: Create a fallback placeholder thumbnail with file format label
    try {
      console.log('[Preflight] Creating fallback placeholder thumbnail with file format label')
      // Detect file type label for better user experience
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

// Run all preflight checks
export async function runPreflightChecks(
  filePath: string,
  mimeType: string,
  fileSize: number,
  config: PreflightConfig
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = []
  let overall: 'ok' | 'warning' | 'error' = 'ok'

  // 1. File size check
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

  // 2. Format check (magic bytes)
  const detectedType = await detectFileType(filePath)

  // Check if detected type or its alternatives are allowed
  // PSD can have multiple MIME types, check all variants
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

  // 3. PDF-specific checks
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

  // 4. Image info checks (DPI, dimensions, transparency, color)
  try {
    const imageInfo = await getImageInfo(filePath)
    const trimmedBounds = await getTrimmedImageBounds(filePath, imageInfo)
    const effectiveDpi = PRODUCTION_DPI
    const measurementWidth = trimmedBounds.trimmedWidth > 0 ? trimmedBounds.trimmedWidth : imageInfo.width
    const measurementHeight =
      trimmedBounds.trimmedHeight > 0 ? trimmedBounds.trimmedHeight : imageInfo.height

    // DPI check
    if (imageInfo.dpi <= 0) {
      checks.push({
        name: 'dpi',
        status: 'warning',
        value: imageInfo.dpi,
        message: `Embedded DPI metadata is missing. Production sizing uses ${effectiveDpi} DPI.`,
      })
    } else if (imageInfo.dpi < config.requiredDPI) {
      checks.push({
        name: 'dpi',
        status: 'warning',
        value: imageInfo.dpi,
        message: `Embedded DPI (${imageInfo.dpi}) is below recommended (${config.requiredDPI}). Production sizing uses ${effectiveDpi} DPI.`,
      })
      if (overall === 'ok') overall = 'warning'
    } else {
      checks.push({
        name: 'dpi',
        status: 'ok',
        value: imageInfo.dpi,
        message: `DPI: ${imageInfo.dpi}`,
      })
    }

    // Dimensions check
    checks.push({
      name: 'dimensions',
      status: 'ok',
      value: `${imageInfo.width}x${imageInfo.height}`,
      message: `Dimensions: ${imageInfo.width} x ${imageInfo.height} px`,
      details: {
        width: imageInfo.width,
        height: imageInfo.height,
        trimmedWidth: trimmedBounds.trimmedWidth,
        trimmedHeight: trimmedBounds.trimmedHeight,
        measurementWidth,
        measurementHeight,
        effectiveDpi,
        measurementMode: trimmedBounds.measurementMode,
        widthIn: Number((measurementWidth / effectiveDpi).toFixed(2)),
        heightIn: Number((measurementHeight / effectiveDpi).toFixed(2)),
      },
    })

    // Transparency check
    checks.push({
      name: 'transparency',
      status: imageInfo.hasAlpha ? 'ok' : 'warning',
      value: imageInfo.hasAlpha,
      message: imageInfo.hasAlpha ? 'Has transparency (alpha channel)' : 'No transparency detected',
    })
    if (!imageInfo.hasAlpha && config.requireTransparency && overall === 'ok') {
      overall = 'warning'
    }

    // Color profile check
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
