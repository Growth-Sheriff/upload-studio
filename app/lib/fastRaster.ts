const PNG_EXTENSIONS = new Set(['png'])
const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg'])

function extensionFromName(value: unknown): string {
  const name = String(value || '')
    .trim()
    .toLowerCase()
  const match = name.match(/\.([a-z0-9]+)$/)
  return match ? match[1] : ''
}

/**
 * PNG and JPEG are the only formats whose production measurement can be
 * established from a bounded header read. The stored bytes are still checked
 * before this hint is allowed to become authoritative.
 */
export function isFastRasterUpload(input: {
  mimeType?: unknown
  originalName?: unknown
}): boolean {
  const mimeType = String(input.mimeType || '')
    .trim()
    .toLowerCase()
  if (
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg'
  ) {
    return true
  }

  if (mimeType && mimeType !== 'application/octet-stream') return false
  const extension = extensionFromName(input.originalName)
  return PNG_EXTENSIONS.has(extension) || JPEG_EXTENSIONS.has(extension)
}
