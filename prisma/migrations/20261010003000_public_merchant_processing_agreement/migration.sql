-- Explicit agreement precedes activation; Shopify billing consent is separate.
ALTER TABLE "shops"
ADD COLUMN "legal_agreement_version" TEXT,
ADD COLUMN "legal_agreement_accepted_at" TIMESTAMP(3),
ADD COLUMN "legal_agreement_actor_id" TEXT;
