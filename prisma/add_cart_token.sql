-- Adds the cart-token carrier column used by /api/cart/bind and the
-- orders/create webhook fallback matching (see app/lib/orderMatching.server.ts).
--
-- Normally applied automatically: docker-entrypoint.sh runs `prisma db push`
-- on container start. This file exists for manual application per tenant
-- schema, matching the repo's other ad-hoc migration files.

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS cart_token TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS order_name TEXT;
ALTER TABLE upload_items ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE INDEX IF NOT EXISTS "upload_items_fingerprint_idx" ON upload_items (fingerprint);

CREATE INDEX IF NOT EXISTS "uploads_shop_id_cart_token_idx"
  ON uploads (shop_id, cart_token);

-- Copies / nesting request captured at add-to-cart time (additive).
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS requested_copies INTEGER;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS designs_per_sheet INTEGER;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS sheets_needed INTEGER;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS cart_variant_id TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS cart_sheet_label TEXT;
