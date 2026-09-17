-- Fee rows are audit records at order creation. They become collectible only
-- after Shopify reports the app-attributable order amount as captured.
--
-- Deliberately no backfill: historical `pending` rows have no trustworthy
-- capture provenance and therefore remain fail-closed until a fresh Shopify
-- order fact is reconciled.
ALTER TABLE "commissions"
  ADD COLUMN IF NOT EXISTS "collectible_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eligibility_source" TEXT,
  ADD COLUMN IF NOT EXISTS "attributable_captured_amount" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "shopify_financial_status" TEXT,
  ADD COLUMN IF NOT EXISTS "shopify_refund_status" TEXT,
  ADD COLUMN IF NOT EXISTS "shopify_cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shopify_observed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_required_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_reason" TEXT;

CREATE INDEX IF NOT EXISTS "commissions_shop_id_status_collectible_at_idx"
  ON "commissions"("shop_id", "status", "collectible_at");
