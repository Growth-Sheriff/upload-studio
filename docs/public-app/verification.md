# Public app verification — evidence, not publication

Work performed 9–10 October 2026 (Europe/Istanbul), exclusively in the managed public worktree. Main baseline: `76113c193d7da789df9b2d3ea1ad7947af48b334`. The original custom checkout is unchanged and clean. No public app has been registered, hosted or submitted in this run.

## The eleven release gates

| Required gate | Executed evidence | Release status |
| --- | --- | --- |
| 1. Independent branch | public-app starts at origin/main; protected remote refs unchanged; public boundary CI/PR warnings | Proven locally; never merge back |
| 2. Existing infrastructure untouched | Both hosts inspected read-only twice; all 14 web + 14 worker StartedAt values unchanged, restart0/OOMfalse | Proven for this run; no deployment occurred |
| 3. One app, three stores | Real PostgreSQL three-shop read/write/connect isolation, durable sessions; real distributed Redis leases | Local proof only; three Shopify installations missing |
| 4. Three privacy topics | Actual raw-body HMAC Requests, invalid401, durable dedupe, exports and real temp-file/archive deletion, real SQL leases/cascades/races | Local proof; real R2/account delivery still missing |
| 5. Tracking removed | Source/compiled JS scans, removal guards, Visitor/VisitorSession absent, DROP migration | Local proof; live storefront Network capture missing |
| 6. Shopify usage fees exactly once | SQL concurrent claims, frozen shop/order key and line/amount, unpaid/cancelled exclusion, lost-response retry, 3.5%/USD6 unit assertions | Simulated provider transport; real consent/order/usage missing |
| 7. Cap behavior | Confirmed rejection/exhaustion tests and merchant-confirmed pending cap state | Real provider cap test missing |
| 8. Full tests | Final commands/results recorded below | Local suite only; no invented live proof |
| 9. Typecheck | Complete public tsconfig no-emit run | Final command below |
| 10. Extensions | Pinned CLI3.88.1, theme check[], both extension bundles built | Not deployed/rendered on new app |
| 11. Performance/accessibility | Removed runtime CSS compiler/blocking includes; real raw/gzip sizes | Lighthouse/keyboard/visual/28-day field evidence missing |

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

Source freeze: `726c53b2a48b61ec0c135f777dda1e2a64152d19`. Later changes are documentation and draft release assets, not application logic.

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

After the final checks, the local native HTTP process was stopped. Exact inspected containers `agsu-public-smoke`, `agsu-public-test-db` and `agsu-public-test-redis` were stopped and removed; all commands succeeded. Disposable SQL/Redis test state is gone. The local `agsu-public-review:final` image remains available for reproduction. No remote container, database row, queue, billing record or storage object was changed by these cleanup steps. The unrelated pre-existing temp_page.html worktree change is preserved and is not part of any public commit.

## Performance and remaining evidence

`theme-performance.md` records executed source/gzip sizes (Mod2 JS212,587/40,689 bytes; main uploader161,849/38,168; native scoped CSS23,843/3,885). These are transfer estimates, not browser timings. Linux process-group cancellation test: a200ms deadline returned in210ms and left no running child. Neither proves peak memory under a475MP decode, fair-load latency or live Web Vitals.

Finish the blocked gates with fresh Actualscope identity/credentials and three demo stores, following listing.md, deployment.md and open-questions.md. Never substitute a custom tenant app or claim publication from local builds.
