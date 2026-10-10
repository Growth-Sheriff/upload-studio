# Public app verification — evidence, not publication

Work performed 9–10 October 2026 (Europe/Istanbul), exclusively in the managed public worktree. Main baseline: `76113c193d7da789df9b2d3ea1ad7947af48b334`. The original custom checkout is unchanged and clean. A new public review app is now registered, hosted and installed in three development shops; no App Store submission or approval is claimed. Historical sections below retain their own executed revisions and limitations.

## Current real customer-flow evidence — 10 October 2026

The native variant path has now reached a genuine Shopify **test** order in `auto-gang-sheet-demo.myshopify.com`,using Shopify's test gateway; no actual money was collected and no physical fulfillment is claimed.

| Step | Actually observed | Evidence |
| --- | --- | --- |
| Variant upload | Upload `9FGuJnpLcKnq` became Ready in3.2seconds; the stored-header/server-verified size was22.30×78in at100DPI | [Ready upload, five copies](evidence/variant-real-upload-ready-five-copies.jpg) |
| Sheet and price | Selected variant `68056763105501`,22×80in,USD40 per complete copy; quantity5 produced USD200 | [Ready upload and price](evidence/variant-real-upload-ready-five-copies.jpg) |
| Cart to checkout | Exactly `Print Ready`, `Sheet Identity` and `DPI`=100 accompanied the line; no fourth property or extra production instruction | [Real five-copy cart](evidence/variant-real-cart-five-copies.jpg) |
| Shopify test payment | Order `#1001`,ID `18946622095581`,PAID,test=true; capture SUCCESS for USD200 at2026-10-10T01:58:58Z | [Confirmed test order](evidence/variant-test-order-confirmed.jpg) |
| Measured-length path | The same22.30×78in fixture,upload `hhVLFBMcIjVW`,received an authoritative USD23.40 quote:78 billable inches×USD0.30. Draft checkout opened but has **not** been paid | [Measured quote](evidence/measured-real-upload-quote-23-40.jpg) |

This proves the native upload/measurement/variant/cart/test-payment path,not usage billing. Actual container diagnostics found `TenantIsolationError` blocking order-webhook reconciliation. Narrow correction `b1c7d6d` is committed but CI is pending and it is **not yet released**; neither successful webhook reconciliation nor a Shopify usage record,replay/exactly-once result or cap behavior is claimed. Software diagnosis uses CLI/container evidence; Chrome is reserved for native customer flow and submission,not software debugging.

The redundant blue CUSTOM ready-file card was removed **visually only in the demo theme** by `02f5c4d`; the three original properties,links,DPI,prices and processing/error/missing-file warnings remain. Pinned CLI pushed only unpublished draft `189187817693`. A read-only pull matched local/remote CSS SHA256 `F53910E7DD2F0FA34CE2DEC834E294D68D71CD33A85BA0DF72508ADED9173AC2`; two focused tests passed and theme check returned[]. This does not remove the embed's DOM/status fetch,change extension/runtime source or alter live Horizon `189187457245`.

Measured checkout payment,post-fix order processing/usage/replay,provider cap proof,remaining block/customer flows,portable official preview,mobile Lighthouse comparison,live no-tracking Network capture,review media and App Store submission remain open. Historical observations below are not relabeled as later success.

## Current merchant agreement and test billing — 10 October 2026

The owner-approved, ordinary Shopify administrator UI flow has now accepted Actual Scope Terms/DPA version `2026-10-10.1:c769892b1216b191ec6f93d2` in all three new development shops. These are separate merchant agreements, not inferred OAuth or billing consent; no receipt was backfilled.

| New development shop | Actual accepted-terms screen | Shopify test subscription |
| --- | --- | --- |
| `auto-gang-sheet-demo.myshopify.com` | [Demo acceptance](evidence/demo-processing-terms-accepted.jpg) | ACTIVE, test=true, USD50 cap, used USD0 |
| `auto-gang-sheet-isolation-two.myshopify.com` | [Isolation two acceptance](evidence/isolation-two-processing-terms-accepted.jpg) | ACTIVE, test=true, USD50 cap, used USD0 |
| `auto-gang-sheet-isolation-three.myshopify.com` | [Isolation three acceptance](evidence/isolation-three-processing-terms-accepted.jpg) | ACTIVE, test=true, USD50 cap, used USD0 |

Each test subscription was separately approved by the owner. The [guarded read-only provider/database evidence](evidence/test-subscriptions-20261010.txt), observed at2026-10-10T01:53:53.316Z, confirms all three ACTIVE test subscriptions, exact matching local references and actual APP_SUBSCRIPTIONS_UPDATE audit receipts. It also records the three UI acceptance timestamps. Isolation three's shop currency is CAD, while its usage subscription is USD; no order FX calculation is proven. An ACTIVE test subscription with zero usage proves neither a paid order nor a usage charge, duplicate-delivery handling, cap exhaustion/increase or paid merchant invoicing.

The initial10October supported file-chooser attempt failed while Chrome's ChatGPT extension lacked **Allow access to file URLs**. That permission blocker was resolved after the owner changed the extension setting and Chrome reconnected; supported file selection started the ready-DTF PNG upload. No unsupported browser bypass was used. Subsequent authoritative readiness,cart and native test payment are now recorded separately above; measured checkout payment and order-webhook/usage/replay/cap proof remain unfinished. Historical unchecked screens and dated pending statements below retain their original meaning; the current sections supersede their current-status interpretation. No publication,approval or perfect-readiness claim is made.

## Historical public-only release — 9 October,23:13UTC

The support-only follow-up source`9c4b466fc92ec7d155f48e7873c8ff606a78c81d` passed clean Depot CI`qwqvfs6w8j`:66files,425tests,zero skips,all8migrations and the same full chained gates. Provider terminal`finished`,62seconds. Sequential production build`7p77lwvp97` finished successfully,70seconds; OCI revision was independently verified. Only NEW607746803 was deployed to immutable index`sha256:37f10d8b6dbc87385ce9de0270b14231fbfd6023b8b6235cd940d33526e1c6fd`. All six new services started23:13:23UTC,running,OOMfalse/restart0;8migrations had none pending;external HTTPS health returnedhealthy. Exact old28containers+oldCaddy strings still match before/after. See evidence/public-release-9c4b466.txt.

Actual second-shop Support UI now shows Contact Actual Scope/mailto:info@actualscope.com and honestly states email notifications are unavailable; it no longer asks merchants to configure our server API key. No ticket/email/provider mutation was performed. Screenshot:evidence/public-support-live.jpg. Initial navigation from the older loaded embedded page returnedDashboard;direct Shopify wrapper navigation and subsequent ordinary Dashboard→Support menu navigation worked. Idle-session/re-auth return-path behavior remains a bounded follow-up,not a proven root cause or universal navigation failure.

Shopify extension version1161844129793 remains Active and current:the follow-up changes only the server/admin support route,test and documentation,not extension assets,pricing,measurement,fees or agreement version. Real contract acceptance,commerce/cap,performance/media and App Store submission remain unfinished. The pending unchecked merchant agreement screen is preserved in evidence/demo-terms-awaiting-owner.jpg. The unused local scratch demo-password copy was deleted;the shop password was not changed.

## Historical public-only release — 9 October,23:07UTC

- Frozen application source`21ccab9012e78d21989bc9321e7b0af28eb7d7d5` passed clean Depot CI`n8mzfd0mdp`:65 files,424 tests,zero skips,full typecheck,strict measurement regression,Remix build,theme check[] and both extension builds. Provider terminal status was`finished`,76seconds. Sequential production build`bht6fgfpzr` also finished successfully,67seconds. See ci.md for reproducible commands and source-label verification.
- Only NEW droplet607746803 was deployed to immutable index`sha256:ca685ad2549e7c1d44651a7f4eb054d551d360dbc83817e6a1d7cd07f944c483`. All eight migrations were present;20261010230000_public_manual_receipt_unique applied before startup. All six public services started23:07:24UTC,running,OOMfalse/restart0. External HTTPS health returned`{"status":"healthy"}`.
- Both old hosts were sampled before and after. Every exact StartedAt/OOM/restart string for14web+14worker and oldCaddy matched byte-for-byte. Full command/output proof: evidence/public-release-21ccab9.txt. No protected branch or old deployment was changed.
- Pinned CLI3.88.1 released`agsu-review-21ccab9`,version1161844129793,with explicit`--config auto-gang-sheet-upload`. The actual Dev Dashboard confirms Active,correct app433768202241,API2026-10,11 ordinary webhook topics,all three privacy topics,and both extension identities. Evidence:evidence/shopify-release-21ccab9.jpg. The exact-rate display and scoped advanced-widget revert are now deployed. This is an app-version/extension release,not an App Store submission.
- The new manual relief recorder is installed but has not issued a financial credit/refund or invented a hosted receipt. Its real disposable-database replay/cross-shop tests passed in CI. Actual owner/provider relief rehearsal remains unexecuted.
- The remaining real commerce,contract,provider-data,media/performance and App Store gates below remain open. Clean CI/startup do not prove them.

## Historical real setup evidence — after 9 October, 22:51 UTC

- Only the NEW public deployment607746803 was refreshed to source78e82f9, digest`sha256:ce5458aadec86a236ed3bc1ce28bb6ed8705361c5f12adf937efbc8274e20a89`. All six new services started22:51:32UTC, OOMfalse/restart0; external `/health` returnedhealthy. Seven migrations were present with none pending.
- Both old hosts were sampled before/after this deploy using the exact28 existing tenant container names plus old Caddy. Every StartedAt/OOM/restart string matched byte-for-byte. No old service was restarted or deployed.
- All three genuine Shopify installations now render the embedded app. The demo loads six real products, not a synthetic catalog. This resolves the historical permanent-token403 below; it does not establish real three-store commerce or an expired background refresh.
- A NEW607 read-only Prisma transaction at22:57:59.814UTC confirmed exactly three genuine offline sessions, correct active-shop ownership, and access/refresh credentials present without printing them. Access expiries were23:43:07.382/23:44:51.106/23:44:52.882UTC; refresh expiries were7January2027. All were unexpired. No expiry was altered and no refresh/API write was induced.
- All six demo products were saved through actual Polaris controls, never direct database writes: Ready DTF, Pick Your Size, DTF+UV Desk and UV use variant mode; Studio and PNG Detail use measured_length at0.30. Each uses22.5 printable width,240 custom-length ceiling and0.02 tolerance. `demo-setup-decimal-rate-saved.jpg` and `demo-mod2-configured.jpg` show successful saves after the original fractional-input rejection.
- Shopify's actual Pricing screen explicitly showed **Manual pricing (legacy)**. The previous inference from a default private plan was not authoritative. Evidence:`pricing-manual-confirmed.jpg`. One manual listing plan`finished-sheet-usage`, Free with additional charges, English name`Per paid order`, was saved with the explicit3.5%/USD6/tax-shipping exclusion/merchant usage-limit description. This is listing metadata, not a paid merchant subscription. Saved review instructions reduced missing listing fields to icon, feature media, screenshots and screencast URL; see`listing-usage-pricing-saved.jpg`.
- Extensions version`agsu-review-6544477`/1161829351425 was successfully released using pinned CLI3.88.1 and explicit public config. Later source corrections910da79/f519d22 still require the final tested image/extension release; older results are not relabeled.
- Candidate CI v7t238tr7x ran415tests without skips and all verification commands exited0, but Depot canceled the build after a builder-release error. This is not a terminal green CI claim. A clean final run is required; see ci.md.

## Historical hosted execution — 9 October, 22:25 UTC

Current hosted evidence does not silently relabel older local results:

| Check | Actually observed |
| --- | --- |
| Public identity/extensions | Actual Scope app433768202241; released version1161809625089; API2026-10; all three new development shops installed |
| Independent public HTTPS | Trusted TLS and /health HTTP200 after issuance22:09:05 UTC; no certificate-warning bypass |
| Hosted isolation | New droplet607746803, deployed digest9c039fc1…;24 assertions/three simultaneous synthetic shops passed; exact3 fixture shops and uploads removed; no order/commission rows. See hosted-isolation.md |
| New private R2 | Bucket-only runtime credential; private r2.dev disabled; tests below; exact test object deleted and HEAD404 verified |
| Demo | Six published test products/media, three supporting pages and nine actual app block bindings in unpublished theme189187817693; no physical fulfillment claim |
| Real merchant onboarding at22:25 | Historical failure: setup/product403 on all3shops and missing products/update binding. Resolved by later deployment; see latest evidence above |
| Commerce/review | Real test billing/order/usage/cap, Lighthouse and App Store submission are still outstanding |
| Hosted privacy, subsequent22:29 UTC proof | All three actual signed HTTP topics/replays, worker export/redaction and real R2 erasure passed on three exact synthetic fixtures, cleaned afterward. See hosted-compliance.md; simulated62-minute fixture clock is not elapsed SLA proof |

### Real new-bucket header validation

Executed deploy/public/prove-storage.mjs at22:14:43.617–22:14:45.091 UTC against only auto-gang-sheet-public. The helper refuses a different app client ID, account or bucket and a public R2 URL; it creates no database/queue/order/billing row.

```text
signed PUT HTTP200, CORS *, ETag present,70816 bytes,331ms
HEAD ContentLength70816
Range HTTP206,65536 bytes, Content-Range bytes0-65535/70816
actual validateStoredRasterHeader:300x600,133ms
tampered browser1x2/DPI9999 overridden by stored header
unsigned access HTTP400, codeInvalidArgument (R2 rejects unsupported anonymous S3 credentials)
multipart created then aborted; exact remaining multipart count0
missing object projected blocked; canAddToCartfalse
finally: exact synthetic object deleted; HEAD404 verified
```

The first attempt expected only401/403 for anonymous S3 access, so it failed on R2's400InvalidArgument; its finally cleanup also verified object absence. The revised assertion accepts that error shape, not successful anonymous access. This proof is header/storage validation, not a real storefront order or a performance benchmark for large images.

Desktop visual evidence: evidence/demo-home-original-theme.jpg is an actual screenshot of the password-protected draft demo storefront, not a mockup or claimed App Store approval.

## The eleven release gates

| Required gate | Executed evidence | Release status |
| --- | --- | --- |
| 1. Independent branch | public-app starts at origin/main; protected remote refs unchanged; public boundary CI/PR warnings | Proven locally; never merge back |
| 2. Existing infrastructure untouched | Both hosts inspected read-only before/after independent public deployments; all14web+14worker and oldCaddy StartedAt values unchanged, restart0/OOMfalse | Old infrastructure untouched; ONLY new public services deployed |
| 3. One app, three stores | Three new Shopify installations; real hosted three-shop synthetic isolation and distributed Redis leases | Hosted isolation proven; real three-shop commerce still missing |
| 4. Three privacy topics | Actual hosted raw-body HMAC HTTP requests, invalid401, replay, worker exports/redaction and real private R2 erasure with exact cleanup | Synthetic hosted proof passed; Shopify-origin delivery and elapsed SLA not claimed |
| 5. Tracking removed | Source/compiled JS scans, removal guards, Visitor/VisitorSession absent, DROP migration | Local proof; live storefront Network capture missing |
| 6. Shopify usage fees exactly once | SQL concurrent claims,frozen shop/order key and line/amount,unpaid/cancelled exclusion,lost-response retry,3.5%/USD6 unit assertions; three real ACTIVE test subscriptions and native PAID test order#1001 | Native test order proven; actual order webhook hit TenantIsolationError. Fixb1c7d6d awaits CI/release; usage/replay still unproven |
| 7. Cap behavior | Confirmed rejection/exhaustion tests and merchant-confirmed pending cap state | Real provider cap test missing |
| 8. Full tests | Final commands/results recorded below | Local suite only; no invented live proof |
| 9. Typecheck | Complete public tsconfig no-emit run | Final command below |
| 10. Extensions | Pinned CLI3.88.1, theme check[], both extension bundles released; nine real theme-block bindings in new draft | Theme surfaces bound/rendered; actual checkout extension checkout proof still missing |
| 11. Performance/accessibility | Removed runtime CSS compiler/blocking includes; real raw/gzip sizes; paired three-page app-free draft baseline | Mobile Lighthouse before/after and keyboard evidence incomplete;28-day field data is optional Built for Shopify, not ordinary App Store prerequisite |

### Honest price and performance presentation

Mod2 no longer server-renders its product unit rate as an unexplained whole-sheet price. Before authoritative readiness it labels the amount per billable inch; only a ready quote is a total, and failed pricing context is visibly unavailable. Generic product-rate guests are not described as VIP/Business accounts. Unsupported hardcoded “Works with Any Design” and “In Stock” claims were removed. The measured-pro block already distinguishes per-inch rate, pending quote and exact total; it required no display change. Price calculation, cart authority gates, measurements and fees are untouched.

Scoped checks after this display-only correction: publicStorefrontProxy/theme-bindings/performance-baseline —3 files,6 tests passed; node --check custom-price-upload-mod2.js exit0; pinned Shopify theme check extensions/theme-extension returned[]; scoped git diff --check passed. The new assertion executes the actual headline functions for pending unit rate, stale quote, ready total and unavailable pricing. These are source checks, not a live order or storefront performance result.

The ordinary [App Store storefront test](https://shopify.dev/docs/apps/build/performance/storefront) is the mobile before/after Lighthouse score impact, home17%/product40%/collection43%, no more than10 points degradation. A clean supported theme with typical app features is the review benchmark; the existing identical-content demo baseline is an additional reproducible comparison, not a claimed pass. The28-day Web Vitals targets belong to [Built for Shopify](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements), so they do not impose a28-day wait for ordinary listing submission.

## Branch and live boundary

Commands from the public worktree:

```powershell
git log origin/main..HEAD --oneline
git ls-remote origin refs/heads/main refs/heads/custom-container-upload-studio-app refs/heads/public-app
git diff --name-only origin/main..HEAD -- 'shopify.app.*.toml' scripts/generate-tenant-envs.sh deploy/deploy.sh
git -C C:/Users/mhmmd/Desktop/Projeler/customizer-app-new status --short
```

Before the public push, remote output was:

```text
d8470f5bca9ab182ca1b9d6b635d89ee7c7a5075 refs/heads/custom-container-upload-studio-app
76113c193d7da789df9b2d3ea1ad7947af48b334 refs/heads/main
```

Only `shopify.app.auto-gang-sheet-upload.toml` appears in the targeted config/script diff. Original checkout status output is empty. No forbidden script, implicit app deploy, global Shopify app command or remove-orphans operation was used. The live deployment workflow is removed **on this branch only**; this does not change either protected branch.

Read-only inspection on upload-studio and upload-studio-worker:

```powershell
ssh -o ConnectTimeout=10 upload-studio 'docker ps --format "{{.Names}}" | xargs docker inspect --format "{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.OOMKilled}}"'
ssh -o ConnectTimeout=10 upload-studio-worker 'docker ps --format "{{.Names}}" | xargs docker inspect --format "{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.OOMKilled}}"'
```

Both samples matched the initial state exactly. Final sample taken at approximately 2026-10-09 21:03 UTC (10 October00:03 Istanbul):

| Tenant | Web StartedAt, 2026-10-05 UTC | Worker StartedAt, 2026-10-05 UTC |
| --- | --- | --- |
| legendtransfers | 18:08:50.364678569 | 18:11:35.268554271 |
| fastdtftransfer | 18:08:50.364689355 | 18:11:35.594231948 |
| chillitransfers | 18:08:50.368565192 | 18:11:35.118934298 |
| localdtf | 18:08:50.356370645 | 18:11:36.179808695 |
| gangsheet | 18:08:50.373353622 | 18:11:34.973834624 |
| eagledtfprint | 18:08:50.371438079 | 18:11:36.558363621 |
| dtftransferohio | 18:08:50.366169509 | 18:11:38.483911629 |
| dtfprintarizona | 18:08:50.377417742 | 18:11:37.709103827 |
| alphaprint | 18:08:50.365715375 | 18:11:38.056030335 |
| dtfprinthouse | 18:08:50.371457604 | 18:11:35.431811072 |
| everydaycustomprint | 18:08:50.358853206 | 18:11:36.889521757 |
| dtfnash | 18:08:50.351965835 | 18:11:37.249226776 |
| dtfprintdepot | 18:08:50.364672600 | 18:11:35.755179724 |
| customprintaz | 18:08:50.364826591 | 18:11:35.955514273 |

Every row has RestartCount0 and OOMKilledfalse. Caddy remains started2026-09-04T05:49:29.638786799Z, bridge2026-09-18T21:53:51.404279883Z and Redis2026-08-26T22:55:45.087366279Z. This proves no restart/change observed here, not a before/after public deployment: there was none.

## Local test method

Only new disposable local containers `agsu-public-test-db` (PostgreSQL16, loopback55439/public_app_test) and `agsu-public-test-redis` (Redis7, loopback56389/DB0) were created. Native public migrations target only that database. Integration fixtures require explicit test URLs, create UUID shops and remove their own fixtures. They never fall back to a live DATABASE_URL.

```powershell
$env:DATABASE_URL='postgresql://public_app:local-test-only@127.0.0.1:55439/public_app_test?schema=public'
$env:PUBLIC_APP_TEST_DATABASE_URL=$env:DATABASE_URL
$env:PUBLIC_TENANCY_TEST_DATABASE_URL=$env:DATABASE_URL
$env:PUBLIC_TENANCY_TEST_REDIS_URL='redis://127.0.0.1:56389/0'
$env:REDIS_URL=$env:PUBLIC_TENANCY_TEST_REDIS_URL
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm exec vitest run
pnpm exec tsc --pretty false
pnpm run measurement:regression -- --json
pnpm run build
pnpm exec shopify theme check --path extensions/theme-extension --output json
pnpm exec shopify app build --config auto-gang-sheet-upload
```

Intermediate full run (23:55:43 Istanbul):50 files passed,1 skipped;368 tests passed,5 ImageMagick-dependent tests skipped on Windows. The Linux production image subsequently ran all five:5 passed in2.57s. Their old header-only PNG fixtures initially failed real ImageMagick as they should; fixtures now contain valid CRCs/IDAT, without weakening production's corrupt-image rejection. Auth/session tests additionally reproduce both erasure races using held SQL row locks, not sleep-based timing.

The production Docker image was built locally with Node22, ImageMagick6, Ghostscript and poppler. An initial build exposed missing OpenSSL detection; explicit OpenSSL installation before Prisma generation fixed the Linux engine choice. No image was sent to an existing host. Image tests ran in a disposable container; root test user is for Vitest's temporary config compilation, not the nonroot deployment user.

## Final executed results

Implementation source freeze: `726c53b2a48b61ec0c135f777dda1e2a64152d19`. The table below records that executed revision. A subsequent public-only compatible security dependency update and due-date correction to concurrent test fixtures are recorded separately below; these results are not silently relabelled as their proof.

| Check | Actual final output |
| --- | --- |
| Windows whole suite, 10 October 00:15 Istanbul | 55 files passed, 1 skipped; 386 tests passed, 5 skipped; exit0 |
| Linux whole suite, 9 October 21:16:50 UTC | 56 files passed; **391 tests passed, zero skipped**; duration8.80s; exit0 |
| Whole TypeScript check after source freeze | `pnpm exec tsc --pretty false`, no diagnostics, exit0 |
| Measurement harness after source freeze | comparisonIntegrity=pass; knownRegressionCount=0; unclassifiedPriceDifferenceCount=0; releaseGate=clear; exit0 |
| Latest production Docker build | `docker build -f deploy/public/Dockerfile -t agsu-public-review:final .`; exit0; manifest-list digest `sha256:0ceb701d3bfd5e1462fb8c5d4f5dff181481ac7426b75a4ea25212b02b8204db` |
| Production bundle inside that build | 1,600 client modules, 160 server modules; server bundle874.64kB; exit0 |
| Pinned CLI static/bundle checks | theme check `[]`; app build with explicit public config successful; not deployed |

The Linux test container used the production image's real ImageMagick6/Ghostscript/poppler and Linux Prisma engine. Latest source/tests plus theme-snippets were mounted read-only. Explicit disposable test URLs targeted the two local test containers; temporary loopback TCP bridges forwarded the tests' required localhost ports to host.docker.internal. Vitest's config compilation used a throwaway root test process, whereas the production HTTP smoke used the image's `node` user. All temporary test containers used `--rm`. SQL write-conflict/not-found logs in the isolation/race cases are expected asserted rejections, not ignored failing tests.

The harness is not a claim of zero differences from historical custom behavior: approved finished-sheet, no-nesting and physical-limit corrections remain individually labelled. Its baseline is a checked-in fixture, not a fresh production-price scrape. The inherited alpha-short fixture was explicitly reconciled with the current 22x12/$6 variant evidence; this is recorded rather than hiding a mismatch.

### Real local HTTP boundary

The native production server was exercised with unique disposable shop-domain/event IDs and local-only fake secrets. Raw signed requests crossed HTTP, not just a direct function call:

| Request | Observed result |
| --- | --- |
| Invalid privacy HMAC | HTTP401 |
| customers/data_request, original + same Event-ID replay | HTTP200, approximately24/23ms |
| customers/redact, original + replay | HTTP200, approximately18/12ms |
| shop/redact, original + replay | HTTP200, approximately16/12ms |
| Six valid deliveries across the three topics | Exactly three durable inbox rows, not six |
| Oversized declared body and streamed body | HTTP413 for each |

Those three unique HTTP-only fixtures were inspected and removed from the disposable database. Separate integration tests execute the inbox exports/deletions/leases; a 200 acknowledgment alone is not erasure proof. HMACs here use our local fake secret, not an authenticated Shopify delivery.

Final image runtime command used `--read-only --tmpfs /tmp:size=128m --memory 1g --pids-limit 128 --cap-drop ALL`, loopback port55441 and only local test database/Redis URLs. Docker inspection returned `node|readonly=true|running=true|oom=false|memory=1073741824`. `/health` returned200/20bytes; `/legal/privacy` returned200/8,592bytes. An idle sample was74.95MiB/1GiB and27PIDs. This demonstrates startup and these endpoints, not load capacity or worker peak RSS.

### Tracking scan exceptions

Executed `rg -n -i 'visitor|fingerprint|utm_|gclid|telemetry|analytics' app extensions prisma --stats`: 146 matches on115 lines in15 files (304 searched). No Visitor/VisitorSession model remains. All matches are explained:

- File-content hash/resume identifiers: uploadFingerprint, upload intent/multipart-resume, ul-file-probe, the two uploader assets and upload_items SQL/schema/indexes. They do not identify a person/browser.
- `orderReconciler.factFingerprint`: financial-fact replay/audit identity, not a visitor identifier.
- Removal tests explicitly name forbidden APIs/files so they cannot return unnoticed.
- Legal copy discloses the removal; one proxy-config comment contrasts shop currency with a Markets visitor's currency.
- The tracking-removal migration names the retired columns/tables to DROP them; it does not create profiling tables.

Full matching paths and earlier compiled-asset scan are in tracking-removal.md. No live storefront Network proof is claimed.

### Local cleanup

After the implementation checks, the local native HTTP process was stopped. Exact inspected containers `agsu-public-smoke`, `agsu-public-test-db` and `agsu-public-test-redis` were stopped and removed; all commands succeeded. The same local-only SQL/Redis fixture containers were recreated for the compatible dependency checks, not reused from any live deployment. No remote container, database row, queue, billing record or storage object was changed by these cleanup steps. The unrelated pre-existing temp_page.html worktree change is preserved and is not part of any public commit.

## Public push and CI boundary

`git push -u origin public-app` created only the new public branch. Immediately afterwards, read-only remote inspection showed public-app=`4f5d7359e9354e63dfa4c703f2c55b7b4d034395`, main=`76113c193d7da789df9b2d3ea1ad7947af48b334` and custom-container-upload-studio-app=`d8470f5bca9ab182ca1b9d6b635d89ee7c7a5075`. No PR into a protected branch was opened. Both live hosts were inspected again; all listed StartedAt/restart/OOM values still matched the initial sample. Original checkout remained clean.

[Public checks run37992897397](https://github.com/Growth-Sheriff/upload-studio/actions/runs/37992897397) did not start any steps. The check annotation from `gh api repos/Growth-Sheriff/upload-studio/check-runs/114031374441/annotations` says: "The job was not started because your account is locked due to a billing issue." No organization billing setting was changed; this is not a code-test failure or a green CI claim.

## Compatible security update — subsequent executed revision

Dependency changes are commit `e67b7e0`; auth-fixture due dates are commit `358e47c`. No application fee, measurement or tenant data is repriced. See dependency-security.md for exact versions and remaining risks.

Post-update Windows full run at00:27:45 Istanbul:55files passed/1skipped,386tests passed/5skipped, duration5.67s, exit0. Whole tsc again returned no diagnostics/exit0. Harness again returned integrity=pass, regressions=0, unclassified differences=0, releaseGate=clear. Pinned theme check again returned[] and both extensions built with explicit public config.

Intermediate retries are not hidden: one parallel auth receipt assertion found the privacy suite legitimately claiming its due receipt. Those auth-only fixtures now use future `dueAt` values; held-SQL-lock race assertions are unchanged. An initial fixture edit mistakenly named `availableAt`; Prisma rejected it and it was corrected to the actual schema field before either commit. Overlapping test runs during a Docker layer copy also produced local database timeouts/unreachability; the local database remained running/OOMfalse. The successful final run above had no overlapping full-suite process. No test timeout or production error check was weakened to get green.

Final application/dependency revision: `358e47c095a779cae7ed7992923c6b891f3bdedb`.

```text
docker build -f deploy/public/Dockerfile -t agsu-public-review:release .
exit0
manifest-list sha256:702d70a6376f61b97cdeab9e9331a286377d01a4646598ed12a3a64a6e235f51
client1601 modules; server160 modules /874.64kB

node /app/node_modules/vitest/vitest.mjs run
Start at21:30:38 UTC, 9 October2026
Test Files 56 passed (56)
Tests 391 passed (391)
Duration4.71s
exit0
```

This final Linux run used **the latest release image's baked source and dependency lock**, not the pre-security image. Extension/theme-snippet/test-config inputs were mounted read-only; local PostgreSQL/Redis were reached through the same two temporary loopback bridges described above. Every integration opt-in URL was set explicitly. All five ImageMagick tests and the SQL/Redis/HMAC suites actually ran. No Windows skip is counted as Linux success.

The release image was then run as `node` with read-only root filesystem, dropped capabilities, loopback-only port55441 and fake local secrets. Inspection: runningtrue/OOMfalse; health200/20bytes and public privacy200/8,592bytes. This is a startup smoke, not an installed Shopify app test.

Final cleanup inspected and removed the three exact local agsu-public containers again. This pass used `docker rm -v` and removed the inspected test PostgreSQL/Redis anonymous volumes too. Earlier first-cycle container removal did not include `-v`; no blanket volume prune was attempted, and this report does not claim that unverified older anonymous Docker volumes were erased. Local review images remain reproducible. No live resource was stopped, removed or modified.

## Performance and remaining evidence

`theme-performance.md` records executed source/gzip sizes (Mod2 JS212,587/40,689 bytes; main uploader161,849/38,168; native scoped CSS23,843/3,885). These are transfer estimates, not browser timings. Linux process-group cancellation test: a200ms deadline returned in210ms and left no running child. Neither proves peak memory under a475MP decode, fair-load latency or live Web Vitals.

Finish the blocked gates with fresh Actualscope identity/credentials and three demo stores, following listing.md, deployment.md and open-questions.md. Never substitute a custom tenant app or claim publication from local builds.
