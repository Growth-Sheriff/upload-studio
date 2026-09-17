-- Existing rows are deliberately left NULL: their quantity columns may have
-- been written by the retired nesting model and cannot be relabelled safely.
ALTER TABLE "uploads"
  ADD COLUMN IF NOT EXISTS "quantity_semantics" TEXT;
