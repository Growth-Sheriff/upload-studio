#!/bin/bash















set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"


ALL_SLUGS=(
  fdt
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


if [ -n "$1" ]; then
  SLUGS=("$1")
else
  SLUGS=("${ALL_SLUGS[@]}")
fi

echo "============================================"
echo "Upload Studio - Deploying Shopify Extensions"
echo "============================================"
echo ""

SUCCESS=0
FAILED=0

for slug in "${SLUGS[@]}"; do
  TOML_FILE="shopify.app.${slug}.toml"

  if [ ! -f "$TOML_FILE" ]; then
    echo "  ❌ ${slug}: ${TOML_FILE} not found"
    FAILED=$((FAILED + 1))
    continue
  fi


  if grep -q "CHANGE_ME" "$TOML_FILE"; then
    echo "  ⚠️  ${slug}: client_id not set yet (CHANGE_ME), skipping"
    FAILED=$((FAILED + 1))
    continue
  fi

  echo -n "  Deploying ${slug}... "

  if npx shopify app deploy --config "$TOML_FILE" --force 2>/dev/null; then
    echo "✅"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "❌ FAILED"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "============================================"
echo "Results: ${SUCCESS} success, ${FAILED} failed/skipped"
echo "============================================"
