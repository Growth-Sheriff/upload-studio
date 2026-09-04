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
#                                           # pull :<sha> on the server, retag as
#                                           # upload-studio:latest, compose up -d
#
# The deploy stage is double-gated (subcommand + CONFIRM_DEPLOY=yes) so that
# running this script casually can never touch production.
#
# Server layout (verified 2026-08-28): compose project lives at
# /opt/apps/public/upload-studio with `image: upload-studio:latest`, so deploy
# is pull + retag + `docker compose up -d` — no server file edits needed.
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
  echo "══ Deploy ══ $IMAGE:$sha -> $DEPLOY_HOST:$REMOTE_DIR"
  ssh "$DEPLOY_HOST" "set -e
    docker pull '$IMAGE:$sha'
    docker tag '$IMAGE:$sha' upload-studio:latest
    cd '$REMOTE_DIR'
    # No --remove-orphans: the Caddy reverse proxy lives in docker-compose.caddy.yml
    # under the same project name and would be deleted as an orphan (2026-09-04 outage).
    docker compose up -d
    docker compose -f docker-compose.caddy.yml up -d
    sleep 10
    docker compose ps"
  echo "✔ Deploy complete ($sha). Verify tenant health before walking away."
}

case "${1:-build}" in
  build)  cmd_build ;;
  deploy) shift; cmd_deploy "$@" ;;
  *) echo "usage: $0 [build|deploy <sha>]"; exit 1 ;;
esac
