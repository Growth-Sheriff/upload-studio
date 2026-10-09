#!/usr/bin/env bash
set -euo pipefail

# This suite may write only to the disposable databases supplied by CI.
test "${DATABASE_URL:-}" = 'postgresql://public_app:local-test-only@127.0.0.1:55439/public_app_test?schema=public'
test "${REDIS_URL:-}" = 'redis://127.0.0.1:56389/0'

pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm exec vitest run
pnpm exec tsc --pretty false
pnpm run measurement:regression
pnpm run build
pnpm exec shopify theme check --path extensions/theme-extension --output json
pnpm exec shopify app build --config auto-gang-sheet-upload
