#!/bin/bash
# Собирает CA bundle = certifi + корпоративные сертификаты из macOS Keychain
#
# Запускать при:
#   - первой установке в корпоративной сети (Сбер BIG IP proxy)
#   - обновлении пакета certifi
#   - смене корпоративных сертификатов
#
# После сборки bundle автоматически подхватится при следующем запуске backend.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="$SCRIPT_DIR/ca-bundle.pem"

# Базовый certifi bundle
PYTHON="${PYTHON:-python3}"
CERTIFI_PEM=$("$PYTHON" -c "import certifi; print(certifi.where())" 2>/dev/null) || {
    echo "❌ certifi не найден. Убедитесь что .venv активирован или certifi установлен."
    exit 1
}

cp "$CERTIFI_PEM" "$OUTPUT"
echo "→ Базовый certifi: $CERTIFI_PEM"

# Корпоративные CA из System Keychain (только macOS)
if command -v security &>/dev/null; then
    ADDED=0
    for pattern in "Sber" "Russian Trusted" "BIG IP"; do
        CERT=$(security find-certificate -a -c "$pattern" -p /Library/Keychains/System.keychain 2>/dev/null || true)
        if [ -n "$CERT" ]; then
            echo "$CERT" >> "$OUTPUT"
            COUNT=$(echo "$CERT" | grep -c "BEGIN CERTIFICATE" || true)
            echo "→ Добавлено '$pattern': $COUNT сертификат(ов)"
            ADDED=$((ADDED + COUNT))
        fi
    done
    if [ "$ADDED" -eq 0 ]; then
        echo "⚠  Корпоративные CA не найдены в Keychain — bundle содержит только certifi."
        echo "   Если вы в корпоративной сети, убедитесь что CA установлены в System Keychain."
    fi
else
    echo "⚠  macOS security не найден — пропускаю корпоративные CA (не macOS?)."
fi

TOTAL=$(grep -c "BEGIN CERTIFICATE" "$OUTPUT")
echo ""
echo "✅ Bundle собран: $OUTPUT ($TOTAL сертификатов)"
echo "   Перезапустите backend чтобы применить."
