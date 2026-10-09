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

Future automatic CI needs a separately approved, public-only source repository
or equivalent isolated integration; it must not merge these workflows into the
tenant main branch. Until then the working standalone builder command above is
the verification path.

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
