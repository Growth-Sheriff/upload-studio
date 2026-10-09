-- The public database must never contain the retired visitor profiling layer.
-- Fresh installs have none; this also removes a copied development schema.
-- This migration is NOT for custom/production tenant databases.
ALTER TABLE "uploads" DROP COLUMN IF EXISTS "visitor_id";
ALTER TABLE "uploads" DROP COLUMN IF EXISTS "session_id";
DROP TABLE IF EXISTS "visitor_sessions";
DROP TABLE IF EXISTS "visitors";
