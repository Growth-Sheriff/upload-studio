#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# deploy/depot.sh — Upload Studio build & deploy via Depot
#
# DOCTRINE (mirrors the GSB pipeline):
#   Git checkout   = source of truth (build context = `git archive <REF>`)
#   Depot          = build machine (project tq9pqdq9xh)
#   GHCR           = image registry (ghcr.io/jesuisfatih/upload-studio)
#   DigitalOcean   = runtime host (`ssh upload-studio`, NEVER builds anything)
#
# Usage:
#   ./deploy/depot.sh build                 # remote build only (no push)
#   PUSH=1 ./deploy/depot.sh build          # build + push :SHA and :latest to GHCR
#   CONFIRM_DEPLOY=yes ./deploy/depot.sh deploy <sha>
#                                           # pull :<sha> on both droplets, retag as
#                                           # upload-studio:latest, compose up -d
#   SERVICES="alphaprint" CONFIRM_DEPLOY=yes ./deploy/depot.sh deploy <sha>
#                                           # same, limited to the listed tenants
#
# The deploy stage is double-gated (subcommand + CONFIRM_DEPLOY=yes) so that
# running this script casually can never touch production.
#
# Server layout (verified 2026-09-19):
#   us-app-do    /opt/apps/public/upload-studio      web containers (+ legacy
#                in-container workers for tenants not yet moved), Redis, Caddy
#   us-worker-do /opt/apps/upload-studio-worker      background workers
# Both run `image: upload-studio:latest`. The compose files come from git
# (docker-compose.yml, deploy/worker/docker-compose.yml); tenant env files live
# on us-app-do and are copied to the worker droplet on every deploy. Web goes
# first because its entrypoint applies the schema the new workers expect.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_NAME="${APP_NAME:-upload-studio}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-jesuisfatih/upload-studio}"
IMAGE="${REGISTRY}/${IMAGE_REPOSITORY}"
DEPOT_PROJECT="${DEPOT_PROJECT:-tq9pqdq9xh}"
PLATFORM="${PLATFORM:-linux/amd64}"
REF="${REF:-HEAD}"
PUSH="${PUSH:-0}"
DEPLOY_HOST="${DEPLOY_HOST:-upload-studio}"   # ~/.ssh/config alias -> DO 64.227.108.45
REMOTE_DIR="${REMOTE_DIR:-/opt/apps/public/upload-studio}"
WORKER_HOST="${WORKER_HOST:-upload-studio-worker}"   # ~/.ssh/config alias -> DO 146.190.112.251
WORKER_DIR="${WORKER_DIR:-/opt/apps/upload-studio-worker}"
SERVICES="${SERVICES:-}"   # space-separated tenant services; empty = all

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SHA="$(git rev-parse --short=12 "$REF")"

ensure_ghcr_auth() {
  # Depot reads registry credentials from ~/.docker/config.json. This machine
  # has no docker CLI, so synthesize the auth entry from the gh token.
  local cfg="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
  if grep -q "ghcr.io" "$cfg" 2>/dev/null; then
    return
  fi
  command -v gh >/dev/null || { echo "ERROR: gh CLI required for GHCR auth"; exit 1; }
  local token
  token="$(gh auth token)"
  [ -n "$token" ] || { echo "ERROR: gh auth token empty (run: gh auth login)"; exit 1; }
  mkdir -p "$(dirname "$cfg")"
  local auth
  auth="$(printf '%s' "jesuisfatih:${token}" | base64 | tr -d '\n')"
  CFG_PATH="$cfg" GHCR_AUTH="$auth" node -e '
    const fs = require("fs");
    const cfg = process.env.CFG_PATH;
    const auth = process.env.GHCR_AUTH;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(cfg, "utf8")); } catch (_) {}
    data.auths = data.auths || {};
    data.auths["ghcr.io"] = { auth };
    fs.writeFileSync(cfg, JSON.stringify(data, null, 2));
  '
  echo "→ ghcr.io auth written to $cfg"
}

cmd_build() {
  echo "══ Depot build ══ ref=$REF sha=$SHA push=$PUSH image=$IMAGE"
  local args=(build - --project "$DEPOT_PROJECT" --platform "$PLATFORM"
    -t "$IMAGE:$SHA" -t "$IMAGE:latest")
  if [ "$PUSH" = "1" ]; then
    ensure_ghcr_auth
    args+=(--push)
  fi
  # Build context from git archive: only committed content, no local litter.
   git -c core.autocrlf=false -c core.eol=lf archive "$REF" | depot "${args[@]}"
  echo "✔ Build finished ($IMAGE:$SHA)"
  [ "$PUSH" = "1" ] && echo "✔ Pushed :$SHA and :latest to $REGISTRY" || echo "ℹ Not pushed (set PUSH=1 to push)"
}

cmd_deploy() {
  local sha="${1:-}"
  [ -n "$sha" ] || { echo "ERROR: usage: CONFIRM_DEPLOY=yes ./deploy/depot.sh deploy <sha>"; exit 1; }
  if [ "${CONFIRM_DEPLOY:-}" != "yes" ]; then
    echo "REFUSING deploy: set CONFIRM_DEPLOY=yes explicitly to touch production."
    exit 1
  fi
  git cat-file -e "$sha:docker-compose.yml" 2>/dev/null \
    || { echo "ERROR: $sha is not a local commit (compose files are taken from it)"; exit 1; }

  echo "══ Deploy web ══ $IMAGE:$sha -> $DEPLOY_HOST:$REMOTE_DIR ${SERVICES:+(services: $SERVICES)}"
  git show "$sha:docker-compose.yml" | ssh "$DEPLOY_HOST" "cat > '$REMOTE_DIR/docker-compose.yml'"
  git show "$sha:deploy/docker-compose.redis-bridge.yml" \
    | ssh "$DEPLOY_HOST" "cat > '$REMOTE_DIR/docker-compose.redis-bridge.yml'"
  ssh "$DEPLOY_HOST" "set -e
    docker pull -q '$IMAGE:$sha'
    docker tag '$IMAGE:$sha' upload-studio:latest
    cd '$REMOTE_DIR'
    # No --remove-orphans: the Caddy reverse proxy lives in docker-compose.caddy.yml
    # under the same project name and would be deleted as an orphan (2026-09-04 outage).
    docker compose up -d $SERVICES
    docker compose -f docker-compose.caddy.yml up -d
    docker compose -f docker-compose.redis-bridge.yml up -d
    sleep 10
    docker compose ps $SERVICES"

  echo "══ Deploy workers ══ $IMAGE:$sha -> $WORKER_HOST:$WORKER_DIR"
  ssh "$WORKER_HOST" "mkdir -p '$WORKER_DIR/envs' && chmod 700 '$WORKER_DIR/envs'"
  git show "$sha:deploy/worker/docker-compose.yml" | ssh "$WORKER_HOST" "cat > '$WORKER_DIR/docker-compose.yml'"
  # Env files stay single-sourced on the app droplet; workers get a fresh copy.
  ssh "$DEPLOY_HOST" "tar -C '$REMOTE_DIR' -cf - envs" | ssh "$WORKER_HOST" "tar -C '$WORKER_DIR' -xf -"
  ssh "$WORKER_HOST" "set -e
    docker pull -q '$IMAGE:$sha'
    docker tag '$IMAGE:$sha' upload-studio:latest
    cd '$WORKER_DIR'
    targets=''
    for s in \$(docker compose config --services); do
      if [ -z '$SERVICES' ] || echo ' $SERVICES ' | grep -q \" \$s \"; then targets=\"\$targets \$s\"; fi
    done
    if [ -n \"\$targets\" ]; then docker compose up -d \$targets; sleep 10; docker compose ps; fi
    docker image prune -f >/dev/null"
  echo "✔ Deploy complete ($sha). Verify tenant health before walking away."
}

case "${1:-build}" in
  build)  cmd_build ;;
  deploy) shift; cmd_deploy "$@" ;;
  *) echo "usage: $0 [build|deploy <sha>]"; exit 1 ;;
esac
