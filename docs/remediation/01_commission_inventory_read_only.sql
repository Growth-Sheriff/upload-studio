-- Upload Studio commission inventory (READ ONLY)
--
-- Run once per tenant connection. The tenant DATABASE_URL/search_path must
-- already point at the intended schema. This script deliberately does not try
-- to decide fee eligibility: the database does not retain authoritative
-- Shopify financial/refund history.
--
-- Suggested psql export:
--   \copy (SELECT * FROM commission_remediation_inventory) TO 'commission_inventory.csv' CSV HEADER

BEGIN TRANSACTION READ ONLY;

CREATE TEMP VIEW commission_remediation_inventory AS
WITH upload_facts AS (
  SELECT
    u.order_id,
    count(*)::integer AS linked_upload_count,
    bool_or(u.order_paid_at IS NOT NULL) AS any_order_paid_at,
    string_agg(DISTINCT u.status, ',' ORDER BY u.status) AS upload_statuses
  FROM uploads u
  WHERE u.order_id IS NOT NULL
  GROUP BY u.order_id
),
cancellation_facts AS (
  SELECT resource_id AS order_id, max(created_at) AS cancellation_audit_at
  FROM audit_logs
  WHERE action = 'order_cancelled' AND resource_type = 'order'
  GROUP BY resource_id
),
refund_facts AS (
  SELECT
    c.payment_ref,
    max(a.created_at) AS provider_refund_review_at
  FROM commissions c
  JOIN audit_logs a
    ON a.shop_id = c.shop_id
   AND a.action IN (
     'stripe_webhook_refund_review_required',
     'paypal_webhook_refund_review_required'
   )
   AND a.metadata_json::text LIKE '%' || c.payment_ref || '%'
  WHERE c.payment_ref IS NOT NULL
  GROUP BY c.payment_ref
)
SELECT
  current_schema() AS tenant_schema,
  s.shop_domain,
  c.id AS commission_id,
  c.order_id,
  c.order_number,
  c.status,
  c.commission_amount,
  c.order_total,
  c.order_currency,
  c.payment_ref,
  c.payment_provider,
  c.collectible_at,
  c.eligibility_source,
  c.attributable_captured_amount,
  c.shopify_financial_status,
  c.shopify_refund_status,
  c.shopify_cancelled_at,
  c.shopify_observed_at,
  c.review_required_at,
  c.review_reason,
  c.created_at,
  c.updated_at,
  coalesce(uf.linked_upload_count, 0) AS linked_upload_count,
  coalesce(uf.any_order_paid_at, false) AS any_order_paid_at,
  uf.upload_statuses,
  cf.cancellation_audit_at,
  rf.provider_refund_review_at,
  CASE
    WHEN c.status = 'pending' AND c.payment_ref IS NOT NULL
      THEN 'CONSISTENCY_ERROR'
    WHEN c.status IN ('charging', 'checkout_reserved') AND c.payment_ref IS NULL
      THEN 'CONSISTENCY_ERROR'
    WHEN c.status = 'paid' AND (c.payment_ref IS NULL OR c.paid_at IS NULL)
      THEN 'CONSISTENCY_ERROR'
    WHEN c.status IN ('charging', 'checkout_reserved')
      THEN 'PROVIDER_RECONCILIATION_REQUIRED'
    WHEN c.status = 'paid'
      THEN 'IMMUTABLE_PAID_REVIEW_ONLY'
    WHEN c.review_required_at IS NOT NULL
      THEN 'REVIEW_REQUIRED'
    WHEN c.shopify_cancelled_at IS NOT NULL
      THEN 'VOID_CANCELLED'
    WHEN c.shopify_refund_status = 'full'
      THEN 'VOID_FULL_REFUND'
    WHEN upper(c.order_currency) <> 'USD'
      THEN 'CURRENCY_POLICY_REQUIRED'
    WHEN cf.cancellation_audit_at IS NOT NULL
      THEN 'CANCELLATION_POLICY_REQUIRED'
    WHEN c.status = 'pending' AND c.collectible_at IS NULL
      THEN 'SHOPIFY_CAPTURE_EVIDENCE_REQUIRED'
    WHEN c.status = 'pending' AND c.collectible_at IS NOT NULL
      THEN 'COLLECTIBLE_CAPTURE_VERIFIED'
    ELSE 'REVIEW'
  END AS review_bucket
FROM commissions c
JOIN shops s ON s.id = c.shop_id
LEFT JOIN upload_facts uf ON uf.order_id = c.order_id
LEFT JOIN cancellation_facts cf ON cf.order_id = c.order_id
LEFT JOIN refund_facts rf ON rf.payment_ref = c.payment_ref
ORDER BY c.created_at, c.id;

SELECT * FROM commission_remediation_inventory;

SELECT
  review_bucket,
  status,
  order_currency,
  count(*) AS row_count,
  sum(commission_amount) AS commission_total
FROM commission_remediation_inventory
GROUP BY review_bucket, status, order_currency
ORDER BY review_bucket, status, order_currency;

COMMIT;
