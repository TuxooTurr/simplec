#!/usr/bin/env bash
# SimpleTest — полный деплой на сервер (Ubuntu 22.04 / Debian 12)
# Использование: sudo bash deploy.sh
#
# Что делает:
#   1. Устанавливает nginx, python3, certbot
#   2. Клонирует репозиторий с GitHub в /opt/simpletest
#   3. Создаёт venv + устанавливает зависимости
#   4. Настраивает .env (запрашивает GigaChat ключ)
#   5. Создаёт systemd service (автозапуск)
#   6. Настраивает nginx reverse proxy с WebSocket
#   7. Выпускает SSL через Let's Encrypt

set -euo pipefail

# ── Конфигурация ──────────────────────────────────────────────
DOMAIN="simpletest.pro"
REPO="https://github.com/TuxooTurr/simplec.git"
APP_DIR="/opt/simpletest"
APP_USER="simpletest"
SERVICE="simpletest"
PORT=8501
# ─────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓] $1${NC}"; }
info() { echo -e "${BLUE}[→] $1${NC}"; }
warn() { echo -e "${YELLOW}[!] $1${NC}"; }
err()  { echo -e "${RED}[✗] $1${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && err "Запустите с sudo: sudo bash deploy.sh"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         SimpleTest — деплой на $DOMAIN          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Системные пакеты ───────────────────────────────────────
info "Обновляю пакеты..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    git nginx curl \
    certbot python3-certbot-nginx
log "Системные пакеты установлены"

# ── 2. Пользователь приложения ────────────────────────────────
if ! id "$APP_USER" &>/dev/null; then
    useradd --system --create-home --home-dir "$APP_DIR" --shell /bin/bash "$APP_USER"
    log "Создан пользователь $APP_USER"
else
    log "Пользователь $APP_USER уже существует"
fi

# ── 3. Клонирование репозитория ───────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
    info "Обновляю существующий репозиторий..."
    sudo -u "$APP_USER" git -C "$APP_DIR" pull
    log "Репозиторий обновлён"
else
    info "Клонирую репозиторий..."
    rm -rf "$APP_DIR"
    git clone "$REPO" "$APP_DIR"
    chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
    log "Репозиторий клонирован в $APP_DIR"
fi

# ── 4. Python venv + зависимости ─────────────────────────────
info "Создаю виртуальное окружение..."
sudo -u "$APP_USER" bash -c "
    cd '$APP_DIR'
    python3 -m venv .venv
    .venv/bin/pip install --quiet --upgrade pip
    .venv/bin/pip install --quiet streamlit
    .venv/bin/pip install --quiet -r requirements.txt
"
log "Python зависимости установлены"

# ── 5. Настройка .env ─────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
    info "Создаю .env из шаблона..."
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
    chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"

    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  Введите GIGACHAT_AUTH_KEY (Base64 строка из СберID) ║"
    echo "╚══════════════════════════════════════════════════════╝"
    read -s -p "GIGACHAT_AUTH_KEY: " gc_key
    echo ""
    if [ -n "$gc_key" ]; then
        sed -i "s|^GIGACHAT_AUTH_KEY=.*|GIGACHAT_AUTH_KEY=$gc_key|" "$APP_DIR/.env"
        log "GigaChat ключ сохранён"
    else
        warn "Ключ не введён. Добавьте вручную: $APP_DIR/.env"
    fi
else
    log ".env уже существует, пропускаю"
fi

# ── 6. Рабочие директории ─────────────────────────────────────
sudo -u "$APP_USER" mkdir -p "$APP_DIR/out" "$APP_DIR/db/chroma_db" "$APP_DIR/data"
log "Рабочие директории созданы"

# ── 7. Systemd service ────────────────────────────────────────
info "Создаю systemd service..."
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=SimpleTest — AI-генератор тест-кейсов
Documentation=https://github.com/TuxooTurr/simplec
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/streamlit run app.py \\
    --server.port $PORT \\
    --server.address 127.0.0.1 \\
    --server.headless true
Restart=on-failure
RestartSec=5
EnvironmentFile=$APP_DIR/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
log "Сервис $SERVICE запущен (автозапуск включён)"

# ── 8. Nginx конфиг ───────────────────────────────────────────
info "Настраиваю nginx..."
cat > "/etc/nginx/sites-available/$DOMAIN" <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # Загрузки — 50 МБ
    client_max_body_size 50M;

    location / {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_http_version 1.1;

        # WebSocket (Streamlit требует)
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host               \$host;
        proxy_set_header X-Real-IP          \$remote_addr;
        proxy_set_header X-Forwarded-For    \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto  \$scheme;

        # Долгие запросы (генерация тест-кейсов)
        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
        proxy_buffering     off;
    }
}
EOF

ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
# Убираем дефолтный сайт
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
log "nginx настроен"

# ── 9. SSL (Let's Encrypt) ────────────────────────────────────
echo ""
echo "DNS для $DOMAIN должен указывать на этот сервер."
echo "Если ещё не настроен — сначала настройте, потом запустите:"
echo "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo ""
read -p "Получить SSL сертификат сейчас? [y/N]: " do_ssl
if [[ "${do_ssl:-N}" =~ ^[Yy]$ ]]; then
    info "Получаю SSL сертификат..."
    certbot --nginx \
        -d "$DOMAIN" -d "www.$DOMAIN" \
        --non-interactive --agree-tos \
        --email "admin@$DOMAIN" \
        --redirect
    log "SSL настроен. Авто-обновление: systemctl status certbot.timer"
else
    warn "SSL пропущен. Запустите позже: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# ── Итог ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║            SimpleTest успешно задеплоен!                ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  URL:      http://$DOMAIN (или https после SSL)  ║"
echo "║  Приложение: $APP_DIR                       ║"
echo "║  .env:       $APP_DIR/.env                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Полезные команды:                                       ║"
echo "║    journalctl -u $SERVICE -f       # логи               ║"
echo "║    systemctl restart $SERVICE      # перезапуск         ║"
echo "║    systemctl status  $SERVICE      # статус             ║"
echo "║    cd $APP_DIR && git pull         # обновление         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
