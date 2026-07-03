#!/bin/bash













set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"




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

echo "============================================"
echo "Upload Studio - Initializing Tenant Schemas"
echo "============================================"
echo "Host: ${DB_HOST}:${DB_PORT}"
echo "Database: ${DB_NAME}"
echo ""




echo "[1/2] Creating PostgreSQL schemas..."

for schema in "${SCHEMAS[@]}"; do
  echo -n "  Creating schema '${schema}'... "

  PGPASSWORD="${DB_PASS}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --set=sslmode="${DB_SSL}" \
    -c "CREATE SCHEMA IF NOT EXISTS \"${schema}\";" \
    -q 2>/dev/null

  echo "✅"
done

echo ""




echo "[2/2] Pushing Prisma schema to each tenant..."

cd "$PROJECT_DIR"

for schema in "${SCHEMAS[@]}"; do
  echo -n "  Pushing schema '${schema}'... "

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=${schema}&sslmode=${DB_SSL}" \
    npx prisma db push --accept-data-loss --skip-generate 2>/dev/null

  echo "✅"
done

echo ""
echo "============================================"
echo "✅ All ${#SCHEMAS[@]} schemas initialized"
echo "============================================"
echo ""
echo "Schemas created:"
for schema in "${SCHEMAS[@]}"; do
  echo "  - ${schema}"
done
echo ""
echo "Next: docker build -t upload-studio:latest . && docker compose up -d"
