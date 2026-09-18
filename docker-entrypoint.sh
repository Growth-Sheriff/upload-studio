#!/bin/bash




set -e






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




if [ "${NODE_ENV}" = "production" ] && [ "${TENANT_SLUG}" = "default" ]; then
  if [ "${ALLOW_DEFAULT_TENANT}" != "true" ]; then
    echo "[Init] FATAL: TENANT_SLUG is 'default' in production and could not be derived from SHOPIFY_APP_URL." >&2
    echo "[Init] Set TENANT_SLUG explicitly, or set ALLOW_DEFAULT_TENANT=true to bypass (not recommended)." >&2
    exit 1
  fi
  echo "[Init] WARNING: running with TENANT_SLUG=default in production (ALLOW_DEFAULT_TENANT=true)."
fi

# APP_ROLE decides what this container runs:
#   web    - Remix server only; background workers can never start here.
#   worker - background workers only (dedicated worker droplet).
#   all    - legacy: both, for tenants not yet moved to the worker droplet.
APP_ROLE="${APP_ROLE:-all}"
case "${APP_ROLE}" in
  web|worker|all) ;;
  *)
    echo "[Init] FATAL: APP_ROLE must be web, worker or all (got '${APP_ROLE}')." >&2
    exit 1
    ;;
esac
export APP_ROLE

echo "============================================"
echo "Upload Studio - Starting tenant: ${TENANT_SLUG} (role: ${APP_ROLE})"
echo "Port: ${PORT:-3000}"
echo "============================================"


echo "[Init] Syncing database schema..."
# Financial eligibility and finished-sheet quantity markers are release gates,
# not optional drift. Apply their idempotent DDL before any worker can claim a
# fee or reinterpret an old upload, then require the full Prisma schema sync to
# succeed without accepting destructive changes.
prisma db execute --schema ./prisma/schema.prisma --file ./prisma/migrations/add_commission_eligibility.sql
prisma db execute --schema ./prisma/schema.prisma --file ./prisma/migrations/add_finished_sheet_quantity_semantics.sql
prisma db push --skip-generate


start_remix() {
  echo "[App:${TENANT_SLUG}] Starting Remix server on port ${PORT:-3000}..."
  exec node --import ./instrumentation.server.mjs node_modules/@remix-run/serve/dist/cli.js ./build/server/index.js
}

if [ "${APP_ROLE}" = "web" ]; then
  echo "[App:${TENANT_SLUG}] Web role: background workers run on the worker droplet, not here."
  start_remix
fi


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


cleanup() {
  echo "[App:${TENANT_SLUG}] Shutting down..."
  trap - SIGTERM SIGINT
  # Stop the restart loops, then signal each tsx launcher once (it relays to
  # its node child) so measure/preview finish in-flight jobs before exiting.
  kill $MEASURE_PREFLIGHT_PID $PREVIEW_RENDER_PID $EXPORT_PID $FLOW_PID $COMMISSION_PID $TELEMETRY_PID 2>/dev/null || true
  pkill -TERM -f "tsx workers/" 2>/dev/null || true
  while pgrep -f "workers/[a-z-]*\.worker\.ts" >/dev/null 2>&1; do sleep 1; done
  echo "[App:${TENANT_SLUG}] All processes stopped."
  exit 0
}
trap cleanup SIGTERM SIGINT


if [ "${APP_ROLE}" = "worker" ]; then
  echo "[App:${TENANT_SLUG}] Worker role: no web server in this container."
  # Stay in the foreground (interruptible, so the trap runs) while the restart loops own the workers.
  while true; do sleep 3600 & wait $!; done
fi

start_remix
