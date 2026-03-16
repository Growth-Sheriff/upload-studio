#!/bin/bash
# ============================================
# Upload Studio - Docker Entrypoint
# Starts Remix app + 5 background workers
# ============================================
set -e

TENANT_SLUG="${TENANT_SLUG:-default}"

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
start_worker "preflight" tsx workers/preflight.worker.ts &
PREFLIGHT_PID=$!

start_worker "export" tsx workers/export.worker.ts &
EXPORT_PID=$!

start_worker "flow" tsx workers/flow.worker.ts &
FLOW_PID=$!

start_worker "commission" tsx workers/commission.worker.ts &
COMMISSION_PID=$!

start_worker "telemetry" tsx workers/telemetry.worker.ts &
TELEMETRY_PID=$!

echo "[App:${TENANT_SLUG}] Workers started (PIDs: ${PREFLIGHT_PID}, ${EXPORT_PID}, ${FLOW_PID}, ${COMMISSION_PID}, ${TELEMETRY_PID})"

# Graceful shutdown
cleanup() {
  echo "[App:${TENANT_SLUG}] Shutting down..."
  kill $PREFLIGHT_PID $EXPORT_PID $FLOW_PID $COMMISSION_PID $TELEMETRY_PID 2>/dev/null || true
  wait $PREFLIGHT_PID $EXPORT_PID $FLOW_PID $COMMISSION_PID $TELEMETRY_PID 2>/dev/null || true
  echo "[App:${TENANT_SLUG}] All processes stopped."
  exit 0
}
trap cleanup SIGTERM SIGINT

# Start main app (foreground, PID 1)
echo "[App:${TENANT_SLUG}] Starting Remix server on port ${PORT:-3000}..."
exec node --import ./instrumentation.server.mjs node_modules/@remix-run/serve/dist/cli.js ./build/server/index.js
