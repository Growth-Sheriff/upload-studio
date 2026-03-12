#!/bin/bash
# ===========================================
# Upload Studio - Multi-Tenant Deployment Script
# ===========================================
# Builds Docker image and restarts all tenant containers.
# Usage: bash deploy/deploy.sh
#
# Prerequisites:
#   - envs/.env.{slug} files generated (scripts/generate-tenant-envs.sh)
#   - DB schemas initialized (scripts/init-tenant-schemas.sh)
# ===========================================

set -e

APP_DIR="/opt/apps/upload-studio"

echo "=========================================="
echo "Upload Studio - Multi-Tenant Deploy"
echo "=========================================="

cd "$APP_DIR"

# Check envs directory
if [ ! -d envs ] || [ -z "$(ls envs/.env.* 2>/dev/null)" ]; then
  echo "ERROR: No tenant env files found in envs/"
  echo "Run: bash scripts/generate-tenant-envs.sh"
  exit 1
fi

echo "[1/4] Pulling latest code from GitHub..."
git pull origin main

echo "[2/4] Building Docker image..."
docker build -t upload-studio:latest .

echo "[3/4] Starting containers..."
docker compose up -d --remove-orphans

echo "[4/4] Checking container health..."
sleep 5
docker compose ps

echo ""
echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
echo ""
echo "Commands:"
echo "  docker compose ps          - Container status"
echo "  docker compose logs -f     - All logs"
echo "  docker logs us-{slug} -f   - Tenant-specific logs"
echo "  docker compose restart     - Restart all"
echo "  docker compose down        - Stop all"

