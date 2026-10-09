# Public application plan

Date: 2026-10-09. Baseline: `76113c193d7da789df9b2d3ea1ad7947af48b334` (`origin/main`). Dedicated worktree, branch `public-app`.

## Work order and decisions

1. Read current Shopify primary documentation, inventory repository assumptions, and establish branch/deployment safeguards. Record observed infrastructure identities without mutating existing infrastructure.
2. Remove person tracking and its complete dependency chain. Keep content hashes, cart identity, order links and aggregate shop operations.
3. Persist all sessions in PostgreSQL. Make row isolation mandatory, including relation-owned records and writes. Use one Redis DB with shop-scoped jobs, concurrency leases and bounded download/image execution.
4. Replace merchant Stripe/PayPal collection with Shopify usage billing: 3.5% of attributable captured net merchandise, maximum USD 6 per order. Keep existing order attribution and paid/cancel/refund gates. Persist one logical charge key independently of delivery/retry; unknown provider outcomes retain the same key.
5. Implement durable, HMAC-authenticated compliance requests, actual export/erasure and retention processing. Minimize customer fields; prepare protected-data justification.
6. Configure one app against stable API `2026-10`; provide self-service product setup, visible printable limits and billing approval. Preserve finished-sheet measurement and the three cart properties.
7. Register only in the Actualscope account; provision entirely new infrastructure, isolated credentials and demo stores. Existing Growth Sheriff applications and both live droplets are excluded. If access is unavailable, record evidence and finish independent work.
8. Run tests, typecheck, build, isolation and signed-webhook tests. Publish only the public configuration. Verify three shops, demo checkout/usage, cap behavior, extensions, network and performance; distinguish local evidence from live evidence.

Each workstream owns disjoint source files where practical. Source edits use explicit patches, never sed/awk or scripted source rewriting. Logical commits explain business reasons. Evidence is updated as work proceeds, never replaced by unexecuted claims.

## Release boundary

App Store approval, protected-data approval and measured 28-day Web Vitals cannot be inferred from local tests. Missing authenticated accounts, independent hosting credentials or demo store access are documented in `open-questions.md`. Those gaps block a claim of publication, not independent implementation.

## Progress

- Dedicated managed worktree created from origin/main; `public-app` branch created. Original checkout untouched.
- Official documentation read for stable version/deprecation, usage billing, privacy, access tokens, proxy, extensions, webhook duplication and performance.
- Implementation and release evidence pending.
