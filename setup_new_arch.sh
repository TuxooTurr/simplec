#!/bin/bash
# setup_new_arch.sh — деплой FastAPI + Next.js поверх существующего Streamlit
# Запускать на VPS: sudo bash setup_new_arch.sh
# Streamlit остаётся работать на /streamlit/

set -euo pipefail

APP_DIR="/opt/simpletest"
APP_USER="simpletest"
DOMAIN="simpletest.pro"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓] $1${NC}"; }
info() { echo -e "${BLUE}[→] $1${NC}"; }
warn() { echo -e "${YELLOW}[!] $1${NC}"; }

[[ $EUID -ne 0 ]] && echo -e "${RED}[✗] Нужен sudo${NC}" && exit 1

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║    SimpleTest 2.0: FastAPI + Next.js деплой              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Node.js 20 LTS ──────────────────────────────────────────
info "Проверяю Node.js..."
if ! command -v node &>/dev/null || [[ $(node --version | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
    info "Устанавливаю Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    log "Node.js $(node --version) установлен"
else
    log "Node.js $(node --version) уже есть"
fi

# ── 2. Обновляем код ───────────────────────────────────────────
info "Обновляю код из репозитория..."
sudo -u "$APP_USER" git -C "$APP_DIR" pull
log "Код обновлён"

# ── 3. Python зависимости ─────────────────────────────────────
info "Обновляю Python зависимости..."
sudo -u "$APP_USER" "$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"
log "Python зависимости OK"

# ── 4. Next.js сборка ─────────────────────────────────────────
info "Устанавливаю npm зависимости..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR/frontend && npm install --legacy-peer-deps"
log "npm install OK"

info "Собираю Next.js production build..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR/frontend && npm run build"
log "Next.js build OK"

# ── 5. Systemd: FastAPI ───────────────────────────────────────
info "Создаю systemd сервис FastAPI..."
cat > /etc/systemd/system/simpletest-api.service <<EOF
[Unit]
Description=SimpleTest API — FastAPI backend
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=on-failure
RestartSec=5
EnvironmentFile=$APP_DIR/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
log "simpletest-api.service создан"

# ── 6. Systemd: Next.js ───────────────────────────────────────
info "Создаю systemd сервис Next.js..."
cat > /etc/systemd/system/simpletest-next.service <<EOF
[Unit]
Description=SimpleTest Frontend — Next.js standalone
After=network.target simpletest-api.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/frontend/.next/standalone
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
log "simpletest-next.service создан"

# ── 7. Nginx конфиг ───────────────────────────────────────────
info "Обновляю nginx конфиг (сохраняю SSL секции)..."

# Сохраняем текущий конфиг на случай отката
cp /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-available/$DOMAIN.backup.$(date +%Y%m%d%H%M) 2>/dev/null || true

# Копируем статику Next.js (для раздачи nginx напрямую)
STATIC_SRC="$APP_DIR/frontend/.next/standalone/public"
STATIC_DST="$APP_DIR/frontend/.next/standalone/.next/static"
mkdir -p "$APP_DIR/frontend/.next/standalone/public" || true
# Для standalone: нужно скопировать статику в standalone директорию
[ -d "$APP_DIR/frontend/.next/static" ] && \
  cp -r "$APP_DIR/frontend/.next/static" "$APP_DIR/frontend/.next/standalone/.next/" 2>/dev/null || true
[ -d "$APP_DIR/frontend/public" ] && \
  cp -r "$APP_DIR/frontend/public/." "$APP_DIR/frontend/.next/standalone/public/" 2>/dev/null || true

chown -R "$APP_USER":"$APP_USER" "$APP_DIR/frontend/.next/standalone/" 2>/dev/null || true

# Новый nginx конфиг (SSL секции добавит certbot)
cat > /etc/nginx/sites-available/$DOMAIN <<'NGINX'
server {
    listen 80;
    server_name simpletest.pro www.simpletest.pro;
    client_max_body_size 50M;

    # API + WebSocket
    location /api/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 600s;
        proxy_buffering    off;
    }

    # FastAPI auto-docs
    location /openapi.json {
        proxy_pass http://127.0.0.1:8000;
    }
    location /docs {
        proxy_pass http://127.0.0.1:8000;
    }
    location /healthz {
        proxy_pass http://127.0.0.1:8000;
    }

    # Старый Streamlit (временно, во время перехода)
    location /streamlit/ {
        proxy_pass         http://127.0.0.1:8501/;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 300s;
        proxy_buffering    off;
    }

    # Next.js frontend
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_read_timeout 60s;
    }
}
NGINX

nginx -t && log "nginx конфиг валиден"

# ── 8. Применяем SSL если был certbot ────────────────────────
if [ -d /etc/letsencrypt/live/$DOMAIN ]; then
    info "Восстанавливаю SSL секции через certbot..."
    certbot --nginx -d $DOMAIN --non-interactive 2>/dev/null && log "SSL секции восстановлены" || \
      warn "certbot не смог обновить SSL. Проверьте вручную."
fi

# ── 9. Запускаем сервисы ──────────────────────────────────────
info "Запускаю сервисы..."
systemctl daemon-reload
systemctl enable simpletest-api simpletest-next
systemctl restart simpletest-api
sleep 2
systemctl restart simpletest-next
systemctl reload nginx

echo ""
log "Проверяю статус сервисов:"
systemctl is-active simpletest-api && echo "  simpletest-api: OK" || echo "  simpletest-api: FAILED"
systemctl is-active simpletest-next && echo "  simpletest-next: OK" || echo "  simpletest-next: FAILED"
systemctl is-active simpletest && echo "  simpletest (streamlit): OK" || echo "  simpletest (streamlit): FAILED"

# ── Итог ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              SimpleTest 2.0 задеплоен!                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Новый UI:    https://simpletest.pro/                    ║"
echo "║  API:         https://simpletest.pro/api/docs            ║"
echo "║  Streamlit:   https://simpletest.pro/streamlit/          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Логи:                                                   ║"
echo "║    journalctl -u simpletest-api -f                       ║"
echo "║    journalctl -u simpletest-next -f                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
