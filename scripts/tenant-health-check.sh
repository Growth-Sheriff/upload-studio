#!/bin/bash
# ============================================
# Upload Studio - Tenant Health Check
# ============================================
# Checks all 11 tenant containers + Caddy + Redis status.
#
# Usage: bash scripts/tenant-health-check.sh
# ============================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TENANTS=(
  "fastdtftransfer|4001"
  "everydaycustomprint|4002"
  "dtftransferohio|4003"
  "dtfprinthouse|4004"
  "dtfprintdepot|4005"
  "eagledtfprint|4006"
  "alphaprint|4007"
  "gangsheet|4008"
  "legendtransfers|4009"
  "customprintaz|4010"
  "dtfprintarizona|4011"
)

echo "============================================"
echo "Upload Studio - Health Check"
echo "============================================"
echo ""

# ─── Docker Status ───
echo "🐳 Docker Containers:"
RUNNING=0
STOPPED=0

for tenant in "${TENANTS[@]}"; do
  IFS='|' read -r SLUG PORT <<< "$tenant"
  CONTAINER="us-${SLUG}"

  STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")
  UPTIME=$(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null | head -c 19 || echo "—")

  if [ "$STATUS" = "running" ]; then
    echo -e "  ${GREEN}✅${NC} ${SLUG} (port ${PORT}) — running since ${UPTIME}"
    RUNNING=$((RUNNING + 1))
  else
    echo -e "  ${RED}❌${NC} ${SLUG} (port ${PORT}) — ${STATUS}"
    STOPPED=$((STOPPED + 1))
  fi
done

echo ""
echo "  Running: ${RUNNING}/11 | Stopped: ${STOPPED}/11"
echo ""

# ─── Redis ───
echo "📦 Redis:"
REDIS_STATUS=$(docker inspect -f '{{.State.Status}}' us-redis 2>/dev/null || echo "not_found")
if [ "$REDIS_STATUS" = "running" ]; then
  REDIS_INFO=$(docker exec us-redis redis-cli info memory 2>/dev/null | grep "used_memory_human" | cut -d: -f2 | tr -d '\r')
  echo -e "  ${GREEN}✅${NC} Redis — running (memory: ${REDIS_INFO:-unknown})"
else
  echo -e "  ${RED}❌${NC} Redis — ${REDIS_STATUS}"
fi
echo ""

# ─── Caddy ───
echo "🌐 Caddy:"
if systemctl is-active --quiet caddy; then
  echo -e "  ${GREEN}✅${NC} Caddy — active"
else
  echo -e "  ${RED}❌${NC} Caddy — inactive"
fi
echo ""

# ─── HTTP Health Checks ───
echo "🔗 HTTP Health (localhost):"
for tenant in "${TENANTS[@]}"; do
  IFS='|' read -r SLUG PORT <<< "$tenant"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://localhost:${PORT}/health" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✅${NC} ${SLUG}:${PORT}/health — ${HTTP_CODE}"
  elif [ "$HTTP_CODE" = "000" ]; then
    echo -e "  ${RED}❌${NC} ${SLUG}:${PORT}/health — connection refused"
  else
    echo -e "  ${YELLOW}⚠️${NC}  ${SLUG}:${PORT}/health — ${HTTP_CODE}"
  fi
done

echo ""
echo "============================================"
echo "Check complete"
echo "============================================"
