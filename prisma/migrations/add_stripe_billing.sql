



ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_payment_method_id" TEXT;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_auto_charge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_email" TEXT;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_setup_at" TIMESTAMP(3);


ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "payment_provider" TEXT;
