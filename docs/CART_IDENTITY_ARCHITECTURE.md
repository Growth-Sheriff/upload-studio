# Cart Identity Architecture

_Status: implemented 2026-08-28, not yet deployed._

## Problem

Cart line items used to carry ~25 `_ul_*` properties. Third-party cart apps
(e.g. DripApps' gang-sheet script) rewrite cart lines and can strip
properties; checkout permalinks drop them entirely. When `_ul_upload_id` was
lost, the orders webhook could not link the order to its files ("ghost
uploads"). Separately, `webhooks/app-uninstalled` deleted the whole Shop row
on uninstall, cascading away all data (fast-dtf-transfer incident,
2026-07-29).

## Doctrine ("invisible neighbor")

1. **Own stage** — the widget uses its own buttons, never the theme's
   `form[action$="/cart/add"]`. Buttons are marked `data-gs-event="click"`
   (DripApps skips such elements).
2. **Own namespace** — line properties never resemble other apps' matchers
   (no `_Print Ready*` keys, no zero-price placeholder lines).
3. **Own truth** — every fact lives in the DB. The cart carries references.

## Line property scheme (main upload flow)

| Property | Purpose |
|---|---|
| `Design File` | Direct download URL of the customer file |
| `Design Identity` | `https://<app>/i/<uploadId>` identity page |
| `_ul_upload_id` | Hidden transition carrier (until all readers migrate) |

`/i/<uploadId>` renders an HTML identity page (preview, measured size, DPI,
preflight state, download) and `/i/<uploadId>.json` the machine version.
Route: `app/routes/i.$uploadId.tsx`. No PII is exposed; ids are unguessable
cuids the customer already holds.

## Flow

1. Widget → `POST /api/cart/prepare` with uploadIds; the server builds the
   canonical properties (`app/routes/api.cart.prepare.tsx`). Client fallback
   builds the same carriers locally if the API is unreachable.
2. Widget adds lines with **verified idempotent mutations** (read `/cart.js`,
   add only the missing delta, re-read to confirm; bounded retries) —
   `ensureCartLine` in `main-product-upload-app.js`.
3. Widget → `POST /api/cart/bind` binding `uploadIds ↔ cart token`
   (`Upload.cartToken` column). `/cart.js` serves new-style tokens with a
   `?key=` suffix which `normalizeCartToken` strips (order payloads carry the
   bare token).
4. `webhooks/orders-create` resolves each line through
   `matchUploadFromLineItem` (`app/lib/orderMatching.server.ts`):
   `_ul_upload_id` / `_upload_id` → `Design Identity` URL → `Design File`
   URL path → any property value holding an identity URL. If a configured
   product's line has no carrier at all, the webhook falls back to
   `order.cart_token` → `Upload.cartToken` (variant-first candidate
   selection) before creating a ghost upload. Every link is audited with a
   `matchSource`.
5. After linking, the webhook mirrors `{uploadId, identityUrl, matchSource}`
   to the order metafield `upload_studio.uploads` (best-effort) so the
   relation also lives on Shopify's side.

## Uninstall lifecycle

`webhooks/app-uninstalled` now only marks the shop
(`billingStatus: "uninstalled"`, `settings.uninstalledAt`) — no deletion.
GDPR `shop/redact` (sent ~48h after uninstall unless reinstalled) remains the
single deletion path. `afterAuth` reactivates the shop and clears the marker
on reinstall.

## Readers migrated to the new carriers

- `extensions/theme-extension/assets/cart-upload-display.js` (cart page)
- `extensions/checkout-upload-display/src/CheckoutLineItem.jsx` (checkout)
- `webhooks/orders-create` (matching)

Still writing legacy-heavy attributes by design: the VIP/draft-order flow
(`api.vip.checkout.tsx` + `api.customer-pricing.workspace.tsx`) — draft-order
custom attributes are server-owned and have their own readers.

## Hardening round (2026-08-28, second pass)

- `webhooks/orders-paid` now resolves uploads through the same multi-source
  matcher, PLUS the OrderLink rows orders/create already resolved (covers
  cart_token-recovered lines the paid payload alone cannot see), PLUS
  multi-id VIP notes. Never downgrades: orders/create preserves an
  `approved` status when paid arrived first.
- **Foreign-app guard**: `isForeignAppLine` recognizes DripApps signatures
  (`_Print Ready File` / `_Print Ready` / `_Admin Edit` keys, values
  containing `dripappsserver.`). On shared products those order lines no
  longer create ghost "missing upload" records or charge commission; they
  are audited as `foreign_app_line_skipped`.
- VIP note parsing extracts EVERY upload id ("... for upload a, b"), not
  just the first.
- `Upload.orderName` stores the human order number (#1234); the identity
  page shows it instead of the internal numeric id.
- Checkout extension renders inline previews only for raster URLs
  (png/jpg/webp/gif) — PDF/PSD lines show name + links, no broken image.
- Widget fallback identity links are absolute
  (`https://<shop>/apps/customizer/i/<id>`), clickable from order admin.
- The Quick Upload modal snippet (app.settings generated) also writes an
  absolute `Design Identity` property. Note: merchants must re-copy the
  snippet into their theme to pick this up.

## Deletion checklist (later)

Remove `_ul_upload_id` from `api.cart.prepare` / `api.cart.add-custom` only
after audit logs show `matchSource` is never `property` for a full release
cycle (caller-first, deletion-last).
