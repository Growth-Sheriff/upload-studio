# Upload Studio measurement and billing correctness

> Historical review snapshot. The owner subsequently finalized the finished-sheet and
> fee-eligibility rules. See `finished-sheet-implementation-report-2026-09-17.md` for the
> implemented local result, updated production evidence, remaining blockers, and canary plan.

Date: 2026-09-17

Branch: `custom-container-upload-studio-app`

Disposition: **not ready to deploy** until the owner resolves the release gates in section 7.

No code was pushed or deployed. No container was restarted. No queue, billing row,
Shopify object, Stripe object, PayPal object, tenant setting, or production upload was
changed. Production evidence in this report came from read-only log and row inspection.
The remediation SQL in `docs/remediation` was written but not run.

## 1. Executive judgment

The local implementation makes the mechanical part of the system substantially more
consistent: the browser estimate is explicitly provisional; the server measurement and
stored policy snapshot are authoritative; client and server now agree on SVG and
anisotropic DPI handling; configured roll width, margins, tolerance, rotation, nesting,
copy count, sheet count, and measured-length price are carried through one canonical
resolution; upload jobs have durable retries and terminal states; and fee collection is
much safer under replay and ambiguous provider outcomes.

That does **not** make the branch deployable yet. Six questions are structural or
commercial rather than implementation details:

1. Which Shopify payment/cancellation/refund states earn the 4% fee is not defined.
   Current code can still create a positive `pending` commission for an unpaid order and
   retain it after cancellation.
2. A public upload ID is still effectively a production and fee-attribution capability.
3. “Order again” reuses a mutable Upload row instead of an immutable order-line snapshot.
4. The main-product marker can force `full_page` even when the merchant explicitly saved
   `artwork_bounds`; the intended precedence is unknown.
5. VIP draft checkout and abandoned hosted checkout reservations lack complete durable
   lifecycle/idempotency handling.
6. Rotation/clamping is stored and visible in storefront/identity detail, but it is not
   present in a Shopify order-line property or order note. Changing one of the deliberate
   three values could break production consumers, so this needs an approved representation.

Those are release gates, not reasons to guess. The owner decisions and smallest safe
designs are in section 7.

## 2. One-page model of measurement as implemented

### Browser estimate

`ul-file-probe.js` reads only header/tail slices. It ranks physical-resolution metadata
as Adobe XMP 95, Exif/PSD/TIFF 90, PNG pHYs 80, and JFIF 75. PNG/JPEG X and Y densities
must agree within 5%. PDF/EPS points use 72 points/in; unitless SVG/viewBox values use the
CSS rule of 96 px/in. Main Product and Mod 2 send this estimate to `resolve-preview`.
The result is labelled provisional and can select/display a likely variant, but it is not
allowed to become billing or production truth.

Evidence: `extensions/theme-extension/assets/ul-file-probe.js:64-82,103-170,255-326`,
`app/routes/api.upload.resolve-preview.tsx:91-132`.

### Authoritative server measurement

The intent stores a measurement-basis snapshot. The worker downloads the object to a
unique temporary directory, detects the real format, parses native pixels/DPI, and makes
ImageMagick decode the file. Native document DPI wins. If there is no usable DPI, Adobe
72 DPI is accepted only when the resulting short edge remains within the roll plus the
0.5-inch compatibility allowance; otherwise sizing anchors to the configured roll.

`full_page` measures the full canvas and skips alpha trim. `artwork_bounds` runs trim when
an alpha channel exists, but preserves the established full-page physical scale: removing
transparent pixels cannot stretch the remaining art back to roll width. A required trim
failure blocks ordering rather than silently billing the full page. Later reads use the
stored basis and stored main-product projection, so a settings change does not rewrite an
upload that was already measured.

Evidence: `app/routes/api.upload.intent.tsx:147-150,409-420`,
`app/lib/preflight.server.ts:1041-1112,1129-1148,1461-1510`,
`app/lib/uploadLifecycle.server.ts:185-239,582-638`,
`workers/uploadPipeline.shared.ts:901-912`.

### Main-product roll projection

The exact `main_product_roll_width` flow deliberately uses full-canvas sizing. Roll width
comes from explicit `rollWidthIn`, then the legacy shorter configured maximum, then 22
inches; an explicit shop policy maximum can cap it. Embedded document DPI is preserved;
no-DPI artwork uses Adobe 72 when it fits, otherwise the roll anchor. `resolve-product`
persists the projection that cart, identity, queue, and later checkout reads reuse.

Evidence: `app/lib/mainProductMeasurement.server.ts:8-11,52-89,136-211`,
`app/routes/api.upload.resolve-product.tsx:129-181`.

### Sheet matching and production orientation

The resolver treats the physical sheet short edge as cross-roll. It subtracts twice the
artboard margin, applies image gap and bounded tolerance, excludes sheets wider than
`maxSheetWidthIn`, evaluates normal, rotated, and mixed-row arrangements, and calculates
`designsPerSheet` and `sheetsNeeded`. Mixed rows are now found by bounded enumeration,
not a greedy choice. `smallest_fitting_sheet` sorts by area; the default
`lowest_total_cost` sorts by retail variant price times physical sheet count. Rotation,
tolerance clamp, effective dimensions, and a production note are stored. The cart still
contains only the deliberate three public properties: Print Ready, Sheet Identity, DPI.
The identity page/DB carries the detail, but the requested Shopify order-line property or
order-note representation is still missing and is a release gate.

Evidence: `app/lib/dtfSheetResolver.server.ts:539-574,577-770`,
`extensions/theme-extension/assets/ul-line-properties.js:9-13`.

### Money

Measured-length custom pricing is measured long edge × requested copies × account rate.
Variant-length custom pricing first resolves the physical sheets, then charges selected
sheet long edge × physical sheet count × rate. Shopify cart quantity for linear-inch
products remains the integer number of billable inch units and is kept separate from
physical sheet count. Standard main-product tier display aggregates the current cart's
billable inches; the multi-file custom checkout currently chooses a tier per upload.

The app fee is cents-rounded 4% of the app-attributable line amount after line discounts,
capped at $6 per order; a zero app-attributable basis is void. Atomic claims, stable
idempotency keys, currency quarantine, and provider-result classification prevent the
known duplicate-charge failure mode. Fee *eligibility* by Shopify financial state remains
undefined and is therefore not changed.

Evidence: `app/lib/customerPricing.server.ts:805-825,903-934`,
`app/lib/customerPricingCheckout.server.ts:577-707`,
`app/lib/billing.server.ts:4-48`, `app/lib/orderReconciler.server.ts:72-107,501-559`,
`app/lib/billingRunner.server.ts:244-495`.

### Pipeline and customer wait

Measurement and preview remain separate workers. This costs a second download/decode but
isolates a thumbnail failure from sizing and allows a labelled placeholder. Both queues
now use deterministic IDs, three attempts, exponential jittered backoff, and database-
first dispatch with a reconciler. Files at least 50 MiB reserve the shared large-image
slot before another download; decoded images over 300 MP serialize across the two workers.
Each run uses a unique temp directory and cleans it in `finally`. Exhausted/stalled
measurement is persisted as blocked instead of an endless spinner.

Main Product polls with progressive delay for about 8.2 minutes; Mod 2 for about 9 minutes;
DTF polls every 3 seconds for about 10 minutes; `ul-line-properties` waits up to 8 minutes;
cart display refreshes for about 3 minutes. Carousel/showcase are display surfaces, not
independent sizing authorities. Pro is a presentation/orchestration layer over the same
authoritative APIs.

Evidence: `app/lib/uploadQueues.ts:6-32,59-91`,
`workers/measure-preflight.worker.ts:445-659`,
`workers/preview-render.worker.ts:493-540,689-700`,
`extensions/theme-extension/assets/main-product-upload-app.js:249-254,2832-2876`,
`extensions/theme-extension/assets/custom-price-upload-mod2.js:3433-3503`,
`extensions/theme-extension/assets/dtf-upload.js:513-600`,
`extensions/theme-extension/assets/ul-line-properties.js:157-180`,
`extensions/theme-extension/assets/cart-upload-display.js:432-458`.

### Storefront surface coverage

| Shipped asset | Measurement/checkout role | Waiting and failure behavior |
|---|---|---|
| `main-product-upload-app.js` (Variant Gang Sheet) | Header probe, provisional resolve, upload, authoritative resolve, variant/tier/cart orchestration; server answer replaces probe. | Progressive polling for about 8.2 minutes; blocks cart and shows the server measurement error. |
| `main-product-upload-pro.js` (Custom Price Sheet) | Multi-file presentation and quote layer over the same upload/resolve APIs; does not establish a second measurement truth. | Checkout remains locked until its underlying items/quote are ready. |
| `custom-price-upload-mod2.js` | Header probe, authoritative per-file custom checkout, quantity/workspace/reorder orchestration. | About 9 minutes of polling; retains each file's visible error and refuses unresolved checkout. |
| `dtf-upload.js` and compatibility `dtf-uploader.js` | DTF editor/upload path; consumes authoritative status and inches. The old duplicate implementation is reduced to a compatibility loader so two implementations cannot diverge. | Three-second polling for about 10 minutes; terminal timeout becomes a visible measurement error. |
| `ul-line-properties.js` | Shared uploader for listing-style blocks and canonical three-property builder. | Waits up to 8 minutes and never converts provisional facts into a cart line. |
| `cart-upload-display.js` | Reads Sheet Identity and status for cart presentation; no sizing authority. | Refreshes for about 3 minutes; then leaves a non-authoritative status display rather than inventing readiness. |
| `ul-carousel.js` / `ul-showcase.js` | Product discovery/presentation; delegates file upload and properties to `ULLineProperties`. | Inherits that module's authoritative wait/error behavior. |

### Live-setting compatibility evidence

Read-only inspection found the live `customerPricing.model`/`policy` shapes absent/null,
ProductConfig entries in DTF mode with no `policyOverrides` or explicit `rollWidthIn`, and
legacy builder values including a 22.5-inch maximum and, on some configurations,
0.125-inch margins. The local normalizer therefore treats these as legacy opt-outs:
historical full-page basis remains effective, missing margins remain zero unless already
stored, and the legacy width participates until the merchant explicitly saves the new
policy. No live settings were changed.

## 3. Findings

The classification is about the original/current behavior; “fixed locally” does not mean
deployed.

### Required hypothesis verdicts

| Review hypothesis | Verdict | Why |
|---|---|---|
| Unpaid fees can become pending and survive cancellation | **CONFIRMED** | Commission creation checks linked app uploads and zero basis, but not `facts.paid`; cancellation has no approved fee transition matrix. Not changed without owner policy. |
| Producer queues silently get BullMQ's one-attempt default | **CONFIRMED** | Route-created queues did not inherit worker defaults. Fixed locally with shared options, deterministic IDs, recovery and terminal state. |
| Configured maximum width is not enforced | **CONFIRMED**, while rotation itself is **INTENTIONAL** | Old resolution did not consume the policy limit. Local resolution checks both orientations and records rotation/tolerance. Shopify line-note surfacing remains incomplete. |
| Expensive trim is computed but ignored | **CONFIRMED for `full_page`** | Full-page sizing never consumes trim; local code skips it. Artwork-bounds legitimately consumes trim and keeps it. |
| Measurement and preview duplicate download/decode | **INTENTIONAL**, but risky | Separation provides failure isolation and placeholder preview; the CPU/I/O cost is real. Kept for canary safety. |
| Cart-wide rather than per-line tier aggregation is automatically a bug | **REJECTED** | Tier scope is a commercial policy. The current flows differ, so desired scope remains an owner decision rather than an inferred fix. |
| Pro's literal `quantity: 1` underprices work | **REJECTED** | It is a carrier in that path; authoritative server inches/sheets determine measured pricing. No concrete bypass was reproduced. |
| Export path is never exercised | **REJECTED** | Code and observed production behavior exercise it. The real defect was silent partial archives, fixed locally. |
| Cart trusts client-supplied price/sizing | **REJECTED for price**, **CONFIRMED for upload identity capability** | Server recomputes measurement, variant and price. A plausible raw upload ID is still insufficiently bound to product/variant/customer. |

| Area | What was independently verified | Classification | Customer or money impact | Confidence and what would change it |
|---|---|---|---|---|
| DPI priority | Native document DPI wins, then Adobe 72 if it fits, then roll anchor. The 300 DPI GREG file therefore measures 22.26 × 237.05, not exactly 22 wide. | intentional and sound | Customer and production see metadata-defined physical size. | High: code and pixels/DPI reproduce it. Only a merchant rule that embedded DPI must be ignored would change the judgment. |
| Provisional probe | Browser numbers are replaced by server numbers before orderability. | intentional and sound | Fast feedback without trusting browser values for price/print. | High: both blocks clear provisional state after status. |
| SVG units | Server used a 72-DPI interpretation while browser used CSS 96 px/in. Fixed locally. | accidental defect | A 960×480 SVG could change from 10×5 to 13.33×6.67, changing sheet and price. | High: deterministic regression test. |
| Anisotropic DPI | Browser trusted X only while server rejected X/Y disagreement >5%. Fixed locally. | accidental defect | Visible estimate could flip after upload. | High: synthetic PNG/JFIF tests. |
| Measurement basis snapshot | New/updated upload stores basis and legacy rows freeze to historical full-page behavior. | intentional and sound | Prevents a settings edit from repricing an existing file and preserves live tenant behavior. | High: lifecycle tests and live settings were read as null/legacy. |
| Main marker vs explicit basis | Exact main marker forces full page even with an explicit artwork-bounds shop policy. | unknown | Transparent padding may be billed and printed differently from merchant expectation. | High code confidence, unknown product intent. A written precedence rule and trusted flow mapping settle it. |
| Trim cost | Full-page work no longer performs unused alpha trim; artwork-bounds still must trim. | accidental defect, fixed locally | Saves tens of seconds on huge full-page RGBA files without changing inches. | High code confidence; real canary timing is still required. |
| Rotation | 23.91×21.14 can fit a 22×24 sheet by rotating so 21.14 is cross-roll. Rotation is persisted and visible in storefront/identity detail, but not a Shopify line property/note. | intentional but risky | Fit is correct; downstream staff can miss the orientation instruction from the Shopify order alone. | High. Owner must approve how to encode it without violating the three-property contract. |
| Roll and margins | Configured physical roll, margins and tolerance are enforced. A 22-inch anchor plus 0.125-inch margins leaves only 21.75 usable. | intentional but risky | A no-DPI file anchored to 22 may then be rejected. | High mechanics, unknown semantics. Owner must say whether roll width means media width or printable width. |
| Mixed nesting | Greedy row selection missed valid higher-density arrangements. Fixed locally. | accidental defect | Example 5×6.35 on 22×24: 14 copies fit in one sheet; old result billed/printed two for quantities 13–14. | High: bounded reproduction test. |
| Sheet selection | `lowest_total_cost` uses retail Shopify variant price, not custom account charge. | intentional but risky | Custom-priced customer may receive a sheet that is not cheapest under their actual rate. | High. Owner must define “cost”; pricing-aware selection could then be implemented. |
| Copies and measured price | Requested copies were not consistently propagated to billable inches/physical sheet count. Fixed locally. | accidental defect | Undercharge or production copy mismatch. | High: quote regression test. |
| Linear cart units | Billable inch quantity and physical sheets were conflated. Fixed locally. | accidental defect | Shopify amount or production count could be wrong despite correct inches. | High: resolver regression test. |
| Volume tiers | Standard flow aggregates current cart inches; custom multi-file checkout chooses per file. | unknown | Two 150-inch files can price at $84 per-file versus $66 at an aggregate 300-inch default tier example. | High code confidence. Written per-file/per-checkout/historical policy changes the classification. |
| `quantity: 1` in Pro | Quantity 1 is a carrier for the standard variant path; measured paths derive price from authoritative inches/sheets. | intentional and sound | No demonstrated undercharge from this literal alone. | High: server recomputation. A concrete quote/cart mismatch would reopen it. |
| Variant pagination | Only the first 250 variants could be considered. Fixed locally with bounded, fail-closed pagination. | accidental defect | Wrong sheet/price on large products. | High: cursor tests. |
| Job retry options | Producers previously created queues without the worker's retry defaults. Fixed locally for all upload producers. | accidental defect | One storage/OOM error could leave “measuring” forever. | High: queue option tests and nC9 failure shape. |
| Terminal job state | Exhausted or stalled work now becomes a visible blocked measurement error. | accidental defect, fixed locally | Customer gets an actionable error; merchant sees blocked work instead of silent spinner. | High: recovery tests. |
| Duplicate decode | Measure and preview still download/decode separately. | intentional but risky | Extra CPU/I/O and longer contention on large uploads; failure isolation is better. | High. A durable shared raster/cache experiment could justify redesign. |
| Missing object | nC9 failed in 264 ms with object-not-found and no multipart-complete evidence. | unknown | Order blocked; no printable object exists. | High on failure location, low on origin. Storage audit/request IDs or a browser HAR would settle whether completion was skipped or the object vanished. |
| Placeholder preview | Preview may use a labelled placeholder while measurement remains authoritative. | intentional and sound | Merchant can proceed only when size is good; visual fidelity is explicitly degraded. | High: preview lifecycle code. |
| Ghost rows | Paid webhooks could approve missing-file ghosts; stale plausible IDs could suppress ghost creation. Fixed locally. | accidental defect | Production could see an approved row with no file, or miss the alert entirely. | High: lattice test plus direct-match control flow. Concurrent duplicate ghost creation remains open. |
| Foreign app order #42909 | GS Studio properties are recognized as foreign and skipped for ghost/commission. | intentional and sound | Upload Studio neither bills nor claims provenance it cannot prove. | High for the skip; the design background itself is unknown without GS Studio evidence. |
| Upload identity capability | A plausible public upload ID is accepted before product binding and is tenant-only checked. | accidental defect | A customer could attach a known upload to another line, affecting attribution, production and fee basis. | High. A signed product/variant/quantity-bound capability is needed. |
| Reorder reuse | Identity page deliberately offers order-again, but one mutable Upload stores the latest order and production facts. | intentional but risky | A later order can overwrite facts used to explain an earlier order. | High. Immutable order-line snapshots or cloning settles it. |
| Fee formula | 4%, line-discount net, cent rounding, $6 cap, and $0 void are coherent. | intentional and sound | Predictable fee amount once an order is eligible. | High: pure tests. |
| Fee eligibility | Positive pending fees do not require `facts.paid`; cancellation does not define pending/claimed/paid behavior. | unknown | Real risk of charging never-paid/cancelled orders, including net-30 ambiguity. | High code confidence. Owner state matrix is required before code. |
| Auto-charge replay | Atomic claim plus stable provider key; unknown results remain quarantined; a hard decline can safely release. Fixed/hardened locally. | accidental defect | Prevents repeat of multi-charge incident; ambiguous rows require manual review. | High: concurrency/result tests. |
| Provider isolation | One provider failure disabled both saved methods. Fixed locally. | accidental defect | Merchant could lose a healthy fallback payment method. | High: Stripe/PayPal tests. |
| Stripe fan-out | Non-2xx tenant response was ignored and outer endpoint returned 200. Fixed locally to return 503. | accidental defect | Lost Stripe retry could strand settlement. | High: fan-out test. |
| Hosted reservation expiry | Rows can remain `checkout_reserved` after abandoned/expired checkout. | accidental defect | Fees disappear from available collection while not paid. | High. Release only after provider-confirmed expiry/cancel/unpaid. |
| VIP draft idempotency | Repeated request/two tabs can create multiple payable draft orders. | accidental defect | Customer can receive duplicate checkout links/orders. | High. Durable request claim is required. |
| Currency | Automatic provider charging fails closed to USD; manual UI still aggregates/labels as USD. | intentional but risky | Non-USD manual totals can be misleading. | High code confidence; tenant-wide USD invariant or currency-grouped UI settles it. |
| Export | Export path is active; it could silently omit a requested upload/item. Fixed locally to fail with a manifest of missing inputs. | accidental defect | Production no longer receives an apparently complete partial archive. | High: archive tests. The earlier “never exercised” claim is rejected. |
| Cart trust | Server recomputes variant/price/measurement; arbitrary client price is not an exploit. Raw upload identity remains exploitable as above. | intentional and sound for price; accidental for identity binding | Price tampering rejected, attribution still needs capability binding. | High: request flow traced end to end. |

## 4. Concrete cases and performance

### Observed cases

- `GREG BRANCH SEP 14 .png`, 6678×71116, embedded 300 DPI: pixel division gives
  22.26×237.05 inches. That is correct under the current document-DPI-first policy.
- Order #43232 `cACX21FxOLlT`, 237.99×21.98: 22×240 is a normal physical fit.
- Order #43232 `p2f6LjKFQaml`, 23.91×21.14: 22×24 is a valid rotated fit; 21.14 is
  cross-roll. The explanation must say “rotated for print,” not imply the uploaded width
  became 22.
- `nC9ES4OSlUeK`: object-not-found in 264 ms, no multipart-complete log found. This is a
  storage finalization/provenance failure, not slow image measurement.
- Order #42909: only GS Studio properties and no Upload Studio row. Upload Studio cannot
  determine whether the background was uploaded or composed; current local code correctly
  skips ghost creation and fee attribution for demonstrably foreign lines.

### Independently extracted production timings

Read-only method: correlate upload ID with timestamped `MEASURE_JOB` and `PREVIEW_JOB`
completion/failure entries from `docker logs us-alphaprint` for 2026-09-15, then compare
the stored upload/item lifecycle rows. A reproducible log extraction is:

```sh
ssh upload-studio "docker logs --timestamps --since 2026-09-15T00:00:00Z --until 2026-09-16T00:00:00Z us-alphaprint 2>&1 | grep -E 'qWk_2QWCTw5B|TURk3zVwowT8|cACX21FxOLlT|nC9ES4OSlUeK|MEASURE_JOB|PREVIEW_JOB'"
```

| Upload | Measurement | Preview | Interpretation |
|---|---:|---:|---|
| qWk_2QWCTw5B | 152,889 ms | 18,179 ms | 475 MP measurement CPU dominates. |
| TURk3zVwowT8 | 164,010 ms | 38,979 ms | Same file class; repeat confirms outlier is reproducible. |
| cACX21FxOLlT | 82,352 ms | up to about 51.5 s | Preview can also be material, but measurement is slower. |
| Other 100–154 MB uploads that day | about 12–18 s | File byte size alone does not predict decode/trim cost. |
| nC9ES4OSlUeK | failed in 264 ms | failed | Missing object, not processing latency. |

The stage profile (download 1.9 s, identify 15.4 s, trim 73.7 s, streaming alpha scan
35.1 s, no trim found) was supplied by the requester. I did **not** rerun that profile in
this implementation pass, because doing so required a production-container temp write.
It is consistent with the logs but is labelled external evidence, not my measurement.

Expected effect of the local change: legacy/full-page uploads skip the 73.7-second trim
class entirely; artwork-bounds uploads retain it. No post-change production timing exists,
so the size of the real gain must be measured in a canary with the same object.

## 5. Implemented defects: reproduction and smallest safe fix

| Defect | Minimal reproduction | Smallest implemented fix | Regression evidence |
|---|---|---|---|
| SVG 72/96 split | Unitless/viewBox SVG 960×480: browser 10×5, server 13.33×6.67. | Use CSS 96 px/in on server and parse quoted width/height/viewBox consistently. | `preflight.server.test.ts:10-20` |
| X/Y DPI split | PNG/JPEG with X/Y density differing >5%. | Browser rejects anisotropic metadata like server and averages consistent axes. | `ulFileProbe.test.ts:55-63,77-83` |
| Greedy mixed nesting | 5×6.35, sheet 22×24, zero gap/margin, quantity 14. | Enumerate bounded normal-row counts and fill remaining height with rotated rows. | `dtfSheetResolver.server.test.ts:251-273` |
| Copy undercount | Measured 10-inch long edge, rate $1/in, quantity 3. | Quote 30 billable inches and 3 physical copy sheets. | `customerPricing.server.test.ts:16-36` |
| Cart-unit conflation | Linear-inch product with multiple physical copies. | Keep integer inch cart quantity separate from physical `sheetsNeeded`. | `sheetResolution.server.test.ts:24-34` |
| Variant truncation | Fitting/cheapest variant appears after item 250. | Bounded cursor pagination; reject missing/repeated cursor rather than partial truth. | `shopifyVariantPagination.server.test.ts` |
| Lost queue retries | Complete route constructs a Queue without producer defaults, then storage read fails once. | Shared job options at every producer, deterministic IDs, DB-first state, reconciler, terminal projection. | `uploadQueues.test.ts`, `uploadQueueRecovery.test.ts` |
| Wrong storage fallback label | R2 presign falls back to local but result is advertised as R2. | Accept a fallback only if its provider matches the requested fallback. | `storage.server.test.ts:11-25` |
| Multipart provider prefix | R2 multipart was issued while provisional object key carried Bunny/local prefix. | Compare exact normalized object key independent of provisional provider. | `storage.server.test.ts:28-33` |
| `autoApprove:false` lost | Aggregate repair receives null settings. | Reload shop settings and preserve explicit false. | `uploadQueueRecovery.test.ts:12-15` |
| Ghost paid approval | Paid webhook replays a missing-file ghost OrderLink. | Status lattice never approves ghost; stale direct ID continues to recovery/ghost path. | `orderReconciler.server.test.ts:89-97` |
| Cross-provider disable | Stripe decline while PayPal vault is healthy, or inverse. | Disable only the attempted provider; notify using that provider's email first. | `billingRunner.server.test.ts:13-25` |
| Stripe partial ACK | One internal tenant returns 500; outer webhook still returns 200. | Treat non-2xx as failure and return 503 so Stripe retries; replay is idempotent. | `stripeWebhookFanout.server.test.ts` |
| Signed URL in logs | Storage key is an HTTP URL with query signature. | Central redaction removes query/fragment before every worker log. | `uploadLogger.server.test.ts` |
| Partial export | Requested upload absent or contains no items. | Fail export and record all missing inputs; use collision-safe archive paths. | `exportArchive.test.ts` |

## 6. Verification and local commits

Final verification after the code changes:

- `npm.cmd test -- --reporter=dot`: **29 files, 250/250 tests passed**.
- Targeted high-risk suite: **10 files, 87/87 tests passed**.
- No-Sentry production build: **passed**, 1,928 client modules and 169 SSR modules.
- `tsc --pretty false`: repository baseline still exits non-zero with 35 diagnostics,
  all in files unchanged by these commits; automated comparison found
  **0 diagnostics in changed files**.
- `git diff --check`: passed.

Local-only code commits, in order (the report/remediation documentation is a separate
final commit):

1. `d5eebdf` — `fix: preserve one physical measurement truth`
2. `d82777a` — `fix: reject sheets that violate configured fit policy`
3. `5f5ea34` — `fix: bill authoritative copies and sheet lengths`
4. `51cff28` — `fix: keep storefronts provisional until server measurement`
5. `0a6e489` — `fix: bind upload access to exact tenant storage objects`
6. `914acde` — `fix: make upload jobs retryable and terminal`
7. `29999b0` — `fix: quarantine ambiguous automatic charge attempts`
8. `3f823a3` — `fix: settle only exact hosted checkout reservations`
9. `917bff1` — `fix: retry Stripe events rejected by any tenant`
10. `fe7568d` — `fix: keep missing files out of paid production`
11. `a2166be` — `fix: fail exports when requested artwork is missing`

## 7. Unresolved release gates and what settles them

| Gate | Current risk | Required decision/access/experiment | Smallest safe follow-up |
|---|---|---|---|
| Fee eligibility | Unpaid/cancelled order can remain collectible. Claimed/paid/refund behavior is undefined. | Owner-approved matrix for paid, partially paid, pending net-30, authorized, voided, refunded, partially refunded, cancelled-before-pay, cancelled-after-pay; explicit rule for `charging` and already paid. | Encode a monotonic state machine, audit every transition, test replay/out-of-order delivery. Never rewrite paid rows. |
| Existing fee rows | Local DB lacks authoritative current Shopify financial/refund history. | Run read-only inventory per tenant, enrich with read-only Shopify order/refund facts, owner approves row decisions. | Use the optimistic, rollback-by-default remediation script; only unclaimed pending rows may change. |
| Upload line capability | Known ID can be attached within a tenant without product/variant binding. | Decide backward-compatibility window for already-created carts/orders. | Signed expiring capability bound to shop, upload, product, variant and quantity; validate before attribution. |
| Reorder snapshot | Mutable upload can explain two orders differently after reuse. | Choose clone-on-reorder, prohibit reuse, or immutable order-line snapshot. | Prefer immutable snapshot/clone before enabling capability enforcement. |
| Main vs artwork-bounds | Main marker silently wins over explicit shop policy. | Owner declares precedence and identifies main products by trusted server config, not browser marker. | Persist a trusted flow kind and select policy from it. |
| Roll width vs printable width | Anchor 22 plus 0.125 margins can reject the anchored design. | Merchant confirms whether saved roll width includes margins. | Store both media width and printable width, or anchor to the approved one. |
| Rotation/clamp on Shopify order | Correct instruction is absent from the three properties and order note. | Owner approves whether to enrich an existing value, use an order note/metafield, or change the three-property contract; production consumers must be inventoried first. | Generate the approved value server-side from canonical resolution and test every storefront/order parser. |
| Tier scope | Per-file and aggregate flows disagree. | Owner chooses per-file, per-checkout, or historical-plus-current tier basis. | Compute the chosen basis once and pass it to every quote path. |
| Lowest cost | Retail price differs from account-rate charge. | Owner defines whether “cost” means storefront retail, merchant production cost, or customer payable. | Rank candidates with the same authoritative pricing function used by checkout. |
| VIP draft idempotency | Retried request can create duplicate payable draft orders. | No commercial decision; needs durable design and schema review. | Unique request token/claim storing Shopify draft ID and URL, safe replay response. |
| Hosted checkout expiry | Abandoned session can strand `checkout_reserved`. | Provider-confirmed expiry/cancel event/API result; never infer from elapsed time alone. | Handle Stripe expiry and equivalent PayPal state, release only exact reservation snapshot. |
| Ghost concurrency | Concurrent webhook topics can create two ghosts for one line. | Schema migration/canary approval. | Unique `(shopId,orderId,lineItemId)` for non-null line IDs plus transactional upsert. |
| PayPal denial audit | Handler searches legacy actions, so denial can be invisible. | Confirm desired merchant notification/UI. | Resolve by current reservation reference and emit one canonical review audit. |
| Refund review visibility | Audit is produced but no UI/notification consumes it. | Owner chooses operational destination/SLA. | Billing review queue with provider reference and immutable row snapshot. |
| Historical eligibility | Unordered 500-upload slice is not billed-sheet history. | Define time window/basis and add immutable checkout snapshots first. | Query deterministic snapshots, not mutable uploads. |
| #42909 provenance | Upload Studio has no source object or row. | GS Studio storage/log access or customer's original file/order session. | No Upload Studio data change; preserve foreign-app skip. |
| nC9 missing key | No complete log; storage audit absent. | Browser HAR plus R2/Bunny request/audit IDs around the attempt. | Add durable completion receipt/request ID in a future migration. |
| Post-change 475 MP timing | No safe local copy was available; production temp profiling would write. | Owner-approved offline copy or explicit container-temp experiment, then delete it. | Compare full-page before/after on identical bytes; record download, identify, trim, measure, preview CPU/RSS. |
| Live theme inventory | Shopify theme inventory API was unavailable in this review. | Read-only theme API/session with permission. | Confirm which block/version is active per shop before canary. |

## 8. Risk and detection table

| Change/risk | Production symptom | Detection | Rollback boundary |
|---|---|---|---|
| Measurement policy/sheet math | Different displayed inches, variant, rotation, or price. | Golden-file compare: provisional vs measured vs cart vs identity vs queue; alert on mismatched stored projection. | Redeploy the recorded prior production image; do not rewrite uploads already ordered. |
| Retry/reconciler | Duplicate CPU work, prolonged lock contention, or unexpected blocked jobs. | BullMQ attempts/stalled counts, `MEASURE_JOB_*`, reconciler repair counts, large-image lock age, queue latency. | Redeploy the recorded prior image; preserve affected DB rows and jobs for review. |
| Billing claim/provider handling | Rows accumulate in `charging`/`checkout_reserved`, or webhook retries rise. | Count status/age by provider and currency; inspect claim/audit reference; compare Stripe/PayPal event delivery. | Stop rollout and redeploy the prior image only after reconciling every provider-bound claim; never reopen or bulk-edit paid/ambiguous rows. |
| Stripe 503 fan-out | Stripe retries an event because one tenant is unavailable. | Stripe delivery attempts plus per-tenant event audit/idempotent settlement. | Redeploy the prior image only if all tenant handlers are healthy; replay remains safer than false 200. |
| Export strictness | Export fails where it previously returned a partial ZIP. | Export failure manifest and missing upload/item count. | Redeploy the prior image; fixing missing source is preferred to allowing partial production output. |
| Legacy settings compatibility | Live shop effective behavior changes without opt-in. | Snapshot normalized policy for dtfprinthouse and alphaprint before/after. | Stop canary and redeploy the prior image; settings/data stay untouched. |

## 9. Owner-executed rollout plan

This plan starts only after section 7 gates required for the chosen release scope are
resolved and their tests are added.

### Preflight

1. Tag/build the reviewed commit set plus the owner-decision follow-up; record the exact
   image digest. Keep the current production image digest for rollback.
2. Export read-only normalized settings and ProductConfig snapshots for dtfprinthouse and
   alphaprint. Confirm no migration changes their JSON shape or effective defaults.
3. Run the 250-test suite, build, changed-file typecheck comparison, and golden files:
   embedded 300 DPI PNG, no-DPI Adobe-sized image, no-DPI roll anchor, transparent full
   page, transparent artwork bounds, SVG, PDF, PSD/TIFF, over-roll orientation, mixed
   nesting, multi-copy, missing object and placeholder preview.
4. Do not enable fee auto-charge for the canary until the eligibility state machine is
   approved and historical rows are inventoried.
5. No verified runtime billing kill switch was found. Before any billing canary, the owner
   must document and rehearse the exact supported scheduler/feature control; do not invent
   a container or queue mutation during an incident.

### Canary 1: dtfprinthouse

1. Owner deploys only to dtfprinthouse.
2. Submit non-chargeable test orders through every active block. For each file compare:
   provisional dimensions, authoritative dimensions/source, selected variant, rotation,
   copies per sheet, sheet count, cart quantity/price, three line properties, identity
   page, merchant queue, and export manifest.
3. Watch for at least one full operational window: queue wait, retries, stalled jobs,
   large-image lock, measurement/preview duration, blocked rate, placeholders, webhook
   retry, `charging`/`checkout_reserved` age, and duplicate drafts.
4. Stop on any unexplained dimension, sheet, payable amount, or provider claim difference.

Rollback: redeploy the recorded prior image. Individual commit reverts were not validated
as deploy artifacts and are not the production rollback. Preserve rows/jobs/logs exactly
as evidence. For a billing symptom, use only the pre-documented supported kill switch and
reconcile exact provider references before any retry; do not bulk-release claims.

### Canary 2: alphaprint

1. Only after dtfprinthouse comparisons are explained, owner deploys to alphaprint.
2. Repeat all surface comparisons, then run the exact GREG bytes if authorized. Compare
   stage timings and peak RSS against the baseline above; ensure full-page skips trim and
   the result remains 22.26×237.05 under embedded-DPI policy.
3. Exercise 22×240 normal fit, 23.91×21.14 rotated 22×24 fit, 13/14-copy mixed nesting,
   and a controlled missing-object fixture outside production customer data.
4. Hold broad rollout until webhook/fee review shows no unresolved state.

Rollback is the same prior-image rollback. Never compensate a measurement rollback by
editing prior upload dimensions or fee rows; existing orders retain their captured facts
and are reviewed individually.

## 10. Remediation artifacts (not executed)

- `docs/remediation/01_commission_inventory_read_only.sql`: read-only per-tenant inventory
  and dry-run summary buckets.
- `docs/remediation/02_apply_owner_approved_decisions.sql`: owner-reviewed CSV input,
  optimistic before-image checks, only unclaimed pending rows mutable, audit output, and
  final `ROLLBACK` safety default.
- `docs/remediation/README.md`: operating sequence and dry-run columns.

The scripts deliberately cannot decide fee eligibility. They require current read-only
Shopify evidence and an owner decision for every proposed row.
