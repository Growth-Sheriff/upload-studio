# Upload Studio measurement regression output

Date: 2026-09-17
Status: comparison integrity passed; strict release gate passed; zero unclassified price differences

## Reproduction

    npm.cmd run measurement:regression
    npm.cmd run measurement:regression -- --fail-on-regression

- Historical code: `d8470f5bca9ab182ca1b9d6b635d89ee7c7a5075`.
- Fixtures: captured, sanitized Alpha/DTF Print House product and upload facts, plus four
  explicitly labelled mathematical boundary canaries. Canary values are not production rows.
- Result: all 15 previous/current goldens passed; strict run exited 0.
- Release-blocking regressions: 0.

The harness now reports the business fact `wholeSheetCopies`; it does not reinterpret the
old measured-inch carrier quantity as a physical sheet count. Current resolution reads the
three visible settings (default maximum width `22.5`, custom maximum length `240`, tolerance
`0.02`) and ignores the captured hidden legacy maximum/margin values.

Only the uploaded file is orientation-normalized: its short edge is width and long edge is
length. Variant dimensions remain the merchant's commercial width × length; a `22 × 12`
variant therefore has 12 inches of length capacity, not 22.

## Observed rows and pricing

| Case | Historical | Current | Price effect | Classification |
|---|---|---|---:|---|
| GREG, 22.26 × 237.05 | no fit | 22 × 240, one copy | no quote → $120 | `approved_finished_sheet_rule` |
| Order #43232 long | 22 × 240 | 22 × 240 | $120 → $120 | measurement precision only |
| Order #43232 normalized | 22 × 24 | 22 × 24 | $30 → $30 | measurement precision only |
| 21.26 × 11.73 orientation case | 22 × 12 | 22 × 24 | $6 → $12 | `approved_finished_sheet_rule` |
| Eight-copy 5 × 5 case | one billed sheet | eight complete sheets | $6 → $48 | `approved_no_nesting` |
| Ten-copy 10.99 × 11.99 case | five billed sheets | ten complete sheets | $30 → $60 | `approved_no_nesting` |
| Adobe-72 14.22 × 21.33 | 22 × 24 | 22 × 24 | $12 → $12 | measurement precision only |
| DTFPH 22 × 63.96, quantity 2 | two 22 × 72 sheets | two 22 × 72 sheets | $63.36 → $63.36 | measurement precision only |
| Measured length 89.67 × 2 | 179.34 inches | 179.34 inches, two copies | $50.22 → $50.22 | same price |
| Measured length 89.67 × 3 | 269.01 inches | 269.01 inches, three copies | $59.18 → $59.18 | same tier and price |
| Measured length 89.67 × 6 | 538.02 inches | 538.02 inches, six copies | $107.60 → $107.60 | same tier and price |

## Boundary canaries

| Boundary | Verified result | Classification |
|---|---|---|
| 22.503 × 78, defaults 22.5 / 0.02 | accepted without clamping; selects synthetic 22 × 80 carrier | `approved_finished_sheet_rule` |
| 23.91 × 80, maximum 22.5 | rejected with `WIDTH_TOO_LARGE` | `approved_physical_rejection` |
| 22.3 × 78, maximum 22.5 | width is allowed; selects synthetic 22 × 80 carrier | `approved_finished_sheet_rule` |
| custom 22.5 × 240.03, max length 240 / tolerance 0.02 | rejected with `LENGTH_TOO_LARGE`; not split or priced | `approved_physical_rejection` |

The synthetic 22 × 80 carrier exists only to isolate the owner's exact boundary example.
It is named `boundary-canary`, uses an `.invalid` shop domain, and is not presented as
merchant or order evidence.

## Explicit price differences

No price difference is silent. The strict gate rejects every price difference whose fixture
is not explicitly one of:

- `approved_finished_sheet_rule`: previously approved width/orientation normalization;
- `approved_no_nesting`: quantity is complete uploaded-sheet copies;
- `approved_physical_rejection`: a width/length outside the visible physical limits is not
  priced.

In this run, observed production-derived price changes are GREG (no fit → $120), the
21.26-inch-long orientation case ($6 → $12), eight copies ($6 → $48), and ten copies
($30 → $60). Boundary
canaries additionally prove tolerance acceptance and the custom 240-inch rejection. There
are no unclassified price changes.

## Scope

This is a resolver/measurement comparison. It does not exercise customer eligibility,
multi-upload aggregation, the separate per-order app fee, provider settlement, or Shopify
availability changes. The captured historical margin/max fields are retained only as
evidence that current runtime ignores them. No production state was changed.
