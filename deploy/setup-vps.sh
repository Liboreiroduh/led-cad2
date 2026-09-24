#!/bin/bash
# =============================================================================
# LED CAD — Provisionamento completo da VPS (Ubuntu 22.04/24.04 virgem)
# Uso (como root, na VPS):
#   GITHUB_TOKEN=ghp_xxx DOMAIN=app.seudominio.com bash deploy/setup-vps.sh
#   (GITHUB_TOKEN é obrigatório se o repositório for privado;
#    DOMAIN é opcional — sem ele o Caddy serve em http://IP na porta 80)
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/Liboreiroduh/led-cad2.git"
APP_DIR="/opt/ledcad"
APP_USER="ledcad"
DOMAIN="${DOMAIN:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

echo "==> [1/8] Atualizando sistema e instalando pacotes base"
apt-get update -y
apt-get install -y curl git unzip ca-certificates

echo "==> [2/8] Criando swap 2G (segura o build do Next em VPS pequenas)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> [3/8] Criando usuario de servico '${APP_USER}'"
id -u "${APP_USER}" &>/dev/null || useradd --system --create-home --shell /bin/bash "${APP_USER}"

echo "==> [4/8] Instalando Bun (como ${APP_USER})"
su - "${APP_USER}" -c 'curl -fsSL https://bun.sh/install | bash'

echo "==> [5/8] Clonando repositorio canonico (GitHub main)"
if [ -d "${APP_DIR}/.git" ]; then
  echo "    ${APP_DIR} ja existe — pulando clone"
else
  if [ -n "${GITHUB_TOKEN}" ]; then
    CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/Liboreiroduh/led-cad2.git"
  else
    CLONE_URL="${REPO_URL}"
  fi
  git clone --depth 1 "${CLONE_URL}" "${APP_DIR}"
fi
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "==> [6/8] Configurando ambiente (.env) e diretorios de dados"
cd "${APP_DIR}"
if [ ! -f .env ]; then
  cat > .env <<EOF
DATABASE_URL=file:${APP_DIR}/db/custom.db
NODE_ENV=production
EOF
  chown "${APP_USER}:${APP_USER}" .env
fi
mkdir -p db data
chown -R "${APP_USER}:${APP_USER}" db data

echo "==> [7/8] Instalando dependencias, Prisma (migrate deploy) e build de producao"
su - "${APP_USER}" -c "
  set -e
  cd ${APP_DIR}
  export PATH=\$HOME/.bun/bin:\$PATH
  export DATABASE_URL=file:${APP_DIR}/db/custom.db
  bun install --frozen-lockfile
  bun run db:deploy
  bun run db:generate
  bun run build
"

echo "==> [8/8] Instalando servico systemd e Caddy (reverse proxy)"
cp "${APP_DIR}/deploy/ledcad.service" /etc/systemd/system/ledcad.service
systemctl daemon-reload
systemctl enable --now ledcad

if [ ! -f /etc/apt/sources.list.d/caddy.list ]; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy.list >/dev/null
  apt-get update -y
fi
apt-get install -y caddy

if [ -n "${DOMAIN}" ]; then
  cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  reverse_proxy 127.0.0.1:3000
}
EOF
else
  cat > /etc/caddy/Caddyfile <<EOF
:80 {
  reverse_proxy 127.0.0.1:3000
}
EOF
fi
systemctl enable --now caddy
systemctl reload caddy

echo "==> Firewall (ufw)"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

echo ""
echo "=========================================================="
echo " Deploy concluido!"
echo "   Servico : systemctl status ledcad"
echo "   Logs    : journalctl -u ledcad -f"
echo -n "   URL     : "
if [ -n "${DOMAIN}" ]; then echo "https://${DOMAIN}"; else echo "http://$(curl -s ifconfig.me)"; fi
echo "=========================================================="
