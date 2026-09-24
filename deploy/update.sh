#!/bin/bash
# =============================================================================
# LED CAD — Update de versao na VPS (deploys futuros)
# Uso (como root, na VPS): bash /opt/ledcad/deploy/update.sh
# Preserva: data/ (projeto, revisoes, chaves de IA) e db/ (SQLite)
# =============================================================================
set -euo pipefail

APP_DIR="/opt/ledcad"
APP_USER="ledcad"

echo "==> Atualizando codigo a partir do GitHub (main)"
cd "${APP_DIR}"
sudo -u "${APP_USER}" git pull --ff-only origin main

echo "==> Reinstalando dependencias e rebuild"
sudo -u "${APP_USER}" bash -lc '
  set -e
  cd '"${APP_DIR}"'
  export PATH=$HOME/.bun/bin:$PATH
  export DATABASE_URL=file:'"${APP_DIR}"'/db/custom.db
  bun install --frozen-lockfile
  bun run db:generate
  bunx prisma db push --skip-generate
  bun run build
'

echo "==> Reiniciando servico"
systemctl restart ledcad
systemctl status ledcad --no-pager || true

echo ""
echo "Update concluido. Logs: journalctl -u ledcad -f"
