# Upload Studio — finished-sheet measurement model

Date: 2026-09-17
Branch: `custom-container-upload-studio-app`
Status: implemented and verified locally; ready for owner review

This report covers only the finished-sheet measurement and pricing change. It replaces the
earlier broad report as the implementation handoff for this task; fee collection, provider
settlement, historical production evidence, and unrelated storefront products are outside
this document.

## The five-line model

1. A gang-sheet upload is a finished production file; the full uploaded canvas is measured.
2. Only the uploaded file is orientation-normalized: smaller dimension is width, larger is length.
3. Width must fit the merchant's maximum printable width; real overflow is rejected, never clamped.
4. Variant products use the smallest commercial variant length that covers the file; custom pricing uses measured length and rejects above its maximum.
5. Quantity is complete copies of that sheet; nothing is nested, combined, rearranged, or split.

## Merchant-visible settings

The product editor exposes exactly three measurement controls:

| Setting | Default | Where it applies | Meaning |
|---|---:|---|---|
| Maximum printable width | 22.5 in | Variant and custom pricing | Physical press limit for the normalized file width. The nominal 22 in a variant title is not a second width gate. |
| Maximum printable length | 240 in | Custom pricing | Longest custom-priced sheet accepted. It is rejected above this limit, not split. |
| Export rounding tolerance | 0.02 in | Width and length fit comparisons | Allowed range 0.01–0.03 in. It absorbs pixel/export drift only and never changes the measured or billed dimensions. |

If the seller has not saved these fields, the editor and runtime use the visible defaults
`22.5 / 240 / 0.02`. There is no invisible inset or price-affecting measurement number.

## Geometry and pricing truth

- Valid embedded document DPI remains the first source of inches. Without usable DPI, the
  existing Adobe 72 DPI interpretation is tried; full-sheet aspect-ratio/printable-width
  calibration supplies the fallback for large no-DPI sheets. Implausible DPI is ignored.
- Measurement retains four-decimal precision so the visible tolerance has a real boundary.
  Tolerance affects only fit. It does not silently rewrite 22.503 to 22.5.
- File orientation is internal measurement normalization. A file exported as 22×80 or
  80×22 has normalized width 22 and length 80. No image bytes are rotated.
- Shopify variant dimensions remain the merchant's commercial `width × length`. They are
  not normalized. The second configured dimension is length: `22 × 12` has 12 inches of
  length capacity, while `240 × 22` has 22 inches of length capacity.
- Consequently, a physical 22×12 upload normalizes to width 12 / length 22 and selects the
  22×24 commercial variant. A 22.3×78 upload fits a 22.5-inch press and selects 22×80.
- Variant pricing chooses the shortest available commercial length that covers the file.
  If no variant covers the length, the upload is rejected.
- Measured-length custom pricing has no sizing-variant ceiling. It bills the displayed
  per-sheet length rounded to 0.01 inch, multiplied by whole-sheet copies. Example:
  `237.994 → 237.99`; 500 copies bill `118,995` inches. This preserves live prices and makes
  the customer-visible arithmetic reproduce the charge.

## Removed runtime concepts

- `rollWidthIn` as a separate measurement setting; maximum printable width is canonical.
- `artboardMarginIn` and `imageMarginIn`; the entered maximum is already usable width.
- copies-per-sheet, grid fitting, copy spacing, and `ceil(quantity / designsPerSheet)` billing.
- rotation notes, rotation metafields, extra line properties, and byte-rotation instructions.
- retired “we arrange your designs” layout selection from the orderable runtime.

Historical fields may remain readable for audit or compatibility, but they do not decide a
new fit or price. The cart contract remains exactly three properties: `Print Ready`,
`Sheet Identity`, and `DPI`.

## What each person sees

### Customer

- The browser may show a provisional header estimate, but the server measurement controls
  whether the upload can be purchased.
- A width or custom-length failure names both the measured value and configured maximum.
- Variant choice and displayed price come from the same authoritative normalized file
  dimensions. Quantity always means complete sheet copies.
- A large file cannot silently fail into a cheaper variant, be clamped, or be split.

### Merchant

- The product editor shows all three numbers used by measurement; there is no hidden margin.
- Cart preparation re-resolves the authoritative upload and returns the canonical variant,
  quantity, and three line properties. Manual listing surfaces lock the selected commercial
  variant rather than silently substituting one.
- Admin/order/identity surfaces use the stored server measurement and whole-sheet quantity.

### Production

- Production receives the uploaded source file as supplied and prints it once per requested
  copy. Orientation normalization is metadata, not an instruction to rotate or rearrange.
- Preview failure cannot replace the source file or authoritative dimensions. A missing or
  failed source remains non-orderable.

## Existing carts, orders, uploads, and products

- Existing placed orders are immutable. No historical order, price, quantity, upload, or
  production record is rewritten.
- Shopify cart lines that already exist are not silently rewritten: their variant, quantity,
  and price remain as added. A new add/re-add through a current upload surface is prepared
  under the finished-sheet rule and a physically invalid file fails closed.
- Existing measured uploads keep their source pixels, DPI evidence, object identity, and
  audit history. Current cart resolution applies the finished-sheet rule; legacy nesting
  facts are not silently reclassified as whole-sheet truth.
- Existing products without the three canonical fields materialize the visible
  `22.5 / 240 / 0.02` defaults. Hidden legacy maximum and margin values do not reprice them.
- Newly measured uploads use full-page finished-sheet semantics. Historical metadata stays
  readable but cannot resurrect trim-based pricing or nesting.

## Regression harness and approved price effects

The normal and strict historical comparison pass with zero unclassified differences.
Every changed price is labelled with its owner-approved business reason.

Production-derived fixtures:

| Case | Historical | Current | Reason |
|---|---:|---:|---|
| GREG, 22.26×237.05 | no fit | $120 / 22×240 | 22.26 fits the 22.5 press maximum; nominal variant width is not the press gate. |
| 21.26×11.73 | $6 / 22×12 | $12 / 22×24 | Uploaded file normalizes to 21.26 length; commercial variant length stays its second dimension. |
| 5×5, quantity 8 | $6 | $48 | Eight finished sheets are eight paid copies; no eight-up layout exists. |
| 10.99×11.99, quantity 10 | $30 | $60 | Ten finished sheets replace the old two-up assumption. |

Boundary canaries, explicitly synthetic rather than production evidence:

| Case | Historical | Current | Reason |
|---|---:|---:|---|
| 22.503×78 | no fit | $40 / 22×80 | Within the visible 0.02-inch tolerance above 22.5; measurement is not clamped. |
| 22.3×78 | no fit | $40 / 22×80 | Fits the 22.5 press and the 80-inch commercial length. |
| Custom 22.5×240.03 | $67.21 | rejected | Exceeds 240 + 0.02; custom sheets are not split. |

The 23.91×80 boundary remains rejected and now reports `WIDTH_TOO_LARGE`. Adobe-72
14.22×21.33 remains 22×24 at $12. Captured measured-length tier examples retain their
existing totals. Any future price difference outside these labelled cases fails the strict
gate as a regression.

## Verification status

- Measurement regression harness, normal mode: passed.
- Measurement regression harness, strict mode: passed; zero release-blocking or unclassified differences.
- Focused measurement suite: **8 files, 105 tests passed**.
- Changed storefront JavaScript syntax checks: passed.
- TypeScript: repository-wide check still reports only unrelated diagnostics already present on the baseline; no new diagnostic was attributed to this task.
- `git diff --check`: passed for the focused changes.
- Production build: passed. The verification build disabled Sentry upload and telemetry, so it created no Sentry release or source-map upload.
- Changes are recorded as logical local commits whose bodies explain the finished-sheet business rule; their hashes are listed in the handoff.

## Release boundary

Nothing was pushed or deployed. No container was restarted. No production database, queue,
billing row, Stripe object, Shopify object, tenant setting, upload, or order was mutated.
Before deployment, compare real files before/after on one canary shop, including exact
dimensions, selected variant or custom inches, customer total, cart quantity, identity/admin
facts, and production source. Stop on any price movement not already labelled above.
