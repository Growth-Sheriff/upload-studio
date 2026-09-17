# Upload Studio measurement regression output

Date: 2026-09-17
Status: deterministic comparison passed; four known regressions require owner approval

## Reproduction

    npm.cmd run measurement:regression
    npm.cmd run measurement:regression -- --fail-on-regression

- Fixture source: sanitized read-only upload rows plus read-only Shopify product/config
  snapshots from alphaprint and dtfprinthouse.
- Previous code: d8470f5bca9ab182ca1b9d6b635d89ee7c7a5075.
- Current code: a253fc947096fd3cadc09dde5e83a1b89b9dc279.
- Executed-source fingerprint: sha256:7074b144ccb2f6ea. It covers the current
  loader's transitive source closure, package manifest, pnpm lockfile, harness and fixture.
- Two consecutive JSON payloads exited 0 and were byte-identical; after removing the
  CLI's single trailing newline, payload SHA-256 was
  c8616b5e03c8c375cf789ee901a67ef8caecdfc11d3a4439f64b6435929d9794. Literal stdout
  (37,994 bytes) SHA-256 was
  a357ada6deac4c53dfc0f44a442abf5ae9f92159d0cde5ec0c5d5c4386cd65cd.
- All 11 cases matched full 13-field previous/current goldens.
- Strict mode exited 2 because four rows are explicitly classified as regressions.

Sheet finalPrice below is captured Shopify retail variant price × selected sheet count.
Measured-length finalPrice is this upload's captured tier quote. The 4%/$6 hosted fee,
customer eligibility, multi-upload tier aggregation and payment collection are outside
this resolver harness.

For baseline measured-length rows, sheetsNeeded is the old resolve-product carrier-inch
field. Baseline quote/checkout still used the requested physical copy quantity; the large
180/270/539 values were not the customer charge.

## Numeric comparison

| Case | Version | widthIn | heightIn | effectiveDpi | chosen variant | designs/sheet | sheetsNeeded | finalPrice |
|---|---|---:|---:|---:|---|---:|---:|---:|
| alpha-greg-475mp | previous | 22.26 | 237.05 | 299.9994 | no fit | — | — | — |
| alpha-greg-475mp | current | 22.26 | 237.05 | 299.9994 | no fit | — | — | — |
| alpha-order-43232-long | previous | 237.99 | 21.98 | 299.9994 | 22" / 240" | 1 | 1 | $120.00 |
| alpha-order-43232-long | current | 237.99 | 21.98 | 299.9994 | no fit | — | — | — |
| alpha-order-43232-rotated | previous | 23.91 | 21.14 | 299.9994 | 22" / 24" | 1 | 1 | $30.00 |
| alpha-order-43232-rotated | current | 23.91 | 21.14 | 299.9994 | 22" / 36" | 1 | 1 | $45.00 |
| alpha-short-sheet-orientation | previous | 21.26 | 11.73 | 299.9994 | 22" / 12" | 1 | 1 | $6.00 |
| alpha-short-sheet-orientation | current | 21.26 | 11.73 | 299.9994 | 22" / 12" | 1 | 1 | $6.00 |
| alpha-eight-up | previous | 5.00 | 5.00 | 299.9994 | 22" / 12" | 8 | 1 | $6.00 |
| alpha-eight-up | current | 5.00 | 5.00 | 299.9994 | 22" / 12" | 8 | 1 | $6.00 |
| alpha-margin-reprice | previous | 10.99 | 11.99 | 291.9984 | 22" / 12" | 2 | 5 | $30.00 |
| alpha-margin-reprice | current | 10.99 | 11.99 | 291.9984 | 22" / 12" | 1 | 10 | $60.00 |
| alpha-adobe-72 | previous | 14.22 | 21.33 | 72 | 22" / 24" | 1 | 1 | $12.00 |
| alpha-adobe-72 | current | 14.22 | 21.33 | 72 | 22" / 24" | 1 | 1 | $12.00 |
| dtfph-two-copies | previous | 22.00 | 63.96 | 299.9994 | 22"x72" | 1 | 2 | $63.36 |
| dtfph-two-copies | current | 22.00 | 63.96 | 299.9994 | 22"x72" | 1 | 2 | $63.36 |
| alpha-linear-copy-scenario | previous | 22.25 | 89.67 | 299.9994 | (22" X 1") | 1 | 180 | $50.22 |
| alpha-linear-copy-scenario | current | 22.25 | 89.67 | 299.9994 | (22" X 1") | 1 | 2 | $50.22 |
| alpha-linear-tier-250-canary | previous | 22.25 | 89.67 | 299.9994 | (22" X 1") | 1 | 270 | $59.18 |
| alpha-linear-tier-250-canary | current | 22.25 | 89.67 | 299.9994 | (22" X 1") | 1 | 3 | $59.18 |
| alpha-linear-tier-500-canary | previous | 22.25 | 89.67 | 299.9994 | (22" X 1") | 1 | 539 | $107.60 |
| alpha-linear-tier-500-canary | current | 22.25 | 89.67 | 299.9994 | (22" X 1") | 1 | 6 | $107.60 |

## Pricing and production details

| Case | Version | billable inches | rate/tier | placement | production instruction |
|---|---|---:|---|---|---|
| alpha-order-43232-rotated | previous | — | retail sheet | not persisted | — |
| alpha-order-43232-rotated | current | — | retail sheet | rotated | Rotate artwork 90° |
| alpha-short-sheet-orientation | previous | — | retail sheet | not persisted | — |
| alpha-short-sheet-orientation | current | — | retail sheet | rotated | Rotate artwork 90° |
| alpha-eight-up | previous | — | retail sheet | not persisted | — |
| alpha-eight-up | current | — | retail sheet | normal | — |
| alpha-margin-reprice | previous | — | retail sheet | not persisted | — |
| alpha-margin-reprice | current | — | retail sheet | normal | — |
| alpha-adobe-72 | previous | — | retail sheet | not persisted | — |
| alpha-adobe-72 | current | — | retail sheet | normal | — |
| dtfph-two-copies | previous | — | retail sheet | not persisted | — |
| dtfph-two-copies | current | — | retail sheet | normal | — |
| alpha-linear-copy-scenario | previous/current | 179.34 | $0.28; 1–249 | n/a | — |
| alpha-linear-tier-250-canary | previous/current | 269.01 | $0.22; 250–499 | n/a | — |
| alpha-linear-tier-500-canary | previous/current | 538.02 | $0.20; 500+ | n/a | — |

## Difference classification

| Case | Classification | Changed fields | Explanation |
|---|---|---|---|
| alpha-greg-475mp | same | none | Embedded DPI remains authoritative. It is 22.26" across and has no fit under the captured zero-tolerance Alpha configuration. |
| alpha-order-43232-long | regression | variant, designs/sheet, sheets, price | Activating stored 0.125" margins turns the historical 22×240 match into no fit because printable width is 21.75". Owner must decide media width versus printable width. |
| alpha-order-43232-rotated | regression | variant, price, placement/note | The same stored margins move 22×24/$30 to 22×36/$45. The explicit rotate instruction itself is intentional. |
| alpha-short-sheet-orientation | regression | placement/note | Price remains $6, disproving A1's silent-repricing claim on this live split product. Current short-edge convention says rotate even though Shopify names the first 22" option Transfer Width; changing it would also affect checkout validation and billable length. |
| alpha-eight-up | intended fix | placement fields | Eight copies still fit one 22×12 sheet at $6; current code explicitly records normal/no rotation. |
| alpha-margin-reprice | regression | nesting, sheets, price, placement fields | Stored margins reduce capacity from two to one, doubling five sheets/$30 to ten/$60. This is not approved for release. |
| alpha-adobe-72 | intended fix | placement fields | Both route-equivalent revisions produce 14.22×21.33 at Adobe 72 DPI and $12; current code only adds explicit placement metadata. |
| dtfph-two-copies | intended fix | placement fields | Dimensions, two sheets and $63.36 are unchanged; current code records normal/no rotation. |
| alpha-linear-copy-scenario | intended fix | resolver sheets field | Customer price remains $50.22. Current resolve-product reports two physical copies instead of 180 one-inch carrier units. |
| alpha-linear-tier-250-canary | intended fix | resolver sheets field | Three copies cross the captured 250" tier; both versions charge 269.01" × $0.22 = $59.18. |
| alpha-linear-tier-500-canary | intended fix | resolver sheets field | Six copies cross the captured 500" tier; both versions charge 538.02" × $0.20 = $107.60. |

## Bounded authority

This artifact is a resolver/measurement comparison, not an end-to-end billing proof:

- Measured-length tier selection is replayed from the captured live tier tuples; customer
  eligibility, precedence and multi-upload aggregation are not executed.
- Shopify variants are reconstructed from captured dimensional variants and treated as
  available; a future availability or service-option change needs a fresh snapshot.
- No real successful artwork_bounds row with a trim delta was found in the latest 500
  Alpha/customprintaz rows inspected, so that path is not represented.
- The sample does not cover every tenant, exact 249/250/499/500 rounding edge, or a genuine
  long-side cross-roll product.
- Use --fail-on-regression for a blocking canary/release check. A normal run validates
  deterministic goldens but deliberately reports known owner-gated regressions without
  hiding them.
