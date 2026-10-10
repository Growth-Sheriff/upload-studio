# Genuine order retry recovery and remaining billing release gates

Read-only audit: 2026-10-10T02:38:02.897–02:38:03.154Z, plus current
container logs since 02:23Z. This supersedes the earlier **current-status**
interpretation of #1001 being unlinked; the earlier timestamped evidence remains
valid history. No webhook replay, collector, ledger edit or order mutation was
performed by that audit. A separately authorized, bounded **provider mutation
replay** at02:43:55–56Z is recorded explicitly in section2; it is not disguised
as a read-only request. Neither step deployed or changed server source.

## 1. The original variant order recovered through genuine delivery

Exact target: NEW host607746803 /143.198.12.234, public app
8822c01b1f0be2280240cfab7d4e9a79, auto-gang-sheet-demo.myshopify.com.
DigitalOcean metadata, public-runtime/app URL and dedicated PostgreSQL
host/database/runtime user were verified before connection/query. Local reads
ran inside a transaction beginning SET TRANSACTION READ ONLY. Provider calls
were GraphQL queries using the stored valid access token in memory, not an SDK
refresh or subscription-sync action. Existing tenant hosts were not accessed.

Observed image remained:
`ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:d856fbc48eb3954a26618d3e5955b1cf3a0c4e0c50c81c0ce8e1262909ac1d08`.

```text
Provider order: gid://shopify/Order/18946622095581, #1001
test: true; financial status: PAID; cancelledAt: null
subtotal / total: USD200 / USD200
successful CAPTURE: gid://shopify/OrderTransaction/20824185176285
capture processedAt: 2026-10-10T01:58:58Z
provider order updatedAt: 2026-10-10T01:58:59Z (unchanged from original order)

Upload: 9FGuJnpLcKnq
status: approved; orderId:18946622095581; orderName:#1001
orderPaidAt:2026-10-10T02:29:03.042Z (local reconciliation time, NOT capture time)
requestedCopies:5; sheetsNeeded:5; cartSheetLabel:22 x 80
cartVariantId:68056763105501
OrderLink: one row, lineItemId50810921222365, created2026-10-10T02:29:03.039Z

Commission: cmv1rzoqm000wwc7dma3ckpj8
commissionAmount:USD6; status:paid (= usage recorded, NOT merchant invoice paid)
createdAt:2026-10-10T02:29:03.358Z
collectibleAt:2026-10-10T01:58:59.000Z
usageRequestStartedAt:2026-10-10T02:30:00.412Z
updatedAt:2026-10-10T02:30:00.750Z
usageRecordId:gid://shopify/AppUsageRecord/534381297885
usageLineItemId:gid://shopify/AppSubscriptionLineItem/33025884381?v=1&index=0
usageIdempotencyKey:agsu-order-a2d09873dbbd0561aca5a481f57357a6db3966630f902d42e6db82bc54c06764
nextBillingAttemptAt / billingLastError:null
```

Actual current-container logs:

```text
2026-10-10T02:29:03.347886933Z [Reconcile] Upload 9FGuJnpLcKnq <- order 18946622095581 (source=identity_url, topic=orders/updated, status=approved)
2026-10-10T02:29:03.389561546Z [Reconcile] Commission order=18946622095581 action=make_collectible status=pending financial=paid amount=$6.00
2026-10-10T02:29:03.389602214Z [Reconcile] order 18946622095581 topic=orders/updated: linked=1 ghosts=0 foreignSkipped=0 paidNew=true
2026-10-10T02:29:04.038658294Z [Webhook] Order paid: 18946622095581 for shop: auto-gang-sheet-demo.myshopify.com
2026-10-10T02:29:04.239519329Z [Webhook] Order created: 18946622095581 for shop: auto-gang-sheet-demo.myshopify.com
2026-10-10T02:29:04.277880555Z [Reconcile] Upload 9FGuJnpLcKnq <- order 18946622095581 (source=identity_url, topic=orders/paid, status=unchanged)
2026-10-10T02:29:04.313919322Z [Reconcile] Commission order=18946622095581 action=make_collectible status=pending financial=paid amount=$6.00
2026-10-10T02:29:04.529707781Z [Reconcile] Upload 9FGuJnpLcKnq <- order 18946622095581 (source=identity_url, topic=orders/create, status=unchanged)
2026-10-10T02:29:04.564209358Z [Reconcile] Commission order=18946622095581 action=make_collectible status=pending financial=paid amount=$6.00
```

No TenantIsolationError appeared in the targeted log slice. The original order
was not changed: its provider updatedAt still predates the fixed deployment.
The converging original create/paid/updated deliveries around02:29 are the
observed genuine retry recovery, not a newly invented captured order or an
operator-signed replay. The audit does not claim original delivery headers were
retained or that Shopify retries can never be lost.

Provider subscription33025884381 returned exactly two usage nodes,
hasNextPage=false:

| Order | Usage ID | USD | Provider createdAt |
| --- | --- | --- | --- |
| #1001 |534381297885|6.00|2026-10-10T02:30:00Z|
| #1002 |534379430109|0.82|2026-10-10T02:15:05Z|

Both provider and local balance wereUSD6.82; capUSD50; ACTIVE/test=true; local
syncedAt02:35:00.298Z. Thus the variant's **per-order** USD6 cap is now proven on
an actual TEST order: min(USD200×3.5%,USD6)=USD6. The measured order separately
proves round(USD23.40×3.5%,2)=USD0.82, excludingUSD8 shipping. The normal
five-minute collector recorded both; no manual collection occurred.

## 2. Executed: known-recorded TEST usage replay with unread first response

Release owner separately authorized at most two exact-same requests for the
already-recorded #1002 fee. Fresh guards at2026-10-10T02:43:55.329Z required the
same exact public host/app/database identity, installed demo shop, one immutable
paid Commission, and provider ACTIVE/test=true/partnerDevelopment=true. Original
subscription33025884381 and its line?v=1&index=0 matched local state; capUSD50,
balanceUSD6.82, precisely two usage nodes and hasNextPage=false. No pending cap
approval or ambiguous receipt was allowed. An unexpected fact would stop before
any replay.

The two requests used **byte-identical GraphQL bodies** and the original stored
provider description, line, amount and idempotency key:

```json
{"subscriptionLineItemId":"gid://shopify/AppSubscriptionLineItem/33025884381?v=1&index=0","price":{"amount":"0.82","currencyCode":"USD"},"description":"Order #1002: 3.5% of app-served captured lines, max US$6 (order 18946639954141)","idempotencyKey":"agsu-order-97e09bd487f75a81a4fc4f39fd363e32c2f049fcf89a1416830ca0dcd3c4bd2a"}
```

Actual safe output:

```json
{"stage":"first-replay-response-deliberately-unread","observedAt":"2026-10-10T02:43:55.499Z","http":200,"bodyRead":false,"mutationAttempts":1}
{"stage":"readback-after-unread-response","observedAt":"2026-10-10T02:43:55.667Z","usageNodeCount":2,"balanceUsedUsd":6.82,"originalRecordId":"gid://shopify/AppUsageRecord/534379430109"}
{"stage":"second-identical-replay-response","observedAt":"2026-10-10T02:43:55.836Z","http":200,"data":{"appUsageRecordCreate":{"appUsageRecord":{"id":"gid://shopify/AppUsageRecord/534379430109"},"userErrors":[]}},"mutationAttempts":2}
{"stage":"verdict","observedAt":"2026-10-10T02:43:56.027Z","providerReplayConfirmed":true,"originalProviderId":"gid://shopify/AppUsageRecord/534379430109","originalCommissionUnchanged":true,"usageNodeCount":2,"balanceUsedUsd":6.82,"balanceDeltaUsd":0,"mutationAttempts":2,"appDatabaseWrites":0,"collectorCalls":0,"capChanges":0,"firstSubmissionLostResponseProven":false}
```

The first response's HTTP headers were received, but its body was deliberately
cancelled without parsing. Intermediate and final provider readback both returned
exactly #1001USD6 and #1002USD0.82, same original IDs/keys/prices/createdAt, total
USD6.82. The second mutation returned the **original** #1002 usage ID. A final
read-only SQL transaction confirmed its paid Commission amount/key/reference
and updatedAt2026-10-10T02:15:05.802Z were unchanged. No third request, new key,
collector, cap update, subscription change, forged webhook or ledger edit occurred.

This is a real provider idempotency and deliberately unread-response result,
consistent with [appUsageRecordCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appUsageRecordCreate).
It is **not** first-submission lost-response/unknown-Commission recovery: the
original request was already settled before either replay. It also is not an
identical original Shopify webhook-event replay. Keep both limitations when
summarizing the proof.

## 3. Missed-order recovery: what code actually supports

There is currently **no supported owner recovery action or automatic recent-order
scan** in the public app. This is not needed to repair #1001 now, because genuine
retry already recovered it. It remains a reliability gap for future permanently
missed events, not a reason to reset the two completed fees.

Code search of app/, workers/ and scripts/ found only the six verified order/refund
webhook adapters calling `reconcileOrder`. The other apparently relevant paths
have different jobs:

| Existing surface | Actual scope | Why it cannot recover an absent paid order |
| --- | --- | --- |
| `billingScheduler.server.ts`, `billingQueueProducer.server.ts` | Five-minute shop fanout | Collector selects existing Commission candidates; it does not fetch recent Shopify orders. |
| `api.cron.billing.run.tsx` | Owner-authenticated, bounded queue enqueue | Scheduling collection is not order discovery. Calling it would not create a missing order association. |
| `app.billing.tsx` | Sync subscription; request cap approval or credit review | No order fetch/reconcile action. Loading Billing may write subscription state, so it is not a read-only diagnostic. |
| `app.queue.tsx` | Local upload status, bulk status and exports | Marking approved cannot establish Shopify capture, an order link or a legitimate fee. |
| `workers/upload-pipeline-reconciler.ts` | Measurement/preview repair | Repairs upload processing jobs, not Shopify order delivery. |
| `app/operations/record-billing-adjustment.ts` | Already-confirmed manual adjustment receipt | Never creates an order or Commission and never issues money. |
| Historical link-repair scripts | Other legacy maintenance | Not a supported, guarded public order-recovery tool; do not run them as one. |

Shopify's current [webhook overview](https://shopify.dev/docs/apps/build/webhooks)
explicitly recommends reconciliation because delivery is not guaranteed; a
background fetch or user-operated sync is acceptable. Its
[retry guidance](https://shopify.dev/docs/apps/build/webhooks/troubleshoot)
explains increasing retry delays within the retry window, not permanent recovery.

Smallest safe future implementation, if separately assigned: an owner-only CLI
accepting one exact public shop/order plus operator and reason, with the existing
public-host/app/database guards. Fetch the real current GraphQL financial snapshot,
fail on incomplete/truncated/refund-ambiguous data, then invoke the existing
`withTenantContext(shop.id, () => reconcileOrder(shop,snapshot,'owner/order-recovery'))`
and record an operator audit. No forged HMAC/event, direct ledger mutation, cap
change or provider-usage call. Normal scheduling alone collects any eligible fee;
paid immutable fees stay unchanged. Session refresh, if needed, must be disclosed
as a normal write rather than labelling the execution read-only.

A periodic bounded, shop-fair updated_at scan with overlap/cursor can later reuse
the same snapshot/reconciler. Do not implement a second commission calculator.
Do not use fake financial status or tag/change merchant orders merely to provoke
an orders/updated delivery. This document proposes, but does not implement, that
recovery control.

## 4. Billing release evidence: sufficient facts versus remaining gaps

| Gate | Actual strongest evidence now | Remaining scope |
| --- | --- | --- |
| Shopify-only billing and merchant consent | Manual listing policy; real approved ACTIVE TEST usage subscription in each of3 shops; exact IDs checked | Live real-merchant eligibility/mode must not be inferred from dev approval. No external Stripe/PayPal path is used in this branch. |
| Correct order fee, USD6 cap and shipping exclusion | Real #1001USD6 and #1002USD0.82 usage IDs above | Other storefront/customer flows are separate; do not claim commerce in all3 shops. |
| Genuine delayed delivery recovery | #1001 original order recovered by current verified handlers, no order change | Not proof of permanent loss recovery; owner sync/periodic order scanner is absent. |
| Repeated/concurrent processing | Real different-topic delivery converges to1 row/order and1 provider node/order; real disposable-SQL concurrency tests; two actual known-recorded provider-key replays added no charge | Deliberately identical original webhook-event replay has not been executed. |
| Provider interval ceiling | Actual TEST50.01USD request rejected against50USD cap, no record/balance change | Not deployed collector exhaustion or merchant-approved50→200 recovery. Exact evidence in billing-live-gaps.md. |
| Lost provider response | Real known-recorded replay survived one deliberately unread response with unchanged balance; production SQL unknown-claim recovery tested against simulated provider | Real Shopify first-submission response loss not observed; do not manufacture it by editing a paid Commission. |
| Unpaid/cancelled/refunded no-collection | Negative eligibility/runner tests, guarded first-request cancellation race, real SQL non-collection | No native hosted cancellation/refund scenario observed yet. Collected fee is immutable; relief remains separate review. |
| Currency | USD order flow and identity FX proven; CAD conversion/stale/unsupported handling tested locally | No genuine CAD order/FX receipt proof. Third shop beingCAD is not that proof. |
| Cap consent/access rules | Unit tests ensure pending approval cannot raise effective cap; real initial approval returns embedded app | Actual pending increase/approval and clearing pending liabilities still unobserved. |
| Credits/refunds | Owner runbook and durable receipt CLI; local SQL idempotent/cross-shop tests | Actual account credit/refund authority and supported hosted operation still need verification before real merchant money. TEST usage is not a paid merchant invoice; do not issue a real credit for it. |

Full CI for deployed application02f5c4d passed69 files/436 tests, typecheck,
strict regression, build and extension checks. This is not a second live-provider
proof: test transports and real provider calls are labelled separately above.

Shopify's [review preparation](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)
requires a working/tested billing flow. It distinguishes manual Billing API test
charges (`test:true`) from Shopify App Pricing's separate dev-plan mechanism.
The actual TEST subscriptions here use the manual path. It does not require
charging a real merchant merely to prove test integration; do not turn a TEST
review into real-money settlement or claim every optional fault experiment is an
explicit Shopify review requirement. The owner's broader release criteria still
require truthful treatment of the remaining cap/replay scenarios.

## 5. Concrete next action

No further recovery operation is needed for either genuine order. Preserve the
two immutable usage receipts and update current release evidence with this
successful retry/per-order cap result. Continue review-media/performance/submission
work in parallel; none of the open diagnostic substeps ends the App Store goal.

The bounded known-recorded provider replay is now complete; do not repeat it to
inflate the evidence or reset a paid row to make it a different test. A real
first-unknown-Commission experiment is a separate, more invasive fault-control
decision, not a prerequisite inferred from this successful replay.

Application interval-limit recovery needs a separate owner choice between genuine
TEST checkouts or an explicitly labelled TEST-only cap fixture, followed by the
ordinary merchant approval flow; bounded alternatives are in
[billing-live-gaps.md](billing-live-gaps.md). No synthetic capture, direct
collector call or ledger reset is a safe shortcut.

The initial audit was read-only. The later two authorized TEST-provider mutation
replays produced no balance delta/new record and made no app-database/queue/server
change. This workstream commits only this evidence document, not application
source or deployment. The single previously authorized TEST cap rejection is
recorded separately, not hidden inside the initial read-only audit.
