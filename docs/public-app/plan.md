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
- Visitor profiling, attribution, browser replay and external merchant-card collection removed; file hashes and order identity remain.
- Shared durable sessions, mandatory row guards, signed upload/download ownership, Redis DB0 and distributed per-shop resource limits implemented.
- Shopify usage billing, cap approval, immutable retries/unknown outcomes and durable privacy/retention implemented. Local PostgreSQL/Redis tests exercise real locks, leases and file deletion; provider transport remains simulated.
- Self-service product setup, public legal/help drafts, minimum scopes, independent Docker/CI/config and both extension builds implemented.
- Final review fixed OAuth/session-versus-erasure races, silent admin shop recreation and retention-versus-erasure races. Paid film-volume eligibility now uses immutable accepted units and paid order-line quantities, not a second orientation calculation; privacy unlinking is fenced.
- Final Linux suite: 56 files and all 391 tests passed, including ImageMagick and real local PostgreSQL/Redis integrations. Full typecheck, regression harness, app/extension builds and nonroot read-only Docker HTTP smoke pass. Results and explicitly unproven live gates are in verification.md.
- After the public push, dependency review removed the unused Express server chain and applied compatible published security patches. The production audit now has zero critical entries, with two high/three moderate conditions explicitly retained in dependency-security.md. Post-update Linux suite again passes all391 tests; Windows, typecheck, harness, extension builds and the latest nonroot read-only image smoke also pass. GitHub CI is blocked before any steps by the organization's billing lock; no organization billing setting was changed.
- The initial pre-access review could not verify registration or hosting. That historical limit was superseded by the authorized release work below; it must not be read as the current deployment state.

## Authorized release work — 2026-10-10

The owner now authorizes independent provisioning, provider CI, public deployment, demo-store content and App Store submission. The existing tenant/app/droplet exclusions remain absolute. Chrome's Actual Scope profile is connected; the existing development shop is accessible, but the app organization must still be verified before registration.

1. Verify Actualscope Shopify organization and create only Auto Gang Sheet Upload; keep pinned CLI3.88.1 and explicit public config.
2. Use a new Depot project for public builds/tests, independent of the GitHub Actions billing lock. Never reuse the existing Upload Studio or gang-sheet-editor projects.
3. Provision a new DigitalOcean project/host/data services and new Cloudflare R2 bucket/DNS records. Verify exact targets and estimated recurring costs; never reuse either live Upload Studio droplet or shared databases/buckets.
4. Download the development shop theme into a separate demo directory before editing. Build honest product demos for every relevant product block and supporting catalog/cart surfaces, using FAL-generated original print-shop images rather than fake product claims or review screenshots.
5. Run hosted multishop isolation, real storage, signed compliance requests, Shopify test subscription/order/usage/replay/cap checks, extension rendering and Lighthouse. Submit only after the real gates are satisfied; external approval is never reported as completed before Shopify grants it.

Provider credentials remain outside Git and are consumed only for their authorized service. No raw credential inventory is committed. A mistaken inventory output exposed several API credentials in tool history; their values are not repeated or copied into evidence, and rotation is a separate owner-security action because existing services may use them.

### Latest executed progress — after 9 October, 22:51 UTC

The historical22:22 snapshot below is retained as history. The permanent-token403 is now resolved on all three real installations; the demo's six real product configurations were saved in Polaris. Source78e82f9 is deployed only to the new host; the narrower advanced-widget revert910da79 and truthful unit-rate displayf519d22 await a clean final image. Actual Shopify UI confirms Manual pricing (legacy), so no managed-plan migration is necessary. Versioned Actual Scope merchant Terms/DPA are deployed but have not been accepted without action-time owner confirmation. No real subscription/order/usage, Lighthouse result, review video or App Store submission is claimed. See verification.md and open-questions.md for remaining concrete gates.

### Historical executed progress — 9 October, 22:22 UTC

- Correct Actual Scope organization239354566 owns app433768202241. Version1161809625089 is released with API2026-10 and its own two extension identities. All three new development shops installed this app. Level1 order-data development purposes were saved without buyer contact fields; this is not an App Store approval.
- A new private repository, Growth-Sheriff/auto-gang-sheet-public, contains only public-app as its default branch. Isolated Depot builds/tests passed; automatic repository triggering is still being configured. The organization installation screen requests broader organization permissions than the approved repository access, so those permissions have not been granted.
- New DigitalOcean project, droplet607746803, managed PostgreSQL/Valkey, private R2 bucket and new DNS/TLS host are live. No existing tenant host, database, bucket or Caddy configuration was reused. Six new services are healthy; this is a single-host review deployment, not proven HA or thousand-shop capacity.
- New host service data, Docker/containerd, Caddy and logs were moved to an encrypted40GiB volume. Boot dependencies and health were checked. Removed plaintext directory copies were exact retired copies, not old tenant data; historical root-disk credential residue is not proven securely erased.
- Real R2 PUT/HEAD/range/CORS/header-authority/missing-object/multipart-abort checks passed, with the exact disposable object deleted and verified absent. Hosted three-shop isolation passed24 assertions and removed all exact fixtures. Neither proof creates paid orders or fee records.
- Six real demo products, supporting pages and original FAL illustrations are prepared. The native draft theme uses the actual installed app block UUID for all nine remaining extension surfaces; it is not yet the published theme. No real print/fulfillment claims or fabricated reviews are used.
- Real embedded testing exposed Admin API403 failures in setup/product loading and a products/update tenant-context error. These are being fixed before commerce proof, not waved away by successful synthetic isolation tests.
- Owner supplied the operator name Actual Scope only. No company suffix, legal person or physical address is invented. Terms/DPA receipt activation, provider contracting evidence, real billing/order/privacy flows and App Store submission remain release work, not completed claims.
