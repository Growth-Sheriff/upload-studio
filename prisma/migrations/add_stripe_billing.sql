-- Migration: Add Stripe billing fields to shops and payment_provider to commissions
-- Stripe alongside PayPal for dual payment provider support

-- Add Stripe fields to shops table (all nullable, no impact on existing data)
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_payment_method_id" TEXT;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_auto_charge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_email" TEXT;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "stripe_setup_at" TIMESTAMP(3);

-- Add payment_provider to commissions table (nullable, no impact on existing data)
ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "payment_provider" TEXT;
