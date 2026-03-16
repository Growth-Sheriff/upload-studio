-- Migration: Add builder_config_json to products_config
-- Stores area-based pricing tiers, volume discounts, and fee configuration
-- for the Builder Modal (DTF size-based upload flow)

ALTER TABLE "products_config"
ADD COLUMN "builder_config_json" JSONB;
