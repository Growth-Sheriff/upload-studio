#!/bin/bash
# ============================================
# Upload Studio - Rollback Tenant Migration
# ============================================
# If something goes wrong, this script will:
#   1. Drop the fastdtftransfer schema (removes all tenant data)
#   2. Keep the public schema intact (original data safe)
#
# The public schema is NEVER touched by any migration script.
# You can always fall back to public schema by setting
# DATABASE_URL without ?schema= parameter.
#
# Usage: bash scripts/rollback-migration.sh
# ============================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

DB_HOST="${DB_HOST:-34.44.26.92}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${DB_PASS:-CHANGE_ME}"
DB_NAME="${DB_NAME:-defaultdb}"
DB_SSL="${DB_SSL:-prefer}"

SCHEMAS=(
  fastdtftransfer
  everydaycustomprint
  dtftransferohio
  dtfprinthouse
  dtfprintdepot
  eagledtfprint
  alphaprint
  gangsheet
  legendtransfers
  customprintaz
  dtfprintarizona
)

run_sql() {
  PGPASSWORD="${DB_PASS}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --set=sslmode="${DB_SSL}" \
    -t -A -c "$1" 2>/dev/null
}

echo "============================================"
echo -e "${RED}Upload Studio - ROLLBACK Migration${NC}"
echo "============================================"
echo ""
echo -e "${YELLOW}WARNING: This will DROP all tenant schemas!${NC}"
echo "The 'public' schema will NOT be affected."
echo ""
echo "Schemas to drop:"
for schema in "${SCHEMAS[@]}"; do
  echo "  - ${schema}"
done
echo ""

read -p "Are you sure? Type 'YES' to confirm: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Dropping schemas..."

for schema in "${SCHEMAS[@]}"; do
  echo -n "  Dropping '${schema}'... "

  EXISTS=$(run_sql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '${schema}';")
  if [ "$EXISTS" = "1" ]; then
    run_sql "DROP SCHEMA \"${schema}\" CASCADE;"
    echo -e "${GREEN}✅${NC}"
  else
    echo "skipped (not found)"
  fi
done

echo ""
echo "============================================"
echo -e "${GREEN}Rollback complete.${NC}"
echo "The 'public' schema with original data is intact."
echo ""
echo "To restore, run:"
echo "  1. bash scripts/init-tenant-schemas.sh"
echo "  2. bash scripts/migrate-public-to-tenant.sh"
echo "============================================"
