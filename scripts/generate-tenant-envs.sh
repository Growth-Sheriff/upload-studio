#!/bin/bash
# ============================================
# Upload Studio - Tenant Environment Generator
# ============================================
# Generates envs/.env.{slug} files for all 11 tenants.
# Run this ONCE on the server before starting Docker Compose.
#
# Usage: bash scripts/generate-tenant-envs.sh
#
# ⚠️  After generation, manually fill in:
#     - SHOPIFY_API_KEY / SHOPIFY_API_SECRET (from Shopify Partner Dashboard)
#     - SESSION_SECRET (unique random per tenant)
# ============================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENVS_DIR="${PROJECT_DIR}/envs"

mkdir -p "$ENVS_DIR"

# ─────────────────────────────────────────────
# Database config (GCP Cloud SQL)
# ─────────────────────────────────────────────
DB_HOST="${DB_HOST:-34.44.26.92}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${DB_PASS:-CHANGE_ME}"
DB_NAME="${DB_NAME:-defaultdb}"
DB_SSL="${DB_SSL:-prefer}"

# ─────────────────────────────────────────────
# Shared services
# ─────────────────────────────────────────────
BUNNY_STORAGE_ZONE="${BUNNY_STORAGE_ZONE:-customizerappdev}"
BUNNY_API_KEY="${BUNNY_API_KEY:-CHANGE_ME}"
BUNNY_CDN_URL="${BUNNY_CDN_URL:-https://customizerappdev.b-cdn.net}"
BUNNY_STORAGE_HOST="${BUNNY_STORAGE_HOST:-storage.bunnycdn.com}"

PAYPAL_CLIENT_ID="${PAYPAL_CLIENT_ID:-CHANGE_ME}"
PAYPAL_CLIENT_SECRET="${PAYPAL_CLIENT_SECRET:-CHANGE_ME}"
PAYPAL_EMAIL="${PAYPAL_EMAIL:-billing@techifyboost.com}"
PAYPAL_WEBHOOK_ID="${PAYPAL_WEBHOOK_ID:-CHANGE_ME}"

STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-CHANGE_ME}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-CHANGE_ME}"

CRON_SECRET="${CRON_SECRET:-CHANGE_ME}"

# ─────────────────────────────────────────────
# Tenant definitions
# Format: slug|display_name|port|redis_db
# ─────────────────────────────────────────────
TENANTS=(
  "fastdtftransfer|Upload Studio Fast DTF Transfer|4001|0"
  "everydaycustomprint|Upload Studio Everyday Custom Print|4002|1"
  "dtftransferohio|Upload Studio DTF Transfer Ohio|4003|2"
  "dtfprinthouse|Upload Studio DTF Print House|4004|3"
  "dtfprintdepot|Upload Studio DTF Print Depot|4005|4"
  "eagledtfprint|Upload Studio Eagle DTF Print|4006|5"
  "alphaprint|Upload Studio Alpha Print|4007|6"
  "gangsheet|Upload Studio Gang Sheet|4008|7"
  "legendtransfers|Upload Studio Legend Transfers|4009|8"
  "customprintaz|Upload Studio Custom Print AZ|4010|9"
  "dtfprintarizona|Upload Studio DTF Print Arizona|4011|10"
)

echo "============================================"
echo "Upload Studio - Generating Tenant Env Files"
echo "============================================"
echo ""

for tenant in "${TENANTS[@]}"; do
  IFS='|' read -r SLUG DISPLAY_NAME PORT REDIS_DB <<< "$tenant"

  ENV_FILE="${ENVS_DIR}/.env.${SLUG}"
  DOMAIN="${SLUG}.uploadstudio.app.techifyboost.com"
  SESSION_SECRET="$(openssl rand -hex 32)"
  SECRET_KEY="$(openssl rand -hex 32)"

  cat > "$ENV_FILE" <<EOF
# ============================================
# ${DISPLAY_NAME}
# Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# ============================================

# ─── App Identity ───
TENANT_SLUG=${SLUG}
APP_NAME=${DISPLAY_NAME}
APP_DOMAIN=${DOMAIN}
NODE_ENV=production
PORT=3000

# ─── Shopify App Credentials ───
# ⚠️  FILL FROM SHOPIFY PARTNER DASHBOARD
SHOPIFY_API_KEY=CHANGE_ME_${SLUG}
SHOPIFY_API_SECRET=CHANGE_ME_${SLUG}
SHOPIFY_APP_URL=https://${DOMAIN}
SCOPES=read_products,write_products,read_orders,write_orders,read_customers

# ─── Database (PostgreSQL - Schema: ${SLUG}) ───
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=${SLUG}&sslmode=${DB_SSL}&connection_limit=5&pool_timeout=10

# ─── Redis (DB index: ${REDIS_DB}) ───
REDIS_URL=redis://redis:6379/${REDIS_DB}

# ─── Session ───
SESSION_SECRET=${SESSION_SECRET}

# ─── Storage (Bunny CDN - Shared) ───
DEFAULT_STORAGE_PROVIDER=bunny
BUNNY_STORAGE_ZONE=${BUNNY_STORAGE_ZONE}
BUNNY_API_KEY=${BUNNY_API_KEY}
BUNNY_CDN_URL=${BUNNY_CDN_URL}
BUNNY_STORAGE_HOST=${BUNNY_STORAGE_HOST}
LOCAL_STORAGE_PATH=./uploads
SECRET_KEY=${SECRET_KEY}

# ─── PayPal (Shared Account) ───
PAYPAL_CLIENT_ID=${PAYPAL_CLIENT_ID}
PAYPAL_CLIENT_SECRET=${PAYPAL_CLIENT_SECRET}
PAYPAL_MODE=live
PAYPAL_EMAIL=${PAYPAL_EMAIL}
PAYPAL_WEBHOOK_ID=${PAYPAL_WEBHOOK_ID}

# ─── Stripe (Shared Account) ───
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}

# ─── Cron ───
CRON_SECRET=${CRON_SECRET}
EOF

  echo "  ✅ ${ENV_FILE} (port: ${PORT}, redis db: ${REDIS_DB}, schema: ${SLUG})"
done

echo ""
echo "============================================"
echo "✅ Generated ${#TENANTS[@]} tenant env files"
echo "============================================"
echo ""
echo "⚠️  NEXT STEPS:"
echo "  1. Fill SHOPIFY_API_KEY + SHOPIFY_API_SECRET for each tenant"
echo "  2. Update DB_PASS with actual database password"
echo "  3. Update BUNNY_API_KEY, PAYPAL, STRIPE credentials"
echo "  4. Run: bash scripts/init-tenant-schemas.sh"
echo "  5. Run: docker build -t upload-studio:latest ."
echo "  6. Run: docker compose up -d"
