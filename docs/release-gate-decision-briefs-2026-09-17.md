# Upload Studio release-gate decision briefs

Date: 2026-09-17
Status: owner decisions required; local only, not approved for deployment

This document turns every unresolved gate in section 7 of
measurement-billing-correctness-report-2026-09-17.md into a choice the owner can answer
inline. It does not authorize a code change, deployment, production write, billing action,
or remediation run.

## How to answer

- Tick exactly one policy option for each gate unless the brief explicitly asks for a
  second sub-decision.
- **◆ Safety invariant** means there is only one defensible technical treatment.
- **◇ Business choice** means the repository cannot supply the answer.
- “Reversible” means reversible for future activity. A placed order, provider charge, or
  immutable production snapshot must not be silently rewritten.
- Any Commission row in charging or checkout_reserved with a provider reference must be
  reconciled against that exact provider reference before it changes.
- A paid Commission row remains an immutable payment record. Any relief is a separate
  provider refund or adjustment/credit, never a reopening of that row.

---

## Gate 1 — Fee eligibility

**Decision in one sentence:** At what Shopify financial event does the 4% fee become owed,
and how should partial payment, cancellation and refund facts affect it?

**Current evidence:** Commission creation depends on a linked real upload and positive
app-attributable line value, but not facts.paid or facts.cancelled
(app/lib/orderReconciler.server.ts:501-559). The automatic runner may collect any
unclaimed pending row (app/lib/billingRunner.server.ts:192-495). The schema has one
Commission row per shop/order, not an installment or adjustment ledger
(prisma/schema.prisma:603-633).

### Choose one fee trigger

#### ☐ A. Fully paid only

- **Customer:** no storefront change; a cancellation before capture cannot indirectly
  create a merchant fee.
- **Merchant:** the fee becomes collectible only when the app-attributable order amount is
  fully captured. Partially paid, net-30 and authorized orders remain non-collectible.
- **Implementation cost:** medium. Add an explicit deferred/non-collectible state,
  monotonic transitions, authoritative payment facts, and replay/out-of-order tests.
- **What it breaks:** fee revenue arrives later for installment and net-30 orders; it
  differs from today's order-created pending behavior.
- **Reversibility:** easy for future orders. Already claimed or paid rows require exact
  reconciliation and never get silently reopened.

#### ☐ B. Proportional cash received and retained

- **Customer:** no storefront change; the merchant's app fee follows money actually
  captured and retained.
- **Merchant:** partial captures create proportional fee obligations and refunds create
  proportional credits or adjustments.
- **Implementation cost:** high. This needs immutable payment/refund snapshots and an
  adjustment ledger so installments, credits and the $6 per-order cap compose correctly.
- **What it breaks:** the current one-row-per-order Commission model cannot safely express
  multiple captures and later refunds.
- **Reversibility:** an additive ledger is reversible for future policy; completed provider
  movements are not.

#### ☐ C. Order-created accrual

- **Customer:** no direct checkout change.
- **Merchant:** the full fee is collectible when the order is placed, even before Shopify
  captures funds; cancellation/refund does not automatically remove it.
- **Implementation cost:** low; this is closest to today's behavior.
- **What it breaks:** it can charge a merchant for money never received unless the merchant
  agreement explicitly permits that.
- **Reversibility:** only unclaimed pending rows are easy to reverse.

#### ☐ D. Merchant-configurable payment terms

- **Customer:** behavior can differ by shop or account.
- **Merchant:** cash, installment and net-30 merchants can use different triggers.
- **Implementation cost:** very high: per-shop policy, UI, snapshots, migration, audit and
  support rules.
- **What it breaks:** cross-tenant billing becomes harder to explain and verify.
- **Reversibility:** prospective settings can change; historical rows remain governed by
  their saved policy.

### Recommended release choice

**Recommend A, fully paid only.** It is the smallest safe policy that the current schema
can represent without pretending one Commission row is an installment ledger. If the owner
requires proportional collection, choose B only after an adjustment ledger exists.

**Evidence that would change the recommendation:**

- Contract language saying the fee is earned on order placement regardless of payment or
  refund favors C.
- Material installment/net-30 volume plus an approved definition of retained revenue
  justifies B.
- Different signed merchant agreements with different triggers justify D.

### Full state matrix: Shopify truth × current fee state

This is the tickable 9×3 matrix. Every action cell is marked independently: **◆** is a
technical invariant with one defensible treatment; **◇** is a commercial choice. Tick one
box inside every ◇ group. A charging or paid row is never reset directly from a Shopify
order webhook.

| Shopify truth | Fee is pending | Fee is charging | Fee is paid |
|---|---|---|---|
| **Paid** | ◆ Collect the exact approved fee. | ◆ Reconcile the exact provider claim: matching success settles it; confirmed no-charge may return to eligible pending; unknown stays quarantined. | ◆ Keep the payment record immutable. |
| **Partially paid** | ◇ ☐ Defer until fully paid ☐ Charge proportionally on captured value ☐ Charge the full fee now | ◆ Reconcile first; if no charge occurred, return to the selected partially-paid rule. | ◆ Keep immutable. ◇ If policy says it is excessive: ☐ issue reviewed adjustment/credit ☐ retain it |
| **Pending, net-30** | ◇ ☐ Defer until capture ☐ Accrue on order creation ☐ Collect on contractual due date | ◆ Reconcile first; confirmed no-charge returns to the selected hold/accrual state. | ◆ Keep immutable. ◇ ☐ provider refund/credit under selected policy ☐ no relief |
| **Authorized, not captured** | ◇ ☐ Defer until capture ☐ Make fee collectible on authorization | ◆ Reconcile first; confirmed no-charge returns to the selected authorization rule. | ◆ Keep immutable. ◇ ☐ reviewed credit/refund if authorization never captures ☐ no relief |
| **Voided** | ◆ Void the unclaimed fee. | ◆ Reconcile first: confirmed no-charge becomes void; unknown stays quarantined; success becomes a paid incident. | ◆ Keep the audit record immutable and refund/credit the exact anomalous app fee after provider confirmation. |
| **Fully refunded** | ◇ ☐ Void under retained-revenue policy ☐ Retain because the sale completed ☐ Manual review | ◆ Reconcile first; never race a refund webhook against an in-flight app charge, then apply the selected refund rule. | ◆ Keep immutable. ◇ ☐ provider refund ☐ future credit ☐ retain fee |
| **Partially refunded** | ◇ ☐ Recompute on retained attributable revenue ☐ Retain original fee ☐ Manual review | ◆ Reconcile first. ◇ Any policy difference becomes ☐ adjustment/credit ☐ retained fee | ◆ Keep immutable. ◇ ☐ proportional credit/adjustment ☐ retain original fee ☐ manual review |
| **Cancelled before payment** | ◆ Void the unclaimed fee. | ◆ Reconcile first: confirmed no-charge becomes void; unknown stays quarantined; success is an incident. | ◆ Keep the audit record immutable and refund/credit the anomalous app fee after provider confirmation. |
| **Cancelled after payment** | ◆ Determine whether funds remain captured or were refunded. Then ◇ ☐ follow retained/refunded facts ☐ always waive ☐ always retain | ◆ Reconcile the exact claim first, then apply the selected captured/refunded rule. | ◆ Keep immutable. ◇ ☐ follow refund/credit policy ☐ always waive via adjustment ☐ always retain |

### Owner cross-cutting sub-decisions

- Refund basis: ☐ retained revenue ☐ original completed sale ☐ case-by-case
- Net-30 timing: ☐ wait for capture ☐ order-created accrual ☐ contractual due date
- Already collected relief: ☐ provider refund ☐ future-credit ledger ☐ no relief

**If deferred:** unsafe. Current positive rows remain pending and therefore eligible for
automatic or hosted collection regardless of payment truth.

---

## Gate 2 — Existing fee rows

**Decision in one sentence:** What should happen to historical Commission rows created
before the eligibility policy is approved?

### Choose one treatment

#### ☐ A. Evidence-based row review

- **Customer:** no change.
- **Merchant:** each row is enriched with read-only Shopify payment, cancellation and
  refund facts; the owner approves leave, void, waive or correct.
- **Implementation cost:** medium-high operational effort.
- **What it breaks:** no application behavior; optimistic snapshot checks bound mistakes.
- **Reversibility:** unclaimed pending corrections are auditable; paid/provider-bound rows
  remain untouched.

#### ☐ B. Legacy amnesty

- **Customer:** no change.
- **Merchant:** all unclaimed pending rows before an approved cutoff are waived.
- **Implementation cost:** low.
- **What it breaks:** writes off legitimate historical revenue.
- **Reversibility:** waived rows must not later be silently recollected.

#### ☐ C. Quarantine all legacy rows

- **Customer:** no change.
- **Merchant:** rows remain visible but non-collectible until evidence is available.
- **Implementation cost:** medium; requires a quarantine state and UI.
- **What it breaks:** delays legitimate collection.
- **Reversibility:** easy after evidence review.

#### ☐ D. Collect as-is

- **Customer:** no direct change.
- **Merchant:** existing pending rows are charged under old behavior.
- **Implementation cost:** none.
- **What it breaks:** can charge unpaid or cancelled orders.
- **Reversibility:** poor after provider collection.

### Recommendation

**Recommend A.** Run docs/remediation/01_commission_inventory_read_only.sql, enrich it with
authoritative Shopify facts, and use the owner-approved optimistic workflow in
docs/remediation/02_apply_owner_approved_decisions.sql. If the total collectible value is
lower than the forensic cost, B is a defensible commercial decision. Never bulk-edit
paid, charging, checkout_reserved, or a row carrying a provider reference
(docs/remediation/README.md).

**Evidence that would change the recommendation:** row count, total value, age, provider
state, and whether authoritative Shopify history is still available.

**If deferred:** safe only if legacy rows cannot be collected. Leaving them as ordinary
pending rows continues the risk.

---

## Gate 3 — Upload-line capability

**Decision in one sentence:** How should existing carts and orders transition from raw
upload IDs to signed capabilities bound to the intended product, variant and quantity?

### Choose one transition

#### ☐ A. Hard cutover

- **Customer:** old carts must remove and re-add the item; expired links fail clearly.
- **Merchant:** closes the capability gap fastest.
- **Implementation cost:** medium.
- **What it breaks:** carts created before deployment and some reorder links.
- **Reversibility:** enforcement can be relaxed, but abandoned carts are not recovered
  automatically.

#### ☐ B. Dated compatibility window

- **Customer:** new carts use signed capabilities; pre-cutover carts work for a published
  short window and then prompt re-add.
- **Merchant:** security improves without an abrupt cart loss.
- **Implementation cost:** medium-high: signed token, cutoff and audit logic.
- **What it breaks:** temporary residual exposure for legacy carts.
- **Reversibility:** the window can be extended or shortened.

#### ☐ C. Audit-only, then enforce

- **Customer:** no initial breakage.
- **Merchant:** mismatch telemetry is available before enforcement.
- **Implementation cost:** medium.
- **What it breaks:** the exploit remains possible during audit mode.
- **Reversibility:** easy.

#### ☐ D. Keep tenant-only raw IDs

- **Customer:** no change.
- **Merchant:** a known upload ID can still be attached to another product, variant or
  quantity.
- **Implementation cost:** none.
- **What it breaks:** attribution, production and fee basis remain vulnerable.
- **Reversibility:** not applicable.

### Recommendation

**Recommend B, followed by full enforcement.** Bind the signature to shop, upload, product,
variant, intended quantity and expiry. Add customer/cart binding only where guest-checkout
semantics permit it. Validate before attribution
(app/lib/orderMatching.server.ts:150-184;
app/lib/orderReconciler.server.ts:237-277,358-371).

**Evidence that would change the recommendation:** if read-only inventory shows virtually
no open pre-cutover carts, choose A.

**If deferred:** harmful; the attribution/billing/production capability remains
exploitable.

---

## Gate 4 — Reorder snapshot

**Decision in one sentence:** When a saved design is ordered again, should the new order
get an immutable order-line snapshot, a cloned upload, or no reuse?

### Choose one representation

#### ☐ A. Immutable order-line snapshot

- **Customer:** “Order again” remains seamless.
- **Merchant:** every order retains its exact measurement, object/checksum, policy, sheet,
  price, copies and production instruction.
- **Implementation cost:** high: new model, transactional writes and reader migration.
- **What it breaks:** consumers that currently explain history from mutable Upload fields
  must read the snapshot.
- **Reversibility:** additive and strong; the old row can remain during migration.

#### ☐ B. Clone on reorder

- **Customer:** seamless if existing object bytes can be referenced without re-upload.
- **Merchant:** each reorder receives a new upload identity, making order provenance
  straightforward.
- **Implementation cost:** medium.
- **What it breaks:** object lifetime/reference counting and customer-workspace grouping
  need explicit behavior.
- **Reversibility:** good for future reorders.

#### ☐ C. Prohibit reuse

- **Customer:** must upload the file again.
- **Merchant:** simplest provenance.
- **Implementation cost:** low.
- **What it breaks:** removes an advertised reorder feature and adds upload cost/latency.
- **Reversibility:** easy.

#### ☐ D. Keep the mutable singleton

- **Customer:** current experience.
- **Merchant:** later orders can overwrite facts used to explain earlier orders.
- **Implementation cost:** none.
- **What it breaks:** historical production and billing truth remain unstable.
- **Reversibility:** not applicable.

### Recommendation

**Recommend A.** It preserves the deliberate reorder experience and supplies the immutable
basis needed by capability validation, billing, history and production. B is an acceptable
smaller first step if the snapshot migration cannot ship safely.

Evidence: reorder is explicitly offered at app/routes/i.$uploadId.tsx:150-168,258.
Upload stores mutable latest-order/production facts, while OrderLink has no immutable
measurement, price or production snapshot (prisma/schema.prisma:158-200,243-257).

**Evidence that would change the recommendation:** if product requirements remove reorder,
C is sufficient; if every consumer already expects one upload per order and shared object
retention is proven safe, B may be cheaper.

**If deferred:** each reorder can make an earlier order explain differently. This is not
safe for a canary that includes reorder.

---

## Gate 5 — Main flow versus artwork bounds

**Decision in one sentence:** Should an explicit merchant measurement-basis policy govern
the main-product flow, or may that trusted flow override it to full-page sizing?

### Choose one precedence rule

#### ☐ A. Explicit shop policy always wins

- **Customer:** the same basis applies across every block.
- **Merchant:** the admin setting has one literal meaning.
- **Implementation cost:** low-medium.
- **What it breaks:** main products relying on full-page pricing can remeasure and reprice.
- **Reversibility:** prospective setting changes are easy; placed orders stay snapshotted.

#### ☐ B. Trusted main products always use full page

- **Customer:** main stays roll/full-canvas based; other flows use shop policy.
- **Merchant:** preserves current main semantics, but the global setting is not global.
- **Implementation cost:** medium; requires trusted server product/flow mapping.
- **What it breaks:** surprises a merchant who selected artwork bounds expecting every
  upload block to honor it.
- **Reversibility:** easy through trusted configuration.

#### ☐ C. Separate per-flow policy

- **Customer:** behavior is consistent within each named flow.
- **Merchant:** explicitly selects Main, DTF and Custom measurement bases independently.
- **Implementation cost:** medium-high: schema/config, admin UI, trusted flow mapping and
  policy snapshots.
- **What it breaks:** adds configuration and migration/default complexity.
- **Reversibility:** strong because each policy is explicit and snapshotted.

#### ☐ D. Browser marker continues to decide

- **Customer:** current behavior.
- **Merchant:** a client-controlled marker silently overrides saved policy.
- **Implementation cost:** none.
- **What it breaks:** sizing authority and explainability remain wrong.
- **Reversibility:** not applicable.

### Recommendation

**Recommend C**, with current live tenants defaulted to their existing effective behavior
and no implicit pricing change. It represents both potentially legitimate policies without
silent precedence. Choose A instead if the owner confirms the admin promise “every upload
block” is contractual.

Evidence: the marker forces full page in
app/lib/mainProductMeasurement.server.ts:52-59; the shared resolver applies main projection
instead of the selected basis at app/lib/sheetResolution.server.ts:499-575; the admin UI
describes a store-wide policy at app/routes/app.customer-pricing.tsx:2223-2253.

**Evidence that would change the recommendation:** a signed product catalog proving all
main products deliberately require full page favors B; a written universal policy favors
A.

**If deferred:** known legacy/null settings may remain stable, but enabling explicit
artwork_bounds is unsafe.

---

## Gate 6 — Roll width versus printable width

**Decision in one sentence:** Does a configured width such as 22 inches mean physical
media width or printable artwork width after margins?

### Choose one meaning

#### ☐ A. Physical media width; anchor no-DPI artwork to printable width

- **Customer:** a no-DPI file anchors to media width minus margins and then fits the same
  printable boundary.
- **Merchant:** physical roll and safety margins retain distinct meanings.
- **Implementation cost:** medium.
- **What it breaks:** no-DPI inches change for products with non-zero margins.
- **Reversibility:** configurable for future uploads; ordered files stay snapshotted.

#### ☐ B. Saved width means printable width

- **Customer:** anchor and fit use the same number.
- **Merchant:** simple single field, but physical roll width becomes implicit.
- **Implementation cost:** low-medium.
- **What it breaks:** an existing value entered as physical width becomes too permissive.
- **Reversibility:** only after an explicit per-product migration choice.

#### ☐ C. Store physical media width and printable width separately

- **Customer:** receives consistent sizing and a clear rejection explanation.
- **Merchant:** no semantic ambiguity; validation can require printable ≤ physical.
- **Implementation cost:** high: settings, UI, runtime, snapshots and migration.
- **What it breaks:** every existing one-field configuration needs an owner-approved
  mapping.
- **Reversibility:** strong once both values are explicit.

#### ☐ D. Keep physical anchoring and then subtract margins

- **Customer:** artwork anchored to 22 inches can fail against 21.75 printable inches.
- **Merchant:** current mechanical behavior.
- **Implementation cost:** none.
- **What it breaks:** creates self-rejection and support confusion.
- **Reversibility:** not applicable.

### Recommendation

**Recommend C.** For a smaller first release, A is coherent if the owner confirms margins
are non-printable media. Do not migrate dtfprinthouse or alphaprintcenter implicitly.

Evidence: main no-DPI anchoring and fit are separate operations
(app/lib/mainProductMeasurement.server.ts:174-195;
app/lib/dtfSheetResolver.server.ts:577-625). Read-only live configuration evidence included
0.125-inch margins.

**Evidence that would change the recommendation:** written confirmation that every stored
width already means printable width favors B.

**If deferred:** harmful for no-DPI files on non-zero-margin products.

---

## Gate 7 — Rotation and tolerance on the Shopify order

**Decision in one sentence:** How should canonical “rotate 90°” and tolerance instructions
reach production staff without changing the three-property contract?

### Three-property consumer inventory

| Consumer | Current use | Enrich an existing value | Order note | Order metafield |
|---|---|---|---|---|
| extensions/theme-extension/assets/ul-line-properties.js; app/routes/api.cart.prepare.tsx; app/routes/api.vip.checkout.tsx; app/routes/api.storefront.reorder-designs.tsx | Canonical writers of Print Ready, Sheet Identity and DPI. | Every writer and fallback must change together. | No effect on property generation. VIP already writes canonical production text into its draft note. | No effect unless explicitly written later. |
| extensions/theme-extension/assets/main-product-upload-app.js; extensions/theme-extension/assets/dtf-upload.js | Main has a local three-property fallback; DTF has a Print Ready/DPI fallback when the shared builder is unavailable. | Any enrichment can diverge between canonical and fallback carts; DTF's fallback already lacks Sheet Identity. | No effect. | No effect. |
| extensions/theme-extension/assets/main-product-upload-app.js; custom-price-upload-mod2.js | Find/synchronize cart lines with Sheet Identity; some paths compare the exact value. | Changing identity text or URL can create duplicate adds or failed exact reconciliation. | Can coexist, but standard carts need idempotent append/preservation. | No current reader. |
| extensions/theme-extension/assets/cart-upload-display.js | Parses upload ID from Sheet Identity; treats Print Ready as a file URL. | Enriched URLs can stop parsing or linking. | Not consumed. | Not consumed. |
| extensions/checkout-upload-display/src/CheckoutLineItem.jsx | Links Print Ready and links/parses Sheet Identity. | Enriched URL values can break links or ID extraction. | This extension does not consume it. | Not consumed. |
| extensions/theme-extension/assets/confirmation-screen.js | Uses property presence to recognize an upload line. | Usually remains truthy, but does not surface the instruction. | Not consumed. | Not consumed. |
| app/lib/orderMatching.server.ts and app/lib/orderReconciler.server.ts | Identity/file URLs prove attribution; DPI is not an identity carrier. | Enriching either URL risks lost attribution; enriching DPI corrupts its numeric meaning. | VIP note parsing tolerates following production text. | Reconciler writes order metafields, but current JSON lacks rotation/tolerance. |
| app/routes/i.$uploadId.tsx | Reads DB cartSheetLabel, not order properties. | No benefit. | No benefit. | No current reader. |
| workers/export.worker.ts and admin upload pages | Read DB/OrderLink/item facts, not the three property values. | No benefit and no added production visibility. | Useful only when production staff work from the Shopify order. | Requires a production UI/tool consumer. |
| ul-carousel.js, ul-showcase.js and theme blocks | Delegate line-property creation; no independent production parser. | Indirect compatibility risk. | No current consumer. | No current consumer. |

Exact evidence includes extensions/theme-extension/assets/ul-line-properties.js:9-41,
extensions/theme-extension/assets/main-product-upload-app.js:3014-3022,
extensions/theme-extension/assets/dtf-upload.js:2169-2170,
extensions/theme-extension/assets/custom-price-upload-mod2.js:380-391,
extensions/theme-extension/assets/cart-upload-display.js:176-184,616-620,
extensions/theme-extension/assets/confirmation-screen.js:68-74,138-145,
extensions/theme-extension/assets/ul-carousel.js:131,
extensions/theme-extension/assets/ul-showcase.js:126,
extensions/checkout-upload-display/src/CheckoutLineItem.jsx:42-44,88-96,
app/lib/orderMatching.server.ts:26-32,150-184,
app/routes/api.cart.prepare.tsx:337-339,
app/routes/api.storefront.reorder-designs.tsx:92-94,
app/routes/api.vip.checkout.tsx:223-269,301-308,
app/routes/i.$uploadId.tsx:163-177,
app/lib/orderReconciler.server.ts:563-608, and
workers/export.worker.ts:274-284,411-426.

### Choose one delivery channel

#### ☐ A. Namespaced order-note section

- **Customer:** the three line properties remain unchanged.
- **Merchant/production:** normal Shopify order view shows a per-upload instruction such as
  “Upload Studio Production: abc123 — Rotate artwork 90°; tolerance applied.”
- **Implementation cost:** medium: append idempotently, preserve customer/other-app notes,
  enforce length and map each upload/line.
- **What it breaks:** order-note collisions or truncation if preservation is wrong; cart
  notes can be edited.
- **Reversibility:** easy for future orders; existing notes remain.

#### ☐ B. Structured order metafield plus a production-surface reader

- **Customer:** no storefront change; Print Ready, Sheet Identity and DPI remain unchanged.
- **Merchant/production:** canonical per-line rotation and tolerance JSON is rendered in
  the production surface staff actually use—Shopify Admin, the export manifest, Upload
  Studio's queue or approved print tooling—before artwork is downloaded or printed.
- **Implementation cost:** medium-high: write a versioned metafield from canonical server
  resolution, add and test the reader in the selected production surface, and monitor
  metafield-write and reader-version failures.
- **What it breaks:** an unavailable, stale or unrecognized reader can hide the
  instruction; writer and reader therefore need coordinated schema-version handling and a
  visible fail/review state.
- **Reversibility:** additive. The reader can be disabled while retaining historical
  metafield data, but orders already processed using the instruction must not be rewritten.

#### ☐ C. Enrich one of the three existing values

- **Customer:** may see the instruction beside a familiar property.
- **Merchant/production:** immediate line-level visibility.
- **Implementation cost:** low.
- **What it breaks:** Print Ready and Sheet Identity must remain URLs; DPI must remain
  numeric. Cart, checkout and reconciler consumers can break.
- **Reversibility:** poor for mixed-format carts and orders.

#### ☐ D. Add a fourth line property

- **Customer:** the instruction is visible on the line.
- **Merchant/production:** best native line-level visibility.
- **Implementation cost:** low-medium.
- **What it breaks:** violates the explicit three-property contract and changes every
  block/order presentation.
- **Reversibility:** future-only.

### Recommendation

**Recommend A only after an operational walkthrough confirms that every production job is
opened from a Shopify surface that always shows the order note.** Generate it server-side
from canonical resolution and append a namespaced, idempotent, per-upload section without
overwriting an existing note. The immutable DB/order snapshot remains authoritative; the
note is an operational mirror. If staff instead work from the export artifact or Upload
Studio admin queue, A does not reach them: choose B only together with a reader in that
actual production surface. Until one of those visibility checks passes, do not approve
either delivery channel.

**Evidence that would change the recommendation:** a walkthrough proving Shopify order
notes are mandatory confirms A; a walkthrough proving a pinned/order-tool metafield is
always visible favors B; an export/admin-first workflow requires adding the instruction to
that consumer. Owner approval to change the hard contract is required for D.

**If deferred:** rotated or clamped jobs remain mathematically correct but operationally
ambiguous from the normal Shopify order, so production can print in the wrong orientation.

---

## Gate 8 — Volume-tier scope

**Decision in one sentence:** Does a volume threshold apply to each file, the aggregate
current checkout, or historical-plus-current customer volume?

### Choose one scope

#### ☐ A. Per file

- **Customer:** splitting or combining artwork changes price; two 150-inch files stay in
  the lower tier independently.
- **Merchant:** matches per-file setup economics if that is the intended rule.
- **Implementation cost:** low; current custom checkout is close to this behavior.
- **What it breaks:** disagrees with standard aggregate-cart behavior and permits
  split/merge surprises.
- **Reversibility:** easy for future quotes.

#### ☐ B. Per checkout aggregate

- **Customer:** all eligible inches in one checkout choose one tier; two 150-inch files use
  the 300-inch tier.
- **Merchant:** consistent and resistant to file-splitting arbitrage.
- **Implementation cost:** medium: calculate tier context once and pass it into every item
  quote.
- **What it breaks:** changes existing multi-file custom checkout prices.
- **Reversibility:** future quotes only; placed orders stay unchanged.

#### ☐ C. Historical plus current

- **Customer:** prior paid volume can unlock a tier before the present checkout reaches it.
- **Merchant:** stronger loyalty program with larger discount exposure.
- **Implementation cost:** high: immutable paid snapshots, approved time window and
  deterministic history.
- **What it breaks:** current mutable/unordered history cannot support it safely.
- **Reversibility:** policy is configurable, but earned customer expectations need
  communication.

### Recommendation

**Recommend B.** It matches the standard main-product flow and makes the price independent
of how a customer packages the same order.

Evidence: custom checkout selects a tier per upload at
app/lib/customerPricingCheckout.server.ts:570-578,675-682 and then sums items at
743-756; the standard storefront aggregates ready cart inches before selecting a tier at
extensions/theme-extension/assets/main-product-upload-app.js:840-854. At default example
rates, two 150-inch files are $84 per-file versus $66 as an aggregate 300 inches.

**Evidence that would change the recommendation:** written policy tying thresholds to
per-file setup cost favors A; explicit loyalty-program terms favor C.

**If deferred:** active flows continue to quote the same basket differently.

---

## Gate 9 — Meaning of “lowest total cost”

**Decision in one sentence:** Whose cost should the “Cheapest total” sheet-selection
strategy minimize?

### Choose one cost function

#### ☐ A. Customer's authoritative payable amount

- **Customer:** “Cheapest total” is literally true for the current account and tier.
- **Merchant:** selection follows the same pricing function as checkout.
- **Implementation cost:** medium-high: candidate ranking must receive the authoritative
  rate/tier context.
- **What it breaks:** custom-priced customers can receive a different sheet than today.
- **Reversibility:** future resolutions only.

#### ☐ B. Shopify retail variant total

- **Customer:** correct for retail buyers, potentially wrong for account-rate buyers.
- **Merchant:** current implementation.
- **Implementation cost:** none.
- **What it breaks:** a sheet can be cheapest by retail price but more expensive under the
  customer's actual rate.
- **Reversibility:** not applicable.

#### ☐ C. Merchant production cost

- **Customer:** may not receive the lowest payable amount.
- **Merchant:** can optimize margin or production efficiency if an authoritative cost
  model exists.
- **Implementation cost:** high: production-cost data and a renamed strategy/UI.
- **What it breaks:** no authoritative production-cost input exists today.
- **Reversibility:** prospective policy changes are easy.

#### ☐ D. Remove the cost strategy and choose smallest fitting sheet

- **Customer:** receives a predictable physical rule, not necessarily the cheapest price.
- **Merchant:** simple explanation.
- **Implementation cost:** low.
- **What it breaks:** removes a current policy choice.
- **Reversibility:** easy.

### Recommendation

**Recommend A** while retaining the “Cheapest total” label. If the owner means production
economics, choose C and rename the policy explicitly.

Evidence: the resolver ranks retail variant price × sheet count at
app/lib/dtfSheetResolver.server.ts:721-769, while custom variant-length checkout charges
selected sheet length × sheet count × account/tier rate at
app/lib/customerPricingCheckout.server.ts:669-700.

**Evidence that would change the recommendation:** an approved merchant production-cost
table and a renamed objective favor C.

**If deferred:** shops using custom rates can receive a sheet that is not cheapest under
the amount actually charged.

---

## Gate 10 — VIP draft-order idempotency

**Decision in one sentence:** How should a retry return the same Shopify draft rather than
create another payable draft?

### Choose one design

#### ☐ A. Durable client request token and unique claim

- **Customer:** a retry or second tab returns the same checkout URL.
- **Merchant:** exactly one draft exists per logical request; unknown Shopify outcomes stay
  recoverable.
- **Implementation cost:** medium-high: schema, transaction, request digest and recovery.
- **What it breaks:** clients must create and retain a stable request token.
- **Reversibility:** additive and safe.

#### ☐ B. Deterministic basket fingerprint with a time window

- **Customer:** most accidental retries deduplicate.
- **Merchant:** two legitimate identical reorders inside the window can be conflated.
- **Implementation cost:** medium.
- **What it breaks:** a fingerprint cannot prove customer intent.
- **Reversibility:** the window can change.

#### ☐ C. Query Shopify after creation and deduplicate by tag/metafield

- **Customer:** some retries recover the old draft.
- **Merchant:** concurrent calls can still create two drafts before either is discoverable.
- **Implementation cost:** medium.
- **What it breaks:** no true uniqueness boundary exists.
- **Reversibility:** easy.

#### ☐ D. Disable automated VIP draft creation

- **Customer:** needs manual assistance.
- **Merchant:** duplicate payable drafts are impossible.
- **Implementation cost:** low technical, high operational.
- **What it breaks:** removes automated custom checkout.
- **Reversibility:** easy.

### Recommendation

**Recommend A.** Persist token, request digest, claim state, Shopify draft ID and invoice
URL. An identical replay returns the stored result; a mismatched use of the same token
fails.

Evidence: each request directly invokes draftOrderCreate without a durable claim at
app/routes/api.vip.checkout.tsx:315-325.

**Evidence that would change the recommendation:** a provider-supported idempotency key
with documented draft-order guarantees could replace the local claim.

**If deferred:** normal retries or two tabs can create duplicate payable drafts.

---

## Gate 11 — Hosted-checkout expiry

**Decision in one sentence:** How long should an unpaid hosted fee checkout reserve rows,
and how should rows recover when the expiry webhook never arrives?

### Choose one lifecycle

#### ☐ A. Explicit approximately 60-minute session, expiry webhook and verified sweeper

- **Customer:** an expired link clearly offers creation of a new checkout.
- **Merchant:** fees reappear only after Stripe/PayPal confirms
  expired/cancelled/unpaid; a missing webhook is recovered through exact API verification.
- **Implementation cost:** medium-high.
- **What it breaks:** very slow payers need a new link; the provider-supported expiry
  limit must be verified before implementation.
- **Reversibility:** expiry duration is configurable.

#### ☐ B. Provider default window and expiry webhook only

- **Customer:** has a long time to finish.
- **Merchant:** waits for the provider default; a missed event can strand rows.
- **Implementation cost:** low-medium.
- **What it breaks:** recovery depends entirely on webhook subscription and delivery.
- **Reversibility:** easy.

#### ☐ C. Manual reconciliation and release only

- **Customer:** abandoned fees remain unavailable until support intervenes.
- **Merchant:** safest from an accidental release, with high operational latency.
- **Implementation cost:** low code, high support.
- **What it breaks:** does not scale.
- **Reversibility:** manual.

#### ☐ D. Release on elapsed local time without provider proof

- **Customer:** quickly gets another payment attempt.
- **Merchant:** an old payment can succeed after rows reopen, enabling double collection.
- **Implementation cost:** low.
- **What it breaks:** violates the exact-reservation safety boundary.
- **Reversibility:** unsafe.

### Recommendation

**Recommend A**, subject to official provider limits and owner confirmation that about
60 minutes is sufficient. The sweeper must query the exact provider session/order and
release only the exact reservation snapshot on confirmed expired/cancelled/unpaid state.
Unknown stays quarantined.

Evidence: pending rows become checkout_reserved atomically at
app/lib/hostedCheckoutReservation.server.ts:135-222; the Stripe dispatcher does not handle
checkout.session.expired at app/lib/stripeWebhookHandlers.server.ts:153-165.

**Evidence that would change the recommendation:** measured merchant checkout completion
times above one hour justify a longer explicit duration; guaranteed webhook delivery plus
an operational retry source could make B sufficient.

**If deferred:** harmful. Reservations can remain unavailable to every collection path
indefinitely.

---

## Gate 12 — Ghost-row concurrency

**Decision in one sentence:** What invariant should guarantee one missing-upload ghost per
Shopify order line under concurrent webhook topics?

### Choose one concurrency boundary

#### ☐ A. Partial unique index and transactional upsert

- **Customer:** no change.
- **Merchant:** exactly one ghost per non-null line ID.
- **Implementation cost:** medium: duplicate inventory, migration and conflict-safe upsert.
- **What it breaks:** migration fails if existing duplicates are not reviewed first.
- **Reversibility:** the index can be removed; already created data remains.

#### ☐ B. Per-order advisory or serializable lock

- **Customer:** no change.
- **Merchant:** application writers serialize while they all honor the lock.
- **Implementation cost:** medium.
- **What it breaks:** no durable invariant protects scripts or future writers; contention
  can increase.
- **Reversibility:** easy.

#### ☐ C. Allow duplicates and run a deduplicator

- **Customer:** no change.
- **Merchant:** queue can briefly show duplicate missing jobs.
- **Implementation cost:** medium.
- **What it breaks:** production can act before cleanup.
- **Reversibility:** easy.

#### ☐ D. Stop creating ghosts; audit only

- **Customer:** no visible change.
- **Merchant:** no duplicate ghost rows, but the operational queue loses its missing-file
  object.
- **Implementation cost:** low.
- **What it breaks:** changes established missing-file handling.
- **Reversibility:** easy.

### Recommendation

**Recommend A:** unique (shopId, orderId, lineItemId) where lineItemId is not null, plus a
transactional upsert. Existing uniqueness covers only (orderId, uploadId)
(prisma/schema.prisma:243-257). Inventory duplicates before applying the index.

**Evidence that would change the recommendation:** proof that a single ordered webhook
consumer is the sole writer could make B adequate, though the DB invariant remains safer.

**If deferred:** low-frequency but real duplicate production rows remain possible.

---

## Gate 13 — PayPal denial handling

**Decision in one sentence:** Where should a denied PayPal reservation appear, and who must
be notified?

### Choose one operational destination

#### ☐ A. Review queue plus one deduplicated email

- **Customer:** the provider denial remains visible at checkout.
- **Merchant:** receives an actionable item with reservation, order IDs, amount and
  provider reference.
- **Implementation cost:** medium.
- **What it breaks:** can create email noise without deduplication and ownership.
- **Reversibility:** notification policy is configurable.

#### ☐ B. In-app review queue only

- **Customer:** same.
- **Merchant:** sees a clear dashboard item but must open the app.
- **Implementation cost:** medium.
- **What it breaks:** response can be slower.
- **Reversibility:** easy.

#### ☐ C. Canonical audit only

- **Customer:** same.
- **Merchant:** support can search logs; routine operators see nothing.
- **Implementation cost:** low.
- **What it breaks:** repeats the current visibility problem.
- **Reversibility:** easy.

#### ☐ D. Keep the legacy lookup

- **Customer:** same.
- **Merchant:** current hosted reservations can stay unmatched.
- **Implementation cost:** none.
- **What it breaks:** the handler searches obsolete audit actions.
- **Reversibility:** not applicable.

### Recommendation

**Recommend A.** Match the current reservation/session reference and emit one canonical
idempotent review record.

Evidence: denial searches paypal_order_created/paypal_payment_captured at
app/routes/api.webhooks.paypal.tsx:186-213, while current hosted checkout records
paypal_checkout_created through app/lib/hostedCheckoutReservation.server.ts:265-281.

**Evidence that would change the recommendation:** absence of a named billing-email owner,
combined with a staffed queue and measured daily response, favors B.

**If deferred:** denied reservations can remain stranded and invisible.

---

## Gate 14 — Refund-review visibility

**Decision in one sentence:** What operational channel and service-level target should
handle app-fee review after Stripe or PayPal reports a refund?

### Choose one operating model

#### ☐ A. In-app queue, deduplicated email and one-business-day target

- **Customer:** the customer refund is not blocked by the app-fee review.
- **Merchant:** a new item is visible and actively notified; staff acknowledge and resolve
  it.
- **Implementation cost:** medium-high.
- **What it breaks:** creates email/support process unless ownership and deduplication are
  explicit.
- **Reversibility:** channel and target are configurable.

#### ☐ B. In-app queue only

- **Customer:** same.
- **Merchant:** receives a central workflow but must check the app regularly.
- **Implementation cost:** medium.
- **What it breaks:** items can age unnoticed.
- **Reversibility:** easy.

#### ☐ C. External operations webhook or ticket

- **Customer:** same.
- **Merchant:** uses an existing finance/operations desk.
- **Implementation cost:** medium-high integration effort.
- **What it breaks:** introduces delivery, retry, permission and security dependencies.
- **Reversibility:** the integration can be disabled.

#### ☐ D. Audit log only

- **Customer:** same.
- **Merchant:** no operational consumer is expected to see the signal.
- **Implementation cost:** none.
- **What it breaks:** current harm continues.
- **Reversibility:** not applicable.

### Recommendation

**Recommend A** until actual volume proves email unnecessary. Show provider/event
reference, immutable reservation snapshot, affected rows, refund amount and required
policy action. Resolution creates a separate adjustment; it never reopens paid.

Evidence: producers exist at app/lib/stripeWebhookHandlers.server.ts:120-148 and
app/routes/api.webhooks.paypal.tsx:239-268; repository search found no UI or notification
consumer.

**Evidence that would change the recommendation:** an existing staffed ticketing
integration favors C; very low volume plus demonstrated daily app use may justify B.

**If deferred:** harmful; refund-review signals are recorded without an expected reader.

---

## Gate 15 — Historical volume eligibility

**Decision in one sentence:** What completed-purchase history, if any, should count toward
automatic volume pricing?

### Choose one eligibility basis

#### ☐ A. Rolling paid-snapshot window plus current checkout

- **Customer:** receives a predictable loyalty benefit based on recent paid volume.
- **Merchant:** discounts use the inches/sheets actually billed.
- **Implementation cost:** high: immutable order snapshots, deterministic query and an
  approved time window.
- **What it breaks:** incomplete backfill can change eligibility relative to today's
  arbitrary slice.
- **Reversibility:** the time window can change prospectively.

Owner window: ☐ 3 months ☐ 6 months ☐ 12 months ☐ other: __________

#### ☐ B. Lifetime paid snapshots plus current checkout

- **Customer:** eligibility only increases over time.
- **Merchant:** takes the largest long-term discount exposure.
- **Implementation cost:** high.
- **What it breaks:** old purchases affect margin permanently.
- **Reversibility:** hard without customer communication.

#### ☐ C. Current checkout only

- **Customer:** receives no historical loyalty carryover.
- **Merchant:** simple and deterministic.
- **Implementation cost:** low.
- **What it breaks:** removes automatic returning-volume benefit.
- **Reversibility:** easy.

#### ☐ D. Manual tag/status only

- **Customer:** pricing depends on a merchant-assigned account status.
- **Merchant:** full control without automatic history.
- **Implementation cost:** low-medium.
- **What it breaks:** creates manual administration and delayed qualification.
- **Reversibility:** easy.

### Recommendation

**Recommend A with an owner-approved window**, after immutable order-line snapshots exist.
Count the authoritative billed basis, not mutable upload long edge.

Evidence: app/lib/customerPricingRuntime.server.ts:136-182 reads at most 500 Upload rows
without orderBy and estimates long edge × copies, ignoring matched-sheet length and nesting.

**Evidence that would change the recommendation:** a contractual lifetime loyalty promise
favors B; a decision that volume tiers apply only to each purchase favors C; a deliberately
curated account program favors D.

**If deferred:** harmful if history automation remains enabled because eligibility can be
unstable or wrong. Waiting is safe only when tags/manual status govern eligibility.

---

## Gate 16 — Order #42909 provenance

**Decision in one sentence:** Should the owner authorize a time-boxed investigation outside
Upload Studio, rely on customer evidence, or close the case as indeterminate?

### Choose one primary evidentiary route

#### ☐ A. Read-only GS Studio forensic review

- **Customer:** no change unless evidence answers the question.
- **Merchant:** best chance to identify the source file/background through object, log or
  session evidence.
- **Implementation cost:** external access and reviewer time.
- **What it breaks:** nothing in Upload Studio.
- **Reversibility:** fully read-only.

#### ☐ B. Customer-supplied original/session evidence

- **Customer:** is asked for the original file, receipt or available browser/session
  evidence.
- **Merchant:** lower technical access burden with weaker proof.
- **Implementation cost:** low-medium support effort.
- **What it breaks:** evidence can be incomplete or altered.
- **Reversibility:** fully reversible.

#### ☐ C. Close as indeterminate

- **Customer:** receives an honest limitation statement.
- **Merchant:** makes no unsupported provenance claim.
- **Implementation cost:** none.
- **What it breaks:** the question remains unanswered.
- **Reversibility:** investigation can reopen if evidence appears.

### Recommendation

**Recommend A as a short read-only investigation** because the merchant asked a concrete
question. If GS Studio evidence is unavailable, choose C rather than infer. Preserve the
current foreign-app skip.

Evidence: the only line properties point at the separate GS Studio app and Upload Studio
has no Upload/Object/OrderLink source for this order. Foreign markers are intentionally
skipped by app/lib/orderMatching.server.ts:101-120 and
app/lib/orderReconciler.server.ts:371-394.

**Evidence that would change the recommendation:** a customer-provided original with a
verifiable hash/session record may make B conclusive.

**If deferred:** application behavior is safe, but logs and object versions may expire.

---

## Gate 17 — nC9ES4OSlUeK missing object

**Decision in one sentence:** Which evidence path should distinguish skipped multipart
completion from an object that was later absent?

### Choose one investigation policy

#### ☐ A. Incident-specific browser HAR and storage audit/request IDs

- **Customer:** no new upload is required if retained evidence exists.
- **Merchant:** can directly correlate intent, part completion, final object and worker
  read.
- **Implementation cost:** low-medium access effort.
- **What it breaks:** likely impossible if browser/storage retention has expired.
- **Reversibility:** read-only.

#### ☐ B. Controlled staging reproduction with the same file and network conditions

- **Customer:** no production impact.
- **Merchant:** can test interruption, resume and finalization cases.
- **Implementation cost:** medium-high.
- **What it breaks:** a successful replay does not prove the historical cause.
- **Reversibility:** fully reversible.

#### ☐ C. Accept this case as unknown and add a durable completion receipt for future cases

- **Customer:** future failures become explainable; this incident remains unresolved.
- **Merchant:** receives request/object IDs and an auditable completion boundary.
- **Implementation cost:** medium schema/logging work.
- **What it breaks:** does not answer the old event.
- **Reversibility:** additive.

#### ☐ D. Close as a one-off without instrumentation

- **Customer:** retry remains the only remedy.
- **Merchant:** lowest cost.
- **Implementation cost:** none.
- **What it breaks:** recurrence remains unexplainable.
- **Reversibility:** not applicable.

### Recommendation

**Recommend A as the selected investigation.** If evidence retention is already gone, A
cannot execute; return this decision to the owner and select C rather than silently
combining investigation policies.

Evidence: the measure job failed after 264 ms with object-not-found and no multipart-
complete log was found. That places the failure at storage availability, not image
measurement, but does not prove why the object was absent.

**Evidence that would change the recommendation:** a retained HAR or storage request audit
settles A; a deterministic staging reproduction can make B the primary root-cause proof.

**If deferred:** historical evidence decays and a recurrence remains difficult to
distinguish.

---

## Gate 18 — Post-change 475 MP performance

**Decision in one sentence:** What comparison is sufficient to approve the large-image
performance canary?

### Choose one experiment

#### ☐ A. Offline benchmark of identical bytes in the reviewed container image

- **Customer:** no impact.
- **Merchant:** receives reproducible download, identify, trim, measure, preview, CPU and
  RSS numbers without a production write.
- **Implementation cost:** medium; requires an authorized offline file copy.
- **What it breaks:** local/staging cgroups and storage latency may differ from production.
- **Reversibility:** fully reversible.

#### ☐ B. Explicitly approved production-container temp profile, followed by deletion

- **Customer:** possible temporary contention if poorly scheduled.
- **Merchant:** receives the highest environment fidelity.
- **Implementation cost:** medium operational coordination.
- **What it breaks:** writes temporary data and consumes production CPU; requires separate
  explicit approval before execution.
- **Reversibility:** the temp copy can be removed; resource impact cannot be undone.

#### ☐ C. Passive telemetry on the next naturally uploaded equivalent file

- **Customer:** one real upload exercises the canary.
- **Merchant:** avoids copying an old object, but file comparability and timing are
  uncertain.
- **Implementation cost:** medium-low implementation and unknown wait.
- **What it breaks:** it is not an identical-byte comparison.
- **Reversibility:** stop the canary.

#### ☐ D. Ship without comparative timing

- **Customer:** may continue waiting minutes for a large image.
- **Merchant:** performance benefit remains unproved.
- **Implementation cost:** none.
- **What it breaks:** no objective regression decision is possible.
- **Reversibility:** rollback only after exposure.

### Recommendation

**Recommend A**, using identical SHA-256 bytes, ImageMagick 6 version, command arguments
and container resource limits. If environment variance prevents a decision, A has failed;
return to the owner to select B and explicitly approve its temporary write.

Evidence: read-only logs measured qWk_2QWCTw5B at 152,889 ms and TURk3zVwowT8 at
164,010 ms. The supplied profile—download 1.9 s, identify 15.4 s, trim 73.7 s, streaming
scan 35.1 s—was not independently rerun. The local full-page change skips that trim class,
but no post-change identical-byte timing exists.

**Evidence that would change the recommendation:** a naturally arriving file with the same
hash/class and complete stage telemetry could make C sufficient.

**If deferred:** there is no numerical basis to approve the claimed improvement; this
should block the alphaprint canary.

---

## Gate 19 — Live theme inventory

**Decision in one sentence:** How will the owner prove which extension block and asset
version is actually active on each canary storefront?

### Choose one inventory method

#### ☐ A. Read-only Shopify Theme API inventory

- **Customer:** no impact.
- **Merchant:** gets exact theme, template, app block, settings and asset/version facts.
- **Implementation cost:** low once read access exists.
- **What it breaks:** nothing.
- **Reversibility:** read-only.

#### ☐ B. Merchant-led Theme Editor/manual inventory

- **Customer:** no impact.
- **Merchant:** screenshots/checklist establish visible blocks, but hidden or duplicate
  templates may be missed.
- **Implementation cost:** low technical, medium merchant time.
- **What it breaks:** human omission risk.
- **Reversibility:** read-only.

#### ☐ C. Runtime block/version beacon

- **Customer:** no visible change.
- **Merchant:** sees which code executes on real pages.
- **Implementation cost:** medium and requires a future deployment.
- **What it breaks:** cannot approve the deployment that first introduces it unless an
  equivalent beacon already exists.
- **Reversibility:** easy to remove.

#### ☐ D. Assume shipped assets equal active assets

- **Customer:** no immediate change.
- **Merchant:** fastest path.
- **Implementation cost:** none.
- **What it breaks:** the canary may test a block/version no customer actually uses.
- **Reversibility:** not applicable.

### Recommendation

**Recommend A.** Record theme ID, template/product, block type, extension/asset version,
settings and product mapping for dtfprinthouse and alphaprint before canary. Manual
screenshots may accompany the inventory as evidence, but they do not become a second
authoritative method.

**Evidence that would change the recommendation:** if Theme API access remains unavailable,
a signed manual export plus page-source/asset verification can make B sufficient. C is
useful for future releases but cannot replace pre-canary inventory now.

**If deferred:** unsafe; test and monitoring coverage cannot be mapped to the storefront
code customers actually execute.

---

## Owner answer sheet

| Gate | Selected option | Required sub-decision or evidence | Owner/date |
|---|---|---|---|
| 1. Fee eligibility |  | Refund, net-30 and relief selections |  |
| 2. Existing fee rows |  | Read-only inventory totals |  |
| 3. Upload-line capability |  | Compatibility cutoff/window |  |
| 4. Reorder snapshot |  | Snapshot or clone migration boundary |  |
| 5. Main vs artwork bounds |  | Trusted flow/product mapping |  |
| 6. Roll vs printable width |  | Meaning of each live stored width |  |
| 7. Rotation on Shopify order |  | Production staff visibility proof |  |
| 8. Tier scope |  | Per-file, checkout or history definition |  |
| 9. Lowest total cost |  | Customer, retail or production objective |  |
| 10. VIP idempotency |  | Token lifetime/replay behavior |  |
| 11. Hosted expiry |  | Duration and provider verification route |  |
| 12. Ghost concurrency |  | Read-only duplicate inventory |  |
| 13. PayPal denial |  | Queue/email owner |  |
| 14. Refund review |  | Destination and SLA |  |
| 15. Historical eligibility |  | Window and billable basis |  |
| 16. #42909 provenance |  | GS Studio/customer evidence access |  |
| 17. nC9 missing object |  | Retained HAR/storage audit availability |  |
| 18. 475 MP timing |  | Offline copy or explicit temp-write approval |  |
| 19. Live theme inventory |  | Read-only Theme API/session |  |

No gate is implemented merely by ticking this sheet. Each approved decision still needs a
separate scoped change, tests, before/after evidence and the canary boundary described in
the correctness report.
