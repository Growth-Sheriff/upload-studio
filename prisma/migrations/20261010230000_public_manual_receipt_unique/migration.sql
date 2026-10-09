-- A provider receipt remains unique even if an ordinary diagnostic audit expires.
-- PostgreSQL permits multiple NULL values for still-open/unknown review rows.
CREATE UNIQUE INDEX "billing_credits_provider_ref_key" ON "billing_credits"("provider_ref");
ALTER TABLE "billing_credits"
  ADD COLUMN "settled_amount_usd" DECIMAL(12,2),
  ADD COLUMN "receipt_fingerprint" TEXT;
