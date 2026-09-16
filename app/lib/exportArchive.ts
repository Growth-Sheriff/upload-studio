export function safeArchiveSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '_')
  return sanitized || 'unknown'
}

export function getExportItemFileName(
  location: string,
  originalName: string | null | undefined,
  itemId: string
): string {
  const extensionMatch = String(originalName || '').match(/\.([A-Za-z0-9]{1,10})$/)
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'bin'
  return `${safeArchiveSegment(location)}_design_${safeArchiveSegment(itemId)}.${extension}`
}

export function getMissingExportUploadIds(requestedIds: string[], foundIds: string[]): string[] {
  const found = new Set(foundIds)
  return Array.from(new Set(requestedIds)).filter((id) => !found.has(id))
}

export function getEmptyExportUploadIds(
  uploads: ReadonlyArray<{ id: string; items: ReadonlyArray<unknown> }>
): string[] {
  return uploads.filter((upload) => upload.items.length === 0).map((upload) => upload.id)
}

export function getExportUploadFolder(
  orderId: string,
  uploadId: string,
  uploadsForOrder: number
): string {
  const orderFolder = `order_${safeArchiveSegment(orderId).slice(-8)}`
  if (uploadsForOrder <= 1) return orderFolder
  return `${orderFolder}/upload_${safeArchiveSegment(uploadId)}`
}
