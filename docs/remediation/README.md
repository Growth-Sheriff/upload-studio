# Commission remediation runbook (not executed)

1. Run `01_commission_inventory_read_only.sql` once per tenant using a connection whose
   search path is already restricted to that tenant schema. Export the detailed view and
   summary as CSV.
2. Enrich each row with current, read-only Shopify evidence: financial status,
   cancellation time, current line totals/discounts, currency, refunded line quantities
   and amounts, and order `updatedAt`. The local schema does not preserve enough history
   to infer these facts safely.
3. The owner assigns one of `leave`, `void_pending`, `waive_pending`,
   `correct_pending_amount`, or `confirm_captured_pending`. The last action requires an
   attributable captured amount/time, explicit Shopify `paid` and `none` refund evidence,
   and refuses any cancellation or stored refund fact. `correct_pending_amount` changes
   only the amount and preserves any safety-review quarantine; only void/waive or the
   strict capture-confirmation action clears that review. Never bulk-edit `paid`,
   `charging`, `checkout_reserved`, or any row carrying a provider reference.
4. Load the reviewed CSV into `02_apply_owner_approved_decisions.sql`. Its optimistic
   snapshot checks make the whole batch fail if any row changed after review. Run the
   default `ROLLBACK` copy first and retain its output.
5. For a `charging`/`checkout_reserved` row, reconcile the exact claim with Stripe or
   PayPal. Provider success must settle the complete claim using the provider reference,
   amount, and currency; confirmed no-charge may be released only after the owner applies
   the eligibility policy. Unknown outcomes stay quarantined.
6. Paid rows remain immutable. Commercial relief after collection requires a provider
   refund or a future-credit/adjustment ledger; reopening a paid commission risks a second
   charge.

Dry-run review columns include tenant schema, batch ID, commission ID, action,
before/after status and amount, before/after collectible time, captured amount, Shopify
financial/refund/cancellation facts, provider reference, proposed update time, and reason.
The scripts have not been run against any database.
