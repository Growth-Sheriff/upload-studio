# Owner-operated Shopify app-fee adjustments

Checked2026-10-10. Public app **Auto Gang Sheet Upload** only. This is a runbook, not evidence that any credit/refund was issued or that the account's permissions have been tested. Never apply it to custom-app Stripe/PayPal charges or other tenants. The commercial policy remains [billing.md](billing.md).

## Supported boundary

Shopify Partner Dashboard issues credits/refunds and retains their provider history. The merchant's Billing page **requests review**; it never issues an adjustment. The owner-only `app/operations/record-billing-adjustment.ts` CLI records an already reconciled provider result, through `billingAdjustment.server.ts`. It does not call Shopify/Partner financial APIs, create a financial transaction, reopen a Commission or change a recorded fee.

Access is the authorized owner's SSH/Docker access to the independent public host; the operator field is an explicit owner attestation, not a Shopify-verified administrator ID. No merchant-facing settlement action exists. Do not claim a review is settled merely because someone clicked a button or replied to a support ticket. Provider permissions and an actual end-to-end owner rehearsal still need verification; local tests do not prove that a real Shopify refund/credit was issued. If a provider result is uncertain, record `unknown` and stop financial retries.

## 1. Establish the exact case before any money action

One authorized owner operates one review at a time; no parallel operator may issue another adjustment for the same case. Open the merchant's **Billing** page and locate the order, recorded fee, review reason and Shopify usage record. The page only shows the latest100 fees and reviews: absence there is not proof a record does not exist. A merchant may use **Request credit review**; that records a request, not entitlement or payment.

Record the following in a private operator case, never a public repository or storefront:

- Exact public-app shop domain and internal shopId; Commission id/orderId/order number; BillingCredit id/idempotency key if present.
- Frozen `commissionAmount`, `billingCurrency`, usage record ID, original usage subscription/line IDs, usage idempotency key and `paymentRef`.
- Review reason/time, verified Shopify cancellation/refund facts, original order currency and frozen FX snapshot when relevant.
- Shopify app charge/invoice reference and whether **the merchant's Shopify app invoice** was paid. The customer's paid order is a different payment. `Commission.status=paid` means usage recorded on Shopify, not that Shopify collected the merchant invoice.
- Every previous credit/refund for this same usage/order, including adjustments issued outside this app, their amounts/currencies and provider receipts.

Use the existing authorized, private public-database operator connection for a read-only inspection when the page is insufficient. Verify its target is the independent `public_app` database, not any custom-tenant database. Supply exact `psql` variables `shop_domain` and `commission_id`; this query reads only, requires both owner predicates and excludes credentials/buyer contacts:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT s.id AS shop_id, s.shop_domain, c.id AS commission_id,
       c.order_id, c.order_number, c.status, c.commission_amount,
       c.billing_currency, c.order_currency, c.fx_rate, c.fx_source,
       c.fx_observed_at, c.usage_record_id, c.usage_subscription_id,
       c.usage_line_item_id, c.usage_idempotency_key, c.payment_ref,
       c.payment_provider, c.review_reason, c.review_required_at,
       c.shopify_financial_status, c.shopify_refund_status,
       c.shopify_cancelled_at, b.id AS review_id,
       b.idempotency_key AS review_key, b.amount_usd AS review_amount_usd,
       b.status AS review_status, b.provider_ref, b.settled_at,
       b.settled_amount_usd, b.receipt_fingerprint
FROM shops s
JOIN commissions c ON c.shop_id = s.id
LEFT JOIN billing_credits b ON b.shop_id = c.shop_id AND b.commission_id = c.id
WHERE s.shop_domain = :'shop_domain' AND c.id = :'commission_id';
SELECT a.id, a.action, a.created_at, a.metadata_json
FROM audit_logs a
JOIN shops s ON s.id = a.shop_id
JOIN commissions c ON c.shop_id = s.id AND c.order_id = a.resource_id
WHERE s.shop_domain = :'shop_domain' AND c.id = :'commission_id'
  AND a.action IN ('shopify_usage_recorded', 'commission_review_required',
                   'shopify_app_credit_requested', 'shopify_usage_outcome_unknown')
UNION ALL
SELECT a.id, a.action, a.created_at, a.metadata_json
FROM audit_logs a
JOIN billing_credits b ON b.shop_id = a.shop_id AND b.id = a.resource_id
JOIN commissions c ON c.shop_id = b.shop_id AND c.id = b.commission_id
JOIN shops s ON s.id = c.shop_id
WHERE s.shop_domain = :'shop_domain' AND c.id = :'commission_id'
  AND a.action IN ('shopify_manual_adjustment_recorded', 'shopify_manual_adjustment_unknown')
ORDER BY created_at;
COMMIT;
```

**Stop** if scope/identity, frozen amount, usage reference or prior relief cannot be reconciled. A `charging` row, missing usage ID, timeout or unknown original submission must first reconcile its exact original provider key; it is not a new credit entitlement. Provider absence in one lookup is not proof no request could finish later. Do not reset status, clear a key or retry under a new key.

For a recorded cancelled/fully refunded order, review the original fee for relief. A partial refund requires an explicit owner amount decision: the full amount in a review row is not an instruction to credit it all. Never exceed the frozen fee less already confirmed relief. Use the original USD fee, not today's FX or the original local-currency order total. If Shopify's invoice currency differs, require its documented charge conversion/reference; do not guess.

## 2. Choose the provider operation

| Verified Shopify app-invoice state | Action |
| --- | --- |
| Usage recorded but charge not yet paid | Award an app credit; do not attempt a cash refund. |
| The specific app charge was paid | Refund the eligible amount against that charge. |
| Unknown, mixed, ambiguous or provider references differ | Quarantine the case; obtain Shopify confirmation first. |
| Test subscription/charge | Keep it a test case; do not send a real credit/refund. |

Shopify's [refund rules](https://shopify.dev/docs/apps/launch/billing/billing-adjustments/refund-app-charges) distinguish paid-charge refunds from unpaid-charge credits. The originally recorded Commission stays immutable in either case; relief is a separate provider operation.

## 3. Unpaid app invoice: owner awards credit

In Partner Dashboard search/select the exact store, then **App credits → Send**. Select this app, currency and approved amount. Include the case/review ID and original usage reference in the note without buyer contacts. Verify the summary and send once. Preserve the resulting store-history event/reference and have the merchant verify its Billing entry. Owner access or the relevant staff credit permission is required; the total credit is constrained by pending Partner payouts. If permissions, balance or installed-app availability prevent the operation, keep the case open and escalate through Shopify Partner Support. Do not substitute an external payment. [Official credit procedure](https://shopify.dev/docs/apps/launch/billing/billing-adjustments/award-app-credits)

## 4. Paid app invoice: owner refunds the exact charge

In Partner Dashboard select the store, open the app charge's **Details**, expand the correct charge and choose **Issue refund**. Enter only the approved remaining relief, verify its currency/charge association, then submit once. Preserve the updated charge history and refund reference. Notify the merchant to check the invoice; Shopify does not automatically notify them of this status. Shopify lists restrictions for charges aboveUSD1,000, invoices older than12months and ACH invoices90days or older; escalate restricted cases to Partner Support. Processing fees are not refunded to the developer. [Official refund procedure](https://shopify.dev/docs/apps/launch/billing/billing-adjustments/refund-app-charges)

## 5. Unknown result: no blind retry

A spinner, disconnected browser, timeout, missing local write or delayed history is **unknown**, not failure. Preserve the attempt time, operation, exact case/usage/charge IDs, amount/currency and any visible confirmation. Recheck the same store's provider history and ask Shopify Support when inconclusive. Do not send both a credit and refund, click Send again, or infer failure from the app still saying **Credit review requested**. A confirmed rejection with no provider operation is distinct, but reattempt only after reconciling that fact and all previous history.

The optional [Partner `appCreditCreate` API](https://shopify.dev/docs/api/partner/latest/mutations/appCreditCreate) is not implemented here and exposes no idempotency-key argument. A new unattended integration is unnecessary for owner-operated publication and must not be assumed safe to retry.

## 6. Record the outcome, not another payment

Shopify's credit event/updated charge history is the authoritative provider outcome. Preserve its canonical receipt/event identifier exactly (never alternative URL/ID spellings), amount, currency, original usage/charge IDs and responsible operator in the private case. The database can reject exact reference reuse; it cannot detect fabricated receipts or aliases, so independent provider-history reconciliation remains mandatory. `providerConfirmedAt` is the UTC time the owner verified that receipt. Do not paste credentials, buyer contacts or bearer URLs into receipts/reasons. Existing support replies may communicate the result to the merchant but are not financial settlement or proof of email delivery. The Billing page labels confirmed credit/refund, partial relief or unknown quarantine separately; it never displays the original review budget as the partial amount returned.

Create one private JSON case file outside Git on the encrypted public volume, owner-readable only. Replace every example identifier with the values from section1. `expectedFeeUsd` is the unchanged full recorded fee; `amountUsd` is the actual verified adjustment. This example records a partial refund, not a full US$3.50 return:

```json
{
  "shopId": "EXACT_INTERNAL_SHOP_ID",
  "shopDomain": "exact-shop.myshopify.com",
  "reviewId": "EXACT_BILLING_CREDIT_ID",
  "commissionId": "EXACT_COMMISSION_ID",
  "expectedUsageRecordId": "gid://shopify/AppUsageRecord/EXACT_ID",
  "expectedFeeUsd": "3.50",
  "operation": "refund",
  "outcome": "confirmed",
  "currency": "USD",
  "amountUsd": "1.50",
  "providerRef": "EXACT_PROVIDER_ISSUED_RECEIPT_OR_HISTORY_REFERENCE",
  "providerConfirmedAt": "2026-10-10T12:00:00Z",
  "operator": "ACCOUNTABLE_OWNER_IDENTITY",
  "reason": "Verified partial relief for this exact usage; provider history reconciled"
}
```

On **NEW host607746803 only**, run the shipped CLI in the existing billing container. This does not restart a service. Use the new image containing this command; an older running image has no tool until the coordinated release.

```sh
docker compose --env-file /opt/agsu-public/public.env \
  -f /opt/agsu-public/compose.yml exec -T \
  -e PUBLIC_BILLING_ALLOWED_DROPLET=607746803 billing \
  node --import tsx app/operations/record-billing-adjustment.ts \
  --record-provider-result < /opt/agsu-public/private-cases/CASE.json
```

The CLI checks the exact public app client ID/URL, private `public_app` database, restricted `agsu_app` role, strict TLS settings and read-only host metadata before recording. Its only network read besides the database is the DigitalOcean host-ID metadata guard; it never asks a financial provider to issue anything. Input is limited to16KiB. Failed target checks do not write. USD-only: if Shopify's receipt is in another currency, stop and obtain a documented USD association from Shopify Support; never relabel local currency as USD.

The service locks the exact Shop (including an uninstalled shop not yet erasing), verifies the owned BillingCredit and immutable `paid` Shopify Commission, full fee, original usage/subscription/line/key and review budget. It atomically updates the review and creates `shopify_manual_adjustment_recorded` AuditLog with exact actual amount, receipt, confirmation time, operator/reason and frozen usage identity. The original `commissionAmount`, status and provider identifiers are never updated. `settledAt` is local recording time, not proof Shopify collected an invoice. Full relief becomes `credited`/`refunded`; partial relief becomes `partially_credited`/`partially_refunded`. The review's `amountUsd` remains its original budget; `settledAmountUsd` is the actual adjustment, with a durable receipt fingerprint.

An identical normalized attestation returns `replayed:true` without another write, even after the ordinary365-day operator audit expires; the durable fingerprint and actual amount prove the same receipt without recreating that audit. A different amount, receipt, operator or reason cannot overwrite a recorded outcome. A provider receipt cannot be reused for another retained review/store: a UNIQUE constraint on `BillingCredit.providerRef` causes the entire conflicting transaction to roll back independently of audit retention. The migration must be applied to the independent public database before the new image starts. Receipt/actual-amount/fingerprint remain existing financial/replay facts; operator/reason keep the ordinary365-day audit retention. No new indefinite personal-data purpose is introduced. One receipt per review is supported. Do not issue a second partial adjustment or split one batch receipt across reviews using this tool; further relief needs an explicit supported follow-up case design and provider-history reconciliation, not ad-hoc SQL.

For an **unknown** provider result use the same exact case/amount/operation with `"outcome":"unknown"` and omit both `providerRef` and `providerConfirmedAt`. It records `quarantined` plus `shopify_manual_adjustment_unknown`, without setting a receipt/settled time or changing the Commission. After Shopify confirms the original result, a confirmed attestation may settle that quarantined review. Never issue again to resolve an unknown state. A confirmed rejection with no relief remains an open/manual case; this lean tool does not fabricate a zero-dollar receipt or close it as paid.

Preserve the CLI result (`reviewId`, status, auditId, replayed) in the private case and rerun section1's read-only queries. On a process timeout/unknown local result, inspect the exact audit first; only replay the identical case, never issue a new provider operation. An audit-write failure rolls back the review update. Erasing/deleted shops are closed: reconcile their retained private finance evidence through the owner/Shopify Support, not by recreating the shop. This document is not evidence of an actual hosted invocation or money movement.

## Publication exit checks

- Confirm owner/staff permissions and the exact app/store charge-history path without issuing a real adjustment merely to demonstrate access.
- Deploy the supported CLI and rehearse the target guard plus confirmed/unknown recording in a safe review fixture. Unit tests cover identical replay, conflicts, quarantine, partial relief and rollback; the opt-in disposable PostgreSQL test covers actual locking and cross-shop receipt uniqueness. These prove bookkeeping, not safe duplicate issuance in Partner Dashboard: one accountable operator must still check provider history before any money action.
- Rehearse unpaid-credit, paid-refund and unknown-result handling with provider test/sandbox evidence where available; never describe a development test charge as real merchant money.
- Keep one accountable owner and `info@actualscope.com` support, preserve provider receipts, and disclose manual refund review honestly. No claim of automatic reversal or completed settlement until the evidence exists.

Local source checks,2026-10-10: `npx vitest run app/lib/billingAdjustment.server.test.ts app/lib/billingAdjustment.integration.test.ts app/lib/billing.server.test.ts` →13passed,1opt-in PostgreSQL test skipped without `PUBLIC_APP_TEST_DATABASE_URL`; `npx tsc --noEmit --pretty false` →0diagnostics. The CLI was invoked with public runtime disabled and refused before importing the database service. No hosted data/provider operation was performed. The new DB test uses only the existing disposable `127.0.0.1:55439/public_app_test` CI fixture and checks exact replay after audit deletion plus cross-shop receipt-constraint rollback; execution is left to the coordinated full CI run.
