# Depot Build Pipeline

_Set up 2026-08-28. Build infrastructure only — nothing here deploys unless
explicitly confirmed._

## Doctrine (mirrors the GSB app)

```
GitHub          source of truth
Depot           build machine   (project: upload-studio / tq9pqdq9xh)
GHCR            image registry  (ghcr.io/jesuisfatih/upload-studio)
DigitalOcean    runtime host    (ssh upload-studio -> 64.227.108.45; never builds)
```

Server compose lives at `/opt/apps/public/upload-studio` and references
`image: upload-studio:latest`, so deploys are **pull + retag + compose up** —
no server file edits.

## Local usage

```bash
./deploy/depot.sh build                    # remote Depot build, no push
PUSH=1 ./deploy/depot.sh build             # build + push :<sha12> and :latest
CONFIRM_DEPLOY=yes ./deploy/depot.sh deploy <sha12>   # production (double-gated)
```

- Build context is `git archive HEAD` — only committed content.
- This machine has no docker CLI; the script synthesizes `~/.docker/config.json`
  GHCR auth from `gh auth token` (account `jesuisfatih`, has `write:packages`).

## GitHub Actions (`.github/workflows/deploy.yml`)

- **push to main** → Depot build + push to GHCR. Build only, never deploys.
  (The previous workflow auto-deployed every main push into the retired Vultr
  path — that behavior is intentionally gone.)
- **Manual deploy** → `workflow_dispatch` with input `confirm_deploy=deploy`,
  pulls the image on the DO host and restarts tenants with health checks.

### Required repo secrets (not yet set)

| Secret | Value |
|---|---|
| `DEPOT_TOKEN` | create at depot.dev → org/project settings → API tokens |
| `DO_HOST` | `64.227.108.45` |
| `DO_SSH_KEY` | private key matching `~/.ssh/upload-studio` |

The old `SERVER_HOST` / `SSH_USER` / `SSH_PRIVATE_KEY` secrets are unused by
the new workflow and can be deleted.
