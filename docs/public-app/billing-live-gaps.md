# Public billing: observed outcomes and remaining bounded proofs

Checked 2026-10-10, UTC. This document distinguishes a real Shopify TEST result
from a simulated transport test. It is not an App Store publication claim.
Scope is ONLY public app `8822c01b1f0be2280240cfab7d4e9a79`, NEW host
`607746803` / `143.198.12.234`, and the three explicitly approved demo shops.
Existing custom apps, their hosts, queues and billing are excluded.

## 1. Current genuine orders: read-only CLI/container observations

Observed local database at `2026-10-10T02:23:46.924Z`; provider queries at
`02:23:47.288–47.786Z`. Each local query used bare Prisma in a transaction whose
first statement was `SET TRANSACTION READ ONLY`, with explicit shop ownership.
Shopify requests were GraphQL **queries**, using the already stored token in
memory; no SDK refresh, subscription synchronization or collector was invoked.
Host metadata, public app client/URL and dedicated PostgreSQL host/database/user
were checked before reads. No secrets or buyer contacts are included here.

| Fact | Variant order #1001 | Measured order #1002 |
| --- | --- | --- |
| Actual Shopify order ID | `18946622095581` | `18946639954141` |
| Provider financial state | TEST, PAID, not cancelled | TEST, PAID, not cancelled |
| Merchandise / total | USD200 / USD200 | USD23.40 / USD31.40 |
| Successful capture | `20824185176285`, USD200, `01:58:58Z` | `20824210964701`, USD31.40, `02:11:31Z` |
| Upload | `9FGuJnpLcKnq` | `hhVLFBMcIjVW` |
| Local order link | **Absent** | Present, line `50810958348509`, created `02:11:31.925Z` |
| Local commission / provider usage | **Absent** | One USD0.82 recorded commission, one matching usage record |

#1001's upload remained `pending_approval`, `orderId/orderName/orderPaidAt=null`,
`requestedCopies=5`, `sheetsNeeded=5`, selected variant `68056763105501`, label
`22 x 80`; checkout was accepted at `01:57:00.649Z`. It is not recovered merely
because the corrected code is deployed. If attributed after genuine delivery,
the expected fee is `min(200 × 0.035, 6) = USD6`; that result is still unproven.

#1002 exact accounting/provider identity:

```text
Commission: cmv1rd5gv0005wc7dwrw5bt1i
status: paid (= Shopify usage recorded, NOT merchant invoice paid)
order total: USD31.40
attributableCapturedAmount / servedAmountUsd: USD23.40
commissionRate: 0.035
commissionAmount: USD0.82
collectibleAt: 2026-10-10T02:11:31.000Z
usageRequestStartedAt: 2026-10-10T02:15:05.557Z
paidAt: 2026-10-10T02:15:05.798Z
usageSubscriptionId: gid://shopify/AppSubscription/33025884381
usageLineItemId: gid://shopify/AppSubscriptionLineItem/33025884381?v=1&index=0
usageRecordId / paymentRef: gid://shopify/AppUsageRecord/534379430109
usageIdempotencyKey: agsu-order-97e09bd487f75a81a4fc4f39fd363e32c2f049fcf89a1416830ca0dcd3c4bd2a
nextBillingAttemptAt / billingLastError / reviewRequiredAt: null
shopifyFinancialStatus: paid; refund/cancel facts: null
```

Provider returned exactly one usage node on that subscription, `hasNextPage=false`,
the same key/ID and price USD0.82, created `02:15:05Z`. Primary local billing and
provider balance both now equal USD0.82, cap USD50, ACTIVE / `test:true`.
`round(23.40 × 3.5%, 2) = 0.82`; the USD8 shipping was correctly excluded.
This proves the ordinary automatic collector, not a manual collector call.

The other approved subscriptions remained ACTIVE / TEST with USD50 cap and USD0
usage: isolation-two `75855822915`; isolation-three `32567918771` (CAD shop,
USD app subscription). No CAD order/FX result is implied.

Read-only Docker inspection confirmed both web and billing run immutable image
index `sha256:d856fbc48eb3954a26618d3e5955b1cf3a0c4e0c50c81c0ce8e1262909ac1d08`,
started `2026-10-10T02:10:51Z`. Application source is `02f5c4d`; later source
history at observation was `35c5425` (release documentation/helper, not another
runtime image). [Fresh CI/image proof](evidence/public-release-02f5c4d.txt).

Current web-container logs show genuine #1002 deliveries:

```text
2026-10-10T02:11:31.939569174Z [Reconcile] Upload hhVLFBMcIjVW <- order 18946639954141 (source=identity_url, topic=orders/updated, status=needs_review)
2026-10-10T02:11:31.975114547Z [Reconcile] Commission order=18946639954141 action=await_payment status=awaiting_payment financial=authorized amount=$0.00
2026-10-10T02:11:33.142023283Z [Reconcile] Commission order=18946639954141 action=make_collectible status=pending financial=paid amount=$0.82
2026-10-10T02:11:33.472797367Z [Reconcile] Commission order=18946639954141 action=make_collectible status=pending financial=paid amount=$0.82
2026-10-10T02:11:33.763336554Z [Reconcile] Commission order=18946639954141 action=make_collectible status=pending financial=paid amount=$0.82
```

One local commission and provider usage survived orders/updated, orders/paid and
orders/create. These are different ordinary topics, **not** a deliberately
replayed identical event. The filtered current-container log had no #1001
delivery or `TenantIsolationError`; it cannot establish what Shopify's next
retry will do or recover logs from the replaced prior container.

## 2. Executed: one real TEST-provider over-cap rejection

Separately authorized by the release owner after the read-only findings. Before
the single mutation, fresh provider and local guards required:

- Exactly `auto-gang-sheet-isolation-two.myshopify.com`, local shop
  `cmv1isu9e0007plvg36dn8jvr`, installed and not erasing.
- Exactly one ACTIVE subscription `gid://shopify/AppSubscription/75855822915`,
  provider `test:true`, shop `partnerDevelopment:true`.
- Exactly its line `gid://shopify/AppSubscriptionLineItem/75855822915?v=1&index=0`,
  AppUsagePricing, USD50 cap, USD0 balance, no pending cap approval.
- No usage nodes and `hasNextPage=false`. Unexpected identity/state aborts
  before any mutation. No token or approval URL is printed.

Actual safe output, `02:26:50.295–50.728Z`:

```json
{"key":"agsu-test-cap-reject-20261010-5f864715-93e2-46fb-8476-58b6b71d1fac","subscriptionLineItemId":"gid://shopify/AppSubscriptionLineItem/75855822915?v=1&index=0","price":{"amount":"50.01","currencyCode":"USD"},"description":"TEST ONLY: cap boundary rejection validation; NOT an order fee; no real merchant charge","mutationAttempts":1}
{"observedAt":"2026-10-10T02:26:50.507Z","http":200,"data":{"appUsageRecordCreate":{"appUsageRecord":null,"userErrors":[{"field":null,"message":"Validation failed: Total price exceeds balance remaining"}]}}}
{"observedAt":"2026-10-10T02:26:50.728Z","after":{"status":"ACTIVE","test":true,"cappedAmountUsd":50,"balanceUsedUsd":0,"usageRecords":[],"hasNextPage":false},"confirmedRejection":true,"mutationAttempts":1,"appDatabaseWrites":0,"collectorCalls":0,"capChanges":0}
```

No retry, cap change, order creation, synthetic capture, ledger write or real
charge occurred. This is a provider ceiling rejection only. USD50.01 is an
intentionally invalid QA request, **not** our normal per-order fee (max USD6).
It does not prove an exhausted application balance, cap-approval recovery or
handling of a first-call provider rejection by the deployed collector.

## 3. Exact remaining experiments, NOT yet authorized/executed here

Every future mutation requires a fresh exact TEST/shop/line/currency check and
the release owner's chosen bounded scope. No existing custom billing, fabricated
PAID order, direct Commission edits or manual collector is acceptable.

### A. Recover the genuine pre-fix variant order

Continue read-only checks for #1001's actual Shopify retry and automatic fee.
Shopify documents up to eight attempts over four hours with increasing spacing;
there is no promise of an immediate retry. Its failed delivery around `02:02Z`
is within that window, not evidence of permanent loss yet. The deployed billing
scheduler does not discover a missing order/Commission by polling Shopify.

Pass: existing upload becomes linked to **that exact** order and one USD6 usage
appears naturally with its stable shop/order key. If no retry arrives, keep the
gap explicit. A separately approved owner re-signing a current **real** financial
snapshot can recover it, but must be labelled owner reconciliation, not genuine
Shopify retry. Do not invent a delivered event ID or use CLI sample order data.

### B. Identical delivery: distinguish original replay from owner replay

The adapters do not retain original request bodies/headers; there is currently
no supported CLI command here that retrieves and resends that original event.
Shopify's `app webhook trigger` sends a fixed sample, is not retried and is not
an end-to-end test of the installed subscriptions. It must not manufacture a
captured order in the public database.

Smallest owner-controlled application proof: read #1002's current genuine order
snapshot, verify actual successful capture and identity, normalize using the
existing snapshot contract, freeze the bytes, then send **those same bytes and
HMAC twice** to `/webhooks/orders-paid` using an explicit QA event marker. Preserve
body hash/status/timestamps, not buyer data or capability URLs. This is an owner
re-signed real-order snapshot, not original Shopify-origin event replay.

Pass: both responses succeed, one owned OrderLink/Commission remains, immutable
paid fee/usage identity is unchanged, and after a normal five-minute scheduler
turn the provider still has exactly the original usage node and balance. No
manual collector or reset-to-pending is necessary. A genuine original replay
requires the actual original delivery payload/headers, not a made-up event ID.

### C. Provider idempotency with a deliberately unread response

Safest bounded provider-only proof uses the **already recorded** #1002 request:
exact original line, key above, USD0.82 and identical description. Fresh reads
must prove that one existing matching record and its frozen local receipt.
Make at most two identical API requests, deliberately discard/close the first
response, then reconcile by reading the original line/key. Never use a new key.

Pass: no added usage node or balance delta; original record ID remains the only
one for that key. Inspect the actual second response instead of assuming Shopify
returns a particular replay payload. An ambiguous result stops further attempts.

This demonstrates real provider duplicate prevention and client response loss;
it **does not** demonstrate the application's first-submission `charging` row
recovery, because #1002 was already settled before the experiment. Real SQL
unknown-row recovery with a simulated provider is already tested in
`billingRunner.integration.test.ts`; keep that proof boundary honest.

A stronger full hosted lost-first-response proof needs an explicitly approved,
one-shot transport fault on the natural scheduler's next usage request for one
new genuine TEST order. It must match exact shop/order/key, forward once, discard
only that response and remove itself; then normal retry must preserve the same
amount/key/line and settle one record. No such supported fault control exists
today. Do not broadly break egress, restart during an unpredictable window, edit
a settled Commission or manually call the collector to manufacture this proof.

### D. Application cap exhaustion and merchant-approved recovery

The executed negative probe leaves isolation-two empty. Two honest alternatives
remain; choose one, not both:

1. **No synthetic usage:** create genuine TEST checkout orders on isolation-two
   through the customer flow and wait for the normal scheduler. With verified
   USD40 variants, eight USD200 app-served orders yield eight USD6 capped fees
   (USD48); another USD40 order yields USD1.40 (USD49.40). The next USD40 order's
   USD1.40 fee must stay pending because only USD0.60 remains. These totals are
   conditional on actual prices/discounts; verify each before committing the test.
   Stop after at most ten orders. This is both per-order cap and application
   interval-limit proof, without pretending a pending fee is partially charged.
2. **Lean TEST-only fixture, requires separate explicit choice:** one unique,
   plainly labelled provider QA usage of exactly USD50 on the still-empty TEST
   isolation-two line exhausts it. It is not an order fee and creates no fake
   order/Commission. Then one genuine customer TEST order must link normally but
   its fee stay pending with `shopify_billing_cap_blocked`; normal collection must
   not create another usage. This consumes that TEST interval's limit and is not
   removable by deleting a usage record. Do not run it merely to make a checkbox
   green or confuse its USD50 fixture with our USD6 order policy.

For either option, use the visible billing UI to request the next allowed USD200
limit. Before merchant approval, provider and effective local cap must remain
USD50. After actual Shopify approval and normal sync, the pending genuine fee
should settle once without changing its order identity; capture before/after
provider cap/balance and matching local/audit facts. No direct cap lowering,
subscription replacement, fake date advance or manual collector is needed.
This is not next-billing-interval rollover proof; do not infer time simulation
support from a TEST subscription's displayed period end.

## 4. Reproducible read shape and source decisions

Read-only current container logs (after exact host metadata check):

```sh
docker logs --timestamps --since 45m auto-gang-sheet-public-web-1 2>&1 | grep -E '18946622095581|18946639954141|TenantIsolationError|Error processing order' | tail -60
docker inspect auto-gang-sheet-public-web-1 auto-gang-sheet-public-billing-1 --format '{{.Name}} {{.Config.Image}} {{.State.StartedAt}} {{.State.Status}}'
```

Provider queries use API `2026-10`: `order(id: exact order GID)` reads only test,
financial status, money and transaction kind/status/amount/time. Subscription
reads use `currentAppInstallation.activeSubscriptions` and original
`node(id: subscription GID).lineItems.usageRecords` with ID/key/price and complete
pagination. Access tokens remain in memory and are never logged. Local finance
reads require both exact shopId and orderId, in `BEGIN ... READ ONLY`.

Current source authority: `billingPolicy.ts` defines 3.5%, USD6 and visible cap
tiers; `billing.server.ts` hashes shopId/orderId into one stable usage key;
`billingRunner.server.ts` uses guarded request-start CAS, original line/amount,
five-minute leases, local whole-fee cap check, and quarantine after an unknown
outcome. `commissionEligibility.server.ts` preserves already recorded fees and
sticky terminal facts. `shopifyBilling.server.ts` requires actual provider
approval and reads back status; a request URL is not consent.

Primary documentation checked 2026-10-10:

- [Usage mutation](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appUsageRecordCreate): idempotency keys prevent duplicate charges; exceeding remaining interval cap returns an error. The actual rejection above independently verifies this provider behavior.
- [AppSubscription](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/AppSubscription): merchant approval is required; TEST subscriptions validate flows without actual charges. Actual `test:true`, not shop naming or a local flag, gates every proposed provider experiment.
- [Cap update](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appSubscriptionLineItemUpdate): the confirmation URL allows the merchant to approve/decline the change; a returned URL is not approval.
- [Usage subscriptions](https://shopify.dev/docs/apps/launch/billing/manual-pricing/subscription-billing/create-usage-based-subscriptions): cap applies per 30-day billing interval. Manual Billing API remains documented for outlier pricing; public-app pricing review acceptance is a separate launch check, not proven by API success.
- [Delivery validation](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries): duplicates can occur; Webhook-Id identifies a delivery and Event-Id correlates the same merchant action. Per-order monetary uniqueness must survive both.
- [Webhook troubleshooting](https://shopify.dev/docs/apps/build/webhooks/troubleshoot): retry timing is bounded/exponential, not immediate or guaranteed lossless recovery.
- [CLI webhook trigger](https://shopify.dev/docs/api/shopify-cli/app/app-webhook-trigger): sample payload limitations make it unsuitable for claiming this genuine paid order's original replay.

Next release steps are bounded experiments above plus the separate App Store
review/media/performance work. Neither this document nor green CI ends the
overall publication goal. [Billing policy](billing.md) and
[owner adjustment runbook](credit-refund-runbook.md) remain the financial policy;
no TEST case authorizes real merchant credits/refunds.
