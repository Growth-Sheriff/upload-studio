# Independent public checks on Depot

## Identity and separation

On 10 October 2026, Depot CLI 2.102.1 reported the accessible organization as
`Growth Sheriff` (`zl650q33c5`). Its ID matches the authorized local credential
inventory. GitHub CLI reported `jesuisfatih`, with administrative access to
`Growth-Sheriff/upload-studio`. These are verified service identities; the CLI
does not establish an Actualscope email address.

A **new** Depot project, `auto-gang-sheet-public` (`7fxkc8sd3p`), was created in
`us-east-1`. Existing projects, including `upload-studio` and `gss-engine`, were
not updated. No organization plan, payment setting, or persistent credential was
created or changed. Every public build explicitly supplies this new project ID;
the existing repository's implicit Depot project must never be used.

The create response applied seven-day cache retention and normalized the
requested 1 GB cache to 25 GB (`26843545600` bytes). A separate project-detail
request returned `Invalid token`, so no successful follow-up metadata lookup is
claimed. Project creation, build execution and the build list did succeed.

## Working verification path

GitHub Actions could not start because of its account billing lock. Instead,
`deploy/public/Dockerfile.ci` executes the checks on an isolated Depot container
builder. This path has no GitHub Actions runner dependency and does not deploy
anything.

The Dockerfile-specific context allowlist includes source, test fixtures, the
public Shopify configuration and the shared verification script. It excludes
local Git metadata, tenant configurations, credentials, env files, uploaded
customer objects and scratch files. The measured initial context was 5.39 MB.
Only the public Git repository is fetched inside the disposable builder so that
the measurement harness can read its historical baseline with `git show`.

The verification step creates a fresh PostgreSQL 15 database on loopback port
55439 and Redis 7 on loopback port 56389, using only fake credentials. It applies
all migrations and runs:

1. Prisma client generation and the complete Vitest suite, including explicitly
   enabled three-shop, billing, privacy, session and distributed-lease fixtures.
2. The whole TypeScript check and the existing measurement regression harness.
3. The production Remix build.
4. Theme check and the pinned Shopify CLI 3.88.1 app build, explicitly selecting
   `auto-gang-sheet-upload`.

`deploy/public/verify.sh` refuses any database/Redis URLs other than those exact
disposable fixture targets. An EXIT trap stops both database processes, also on
failure. Test fixtures do not call live Shopify billing, Stripe, or PayPal. The
verification image is not the production Dockerfile and is not published or
deployed.

Reproduce from the dedicated public worktree, with an already authenticated
Depot CLI and a public source revision available in the remote repository:

```powershell
$publicCiSha = git rev-parse HEAD
depot build --project 7fxkc8sd3p --platform linux/amd64 `
  --file deploy/public/Dockerfile.ci `
  --build-arg "PUBLIC_REVIEW_SHA=$publicCiSha" --progress plain .
depot list builds --project 7fxkc8sd3p --output json
```

Pass `--no-cache-filter verify` when an actual fresh execution, rather than a
valid cached result, is required. An unpushed application revision is not
silently substituted: the Dockerfile fails if the supplied Git commit cannot be
found in the public reference clone. Application code itself comes from the
allowlisted local build context.

## Executed evidence

Source reference: `318170d434a26e25bf39000459d36725cbc73ade`, which matched remote
`public-app` when the initial check began. The CI files were local additions.

[Depot build 6zh06bbw29](https://depot.dev/orgs/zl650q33c5/projects/7fxkc8sd3p/builds/6zh06bbw29)
finished with CLI exit 0. The provider's build list reported:

```json
{"id":"6zh06bbw29","status":"finished","startTime":"2026-10-09T21:47:52Z","duration":75}
```

The log shows all six migrations applied, complete verification followed by the
production build, theme check `[]`, both extensions built, and PostgreSQL stopped
at the end. No output registry was specified: the check image remains only in
the new project's build cache, not a running deployment.

A fresh second execution, explicitly disabling the verification-stage cache,
also exited 0:
[Depot build 7flmhts0zc](https://depot.dev/orgs/zl650q33c5/projects/7fxkc8sd3p/builds/7flmhts0zc).
The provider reported start `2026-10-09T21:49:48Z`, duration 61 seconds and status
`finished`. Captured output included:

```text
All migrations have been successfully applied.
Test Files  56 passed (56)
Tests       391 passed (391)
Duration    1.44s
[]
checkout-upload-display successfully built
Auto Gang Sheet Upload built!
server stopped
PUBLIC_CI_EXIT=0
```

There were zero skipped tests. Asserted race/conflict and simulated processing
failure logs are expected test evidence, not ignored failures. TypeScript and
the measurement harness ran before the production build under `set -e`, so
either failing would have stopped the verification step.

## Native Depot CI workflow: prepared, not activated

`.depot/workflows/public-app-checks.yml` uses Depot's own Ubuntu 24.04 sandbox,
PostgreSQL 16 and Redis service containers, with the same verification script.
Its Redis host port is 56389, as required by the fail-closed integration fixture.
It is restricted to `public-app` pushes/PRs and manual dispatch, never `main`.

Actual CLI preflight reported that the Depot Code Access GitHub App is **not
installed** for Growth-Sheriff. In addition, Depot documents automatic workflow
registration from the repository's default branch. This public branch is never
merged into main. Neither the GitHub integration nor the default branch was
changed. Therefore no automatic branch-triggered native CI run is claimed.

Automatic CI needs a separately approved, public-only source repository or
equivalent isolated integration; it must not merge these workflows into the
tenant main branch. The new repository preparation below resolves the default
branch issue, but the working standalone builder remains the verification path
until the Code Access installation and an actual native run are verified.

## Cost boundary and official references

The documented default container builder has 16 CPUs/32 GB and costs $0.04 per
minute beyond included minutes, billed by the second. A 75-second run is about
$0.05 at that overage rate, not an assertion that an invoice was charged. The
existing account's remaining allowance was not verified and no plan was bought.
The advertised Developer plan includes 500 build minutes and 25 GB cache for
$20/month. Native Depot CI's smallest 2 CPU/8 GB sandbox has a separate
$0.0001/second overage rate; that engine has not been activated here.

- [Container builder isolation and pricing](https://depot.dev/docs/container-builds/overview)
- [Native Depot CI overview and pricing](https://depot.dev/docs/ci/overview)
- [GitHub Code Access and workflow registration](https://depot.dev/docs/ci/quickstart)
- [Depot CI service-container compatibility](https://depot.dev/docs/ci/compatibility)
- [Explicit project creation/build CLI reference](https://depot.dev/docs/cli/reference/container-builds)

These checks do not prove a live installation, storefront rendering, payment,
Shopify webhook delivery, Lighthouse score or production workload capacity.

## Public runtime image publication

The independent runtime Dockerfile was built and pushed only to the new GHCR
package `ghcr.io/growth-sheriff/auto-gang-sheet-public:173f9cf`, using the same
explicit Depot project. Existing `upload-studio` images were not referenced or
changed. The later local revision `608f345` differed from `173f9cf` only outside
the runtime image inputs; the application, worker, Prisma, package and Dockerfile
inputs were identical. The Dockerfile-specific allowlist excludes all tenant
TOMLs, envs, credentials, local Git metadata, demo scratch and uploaded objects.
No production credentials were passed as build arguments.

```powershell
depot build --project 7fxkc8sd3p --platform linux/amd64 `
  --file deploy/public/Dockerfile `
  --tag ghcr.io/growth-sheriff/auto-gang-sheet-public:173f9cf `
  --push --progress plain .
docker buildx imagetools inspect ghcr.io/growth-sheriff/auto-gang-sheet-public:173f9cf
```

[Depot runtime build t3zqw05zs2](https://depot.dev/orgs/zl650q33c5/projects/7fxkc8sd3p/builds/t3zqw05zs2)
exited 0. Its provider record reports `finished`, start
`2026-10-09T21:59:39Z`, duration 48 seconds. A separate registry inspection
confirmed the pushed image index:

```text
ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:9c039fc1dc6809006c604ae94b14074c255e0138f890347c813f83c398929d7c
linux/amd64 manifest: sha256:643c9667b00881a4184bb5c0505178737eee8eb9e6e13d9aa57d4befa4992c2e
```

Existing GHCR credentials reported username `jesuisfatih`, matching the active
GitHub CLI account with `write:packages` scope; the push succeeded without
rewriting that credential. Publishing this new image is not a deployment or a
claim that Shopify/R2 runtime integration has passed.

The GitHub package metadata reports `visibility: private`; the independent
public host therefore needs an authorized registry login to pull the digest.
Package visibility was not changed.

## Follow-up source and release check

The owner authorized a dedicated **private** GitHub source repository,
[`Growth-Sheriff/auto-gang-sheet-public`](https://github.com/Growth-Sheriff/auto-gang-sheet-public)
(repository ID `1412498160`). Only `public-app` was pushed there, explicitly by
repository URL, at `2ff3faf9a856bc8d67be620f0591fc215fc2598e`. Its default branch was
then set to `public-app` through GitHub's repository API. The original local
`origin`, original repository default branch, tenant `main` and custom branch
were not changed. This avoids merging public workflows into tenant main merely
to satisfy Depot's default-branch registration requirement.

The documented integration entry point is the new Depot organization's settings
page, **GitHub Code Access → Connect to GitHub**. Installation must select only
this new repository, not all repositories. No installation or automatic native
run is claimed here yet. Never run local `depot ci run` from a dirty shared
worktree: the CLI uploads local changes automatically. Use the clean, dedicated
repository checkout and explicitly select `--repo
Growth-Sheriff/auto-gang-sheet-public --org zl650q33c5` instead.

After `2ff3faf` was available remotely, the fresh no-cache verification ran with
that exact source reference and local source inputs. The independent container
build [9tf7gbmzhp](https://depot.dev/orgs/zl650q33c5/projects/7fxkc8sd3p/builds/9tf7gbmzhp)
exited 0; provider metadata reports start `2026-10-09T22:11:49Z`, duration 79
seconds and status `finished`. Migrations, the full test suite, typecheck,
measurement harness, runtime build, theme check `[]` and both extension builds
completed successfully. Later uncommitted work is not covered by this run.

The separate production build
[jtj8pzf787](https://depot.dev/orgs/zl650q33c5/projects/7fxkc8sd3p/builds/jtj8pzf787)
exited 0 and pushed only
`ghcr.io/growth-sheriff/auto-gang-sheet-public:2ff3faf`. Provider metadata reports
start `2026-10-09T22:12:00Z`, duration 84 seconds, status `finished`. An independent
registry inspection confirmed:

```text
image index: sha256:271d78d3f4a952add56069d43f4ccf95ef644d9e76861f5301ce92dbe0ac7c00
linux/amd64: sha256:8ad088d2a0439f48e731359f8bd4bfc1c55f47064751905b1747f47828e653f1
```

This image includes the final-claim cancellation fee fix `8c7bbd8`. It does not
include changes made after `2ff3faf`; the operator must choose the exact tested
digest, and a later application change needs a fresh image.

## Hosted three-shop fixture boundary

`deploy/public/prove-hosted-isolation.ts` is a separate, explicitly authorized
synthetic proof for the **new** public deployment only. It refuses any other
DigitalOcean droplet, application ID/origin, database name/private hostname,
runtime role or non-strict TLS connection. It first requires a healthy public
TLS endpoint. It creates three inactive synthetic shops with one empty draft
upload each; no real Shopify installation, customer, item, storage object,
order, commission or queue job is created. All fixture identifiers are random
and selected before insertion, so cleanup can cover an ambiguous create result.

The proof exercises simultaneous scoped reads, foreign unique reads, forbidden
foreign writes/relations, contradicting caller scope and actual deployed
signed app-proxy status requests (own/foreign/unsigned/tampered). Finally it
deletes only the three exact, ownership-checked fixture shops and verifies
their absence. Normal per-shop request rate-limit counters expire after 60
seconds; the proof never clears Redis or queue state. It does not satisfy the
separate requirement for three real installed demo stores, nor prove checkout
or Shopify webhook delivery. Its execution status belongs in the main
verification evidence, not an assumed success in this document.
