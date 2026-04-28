#!/bin/bash
# ============================================
# Upload Studio - Docker Entrypoint
# Starts Remix app + 6 background workers
# ============================================
set -e

# Derive tenant from SHOPIFY_APP_URL subdomain when TENANT_SLUG is missing
# or a placeholder. Previous deploys silently defaulted to "default" which
# broke telemetry attribution and made the [TENANT GUARD] warning noisy,
# while the correct tenant identity was already encoded in SHOPIFY_APP_URL
# (e.g. https://dtfprinthouse.uploadstudio.app... -> dtfprinthouse).
if [ -z "${TENANT_SLUG}" ] || [ "${TENANT_SLUG}" = "default" ] || [ "${TENANT_SLUG}" = "unknown" ]; then
  if [ -n "${SHOPIFY_APP_URL}" ]; then
    DERIVED_SLUG=$(echo "${SHOPIFY_APP_URL}" | sed -E 's|^https?://||' | cut -d. -f1)
    if [ -n "${DERIVED_SLUG}" ] && [ "${DERIVED_SLUG}" != "localhost" ]; then
      echo "[Init] TENANT_SLUG missing/placeholder, derived '${DERIVED_SLUG}' from SHOPIFY_APP_URL"
      TENANT_SLUG="${DERIVED_SLUG}"
    fi
  fi
fi
TENANT_SLUG="${TENANT_SLUG:-default}"
export TENANT_SLUG

# Fail loudly in production when tenant is still not resolved — silent
# "default" in production corrupts telemetry, billing attribution, and
# multi-tenant scope guards without any visible symptom for days.
if [ "${NODE_ENV}" = "production" ] && [ "${TENANT_SLUG}" = "default" ]; then
  if [ "${ALLOW_DEFAULT_TENANT}" != "true" ]; then
    echo "[Init] FATAL: TENANT_SLUG is 'default' in production and could not be derived from SHOPIFY_APP_URL." >&2
    echo "[Init] Set TENANT_SLUG explicitly, or set ALLOW_DEFAULT_TENANT=true to bypass (not recommended)." >&2
    exit 1
  fi
  echo "[Init] WARNING: running with TENANT_SLUG=default in production (ALLOW_DEFAULT_TENANT=true)."
fi

echo "============================================"
echo "Upload Studio - Starting tenant: ${TENANT_SLUG}"
echo "Port: ${PORT:-3000}"
echo "============================================"

# Sync database schema (creates tables if needed)
echo "[Init] Syncing database schema..."
prisma db push --accept-data-loss --skip-generate 2>&1 || echo "[Init] Schema sync warning (may already be up to date)"

# Worker auto-restart wrapper
start_worker() {
  local name="$1"
  shift
  while true; do
    echo "[Worker:${TENANT_SLUG}] Starting ${name}..."
    "$@" 2>&1 | sed "s/^/[${name}:${TENANT_SLUG}] /" || true
    echo "[Worker:${TENANT_SLUG}] ${name} exited, restarting in 5s..."
    sleep 5
  done
}

# Start workers in background
start_worker "measure-preflight" tsx workers/measure-preflight.worker.ts &
MEASURE_PREFLIGHT_PID=$!

start_worker "preview-render" tsx workers/preview-render.worker.ts &
PREVIEW_RENDER_PID=$!

start_worker "export" tsx workers/export.worker.ts &
EXPORT_PID=$!

start_worker "flow" tsx workers/flow.worker.ts &
FLOW_PID=$!

start_worker "commission" tsx workers/commission.worker.ts &
COMMISSION_PID=$!

start_worker "telemetry" tsx workers/telemetry.worker.ts &
TELEMETRY_PID=$!

echo "[App:${TENANT_SLUG}] Workers started (PIDs: ${MEASURE_PREFLIGHT_PID}, ${PREVIEW_RENDER_PID}, ${EXPORT_PID}, ${FLOW_PID}, ${COMMISSION_PID}, ${TELEMETRY_PID})"

# Graceful shutdown
cleanup() {
  echo "[App:${TENANT_SLUG}] Shutting down..."
  kill $MEASURE_PREFLIGHT_PID $PREVIEW_RENDER_PID $EXPORT_PID $FLOW_PID $COMMISSION_PID $TELEMETRY_PID 2>/dev/null || true
  wait $MEASURE_PREFLIGHT_PID $PREVIEW_RENDER_PID $EXPORT_PID $FLOW_PID $COMMISSION_PID $TELEMETRY_PID 2>/dev/null || true
  echo "[App:${TENANT_SLUG}] All processes stopped."
  exit 0
}
trap cleanup SIGTERM SIGINT

# Start main app (foreground, PID 1)
echo "[App:${TENANT_SLUG}] Starting Remix server on port ${PORT:-3000}..."
exec node --import ./instrumentation.server.mjs node_modules/@remix-run/serve/dist/cli.js ./build/server/index.js
