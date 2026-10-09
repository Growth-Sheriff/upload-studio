# Hosted compliance evidence

## Boundary and actual target

Executed on 9 October 2026 UTC (10 October in Istanbul), against only the new
public application. No existing custom-app host, installed demo shop, real
customer, order, commission, paid-volume record or BullMQ job was a fixture.

- Droplet `607746803`, `143.198.12.234`; exact metadata ID checked over pinned
  SSH and again from the disposable proof container.
- App `8822c01b1f0be2280240cfab7d4e9a79`, origin
  `https://auto-gang-sheet.actualscope.com`.
- Exact private PostgreSQL host
  `private-agsu-public-pg-do-user-33221790-0.a.db.ondigitalocean.com`, database
  `public_app`, schema `public`, runtime role `agsu_app`, required TLS and strict
  certificate validation.
- Private R2 account `3b964e63af3f0e752c640e35dab68c9b`, bucket
  `auto-gang-sheet-public`, no public bucket URL.
- Deployed web and privacy-worker image discovered with read-only Docker
  inspection:
  `ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:9c039fc1dc6809006c604ae94b14074c255e0138f890347c813f83c398929d7c`.

The parent approved these exact targets and fixtures before execution and held
deployment during the proof. The existing privacy worker was not restarted;
its start time remained `2026-10-09T22:16:48.709802152Z` before and after.

Source: [prove-hosted-compliance.ts](../../deploy/public/prove-hosted-compliance.ts).
Executed source SHA-256:
`4efa390263785ea4ccf878d08ff4ce443116641eeb8f5a1ce9663419f6ced481`.
Sanitized complete stdout: [hosted-compliance-ae4da577.txt](evidence/hosted-compliance-ae4da577.txt).

## Exact synthetic fixtures

Fixed owner-approved UUID: `ae4da577-bcd1-4f50-8332-af7040fb5e3d`.
Three inactive, non-orderable synthetic shop domains:

```text
agsu-privacy-subject-ae4da577bcd14f508332af7040fb5e3d.myshopify.com
agsu-privacy-erase-ae4da577bcd14f508332af7040fb5e3d.myshopify.com
agsu-privacy-control-ae4da577bcd14f508332af7040fb5e3d.myshopify.com
```

Shop IDs were `hosted-privacy-ae4da577bcd14f508332af7040fb5e3d-` followed by
`subject`, `erase` or `control`. Upload IDs used the same marker with prefix
`privacy-`; there was one upload per shop plus an unrelated customer's upload
in the subject shop. Synthetic customer IDs were `700000000000001` and
`700000000000002`, not Shopify API records.

Eight tiny actual R2 objects used only their synthetic shop-domain prefixes:
subject original/thumbnail/preview/archive, unrelated customer's original,
control original, shop-erasure original and an unreferenced orphan. One exact
unfinished multipart upload was created beneath the shop-erasure prefix. The
completed synthetic export row referenced the subject archive; one synthetic
offline session belonged only to the shop-erasure fixture. The bytes were
explicitly synthetic privacy-proof content, not image-decoding test material.

The script refuses pre-existing shop/domain/session/receipt/prefix collisions
before its first write. It refuses every different app, host, database, role,
TLS mode, account, bucket or run UUID. It never calls Shopify APIs or starts a
global compliance/retention batch: the already running privacy worker claims
the real HTTP-created receipts normally.

## Method and command

The proof sent actual HTTPS POSTs to `/webhooks/compliance`, signing each raw
body in memory with the new app's HMAC secret. Headers included topic,
synthetic shop domain and an exact event ID. Original and replay deliveries
used the same event ID; completed deliveries were replayed again to verify
that completed exports or erasures were not recreated. A separate invalid
signature returned 401 and created no receipt. Fake email/phone values in the
body were explicitly checked absent from stored payload and export results.
No signature, credential, capability URL or raw export was logged.

Only the new host received a temporary copy of this source. The disposable
command used the existing new-app environment and mounted the source/CA
read-only:

```sh
docker run --rm --name agsu-privacy-proof-ae4da577 --read-only \
  --cap-drop ALL --security-opt no-new-privileges --memory 512m \
  --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --env-file /opt/agsu-public/public.env \
  -e PUBLIC_COMPLIANCE_ALLOWED_DROPLET=607746803 \
  -e PUBLIC_COMPLIANCE_PROOF_RUN_ID=ae4da577-bcd1-4f50-8332-af7040fb5e3d \
  -e NODE_OPTIONS=--max-old-space-size=256 \
  -v /opt/agsu-public/pg-ca.pem:/run/secrets/pg-ca.pem:ro \
  -v /opt/agsu-public/prove-hosted-compliance.ts:/app/deploy/public/prove-hosted-compliance.ts:ro \
  ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:9c039fc1dc6809006c604ae94b14074c255e0138f890347c813f83c398929d7c \
  node --import tsx /app/deploy/public/prove-hosted-compliance.ts
```

For both customer and shop erasure, the proof first observed the **real**
closed/blocked state and pending 61-minute capability-drain deadline, with
objects still present. It then advanced only the approved synthetic receipt
creation time and synthetic shop's erasure-start timestamp by 62 minutes,
using exact ownership/status/lease compare-and-set predicates. It did not
change the drain policy, reset a processing lease or alter real timestamps.
This is explicitly a simulated clock, not an actual 61-minute wait or a
48-hour SLA measurement.

## Actual results

Proof interval: `2026-10-09T22:29:02.654Z` to
`2026-10-09T22:29:31.205Z`, **28.551 seconds** inside the script. SSH/source
transfer/cleanup outer interval: `22:28:56.1227349Z` to `22:29:32.2448897Z`.
These are proof timings, not customer upload latency.

| Actual HTTP request | Original | Replay | Processing result |
| --- | --- | --- | --- |
| Invalid HMAC | 401, 14 ms | — | No durable receipt |
| `customers/data_request` | 200, 22 ms | 200, 20 ms | One minimized receipt; existing worker exported exactly one subject upload and its assignment, no unrelated customer/shop data; completed replay kept attempt count 1 |
| `customers/redact` | 200, 16 ms | 200, 14 ms | Immediate block, then physical erasure after simulated drain; original, thumbnail, preview and archive all HEAD404; upload/archive rows removed, assignment removed, earlier export payload/result fenced and cleared |
| `shop/redact` | 200, 11 ms | 200, 17 ms | Immediate token/session closure, then prefix sweep and multipart abort after simulated drain; synthetic shop and cascades deleted; orphan object and unfinished multipart gone |

All acknowledgments were measured from inside the new host and were below
five seconds. They are not remote buyer/browser network measurements.
The same customer ID in the control shop remained untouched. The other
customer's upload/object/assignment within the subject shop also remained
untouched. Post-completion replays did not restore erased results or repeat
processing. Existing independent privacy-worker code, not a proof-specific
replacement, performed the export and deletion.

## Cleanup and limits

The `finally` cleanup revoked only this run's receipt leases and cleared its
payload/results, then removed only predetermined exact object keys,
multipart ID, ownership-checked shops/cascades, synthetic session IDs and
event receipts. Independent cleanup steps continue even if one fails; such
a failure fails the proof. Actual run cleanup passed:

```text
CLEANUP verified: All eight exact R2 keys HEAD404; all three synthetic prefixes and multipart lists empty; exact shops/cascades, sessions and minimized receipts/export results removed. No queue flush or real shop/order/fee changes.
Proof exit: 0
SOURCE_COPY_REMOVED
POST_PROOF_CLEAN
```

The disposable container and exact remote source copy were absent afterward.
No queue flush, database-wide deletion, real demo-shop mutation or existing
tenant operation occurred. Source passes a standalone strict TypeScript
check; the app typecheck also passed. A separate attempt to run existing
local compliance integration tests could not connect to the stopped
disposable database at `127.0.0.1:55439`; that is not reported as a pass, and
test guards were not relaxed to use the hosted database.

This proves real deployed HTTP HMAC validation, durable replay identity,
actual existing-worker export/erasure, R2 orphan/multipart deletion and exact
cleanup for the tested image. It does **not** prove Shopify-originated webhook
delivery, Shopify retry timing, actual elapsed drain/48-hour SLA, financial
record redaction, long-term retention, later local changes, checkout or usage
billing. Those require their own corresponding evidence.
