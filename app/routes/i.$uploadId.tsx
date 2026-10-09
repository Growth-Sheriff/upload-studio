// Public design identity page: /i/<uploadId> (HTML) and /i/<uploadId>.json.
//
// This link is written into cart line properties as `Design Identity` and is
// the durable, human- and machine-readable carrier of everything that used to
// travel as two dozen `_ul_*` line properties. Truth lives in the DB; this
// page is a projection of it.
//
// Access model: the uploadId is an unguessable cuid that the customer already
// holds (it is embedded in their own cart/order line). The page intentionally
// exposes no PII — no customer name/email, no address — only design-file
// facts the customer submitted themselves.

import type { LoaderFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { getRuntimeMeasurementBasis } from '~/lib/customerPricingModel.server'
import { getIdentifier, rateLimitGuard } from '~/lib/rateLimit.server'
import {
  applyMeasurementBasisMetadata,
  deriveUploadItemLifecycle,
  getStoredMeasurementBasis,
} from '~/lib/uploadLifecycle.server'
import {
  buildFileUrl,
  buildIdentityUrl,
  buildThumbnailUrl,
  storageConfigForShop,
} from '~/lib/uploadUrls.server'
import { corsJson } from '~/lib/cors.server'
import { bindUploadCapability } from '~/lib/uploadCapability.server'
import { shopifyGraphQL } from '~/lib/shopify.server'
import {
  deriveUploadQuantityFacts,
  hasUploadOrderHistory,
} from '~/lib/uploadQuantitySemantics'

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

async function buildReorderUrl(
  shop: { shopDomain: string; accessToken: string | null },
  productId: string | null,
  uploadId: string
): Promise<string | null> {
  if (!productId || !shop.accessToken) return null
  const gid = String(productId).startsWith('gid://') ? String(productId) : `gid://shopify/Product/${productId}`
  try {
    const data = await shopifyGraphQL<{ product: { handle: string; onlineStoreUrl: string | null } | null }>(
      shop.shopDomain,
      shop.accessToken,
      `query ReorderProduct($id: ID!) { product(id: $id) { handle onlineStoreUrl } }`,
      { id: gid }
    )
    const product = data.product
    if (!product?.handle) return null
    const base = product.onlineStoreUrl || `https://${shop.shopDomain}/products/${product.handle}`
    const url = new URL(base)
    url.searchParams.set('ul_reorder', uploadId)
    return url.toString()
  } catch (error) {
    console.warn('[Identity] reorder link unavailable:', error instanceof Error ? error.message : error)
    return null
  }
}

function formatInches(value: number | null | undefined): string {
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return '—'
  return Math.abs(n - Math.round(n)) < 0.01 ? `${Math.round(n)}"` : `${n.toFixed(2)}"`
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const identifier = getIdentifier(request, 'customer')
  const rateLimitResponse = await rateLimitGuard(identifier, 'adminApi')
  if (rateLimitResponse) return rateLimitResponse

  const rawId = params.uploadId || ''
  const wantsJson = rawId.endsWith('.json')
  const uploadId = wantsJson ? rawId.slice(0, -'.json'.length) : rawId

  if (!uploadId || !/^[A-Za-z0-9_-]{8,40}$/.test(uploadId)) {
    return new Response('Not found', { status: 404 })
  }

  if (!bindUploadCapability(uploadId, new URL(request.url).searchParams.get('token'))) {
    return new Response('Not found', { status: 404 })
  }
  // The verified capability binds the owner before any tenant data is read.
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    include: {
      shop: {
        select: {
          shopDomain: true,
          storageProvider: true,
          storageConfig: true,
          accessToken: true,
          settings: true,
        },
      },
      items: {
        select: {
          id: true,
          location: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          storageKey: true,
          thumbnailKey: true,
          preflightStatus: true,
          preflightResult: true,
        },
      },
      ordersLink: {
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!upload) {
    return new Response('Not found', { status: 404 })
  }

  const storageConfig = storageConfigForShop(upload.shop)
  const runtimeMeasurementBasis = getRuntimeMeasurementBasis(
    upload.shop.shopDomain,
    upload.shop.settings
  )

  const items = upload.items.map((item) => {
    const lifecycle = deriveUploadItemLifecycle({
      preflightStatus: item.preflightStatus,
      preflightResult: item.preflightResult,
      thumbnailKey: item.thumbnailKey,
    })
    const metadata = applyMeasurementBasisMetadata(
      lifecycle.metadata,
      getStoredMeasurementBasis(item.preflightResult, runtimeMeasurementBasis)
    )
    const firstDimensionIn = Number(metadata?.widthIn || 0)
    const secondDimensionIn = Number(metadata?.heightIn || 0)
    return {
      itemId: item.id,
      fileName: item.originalName || 'design-file',
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      location: item.location,
      widthIn: firstDimensionIn,
      heightIn: secondDimensionIn,
      printableWidthIn:
        firstDimensionIn > 0 && secondDimensionIn > 0
          ? Math.min(firstDimensionIn, secondDimensionIn)
          : 0,
      measuredSheetLengthIn:
        firstDimensionIn > 0 && secondDimensionIn > 0
          ? Math.max(firstDimensionIn, secondDimensionIn)
          : 0,
      dpi: metadata?.documentDpi || metadata?.dpi || 0,
      effectiveDpi: metadata?.effectiveDpi || 0,
      preflightStatus: item.preflightStatus,
      fileUrl: buildFileUrl(storageConfig, item.storageKey),
      thumbnailUrl: buildThumbnailUrl(storageConfig, item.thumbnailKey),
    }
  })

  const quantity = deriveUploadQuantityFacts(upload)
  // An ordered upload is immutable evidence of what was sold. Reusing the row
  // would make current sizing/quantity rules rewrite that history, so only an
  // upload with no order history can be restored as a pending cart design.
  const reorderUrl =
    quantity.semantics === 'whole_sheet' && !hasUploadOrderHistory(upload)
      ? await buildReorderUrl(upload.shop, upload.productId, upload.id)
      : null

  const payload = {
    uploadId: upload.id,
    identityUrl: buildIdentityUrl(upload.id),
    reorderUrl,
    shopDomain: upload.shop.shopDomain,
    mode: upload.mode,
    status: upload.status,
    productId: upload.productId,
    variantId: upload.variantId,
    orderId: upload.orderId,
    orderName: upload.orderName,
    quantitySemantics: quantity.semantics,
    wholeSheetCopies: quantity.wholeSheetCopies,
    selectedSheetLabel:
      quantity.semantics === 'whole_sheet' ? upload.cartSheetLabel : null,
    legacyAudit:
      quantity.semantics === 'legacy_nesting'
        ? {
            requestedDesigns: quantity.requestedCopies,
            designsPerSheet: quantity.designsPerSheet,
            physicalSheets: quantity.physicalSheets,
            storedSheetLabel: upload.cartSheetLabel,
          }
        : null,
    createdAt: upload.createdAt,
    items,
  }
  const copiesBadge =
    quantity.semantics === 'whole_sheet' && quantity.wholeSheetCopies
      ? `<span class="badge badge-copies">${escapeHtml(quantity.wholeSheetCopies)} whole-sheet cop${quantity.wholeSheetCopies === 1 ? 'y' : 'ies'}` +
        (upload.cartSheetLabel ? ` · ${escapeHtml(upload.cartSheetLabel)}` : '') +
        '</span>'
      : quantity.semantics === 'legacy_nesting'
        ? `<span class="badge badge-history">Historical layout record · ${escapeHtml(quantity.requestedCopies || '—')} requested design${quantity.requestedCopies === 1 ? '' : 's'} · ${escapeHtml(quantity.designsPerSheet || '—')}/sheet · ${escapeHtml(quantity.physicalSheets || '—')} physical sheet${quantity.physicalSheets === 1 ? '' : 's'}` +
          (upload.cartSheetLabel ? ` · stored label: ${escapeHtml(upload.cartSheetLabel)}` : '') +
          '</span>'
        : '<span class="badge badge-history">Historical quantity meaning was not recorded</span>'

  if (wantsJson) {
    return corsJson(payload, request, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const rows = items
    .map(
      (item) => `
      <section class="item">
        ${item.thumbnailUrl ? `<img src="${escapeHtml(item.thumbnailUrl)}" alt="Design preview" loading="lazy" />` : '<div class="thumb-fallback">No preview</div>'}
        <div class="facts">
          <h2>${escapeHtml(item.fileName)}</h2>
          <dl>
            <div><dt>Printable width</dt><dd>${formatInches(item.printableWidthIn)}</dd></div>
            <div><dt>Measured sheet length</dt><dd>${formatInches(item.measuredSheetLengthIn)}</dd></div>
            <div><dt>DPI</dt><dd>${item.dpi ? escapeHtml(item.dpi) : '—'}${item.effectiveDpi ? ` (effective ${escapeHtml(item.effectiveDpi)})` : ''}</dd></div>
            <div><dt>File type</dt><dd>${escapeHtml(item.mimeType || '—')}</dd></div>
            <div><dt>Preflight</dt><dd class="status status-${escapeHtml(item.preflightStatus)}">${escapeHtml(item.preflightStatus)}</dd></div>
          </dl>
          ${item.fileUrl ? `<a class="download" href="${escapeHtml(item.fileUrl)}" rel="noopener">Download file</a>` : ''}
        </div>
      </section>`
    )
    .join('\n')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Design ${escapeHtml(upload.id.slice(-8))} — Upload Studio</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; background: #f5f7fa; color: #1f2937; padding: 24px; }
  main { max-width: 720px; margin: 0 auto; }
  header.page { margin-bottom: 20px; }
  header.page h1 { font-size: 20px; }
  header.page p { color: #6b7280; font-size: 13px; margin-top: 4px; word-break: break-all; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #e0e7ff; color: #3730a3; margin-top: 8px; margin-right: 6px; }
  .badge-copies { background: #fff3d6; color: #7a4d00; }
  .badge-history { background: #f3f4f6; color: #4b5563; border-radius: 8px; }
  .item { display: flex; gap: 16px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .item img, .thumb-fallback { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; flex-shrink: 0; }
  .thumb-fallback { display: flex; align-items: center; justify-content: center; background: #f3f4f6; color: #9ca3af; font-size: 11px; }
  .facts { min-width: 0; flex: 1; }
  .facts h2 { font-size: 15px; word-break: break-all; margin-bottom: 8px; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
  dl div { display: flex; gap: 6px; font-size: 13px; }
  dt { color: #6b7280; }
  dd { font-weight: 600; }
  .status-ok { color: #15803d; }
  .status-error { color: #b91c1c; }
  .status-warning { color: #a16207; }
  .download { display: inline-block; margin-top: 10px; font-size: 13px; font-weight: 600; color: #1d4ed8; text-decoration: none; }
  .download:hover { text-decoration: underline; }
  .reorder { display: inline-block; margin-top: 4px; padding: 10px 18px; border-radius: 10px; background: #1d4ed8; color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; }
  .reorder:hover { background: #1e40af; }
  footer { color: #9ca3af; font-size: 12px; margin-top: 20px; }
</style>
</head>
<body>
<main>
  <header class="page">
    <h1>Design identity</h1>
    <p>Reference: ${escapeHtml(upload.id)}</p>
    <span class="badge">${escapeHtml(upload.mode)} · ${escapeHtml(upload.status)}</span>
    ${
      upload.orderName
        ? `<span class="badge">Order ${escapeHtml(upload.orderName)}</span>`
        : upload.orderId
          ? '<span class="badge">Linked to an order</span>'
          : ''
    }
    ${copiesBadge}
  </header>
  ${rows || '<p>No files attached to this design yet.</p>'}
  ${reorderUrl ? `<a class="reorder" href="${escapeHtml(reorderUrl)}">Order this design again</a>` : ''}
  <footer>Created ${escapeHtml(upload.createdAt.toISOString().slice(0, 10))} · ${escapeHtml(upload.shop.shopDomain)} · <a href="${escapeHtml(buildIdentityUrl(upload.id, true))}">JSON</a></footer>
</main>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}
