# Upload Studio measurement review follow-up

Date: 2026-09-17
Branch: `custom-container-upload-studio-app`
Status: local review complete; nothing pushed or deployed

This document is the second-pass companion to
`docs/measurement-billing-correctness-report-2026-09-17.md`. It records the
verification of hypotheses A1-A6, the three changes that survived verification, the
deterministic comparison artifact, and the owner decisions that remain open.

## Executive result

- A1's stated live silent-repricing claim is **REJECTED** for every captured Alpha and
  DTF Print House product: no long-side-first configuration was found, and the targeted
  live 22 x 12 case remains $6 under both revisions. The current short-edge convention
  does change the rotation instruction, however, and the meaning of split Width/Height
  remains an owner-gated production contract.
- A2, A3 and A4 are **CONFIRMED and fixed locally** in separate commits: a deterministic
  regression harness now exists, preview workers no longer poll measurement while holding
  all concurrency slots, and every measurement-failure writer uses one projection builder.
- A5 is **CONFIRMED and not implemented**. Stripe sessions use the 24-hour default, the
  application does not handle `checkout.session.expired`, and the live endpoint inspected
  read-only was disabled and did not subscribe to that event. Expiry/release policy is a
  billing decision in Gate 11.
- A6 is **CONFIRMED; intentional no-change**. The 12 accepted commits have empty bodies.
  Their hashes were not rewritten after acceptance. The three new technical commits carry
  rationale and verification in their bodies, and the reports preserve the earlier chain's
  rationale.
- The strict harness is intentionally red: 11/11 golden comparisons are deterministic,
  but four rows are classified as owner-gated regressions. This branch is not a sizing or
  pricing release candidate until those rows are decided.

## A1-A6 verdicts

| Area | Verdict | What was verified | Concrete scenario and impact | Confidence; what would change the verdict |
|---|---|---|---|---|
| **A1. Sheet-orientation normalization may silently reprice live products** | **REJECTED** for the stated live repricing claim; residual policy is owner-gated | Current fit canonicalizes the sheet to short edge x long edge (`app/lib/dtfSheetResolver.server.ts:584-587`), tests normal, rotated and mixed placements (`:607-669`), and applies `maxSheetWidthIn` to the short edge (`:697-705`). Read-only snapshots contain Alpha DTF/UV split variants with Width=22 and DTF Print House combined variants beginning at 22; no long-side-first or genuine long-edge-cross-roll live variant was found (`scripts/measurement-regression-fixtures.json:18-117`). | The real 21.26 x 11.73 upload still selects 22 x 12, one design, one sheet and **$6 -> $6**. Current code calls it rotated because it treats 12 as cross-roll, while Shopify calls 22 “Transfer Width.” That instruction difference is a release-gated production semantic, not a reproduced price change. Squares are unchanged by normalization. | High for the captured products; incomplete fleet-wide. A read-only inventory showing a live long-side-first/genuine long-edge-cross-roll product, or a route-equivalent fixture where normalization alone changes variant/count/price, would change the verdict. |
| **A2. Numeric measurement regression evidence does not exist** | **CONFIRMED at review start; fixed locally** | `package.json:26` exposes the harness. It loads the immutable baseline from `git show`, executes each revision's dependency graph and lifecycle normalization, fingerprints the transitive inputs, and checks complete 13-field goldens (`scripts/measurement-regression-harness.ts:632-750`). `--fail-on-regression` is the blocking mode (`:755`). | `npm.cmd run measurement:regression` returns 0 when the deterministic goldens match. The strict command returns 2 today because four known differences are marked regressions; an unclassified or unexpected result returns 1. | High within the stated boundary. It would be weakened by an unhashed executed dependency, stale product snapshot, or a release path not represented by the fixture. It is not a substitute for checkout, eligibility, fee or production canaries. |
| **A3. In-process measurement waiting can starve preview rendering** | **CONFIRMED; fixed locally** | At accepted commit `694e282`, `waitForMeasurementResolution` queried every 500 ms for up to 20 s (`git show 694e282:workers/uploadPipeline.shared.ts`, lines 943-970), while preview concurrency was 3. The worker could also enqueue merge follow-ups. Current code reads once (`workers/uploadPipeline.shared.ts:943-963`), then uses a bounded compare-and-swap thumbnail handoff (`app/lib/uploadQueues.ts:58-95`, `workers/preview-render.worker.ts:543-621`). | Three rendered previews whose measurements remain pending could occupy all three old worker slots for approximately 20 s; an unrelated fourth preview could not start. Follow-up attempts could repeat the wait/decode path. Current helper-level concurrency test proves three pending reads do not prevent the fourth probe (`app/lib/uploadQueues.test.ts:77-101`). | High static/unit confidence; runtime confidence remains medium-high until a BullMQ/DB load test is run in a canary. A trace showing active preview slots still held by measurement waits or a repeated source decode would reopen it. |
| **A4. Four inline measurement-failure payloads can drift** | **CONFIRMED; fixed locally** | The old branches did differ in durable-preview truth: several treated stale JSON `preview.hasThumbnail=true` as equivalent to a real `thumbnailKey`, while another path used the key. The shared builder now owns retry/terminal shape (`app/lib/uploadQueueRecovery.ts:124-218`) and derives capability only from the durable key (`:55-72`). Processor retry, terminal catch, failed event and reconciler all call it (`workers/measure-preflight.worker.ts:364,402,512`; `workers/upload-pipeline-reconciler.ts:155`). | With a null `thumbnailKey` but stale JSON saying a thumbnail existed, an old failure path could advertise `capabilities.hasPreview=true`; another writer could say false or overwrite independently owned stage data. Tests now cover stale flags, placeholder evidence, retry and terminal convergence (`app/lib/uploadQueueRecovery.test.ts:101-287`). | High. Any failure writer found outside the builder, or an integration race persisting divergent shapes for the same state, would reopen it. |
| **A5. Hosted Stripe sessions have no explicit expiry/release path** | **CONFIRMED; owner decision required** | Session creation has no `expires_at` (`app/lib/stripe.server.ts:96-145`). Fee rows become `checkout_reserved` before provider creation (`app/lib/hostedCheckoutReservation.server.ts:140-171`). Dispatch handles completed, succeeded, failed and refunded events, not expired (`app/lib/stripeWebhookHandlers.server.ts:153-165`). Stripe documents a 24-hour default and a 30-minute-to-24-hour allowed window. A read-only Stripe endpoint listing on 2026-09-17 showed the Upload Studio endpoint disabled and its event list omitted `checkout.session.expired`. | A merchant opens hosted checkout and abandons it. Rows leave pending/auto-charge visibility, the session expires after the provider default, and no application path releases the exact reservation. The rows can remain stranded indefinitely, not merely for 24 hours. | High for application code and the observed endpoint snapshot. A currently enabled endpoint plus a tested, idempotent handler and provider-verified sweeper for missing delivery would settle the delivery side; the owner must still select the customer-facing expiry duration. |
| **A6. The 12 accepted commit bodies carry no rationale** | **CONFIRMED; intentional no-change** | `git show -s --format=%B` returns only a subject for the 12 commits from `d5eebdf` through `694e282`. The three new commits have bodies that state why, the failure prevented and verification. | Amending the accepted chain would change all descendant local hashes without changing content or order. That creates a second identity for a review the owner already accepted. The rationale remains in the accepted correctness report and this follow-up. | Certain. Rewrite only if the owner explicitly prefers commit-body completeness over preserving the accepted unpublished hashes. |

Official provider references used for A5:

- [Stripe Create Checkout Session](https://docs.stripe.com/api/checkout/sessions/create?api-version=2025-04-30.basil)
  documents the default and allowed `expires_at` range.
- [Stripe event types](https://docs.stripe.com/api/events/types?how=) documents
  `checkout.session.expired`.

## Why A1 was not changed

A candidate change preserved explicit split Width/Height axes instead of normalizing every
sheet to short/long edges. It made the live 22 x 12 fixture read naturally as a normal
placement, but it produced a route disagreement: custom checkout reparses the selected title,
takes `Math.min(width,length)` as cross-roll, and rejects a placed width above that value
(`app/lib/customerPricingCheckout.server.ts:657-663`). The 21.26 x 11.73 fixture would be
accepted by the proposed resolver and then rejected because checkout compares 21.26 to 12.

That candidate was removed and was not committed. A safe change needs one owner-approved
axis contract and route-equivalent tests covering resolver, checkout, persisted production
instruction and the production surface. No residual A1 source diff remains.

## Local commits that survived verification

| Commit | Disposition | Why it exists | Verification |
|---|---|---|---|
| `20a35c31d0e1551d5f386f0f0defb959d051e5e1` | A3 fix | Replaces 20-second worker-slot polling and merge requeues with one read and a durable CAS thumbnail handoff. | Targeted queue/recovery tests: 29/29. Full suite included below. |
| `bc50fb536fbf60e18cffd666ce0088edfd4ca59b` | A4 refactor/fix | Makes retry, terminal worker, failed-event and reconciler projections identical; stale JSON cannot manufacture preview capability. | Targeted queue/recovery tests: 29/29. Full suite included below. |
| `a253fc947096fd3cadc09dde5e83a1b89b9dc279` | A2 evidence | Adds the revision-aware regression harness, sanitized real snapshots, complete goldens, source fingerprint and strict gate. | 11/11 expected comparisons; normal exit 0, strict exit 2 for four declared regressions. |

No source change was made for A1, A5 or A6. No commercial release gate was implemented.

## Deterministic regression result

Reproduce from the repository root:

    npm.cmd run measurement:regression
    npm.cmd run measurement:regression -- --fail-on-regression

The independent final rerun used current commit
`a253fc947096fd3cadc09dde5e83a1b89b9dc279` and executed-source fingerprint
`sha256:7074b144ccb2f6ea`.

- Normal mode: exit 0.
- Strict mode: exit 2.
- Integrity: pass; 11 cases, 0 unexpected, 1 same, 6 intended fixes, 4 regressions.
- Raw JSON stdout: 37,994 bytes; SHA-256
  `a357ada6deac4c53dfc0f44a442abf5ae9f92159d0cde5ec0c5d5c4386cd65cd`.
- JSON payload with the CLI's final newline removed: SHA-256
  `c8616b5e03c8c375cf789ee901a67ef8caecdfc11d3a4439f64b6435929d9794`.
- `docs/measurement-regression-output-2026-09-17.md` matches all 22 numeric
  previous/current rows and all 11 classifications.

The four release-gated rows are:

| Case | Previous | Current | Classification reason |
|---|---|---|---|
| `alpha-order-43232-long` | 22 x 240, one sheet, $120 | no fit | Stored 0.125-inch artboard margins reduce printable width from 22 to 21.75. Owner must define media width versus printable width. |
| `alpha-order-43232-rotated` | 22 x 24, $30 | 22 x 36, $45 | The same margin makes 23.91 exceed the 23.75 printable length of the 24-inch sheet. The new rotate note itself is intentional. |
| `alpha-short-sheet-orientation` | 22 x 12, $6, no persisted placement | 22 x 12, $6, rotate note | No repricing, but the short-edge rotation convention conflicts with the split option label's apparent axis meaning. |
| `alpha-margin-reprice` | two designs/sheet, five sheets, $30 | one design/sheet, ten sheets, $60 | Newly active stored margins halve nesting density. It is mathematically explainable but not owner-approved. |

### Harness authority boundary

The artifact compares authoritative measurement/resolver behavior; it does not prove every
billing path. Sheet prices are captured Shopify retail prices. Linear cases replay captured
tier tuples and each revision's arithmetic, but do not execute customer eligibility/profile
precedence, multi-upload aggregation or the 4%/$6 per-order app fee. Reconstructed Shopify
variants are treated as available. No real successful `artwork_bounds` row with a trim delta
was found in the latest 500 Alpha/customprintaz rows inspected. Exact 249/250/499/500 rounding,
every tenant, theme-instance settings and a genuine long-edge-cross-roll product need fresh
canaries before those contracts are changed.

## Owner decision briefs

`docs/release-gate-decision-briefs-2026-09-17.md` contains all 19 gates in one document.
Its final structural audit found:

- 19 one-sentence business questions;
- 74 mutually exclusive options, two to four per gate;
- customer experience, merchant experience, implementation cost, breakage and reversibility
  for every option;
- a recommendation, evidence that would change it and deferral impact for every gate;
- the full 9 Shopify payment/order states x 3 fee states matrix: 27/27 cells marked as a
  technical invariant or owner choice, with checkboxes on every owner-choice cell;
- an inventory of every direct writer/reader of the three-property contract (`Print Ready`,
  `Sheet Identity`, `DPI`) across storefront assets, checkout, identity route, order matching,
  reconciler and export; and
- Gate 7's recommendation conditioned on a real production walkthrough. An order note is
  acceptable only if every job is opened from a surface that always shows it. An export/admin
  workflow instead requires a versioned metafield plus a reader in that exact production
  surface. Neither option changes the three line properties.

No gate has been implemented. The owner must answer the inline checkboxes.

## Verification

| Check | Result |
|---|---|
| Targeted A3/A4 tests | 2 files, 29/29 passed |
| Full automated suite | 29 files, 260/260 passed; the trim-timeout test emitted its expected stderr |
| Regression harness | 11/11 full goldens; normal exit 0; strict exit 2 for the four declared owner-gated regressions |
| Production build | Exit 0; 1,928 client modules and 169 SSR modules |
| TypeScript check | Exit 1 with 35 existing diagnostics in unchanged files; no diagnostic names a file changed in this follow-up |

The build had an important side effect attempt to disclose: because a local Sentry environment
was active, the Vite plugin attempted to create a release and upload source maps. Both requests
failed with HTTP 400 / “Project not found.” The build still completed, and no Sentry release or
source-map upload succeeded. The build was not rerun.

## Safety and remaining evidence gaps

No branch was pushed. There was no deploy, container restart, queue action, billing/data write,
Stripe or Shopify mutation, remediation-script execution, or production file copy. The only
writes in this follow-up are the three local technical commits and local review artifacts.

The following evidence still requires an owner-approved canary or additional read-only scope:

1. Full product inventory for every tenant, specifically any product whose long edge is truly
   cross-roll or whose split Width/Height axes are not short/long.
2. A successful real `artwork_bounds` upload with a non-zero trim delta.
3. Route-equivalent before/after canaries through resolve-product, VIP/custom checkout,
   persisted order facts and the production reader for the four harness regressions.
4. A BullMQ/DB preview load trace to complement A3's deterministic slot reasoning and unit test.
5. An owner-selected hosted-checkout expiry and recovery policy, followed by a read-only Stripe
   endpoint recheck and tests for exact reservation release on provider-confirmed expiry.
6. A real production walkthrough that proves whether order notes, Upload Studio admin, export
   artifacts or another print tool is the surface every operator actually reads.

Until those decisions are made, the safe release posture is: keep the A2/A3/A4 local changes,
block sizing/pricing rollout on the four strict harness regressions, and do not implement A5 or
any other commercial gate.
