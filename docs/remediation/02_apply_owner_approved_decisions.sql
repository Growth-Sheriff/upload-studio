-- Upload Studio owner-approved commission remediation
--
-- DO NOT run until the inventory CSV has been enriched with current Shopify
-- financial/cancellation/refund facts and the owner has approved every row.
-- The script ROLLS BACK by default. Review its result sets, then replace only
-- the final ROLLBACK with COMMIT in a separately reviewed copy.
--
-- Required CSV columns:
-- batch_id,commission_id,expected_status,expected_updated_at,
-- expected_payment_ref,expected_amount,action,target_amount,reason,shopify_evidence

BEGIN;

CREATE TEMP TABLE remediation_decisions (
  batch_id text NOT NULL,
  commission_id text NOT NULL PRIMARY KEY,
  expected_status text NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  expected_payment_ref text,
  expected_amount numeric(10,2) NOT NULL,
  action text NOT NULL CHECK (
    action IN ('leave', 'void_pending', 'waive_pending', 'correct_pending_amount')
  ),
  target_amount numeric(10,2),
  reason text NOT NULL,
  shopify_evidence text NOT NULL
);

-- psql client-side import; set the reviewed absolute path before running.
-- \copy remediation_decisions FROM '/ABSOLUTE/PATH/owner_approved_decisions.csv' WITH (FORMAT csv, HEADER true, NULL '')

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM remediation_decisions) THEN
    RAISE EXCEPTION 'No reviewed decisions loaded; refusing to continue';
  END IF;
  IF (SELECT count(DISTINCT batch_id) FROM remediation_decisions) <> 1 THEN
    RAISE EXCEPTION 'Exactly one batch_id is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM remediation_decisions
    WHERE action = 'correct_pending_amount'
      AND (target_amount IS NULL OR target_amount <= 0 OR target_amount > 6.00)
  ) THEN
    RAISE EXCEPTION 'Corrected fee must be above 0.00 and at or below the 6.00 cap; use void/waive for zero';
  END IF;
END $$;

-- Lock every reviewed row and retain the exact before-image for audit/output.
CREATE TEMP TABLE remediation_before AS
SELECT
  c.id,
  c.shop_id,
  c.status,
  c.updated_at,
  c.payment_ref,
  c.commission_amount,
  d.batch_id,
  d.action,
  d.target_amount,
  d.reason,
  d.shopify_evidence
FROM commissions c
JOIN remediation_decisions d ON d.commission_id = c.id
FOR UPDATE OF c;

DO $$
DECLARE
  expected_count integer;
  matched_count integer;
BEGIN
  SELECT count(*) INTO expected_count FROM remediation_decisions;
  SELECT count(*) INTO matched_count FROM remediation_before;
  IF matched_count <> expected_count THEN
    RAISE EXCEPTION 'Snapshot mismatch: expected % rows, found %', expected_count, matched_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM remediation_before b
    JOIN remediation_decisions d ON d.commission_id = b.id
    WHERE b.status IS DISTINCT FROM d.expected_status
       OR b.updated_at IS DISTINCT FROM d.expected_updated_at
       OR b.payment_ref IS DISTINCT FROM d.expected_payment_ref
       OR b.commission_amount IS DISTINCT FROM d.expected_amount
  ) THEN
    RAISE EXCEPTION 'One or more rows changed after review; refusing the entire batch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM remediation_before
    WHERE action <> 'leave' AND (status <> 'pending' OR payment_ref IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Only unclaimed pending rows may be changed in bulk';
  END IF;
END $$;

UPDATE commissions c
SET
  status = CASE d.action
    WHEN 'void_pending' THEN 'void'
    WHEN 'waive_pending' THEN 'waived'
    ELSE c.status
  END,
  commission_amount = CASE d.action
    WHEN 'correct_pending_amount' THEN d.target_amount
    ELSE c.commission_amount
  END,
  updated_at = now()
FROM remediation_decisions d
WHERE c.id = d.commission_id
  AND d.action <> 'leave'
  AND c.status = 'pending'
  AND c.payment_ref IS NULL;

DO $$
DECLARE
  expected_updates integer;
  applied_updates integer;
BEGIN
  SELECT count(*) INTO expected_updates
  FROM remediation_decisions WHERE action <> 'leave';

  SELECT count(*) INTO applied_updates
  FROM remediation_before b
  JOIN commissions c ON c.id = b.id
  WHERE b.action <> 'leave' AND c.updated_at IS DISTINCT FROM b.updated_at;

  IF applied_updates <> expected_updates THEN
    RAISE EXCEPTION 'Expected % updates, applied %; rolling back', expected_updates, applied_updates;
  END IF;
END $$;

INSERT INTO audit_logs (
  id, shop_id, user_id, action, resource_type, resource_id, metadata_json, created_at
)
SELECT
  'remed-' || substr(md5(b.batch_id || ':' || b.id), 1, 20),
  b.shop_id,
  NULL,
  'commission_owner_approved_remediation',
  'commission',
  b.id,
  jsonb_build_object(
    'batchId', b.batch_id,
    'decision', b.action,
    'reason', b.reason,
    'shopifyEvidence', b.shopify_evidence,
    'beforeStatus', b.status,
    'afterStatus', c.status,
    'beforeAmount', b.commission_amount,
    'afterAmount', c.commission_amount
  ),
  now()
FROM remediation_before b
JOIN commissions c ON c.id = b.id
WHERE b.action <> 'leave';

-- Dry-run output retained even though the transaction rolls back below.
SELECT
  current_schema() AS tenant_schema,
  b.batch_id,
  b.id AS commission_id,
  b.action,
  b.status AS before_status,
  c.status AS after_status,
  b.commission_amount AS before_amount,
  c.commission_amount AS after_amount,
  b.payment_ref,
  c.updated_at AS proposed_updated_at,
  b.reason
FROM remediation_before b
JOIN commissions c ON c.id = b.id
ORDER BY b.id;

-- SAFETY DEFAULT. The owner must approve a separate copy that says COMMIT.
ROLLBACK;
