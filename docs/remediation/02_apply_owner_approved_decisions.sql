-- Upload Studio owner-approved commission remediation
--
-- DO NOT run until the inventory CSV has been enriched with current Shopify
-- financial/cancellation/refund facts and the owner has approved every row.
-- The script ROLLS BACK by default. Review its result sets, then replace only
-- the final ROLLBACK with COMMIT in a separately reviewed copy.
--
-- Required CSV columns:
-- batch_id,commission_id,expected_status,expected_updated_at,
-- expected_payment_ref,expected_amount,expected_collectible_at,
-- expected_review_required_at,action,target_amount,captured_at,captured_amount,
-- financial_status,refund_status,cancelled_at,reason,shopify_evidence

BEGIN;

CREATE TEMP TABLE remediation_decisions (
  batch_id text NOT NULL,
  commission_id text NOT NULL PRIMARY KEY,
  expected_status text NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  expected_payment_ref text,
  expected_amount numeric(10,2) NOT NULL,
  expected_collectible_at timestamptz,
  expected_review_required_at timestamptz,
  action text NOT NULL CHECK (
    action IN (
      'leave',
      'void_pending',
      'waive_pending',
      'correct_pending_amount',
      'confirm_captured_pending'
    )
  ),
  target_amount numeric(10,2),
  captured_at timestamptz,
  captured_amount numeric(10,2),
  financial_status text,
  refund_status text,
  cancelled_at timestamptz,
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
  IF EXISTS (
    SELECT 1 FROM remediation_decisions
    WHERE action = 'confirm_captured_pending'
      AND (
        captured_at IS NULL
        OR captured_amount IS NULL
        OR captured_amount <= 0
        OR coalesce(lower(nullif(trim(financial_status), '')), '') <> 'paid'
        OR cancelled_at IS NOT NULL
        OR coalesce(lower(nullif(trim(refund_status), '')), '') <> 'none'
      )
  ) THEN
    RAISE EXCEPTION 'A collectible decision requires positive attributable capture evidence and no cancellation/refund';
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
  c.collectible_at,
  c.eligibility_source,
  c.attributable_captured_amount,
  c.shopify_financial_status,
  c.shopify_refund_status,
  c.shopify_cancelled_at,
  c.shopify_observed_at,
  c.review_required_at,
  c.review_reason,
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
       OR b.collectible_at IS DISTINCT FROM d.expected_collectible_at
       OR b.review_required_at IS DISTINCT FROM d.expected_review_required_at
  ) THEN
    RAISE EXCEPTION 'One or more rows changed after review; refusing the entire batch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM remediation_before
    WHERE action <> 'leave' AND (status <> 'pending' OR payment_ref IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Only unclaimed pending rows may be changed in bulk';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM remediation_before
    WHERE action = 'confirm_captured_pending'
      AND (
        shopify_cancelled_at IS NOT NULL
        OR coalesce(lower(nullif(trim(shopify_refund_status), '')), 'none') <> 'none'
      )
  ) THEN
    RAISE EXCEPTION 'A collectible decision cannot override a stored cancellation/refund fact';
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
  collectible_at = CASE
    WHEN d.action = 'confirm_captured_pending' THEN d.captured_at
    WHEN d.action IN ('void_pending', 'waive_pending') THEN NULL
    ELSE c.collectible_at
  END,
  eligibility_source = CASE
    WHEN d.action = 'confirm_captured_pending' THEN 'owner_reviewed_shopify_capture'
    WHEN d.action IN ('void_pending', 'waive_pending') THEN 'owner_reviewed_not_collectible'
    ELSE c.eligibility_source
  END,
  attributable_captured_amount = CASE
    WHEN d.action = 'confirm_captured_pending' THEN d.captured_amount
    ELSE c.attributable_captured_amount
  END,
  shopify_financial_status = coalesce(nullif(trim(d.financial_status), ''), c.shopify_financial_status),
  shopify_refund_status = CASE
    -- Runtime uses NULL (not the literal string "none") for no refund.
    WHEN d.action = 'confirm_captured_pending' THEN NULL
    WHEN nullif(trim(d.refund_status), '') IS NOT NULL
      AND lower(trim(d.refund_status)) <> 'none' THEN lower(trim(d.refund_status))
    ELSE c.shopify_refund_status
  END,
  shopify_cancelled_at = coalesce(d.cancelled_at, c.shopify_cancelled_at),
  shopify_observed_at = CASE
    WHEN d.action <> 'leave' THEN now()
    ELSE c.shopify_observed_at
  END,
  review_required_at = CASE
    WHEN d.action IN ('void_pending', 'waive_pending', 'confirm_captured_pending') THEN NULL
    ELSE c.review_required_at
  END,
  review_reason = CASE
    WHEN d.action IN ('void_pending', 'waive_pending', 'confirm_captured_pending') THEN NULL
    ELSE c.review_reason
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
    'afterAmount', c.commission_amount,
    'beforeCollectibleAt', b.collectible_at,
    'afterCollectibleAt', c.collectible_at,
    'capturedAmount', c.attributable_captured_amount,
    'financialStatus', c.shopify_financial_status,
    'refundStatus', c.shopify_refund_status,
    'cancelledAt', c.shopify_cancelled_at
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
  b.collectible_at AS before_collectible_at,
  c.collectible_at AS after_collectible_at,
  c.attributable_captured_amount,
  c.shopify_financial_status,
  c.shopify_refund_status,
  c.shopify_cancelled_at,
  c.updated_at AS proposed_updated_at,
  b.reason
FROM remediation_before b
JOIN commissions c ON c.id = b.id
ORDER BY b.id;

-- SAFETY DEFAULT. The owner must approve a separate copy that says COMMIT.
ROLLBACK;
