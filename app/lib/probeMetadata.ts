import { validateFinishedSheetFit } from './finishedSheetMeasurement'
import type { UploadLifecycleMetadata } from './uploadLifecycle.server'

// Kept free of the Remix `~` alias and of Shopify/Prisma imports: the upload
// workers run through tsx and reach this module via the stored-header check.

const ADOBE_DEFAULT_DPI = 72

/** Metadata shape for dimensions the browser probed from file headers.
 *  Mirrors the server's no-DPI rule (uploadLifecycle.resolveBestDimensions):
 *  embedded DPI wins; otherwise Adobe's 72 DPI when the short edge fits the
 *  printable press width; otherwise inches stay 0 and the measurement policy
 *  anchors to that width so the estimate lands on the server's numbers. */
export function metadataFromProbe(probe: {
  widthPx: number
  heightPx: number
  dpi?: number | null
  dpiSource?: string | null
  maxPrintableWidthIn: number
  fitToleranceIn: number
}): UploadLifecycleMetadata {
  const widthPx = Math.max(0, Math.round(Number(probe.widthPx) || 0))
  const heightPx = Math.max(0, Math.round(Number(probe.heightPx) || 0))
  const rawDocumentDpi = Number(probe.dpi)
  // Keep the provisional header path on the same validity rule as preflight:
  // a density at or below 1 DPI, or above 10,000 DPI, is not document truth.
  const documentDpi =
    Number.isFinite(rawDocumentDpi) && rawDocumentDpi > 1 && rawDocumentDpi <= 10_000
      ? rawDocumentDpi
      : 0
  const maxPrintableWidthIn = Number(probe.maxPrintableWidthIn)

  let dpi = documentDpi
  let sizingSource = 'document_dpi'
  if (!(dpi > 0)) {
    const shortEdgeIn = Math.min(widthPx, heightPx) / ADOBE_DEFAULT_DPI
    if (
      validateFinishedSheetFit({
        widthIn: shortEdgeIn,
        heightIn: Math.max(widthPx, heightPx) / ADOBE_DEFAULT_DPI,
        maxPrintableWidthIn,
        fitToleranceIn: probe.fitToleranceIn,
      }).ok
    ) {
      dpi = ADOBE_DEFAULT_DPI
      sizingSource = 'adobe_default_dpi'
    } else {
      sizingSource = 'client_probe'
    }
  }

  return {
    widthPx,
    heightPx,
    dpi,
    documentDpi: documentDpi || undefined,
    documentDpiSource: documentDpi > 0 ? probe.dpiSource || null : null,
    trimmedWidthPx: widthPx,
    trimmedHeightPx: heightPx,
    trimmedOffsetXPx: 0,
    trimmedOffsetYPx: 0,
    measurementWidthPx: widthPx,
    measurementHeightPx: heightPx,
    effectiveDpi: dpi,
    sizingSource,
    widthIn: dpi > 0 ? Number((widthPx / dpi).toFixed(4)) : 0,
    heightIn: dpi > 0 ? Number((heightPx / dpi).toFixed(4)) : 0,
    measurementMode: 'full',
  } as UploadLifecycleMetadata
}
