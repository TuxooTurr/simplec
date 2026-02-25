#!/usr/bin/env bash
# SimpleTest — полный деплой на VPS
# Поддерживает: Ubuntu 22.04/24.04, Debian 12, AlmaLinux 8/9, CentOS Stream 8/9
# Использование: sudo bash deploy.sh
#
# Что делает:
#   1. Определяет ОС и устанавливает nginx, python3.12, certbot
#   2. Клонирует репозиторий с GitHub в /opt/simpletest
#   3. Создаёт venv + устанавливает зависимости
#   4. Настраивает .env (запрашивает GigaChat ключ)
#   5. Создаёт systemd service (автозапуск)
#   6. Настраивает nginx reverse proxy с WebSocket
#   7. Открывает порты 80/443 в firewall
#   8. Выпускает SSL через Let's Encrypt

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

# ── 1. Определение ОС ────────────────────────────────────────
info "Определяю операционную систему..."
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_LIKE="${ID_LIKE:-}"
else
    OS_ID="unknown"
    OS_LIKE=""
fi

if echo "$OS_ID $OS_LIKE" | grep -qiE "ubuntu|debian"; then
    PKG="apt"
    info "ОС: Ubuntu/Debian (apt)"
elif echo "$OS_ID $OS_LIKE" | grep -qiE "almalinux|centos|rhel|fedora|rocky"; then
    PKG="dnf"
    info "ОС: AlmaLinux/RHEL/CentOS (dnf)"
else
    warn "Неизвестная ОС: $OS_ID. Пробую как Ubuntu/Debian."
    PKG="apt"
fi

# ── 2. Системные пакеты ───────────────────────────────────────
info "Устанавливаю системные пакеты..."

if [ "$PKG" = "apt" ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq \
        python3 python3-pip python3-venv python3.12 python3.12-venv \
        git nginx curl \
        certbot python3-certbot-nginx 2>/dev/null || \
    apt-get install -y -qq \
        python3 python3-pip python3-venv \
        git nginx curl \
        certbot python3-certbot-nginx
    PYTHON="python3"
    # На Ubuntu 22+ проверяем наличие python3.12
    python3.12 --version &>/dev/null && PYTHON="python3.12" || true

elif [ "$PKG" = "dnf" ]; then
    dnf update -y -q
    # EPEL нужен для certbot
    dnf install -y -q epel-release 2>/dev/null || true
    dnf install -y -q \
        python3.12 python3.12-pip \
        git nginx curl \
        certbot python3-certbot-nginx
    PYTHON="python3.12"
    # SELinux: разрешаем nginx проксировать на localhost
    if command -v setsebool &>/dev/null; then
        setsebool -P httpd_can_network_connect 1 2>/dev/null || true
        log "SELinux: nginx→proxy разрешён"
    fi
fi

log "Системные пакеты установлены ($PYTHON)"

# ── 3. Firewall ───────────────────────────────────────────────
if command -v firewall-cmd &>/dev/null; then
    info "Открываю порты в firewalld..."
    firewall-cmd --permanent --add-service=http  &>/dev/null || true
    firewall-cmd --permanent --add-service=https &>/dev/null || true
    firewall-cmd --reload &>/dev/null || true
    log "Порты 80/443 открыты (firewalld)"
elif command -v ufw &>/dev/null; then
    info "Открываю порты в ufw..."
    ufw allow 80/tcp  &>/dev/null || true
    ufw allow 443/tcp &>/dev/null || true
    log "Порты 80/443 открыты (ufw)"
fi

# ── 4. Пользователь приложения ────────────────────────────────
if ! id "$APP_USER" &>/dev/null; then
    useradd --system --create-home --home-dir "$APP_DIR" --shell /bin/bash "$APP_USER"
    log "Создан пользователь $APP_USER"
else
    log "Пользователь $APP_USER уже существует"
fi

# ── 5. Клонирование репозитория ───────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
    info "Обновляю существующий репозиторий..."
    sudo -u "$APP_USER" git -C "$APP_DIR" pull
    log "Репозиторий обновлён"
else
    info "Клонирую репозиторий..."
    rm -rf "$APP_DIR"
    git clone "$REPO" "$APP_DIR"
    chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
    log "Репозиторий клонирован → $APP_DIR"
fi

# ── 6. Python venv + зависимости ─────────────────────────────
info "Создаю виртуальное окружение ($PYTHON)..."
sudo -u "$APP_USER" bash -c "
    cd '$APP_DIR'
    $PYTHON -m venv .venv
    .venv/bin/pip install --quiet --upgrade pip
    .venv/bin/pip install --quiet streamlit
    .venv/bin/pip install --quiet -r requirements.txt
"
log "Python зависимости установлены"

# ── 7. Настройка .env ─────────────────────────────────────────
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

# ── 8. Рабочие директории ─────────────────────────────────────
sudo -u "$APP_USER" mkdir -p "$APP_DIR/out" "$APP_DIR/db/chroma_db" "$APP_DIR/data"
log "Рабочие директории созданы"

# ── 9. Systemd service ────────────────────────────────────────
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

# ── 10. Nginx конфиг ──────────────────────────────────────────
info "Настраиваю nginx..."

NGINX_CONF_CONTENT=$(cat <<EOF
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
)

if [ "$PKG" = "apt" ]; then
    # Ubuntu/Debian: sites-available + symlink
    echo "$NGINX_CONF_CONTENT" > "/etc/nginx/sites-available/$DOMAIN"
    ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
    rm -f /etc/nginx/sites-enabled/default
else
    # AlmaLinux/CentOS: conf.d
    echo "$NGINX_CONF_CONTENT" > "/etc/nginx/conf.d/$DOMAIN.conf"
    # Убираем дефолтный конфиг если мешает
    [ -f /etc/nginx/conf.d/default.conf ] && mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak
fi

systemctl enable nginx
nginx -t && systemctl restart nginx
log "nginx настроен"

# ── 11. SSL (Let's Encrypt) ───────────────────────────────────
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
    log "SSL настроен. Авто-обновление включено."
else
    warn "SSL пропущен. Запустите позже: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# ── Итог ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║            SimpleTest успешно задеплоен!                ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  URL:        http://$DOMAIN                     ║"
echo "║  Приложение: $APP_DIR                       ║"
echo "║  .env:       $APP_DIR/.env                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Команды управления:                                     ║"
echo "║    journalctl -u $SERVICE -f   # логи в реальном вр.   ║"
echo "║    systemctl restart $SERVICE  # перезапуск             ║"
echo "║    systemctl status  $SERVICE  # статус                 ║"
echo "║    cd $APP_DIR && git pull     # обновление кода        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
