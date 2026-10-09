# Hosted three-shop isolation evidence

## Target and safety boundary

Executed after the new encrypted-host cutover, on **9 October 2026 UTC** (10
October in Istanbul). Only the independent public host was accessed:

- DigitalOcean droplet `607746803`, `143.198.12.234`; metadata ID checked both
  over the pinned SSH connection and from inside the disposable proof container.
- App origin `https://auto-gang-sheet.actualscope.com`, Shopify app
  `8822c01b1f0be2280240cfab7d4e9a79`.
- Exact new private PostgreSQL endpoint
  `private-agsu-public-pg-do-user-33221790-0.a.db.ondigitalocean.com`, database
  `public_app`, schema `public`, least-privilege runtime role `agsu_app`, required
  TLS with strict certificate validation.
- Deployed image, discovered from the public web container rather than assumed:
  `ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:9c039fc1dc6809006c604ae94b14074c255e0138f890347c813f83c398929d7c`.

Proof source: commit `d9bb952`,
`deploy/public/prove-hosted-isolation.ts`, SHA-256
`d9fe5081eb8fe8267a9907e89a0bb3db003acdcba675798bcac1d60a0e5487ff`.
It was copied only to `/opt/agsu-public/prove-hosted-isolation.ts` on that new
host, mounted read-only, then removed. The original source remains in Git.
Existing tenants, their hosts, queues, objects and order/billing rows were not
targets. Local integration tests' separate-test-database refusal gates were
not loosened or reused against this database.

## Method

The script refuses to proceed unless every target identity above matches,
`PUBLIC_APP_RUNTIME=true`, `PUBLIC_ISOLATION_ALLOWED_DROPLET=607746803`, and the
external HTTPS health endpoint returns 200. The pinned SSH connection first
checks the host ID and the web container's immutable public-image name.

The disposable command below used the **existing new-app** environment and CA;
credential values and signed request URLs were never logged:

```sh
timeout --signal=TERM --kill-after=10s 180s docker run --rm --read-only \
  --cap-drop ALL --security-opt no-new-privileges --memory 512m \
  --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --env-file /opt/agsu-public/public.env \
  -e PUBLIC_ISOLATION_ALLOWED_DROPLET=607746803 \
  -e NODE_OPTIONS=--max-old-space-size=256 \
  -v /opt/agsu-public/pg-ca.pem:/run/secrets/pg-ca.pem:ro \
  -v /opt/agsu-public/prove-hosted-isolation.ts:/app/deploy/public/prove-hosted-isolation.ts:ro \
  ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:9c039fc1dc6809006c604ae94b14074c255e0138f890347c813f83c398929d7c \
  node --import tsx /app/deploy/public/prove-hosted-isolation.ts
```

It created three inactive synthetic shop rows and one empty draft upload per
shop. No offline Shopify sessions, actual customer records, order links,
commissions, storage objects or queue jobs were created. Fixture marker:
`1f5bb849d8d943eeb4b494d9d21524ec`. Exact shop IDs followed
`hosted-isolation-1f5bb849d8d943eeb4b494d9d21524ec-0` through `-2`; upload IDs
followed `fixture-1f5bb849d8d943eeb4b494d9d21524ec-0` through `-2`.

Each shop used the same guarded Prisma client concurrently. HTTP checks reached
the actual external HTTPS app, through its deployed request/authentication
wrapper, using Shopify-compatible proxy HMACs generated in memory. The proxy
path prefix was `/apps/customizer`, matching the public Shopify configuration.
No activation, agreement or billing requirement was bypassed.

## Actual result

```text
Proof start UTC: 2026-10-09T22:19:37.4409826Z
PASS shop 1: implicit read scope exposes only its own upload
PASS shop 1: foreign unique ID is unreadable
PASS shop 1: foreign update refused
PASS shop 1: foreign relation create refused
PASS shop 1: injected shop predicate refused
PASS shop 3: implicit read scope exposes only its own upload
PASS shop 3: foreign unique ID is unreadable
PASS shop 2: implicit read scope exposes only its own upload
PASS shop 2: foreign unique ID is unreadable
PASS shop 3: foreign update refused
PASS shop 2: foreign update refused
PASS shop 3: foreign relation create refused
PASS shop 3: injected shop predicate refused
PASS shop 2: foreign relation create refused
PASS shop 2: injected shop predicate refused
PASS shop 2: deployed signed proxy returns its own upload
PASS shop 2: deployed signed proxy denies foreign upload
PASS shop 1: deployed signed proxy returns its own upload
PASS shop 3: deployed signed proxy returns its own upload
PASS shop 1: deployed signed proxy denies foreign upload
PASS shop 3: deployed signed proxy denies foreign upload
PASS deployed proxy refuses an unsigned request
PASS deployed proxy refuses a changed signed shop
PASS all uploads stayed draft, with no upload items or commission rows
PASS 24 assertions across three simultaneous synthetic shops.
CLEANUP verified: all three exact fixture shops and cascading uploads deleted. Rate-limit keys expire in 60 seconds; no queue or storage changes.
Proof exit: 0
SOURCE_COPY_REMOVED
Proof end UTC: 2026-10-09T22:19:45.0360790Z
```

Three expected Prisma errors also appeared for the intentionally forbidden
updates: `Record to update not found.` Each was followed by its passing refusal
assertion. These are evidence of the injected owner predicate, not a failed
customer upload. Own signed status requests returned 200 and their own upload
IDs; foreign requests returned 404; unsigned and altered-shop requests returned
400. All upload statuses remained `draft`, with zero upload items and zero
commissions. The 7.60-second wall interval includes source transfer, disposable
container execution, exact source cleanup and SSH round trips; it is **not** an
upload-measurement latency benchmark.

Cleanup deleted only the three ownership-checked exact fixture shop IDs, with
their cascading empty uploads, and verified zero remaining fixture shops.
Normal per-fixture request rate-limit counters were left to their 60-second
expiry; no queue state or Redis database was cleared. The exact copied proof
source was deleted and its absence checked. The disposable container exited 0
and was automatically removed.

## What this does not prove

This is a hosted isolation proof across three synthetic shops, not three real
installed Shopify stores. It does not prove real Shopify proxy forwarding,
storefront rendering, customer checkout, payment, webhook delivery, usage
billing, retention erasure or Lighthouse performance. It covers the deployed
`9c039fc1…` image only, not later local changes or the separately published
`271d78d3…` image. Those claims require their own corresponding evidence.
