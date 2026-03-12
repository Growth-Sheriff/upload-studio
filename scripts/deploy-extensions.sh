#!/bin/bash
# ============================================
# Upload Studio - Deploy Shopify Extensions
# ============================================
# Deploys the theme extension to each tenant's Shopify app.
# Each tenant has its own shopify.app.{slug}.toml config.
#
# Prerequisites:
#   - Shopify CLI installed (npx shopify)
#   - client_id set correctly in each .toml
#   - Logged into Shopify Partner Dashboard
#
# Usage:
#   bash scripts/deploy-extensions.sh              # Deploy to ALL tenants
#   bash scripts/deploy-extensions.sh fastdtftransfer  # Deploy to one tenant
# ============================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# All tenant slugs
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

# Determine which tenants to deploy
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

  # Check if client_id is still placeholder
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
