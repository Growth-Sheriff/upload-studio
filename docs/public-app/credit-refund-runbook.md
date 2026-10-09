# Owner-operated Shopify app-fee adjustments

Checked2026-10-10. Public app **Auto Gang Sheet Upload** only. This is a runbook, not evidence that any credit/refund was issued or that the account's permissions have been tested. Never apply it to custom-app Stripe/PayPal charges or other tenants. The commercial policy remains [billing.md](billing.md).

## Current support boundary — publication blocker

Shopify Partner Dashboard supports issuing credits/refunds and retaining their provider history. This app supports **requesting review**, not recording its outcome. `app/routes/app.billing.tsx` only creates `BillingCredit.status=review`; it does not expose owner settlement controls, provider-reference entry or a completion audit. `billingRunner.server.ts` and `orderReconciler.server.ts` also only create reviews. `providerRef` and `settledAt` exist in the schema but have no application writer. No supported settlement CLI exists in `scripts/` or `deploy/`.

Therefore the provider steps below are actionable, but this release does **not** have an end-to-end internally audited adjustment workflow. Do not claim a review is settled merely because someone clicked a button or replied to a support ticket. Do not invent an admin action, patch financial rows through ad-hoc SQL, or reopen a paid Commission. A confirmed urgent provider adjustment can be evidenced in Shopify's history, while the app review remains open and explicitly marked unresolved in operator handoff; never issue it again just to make the app display change. Complete the supported outcome-recording gap before calling paid publication financially ready.

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
       b.status AS review_status, b.provider_ref, b.settled_at
FROM shops s
JOIN commissions c ON c.shop_id = s.id
LEFT JOIN billing_credits b ON b.shop_id = c.shop_id AND b.commission_id = c.id
WHERE s.shop_domain = :'shop_domain' AND c.id = :'commission_id';
SELECT a.id, a.action, a.created_at, a.metadata
FROM audit_logs a
JOIN shops s ON s.id = a.shop_id
JOIN commissions c ON c.shop_id = s.id AND c.order_id = a.resource_id
WHERE s.shop_domain = :'shop_domain' AND c.id = :'commission_id'
  AND a.action IN ('shopify_usage_recorded', 'commission_review_required',
                   'shopify_app_credit_requested', 'shopify_usage_outcome_unknown')
ORDER BY a.created_at;
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

## 6. Outcome evidence and the missing internal recording step

**Supported today:** Shopify's credit event/updated charge history is the authoritative provider outcome. Preserve that reference, amount, currency, UTC time, original usage/charge IDs and responsible operator in the private case. Existing support replies may communicate the result to the merchant but are not financial settlement or proof of email delivery. The application does not consume provider credit/refund outcomes, expose review IDs/references completely in its Billing UI, or change its review label after payment.

**Not supported today:** marking the matching BillingCredit completed/rejected/unknown with providerRef/settledAt and an atomic immutable outcome audit. Merely having those schema columns is not a supported operation. Do not fabricate a command for them. Leave the review open, carry the authoritative provider receipt in the handoff, and flag the unresolved internal status so another operator cannot mistake it for an unissued adjustment.

Smallest future supported step, requiring a separate implementation decision: an owner-authenticated, exact-shop/exact-review recording operation, with immutable Commission amount/key/reference checks, concurrency-safe review claim, provider receipt plus exact adjusted amount/currency, operator/time audit in one transaction, and quarantine for unknown outcomes. It must record an already verified provider result, not issue money or reopen fees. It must handle partial relief without pretending the whole review amount was returned. No such action is claimed by this document.

## Publication exit checks

- Confirm owner/staff permissions and the exact app/store charge-history path without issuing a real adjustment merely to demonstrate access.
- Provide the supported internal outcome-recording operation above; verify duplicate operator submissions cannot record/issue relief twice.
- Rehearse unpaid-credit, paid-refund and unknown-result handling with provider test/sandbox evidence where available; never describe a development test charge as real merchant money.
- Keep one accountable owner and `info@actualscope.com` support, preserve provider receipts, and disclose manual refund review honestly. No claim of automatic reversal or completed settlement until the evidence exists.
