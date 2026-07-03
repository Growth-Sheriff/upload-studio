#!/bin/bash
























set -e


RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'




DB_HOST="${DB_HOST:-34.44.26.92}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${DB_PASS:-CHANGE_ME}"
DB_NAME="${DB_NAME:-defaultdb}"
DB_SSL="${DB_SSL:-prefer}"

SOURCE_SCHEMA="public"
TARGET_SCHEMA="fastdtftransfer"
DRY_RUN="${DRY_RUN:-0}"



TABLES=(
  "sessions"
  "shops"
  "asset_sets"
  "products_config"
  "visitors"
  "visitor_sessions"
  "uploads"
  "upload_items"
  "orders_link"
  "export_jobs"
  "audit_logs"
  "team_members"
  "api_keys"
  "white_label_config"
  "flow_triggers"
  "support_tickets"
  "support_replies"
  "commissions"
  "upload_logs"
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

run_sql_verbose() {
  PGPASSWORD="${DB_PASS}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --set=sslmode="${DB_SSL}" \
    -c "$1" 2>/dev/null
}

echo "============================================"
echo "Upload Studio - Data Migration"
echo "============================================"
echo -e "Source: ${CYAN}${SOURCE_SCHEMA}${NC}"
echo -e "Target: ${CYAN}${TARGET_SCHEMA}${NC}"
echo -e "Host:   ${DB_HOST}:${DB_PORT}"
if [ "$DRY_RUN" = "1" ]; then
  echo -e "${YELLOW}MODE: DRY RUN (no changes will be made)${NC}"
fi
echo ""




echo "[0/4] Verifying database connection..."


SOURCE_EXISTS=$(run_sql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '${SOURCE_SCHEMA}';")
if [ "$SOURCE_EXISTS" != "1" ]; then
  echo -e "${RED}ERROR: Source schema '${SOURCE_SCHEMA}' does not exist!${NC}"
  exit 1
fi


TARGET_EXISTS=$(run_sql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '${TARGET_SCHEMA}';")
if [ "$TARGET_EXISTS" != "1" ]; then
  echo -e "${RED}ERROR: Target schema '${TARGET_SCHEMA}' does not exist!${NC}"
  echo "Run: bash scripts/init-tenant-schemas.sh first"
  exit 1
fi

echo -e "  ${GREEN}✅${NC} Both schemas exist"
echo ""




echo "[1/4] Counting source rows..."

declare -A SOURCE_COUNTS
TOTAL_ROWS=0

for table in "${TABLES[@]}"; do
  COUNT=$(run_sql "SELECT COUNT(*) FROM \"${SOURCE_SCHEMA}\".\"${table}\";" 2>/dev/null || echo "0")
  SOURCE_COUNTS[$table]=$COUNT
  TOTAL_ROWS=$((TOTAL_ROWS + COUNT))
  if [ "$COUNT" != "0" ]; then
    echo -e "  ${table}: ${CYAN}${COUNT}${NC} rows"
  fi
done

echo ""
echo -e "  Total: ${CYAN}${TOTAL_ROWS}${NC} rows across ${#TABLES[@]} tables"
echo ""

if [ "$TOTAL_ROWS" = "0" ]; then
  echo -e "${YELLOW}No data to migrate. Source schema is empty.${NC}"
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo -e "${YELLOW}DRY RUN complete. No changes made.${NC}"
  exit 0
fi




echo "[2/4] Migrating data..."


MIGRATION_SQL="BEGIN;"


for table in "${TABLES[@]}"; do
  MIGRATION_SQL="${MIGRATION_SQL}
ALTER TABLE \"${TARGET_SCHEMA}\".\"${table}\" DISABLE TRIGGER ALL;"
done


for (( i=${#TABLES[@]}-1; i>=0; i-- )); do
  table="${TABLES[$i]}"
  MIGRATION_SQL="${MIGRATION_SQL}
TRUNCATE TABLE \"${TARGET_SCHEMA}\".\"${table}\" CASCADE;"
done


for table in "${TABLES[@]}"; do
  count="${SOURCE_COUNTS[$table]}"
  if [ "$count" != "0" ] && [ -n "$count" ]; then
    MIGRATION_SQL="${MIGRATION_SQL}
INSERT INTO \"${TARGET_SCHEMA}\".\"${table}\" SELECT * FROM \"${SOURCE_SCHEMA}\".\"${table}\";"
  fi
done


for table in "${TABLES[@]}"; do
  MIGRATION_SQL="${MIGRATION_SQL}
ALTER TABLE \"${TARGET_SCHEMA}\".\"${table}\" ENABLE TRIGGER ALL;"
done

MIGRATION_SQL="${MIGRATION_SQL}
COMMIT;"


echo "  Executing migration transaction..."
run_sql_verbose "$MIGRATION_SQL"

if [ $? -eq 0 ]; then
  echo -e "  ${GREEN}✅${NC} Data migration transaction complete"
else
  echo -e "  ${RED}❌ Migration failed! Transaction rolled back.${NC}"
  exit 1
fi
echo ""




echo "[3/4] Syncing sequences..."


SEQUENCES=$(run_sql "
  SELECT sequence_name
  FROM information_schema.sequences
  WHERE sequence_schema = '${TARGET_SCHEMA}';
" 2>/dev/null)

if [ -n "$SEQUENCES" ]; then
  while IFS= read -r seq; do
    if [ -n "$seq" ]; then

      TABLE_COL=$(run_sql "
        SELECT table_name || '.' || column_name
        FROM information_schema.columns
        WHERE column_default LIKE '%${seq}%'
          AND table_schema = '${TARGET_SCHEMA}'
        LIMIT 1;
      " 2>/dev/null)

      if [ -n "$TABLE_COL" ]; then
        IFS='.' read -r SEQ_TABLE SEQ_COL <<< "$TABLE_COL"
        MAX_VAL=$(run_sql "SELECT COALESCE(MAX(\"${SEQ_COL}\"), 0) FROM \"${TARGET_SCHEMA}\".\"${SEQ_TABLE}\";" 2>/dev/null)
        if [ -n "$MAX_VAL" ] && [ "$MAX_VAL" != "0" ]; then
          run_sql "SELECT setval('\"${TARGET_SCHEMA}\".\"${seq}\"', ${MAX_VAL});" > /dev/null 2>&1
          echo "  Synced: ${seq} → ${MAX_VAL}"
        fi
      fi
    fi
  done <<< "$SEQUENCES"
  echo -e "  ${GREEN}✅${NC} Sequences synced"
else
  echo "  No sequences found (CUID IDs, no auto-increment)"
fi
echo ""




echo "[4/4] Verifying migration..."

ERRORS=0
for table in "${TABLES[@]}"; do
  SOURCE_COUNT="${SOURCE_COUNTS[$table]}"
  TARGET_COUNT=$(run_sql "SELECT COUNT(*) FROM \"${TARGET_SCHEMA}\".\"${table}\";" 2>/dev/null || echo "0")

  if [ "$SOURCE_COUNT" = "$TARGET_COUNT" ]; then
    if [ "$SOURCE_COUNT" != "0" ]; then
      echo -e "  ${GREEN}✅${NC} ${table}: ${SOURCE_COUNT} = ${TARGET_COUNT}"
    fi
  else
    echo -e "  ${RED}❌${NC} ${table}: source=${SOURCE_COUNT} target=${TARGET_COUNT} MISMATCH!"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
echo "============================================"
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${GREEN}✅ Migration SUCCESSFUL${NC}"
  echo "  ${TOTAL_ROWS} rows migrated across ${#TABLES[@]} tables"
  echo ""
  echo "  Source schema '${SOURCE_SCHEMA}' is untouched (backup)"
  echo "  Target schema '${TARGET_SCHEMA}' is ready"
else
  echo -e "${RED}❌ Migration completed with ${ERRORS} ERRORS${NC}"
  echo "  Check mismatched tables above"
fi
echo "============================================"
