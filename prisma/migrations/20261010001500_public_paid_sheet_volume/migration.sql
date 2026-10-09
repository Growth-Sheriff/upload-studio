-- Future public orders earn volume from accepted server units and exact paid
-- order-line quantities. NULL legacy facts are intentionally never backfilled.
ALTER TABLE "uploads"
  ADD COLUMN "checkout_unit_billable_inches" DECIMAL(12,4),
  ADD COLUMN "checkout_pricing_mode" TEXT,
  ADD COLUMN "checkout_variant_id" TEXT,
  ADD COLUMN "checkout_quote_accepted_at" TIMESTAMP(3);

CREATE TABLE "paid_sheet_volume" (
  "id" TEXT PRIMARY KEY,
  "shop_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "line_item_id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "paid_at" TIMESTAMP(3) NOT NULL,
  "paid_customer_id" TEXT,
  "paid_quantity" INTEGER NOT NULL,
  "paid_unit_billable_inches" DECIMAL(12,4) NOT NULL,
  "paid_billable_inches" DECIMAL(16,4) NOT NULL,
  CONSTRAINT "paid_sheet_volume_shop_id_fkey" FOREIGN KEY ("shop_id")
    REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "paid_sheet_volume_shop_id_order_id_line_item_id_key"
  ON "paid_sheet_volume"("shop_id", "order_id", "line_item_id");
CREATE INDEX "paid_sheet_volume_shop_id_paid_customer_id_paid_at_idx"
  ON "paid_sheet_volume"("shop_id", "paid_customer_id", "paid_at");
