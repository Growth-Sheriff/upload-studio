-- Adds the cart-token carrier column used by /api/cart/bind and the
-- orders/create webhook fallback matching (see app/lib/orderMatching.server.ts).
--
-- Normally applied automatically: docker-entrypoint.sh runs `prisma db push`
-- on container start. This file exists for manual application per tenant
-- schema, matching the repo's other ad-hoc migration files.

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS cart_token TEXT;

CREATE INDEX IF NOT EXISTS "uploads_shop_id_cart_token_idx"
  ON uploads (shop_id, cart_token);
