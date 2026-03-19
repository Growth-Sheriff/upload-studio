#!/bin/bash
# ═══════════════════════════════════════════════════════
# Upload Studio — Mockup Worker Deploy Script
# ═══════════════════════════════════════════════════════
# Deploys the worker to gsb-render-worker-1 VM
# GSB Engine'a DOKUNMAZ — tamamen izole dizin
#
# Usage: bash us-mockup-worker/deploy.sh
# ═══════════════════════════════════════════════════════

set -e

VM_NAME="gsb-render-worker-1"
VM_ZONE="us-central1-b"
VM_USER="AvrasyaKreatif"
REMOTE_DIR="/home/${VM_USER}/us-mockup-worker"
LOCAL_DIR="us-mockup-worker"

echo "═══════════════════════════════════════════"
echo " Upload Studio — Mockup Worker Deploy"
echo "═══════════════════════════════════════════"
echo ""

# 1. Sync files to VM
echo "[1/5] Syncing files to ${VM_NAME}..."
gcloud compute scp --zone=${VM_ZONE} --recurse \
  ${LOCAL_DIR}/package.json \
  ${LOCAL_DIR}/tsconfig.json \
  ${LOCAL_DIR}/src \
  ${VM_USER}@${VM_NAME}:${REMOTE_DIR}/

echo "[2/5] Installing dependencies..."
gcloud compute ssh ${VM_NAME} --zone=${VM_ZONE} --command="\
  cd ${REMOTE_DIR} && \
  npm install --production 2>&1 | tail -5
"

# 3. Copy .env if not exists
echo "[3/5] Checking .env..."
gcloud compute ssh ${VM_NAME} --zone=${VM_ZONE} --command="\
  if [ ! -f ${REMOTE_DIR}/.env ]; then \
    echo 'Creating .env from example...'; \
    cp ${REMOTE_DIR}/.env.example ${REMOTE_DIR}/.env 2>/dev/null || echo '.env.example not found'; \
  else \
    echo '.env already exists — skipping'; \
  fi
"

# 4. Install systemd service
echo "[4/5] Installing systemd service..."
gcloud compute scp --zone=${VM_ZONE} \
  ${LOCAL_DIR}/us-mockup-worker.service \
  ${VM_USER}@${VM_NAME}:/tmp/us-mockup-worker.service

gcloud compute ssh ${VM_NAME} --zone=${VM_ZONE} --command="\
  sudo cp /tmp/us-mockup-worker.service /etc/systemd/system/us-mockup-worker.service && \
  sudo systemctl daemon-reload && \
  sudo systemctl enable us-mockup-worker && \
  sudo systemctl restart us-mockup-worker && \
  echo 'Service installed and started'
"

# 5. Verify
echo "[5/5] Verifying..."
sleep 2
gcloud compute ssh ${VM_NAME} --zone=${VM_ZONE} --command="\
  systemctl status us-mockup-worker --no-pager | head -15; \
  echo ''; \
  echo '=== Recent logs ==='; \
  journalctl -u us-mockup-worker --no-pager -n 10
"

echo ""
echo "═══════════════════════════════════════════"
echo " ✅ Mockup Worker deployed successfully!"
echo " Service: us-mockup-worker.service"
echo " Logs: journalctl -u us-mockup-worker -f"
echo "═══════════════════════════════════════════"
