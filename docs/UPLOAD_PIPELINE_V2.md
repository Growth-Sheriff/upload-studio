# Upload pipeline v2 — instant preview, resumable transfer, instant re-order

Scope: the main product upload block (`extensions/theme-extension/blocks/main-product-upload-app.liquid`)
and the upload APIs it calls. Nothing here changes cart identity, order matching or billing
(see `CART_IDENTITY_ARCHITECTURE.md`).

## Step 1 — Instant preview (size / sheet / price before the upload lands)

| Piece | Where |
|---|---|
| Header probe (PNG, JPEG, TIFF, PSD, PDF, EPS incl. DOS-wrapped, SVG) | `extensions/theme-extension/assets/ul-file-probe.js` (`window.ULFileProbe.probe(file)`) |
| Unit tests for the parsers | `app/lib/ulFileProbe.test.ts` |
| Shared resolver (single implementation for provisional and authoritative answers) | `app/lib/sheetResolution.server.ts` (`resolveForMetadata`, `metadataFromProbe`) |
| Provisional endpoint | `POST /api/upload/resolve-preview` — body `{ shopDomain, productId, widthPx, heightPx, dpi, dpiSource, quantity, selectedVariantId, customer…, measurementPolicy, rollWidthIn, maxUploadWidth }` |
| Authoritative endpoint (unchanged contract, now a thin wrapper) | `POST /api/upload/resolve-product` |

Widget behaviour (`main-product-upload-app.js`):

- `probeAndPreview(file)` reads at most the first/last 1 MB, fills the inspector with the
  probed size/DPI, and calls `resolve-preview` for the sheet + price. Everything it sets is
  flagged `state.provisional = true`; labels show `(est.)` / `Estimated · confirming`.
- Provisional items are **never** cart-ready (`isCartReadyItem` returns false while
  `provisional`), so only the server-measured size can produce a cart line.
- When the status poll returns the server measurement, the provisional resolution is
  discarded and `resolve-product` runs exactly as before.
- `metadataFromProbe` marks `sizingSource = 'client_probe'`; the same measurement policy
  (`applyMainProductMeasurementPolicy`, roll width, sheet anchoring) is applied to it, so
  provisional and final answers only differ when the server's pixel measurement differs
  from the header (e.g. transparent-trim, DPI fallback).

## Step 2 — Resumable, faster transfer

| Piece | Where |
|---|---|
| Content fingerprint `v1-<size>-<sha256(first1MB+last1MB)>` | `ul-file-probe.js` (`fingerprint(file)`) |
| Resume endpoint | `POST /api/upload/multipart-resume` — body `{ shopDomain, uploadId, key, multipartUploadId, totalParts }` → `{ uploadedParts:[{partNumber,etag}], parts:[{partNumber,url}] (missing only), completeUrl, abortUrl }`; `410 MULTIPART_GONE` when R2 no longer has the upload |
| R2 helpers | `listR2MultipartParts`, `presignR2MultipartParts` in `app/lib/storage.server.ts` |
| Client session store | `localStorage` key `umpMp:<shop>:<product>:<fingerprint>` → `{ uploadId, itemId, key, multipartUploadId, partSize, totalParts, publicUrl, fileName, fileSize, parts:{n:etag}, savedAt }` (24 h TTL) |
| Uploader | `ul-multipart-uploader.js` — concurrency 6 (was 4), `onPartDone(partNumber, etag)`, `resume` option, no auto-abort on failure (parts stay on R2), 403 = expired URL → resumable error |

Flow in `startUpload`:

1. Probe + fingerprint run concurrently (≤ 2 MB read).
2. If a session exists for the fingerprint → `multipart-resume`. On success the widget
   builds an intent from the session and uploads only the missing parts (progress starts at
   the resumed byte count; status text says how many chunks were already on the server).
   On 410 / any failure the session is cleared and a fresh intent is requested.
3. Fresh intent sends `fingerprint` and a `partSizeMb` hint (8 / 16 / 32 MB by file size;
   server clamps 5–64 MB). The intent stores the fingerprint on `UploadItem.fingerprint`.
4. Mid-transfer interruption: up to two in-place resumes (fresh URLs), then single-shot
   fallback only for files ≤ 256 MB; larger files keep their session and the customer is told
   to drop the same file again to resume.
5. Session cleared on multipart completion.

Server env: `MULTIPART_THRESHOLD_MB=16` on the canary (default was 100) so multipart +
resume covers everything above 16 MB.

## Step 3 — Instant re-upload / re-order

| Piece | Where |
|---|---|
| Dedupe on intent | `api.upload.intent.tsx`: same shop, same product, same customer (or visitor), same fingerprint, item preflight ok/warning, ≤ 30 days → `{ deduplicated: true, uploadId, itemId }`; zero bytes sent. Guests without identity never dedupe. |
| Widget handling | `startUpload` skips transfer and goes straight to `pollStatus` → `resolve-product`. |
| Reorder link | Identity page `/i/<uploadId>` renders **Order this design again** → `<product online store URL>?ul_reorder=<uploadId>` (handle resolved via Admin GraphQL). |
| Widget restore | `restoreReorderFromUrl()` reads `ul_reorder`, verifies via the status API (orderable, measured), resolves the product, and puts the design in the ready queue. |
| Copies stepper | `[data-ump-copies]` in the inspector → `requestedCopies` → `resolve-product` `quantity` → `designsPerSheet` / `sheetsNeeded` summary and `×N` in the price table. |
| Rotation hint | Shown in the status text when the design is wider than the roll but fits rotated. |

## Schema

`UploadItem.fingerprint String? @map("fingerprint")` + `@@index([fingerprint])`
(`prisma/add_cart_token.sql` carries the additive SQL for tenants applied by hand).

## Deliberately not done (evidence)

- Background removal / upscaling toggles: no `REMOVE_BG_API_KEY` on the canary, no upscale
  endpoint exists.
- Service-worker / Background Fetch: not available to theme app extensions.
- Server-side processing of partial multipart data: R2 cannot read an in-progress multipart
  object.
- S3 vs R2 throughput benchmark: needs a test bucket + credentials.
