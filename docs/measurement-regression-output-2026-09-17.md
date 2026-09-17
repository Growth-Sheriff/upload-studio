# Upload Studio measurement regression output

Date: 2026-09-17
Status: comparison integrity passed; strict release gate passed; no unclassified regression

## Reproduction

    npm.cmd run measurement:regression
    npm.cmd run measurement:regression -- --fail-on-regression

- Sanitized fixtures replay read-only upload metadata and captured Shopify product/config
  snapshots from alphaprint and dtfprinthouse.
- Baseline code: `d8470f5bca9ab182ca1b9d6b635d89ee7c7a5075`.
- Verified working-tree source fingerprint: `sha256:919c7c19a38de0a1`.
- All 11 cases matched their full previous/current goldens.
- Normal and strict runs both exited 0.
- Focused measurement tests: 7 files, 72 tests, all passed.

The comparison implements the final business rule: normalize only the uploaded file so its
short edge is printable width and its long edge is billable length. The merchant's variant
remains stored width × length, so `22 × 12` has 12 inches of length capacity. Product
`printableWidthIn` is the sole cross-roll limit; a nominal `22` in the variant title is not
a second hidden width limit. Quantity is complete-sheet copies and never layouts-per-sheet.

Historical `artboardMarginIn` and `imageMarginIn` values remain in the captured fixtures as
evidence, but current runtime resolution ignores them. No placement, rotation, tolerance or
production instruction is emitted in any current result.

## Numeric comparison

| Case | Baseline | Current | Price effect | Classification |
|---|---|---|---:|---|
| GREG, 22.26 × 237.05, Alpha legacy printable width 22.5 | No fit | 22 × 240, one sheet | now $120 | Intentional rule correction: printable width is the sole width gate |
| Order #43232 long, 21.98 × 237.99 | 22 × 240 | 22 × 240 | $120 → $120 | Same |
| Order #43232 normalized, 21.14 × 23.91 | 22 × 24 | 22 × 24 | $30 → $30 | Same |
| Short orientation case, 11.73 × 21.26 normalized | 22 × 12 | 22 × 24 | $6 → $12 | Intentional rule correction: long edge is billable length |
| Eight-copy 5 × 5 case | 8-up on one 22 × 12 | eight complete 22 × 12 sheets | $6 → $48 | Owner-approved nesting removal |
| Ten-copy 10.99 × 11.99 case | two-up, five sheets | ten complete sheets | $30 → $60 | Owner-approved nesting removal |
| Adobe-default 14.22 × 21.33 | 22 × 24 | 22 × 24 | $12 → $12 | Same |
| DTFPH 22 × 63.96, two copies | two 22 × 72 sheets | two 22 × 72 sheets | $63.36 → $63.36 | Same |
| Measured length, 89.67 inches × 2 | 179.34 billable inches | 179.34 billable inches | $50.22 → $50.22 | Same price; public sheet count corrected to 2 |
| Measured length, 89.67 inches × 3 | 269.01 billable inches | 269.01 billable inches | $59.18 → $59.18 | Same tier and price; sheet count corrected to 3 |
| Measured length, 89.67 inches × 6 | 538.02 billable inches | 538.02 billable inches | $107.60 → $107.60 | Same tier and price; sheet count corrected to 6 |

## Explicit price differences

The harness contains no silent price difference. Four sheet cases intentionally change:

1. GREG becomes orderable at $120 because 22.26 inches fits the existing product's effective
   22.5-inch printable width and the 240-inch variant covers its 237.05-inch length.
2. The 21.26 × 11.73 case becomes $12 because normalization makes 21.26 the billable length;
   the 12-inch variant cannot cover it and the 24-inch variant can.
3. Eight copies of a 5 × 5 finished sheet become eight paid sheets: $6 → $48.
4. Ten copies of a 10.99 × 11.99 finished sheet become ten paid sheets: $30 → $60.

The last two are the approved removal of a nonexistent ganging/layout service. All captured
measured-length totals and tier boundaries are unchanged.

## Bounded authority

This is a resolver/measurement comparison, not a complete billing proof:

- The 4% fee and $6 cap, payment eligibility, hosted checkout, refunds, customer eligibility,
  multi-upload aggregation and provider settlement are outside this harness.
- Shopify variants are reconstructed from the captured snapshots and treated as available.
- The fixture covers captured Alpha and DTFPH products, not every tenant or every numeric
  boundary.
- A fresh read-only product/config snapshot is required before deployment canarying; no
  production state was changed to produce this artifact.
