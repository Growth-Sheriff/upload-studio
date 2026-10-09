# Data minimization and retention

Public-app only. No live custom tenant database or object has been changed.

| Record | Purpose | Retention and erasure |
| --- | --- | --- |
| Uploaded original, thumbnail and preview | Customer's finished production sheet; measure, charge and print without rearrangement | Unordered: seven days from upload creation. Ordered: 90 days from upload creation. Hourly retention removes up to 50 per shop per pass; these are creation-age limits, not guarantees of 90 days after fulfillment. Customer erasure deletes immediately after the 61-minute capability-expiry safety window. |
| Order-to-upload association, file content hash, customer Shopify ID | Cart/order matching, upload resume/deduplication and merchant-entered customer rates | Upload-linked rows cascade when upload is erased; matching customer-rate assignments are removed on customer erasure. No browser fingerprint or behavioral profile. |
| Usage fee, original order amount/currency, fixed FX snapshot, usage key/provider reference, credit review | Merchant accounting, captured-only eligibility, refund disputes and exactly-once provider reconciliation | Minimal finance ledger remains for the installed shop's lifetime. It has order IDs, not buyer contacts or artwork. Expiring usage keys while installed would permit a delayed replay to charge twice. Whole-shop erasure removes it. This retention is a disclosed engineering policy, not a claim that every jurisdiction legally requires it. |
| Operational upload logs | Diagnose upload/worker failures | 30 days; customer erasure removes matching upload logs sooner. |
| Merchant export ZIP archive | Download finished files for production | 24 hours after completion; customer erasure removes any archive containing a matching upload, including the object bytes. All export keys live under the same normalized shop prefix as uploads. |
| Merchant audit history | Trace billing, settings and privacy actions | 365 days; whole-shop erasure cascades all. |
| Privacy request inbox | Durable request acceptance, retry and delivery deduplication | Only shop domain, subject IDs and requested order IDs are stored; never webhook email/phone. Subject payload is cleared on completion. Export results are cleared after seven days and on matching customer erasure. Minimal receipt (topic/event/status/timestamps) remains for deduplication, with no customer payload after completion. |
| Merchant sessions, support and configuration | Authenticate staff, support merchants and configure products | Until merchant removes these or shop erasure; session token revoked on uninstall. Staff/team and support contact data are merchant-provided, not storefront customer tracking. |

## Request processing

`/webhooks/compliance` verifies HMAC over the untouched body, requires body/header shop agreement and writes the minimized inbox record before returning 200. Duplicate shop/topic/event deliveries reuse the same record. Processing leases expire safely; each destructive boundary verifies lease ownership and failed storage deletion leaves the database retryable. Contact-only requests are valid Shopify payloads: we accept them, store no contacts, and report that without a customer/order ID there is no matching collected record.

Customer erasure marks uploads privacy-blocked before waiting for the one-hour presigned URL lifetime plus one minute. Queued processing must reject marked uploads; customer assignments are removed from a freshly read serializable settings transaction, preserving other customers and unrelated configuration. Files, upload links/logs, export jobs and earlier matching data exports are removed. A data request exports upload metadata, measurement results, order associations, fee/credit facts and merchant-entered customer rates, through the authenticated Privacy requests page, never via webhook response or public link.

Uninstall records revocation and schedules erasure after 46 hours; capability drain starts then, allowing deletion within 48 hours in normal operation. Shopify's mandatory `shop/redact` also enters this process. The shop is marked erasing, new writes/jobs are closed, and sessions are removed. After 61 minutes the dedicated R2 shop prefix is swept, including derived/orphaned objects and unfinished multipart uploads, then the Shop cascade removes tenant rows. Storage or database failure retains the erasure job for retry and is visible to operators. No completion is claimed until object sweep and database deletion succeed.

## Operational obligations / limits

- Use a separate public bucket and credentials. Do not point this app at live custom-tenant storage.
- Alert on privacy jobs approaching Shopify's 30-day completion limit and on uninstall erasure failures. Long outages can exceed the 48-hour operational target; the inbox must not mark those requests complete.
- Backup deletion must follow the public infrastructure's documented backup lifecycle; no production backup infrastructure has yet been provisioned or verified. Do not claim backups are erased immediately.
- Public launch requires level-1 protected customer data approval for customer/order association; no customer email, phone, address or name is queried or persisted by the order snapshot.
- A local authenticated request and disposable database test is not proof that Shopify subscriptions or real R2 erasure are configured in production. Those remain separate launch checks.

Primary source checked 2026-10-09: [Shopify privacy compliance webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance), including contact-only requests, 48-hour shop/redact delivery and the 30-day completion requirement.
