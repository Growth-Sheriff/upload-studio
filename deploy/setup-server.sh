#!/bin/bash
# ===========================================
# Upload Studio - Multi-Tenant Server Setup
# ===========================================
# Run this ONCE on a fresh Ubuntu 24 LTS server
# Sets up Docker, Caddy, and project directory
# Usage: bash deploy/setup-server.sh

set -e

echo "=========================================="
echo "Upload Studio - Multi-Tenant Server Setup"
echo "=========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

echo -e "${GREEN}[1/6] Updating system...${NC}"
apt-get update && apt-get upgrade -y

echo -e "${GREEN}[2/6] Installing Docker...${NC}"
# Remove old Docker versions
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install Docker prerequisites
apt-get install -y ca-certificates curl gnupg

# Add Docker official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repo
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl start docker
systemctl enable docker

echo -e "${GREEN}[3/6] Installing Caddy...${NC}"
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# Remove nginx if exists
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
apt-get remove --purge -y nginx nginx-common nginx-full 2>/dev/null || true

echo -e "${GREEN}[4/6] Setting up project directory...${NC}"
mkdir -p /opt/apps/upload-studio
cd /opt/apps/upload-studio

echo -e "${GREEN}[5/6] Deploying Caddyfile...${NC}"
if [ -f deploy/Caddyfile.multi-tenant ]; then
  cp deploy/Caddyfile.multi-tenant /etc/caddy/Caddyfile
  echo "  Copied multi-tenant Caddyfile"
else
  echo -e "${YELLOW}  WARNING: deploy/Caddyfile.multi-tenant not found. Clone repo first.${NC}"
fi

mkdir -p /var/log/caddy
caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl restart caddy
systemctl enable caddy

echo -e "${GREEN}[6/6] Installing utility tools...${NC}"
# psql client for DB schema initialization
apt-get install -y postgresql-client

echo ""
echo -e "${GREEN}=========================================="
echo "Server setup complete!"
echo "==========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Clone repo:"
echo "     cd /opt/apps/upload-studio"
echo "     git clone git@github.com:Growth-Sheriff/customizerapp.git ."
echo ""
echo "  2. Generate tenant env files:"
echo "     bash scripts/generate-tenant-envs.sh"
echo ""
echo "  3. Fill in credentials in envs/.env.* files"
echo ""
echo "  4. Initialize DB schemas:"
echo "     bash scripts/init-tenant-schemas.sh"
echo ""
echo "  5. Build & start:"
echo "     docker build -t upload-studio:latest ."
echo "     docker compose up -d"
echo ""
echo "  6. Deploy Caddyfile:"
echo "     cp deploy/Caddyfile.multi-tenant /etc/caddy/Caddyfile"
echo "     caddy reload --config /etc/caddy/Caddyfile"
echo ""
echo -e "${YELLOW}Docker:${NC} docker compose ps"
echo -e "${YELLOW}Logs:${NC} docker compose logs -f"
echo -e "${YELLOW}Health:${NC} bash scripts/tenant-health-check.sh"

