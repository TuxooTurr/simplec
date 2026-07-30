#!/usr/bin/env bash
# Перенос провайдера OpenAI из локальной базы разработки на сервер.
#
# Зачем: ключ OpenAI был введён через интерфейс на локальной машине и лежит
# в simpletest.db. На сервере своя база, и туда он никогда не попадал —
# поэтому в продовых настройках провайдера нет.
#
# Ключ идёт напрямую отсюда на сервер по ssh. Он не попадает ни в argv
# (виден в ps всем пользователям), ни в вывод скрипта — только в stdin ssh.
#
# Запуск:  bash scripts/push_openai_provider.sh [id_провайдера]
#          по умолчанию custom_openai

set -euo pipefail

LOCAL_DB="${LOCAL_DB:-$(cd "$(dirname "$0")/.." && pwd)/simpletest.db}"
REMOTE_HOST="${REMOTE_HOST:-root@134.0.116.52}"
REMOTE_DB="${REMOTE_DB:-/opt/simpletest/simpletest.db}"
PROVIDER_ID="${1:-custom_openai}"

[ -f "$LOCAL_DB" ] || { echo "Нет локальной базы: $LOCAL_DB"; exit 1; }

echo "→ Читаю провайдера «$PROVIDER_ID» из локальной базы…"

# base64 — чтобы ключ можно было безопасно вложить в текст удалённого скрипта,
# не заботясь о кавычках и переводах строк.
PAYLOAD_B64=$(python3 - "$LOCAL_DB" "$PROVIDER_ID" <<'PY'
import base64, json, sqlite3, sys
db, pid = sys.argv[1], sys.argv[2]
row = sqlite3.connect(db).execute(
    "SELECT value FROM metrics_settings WHERE key='custom_llm_providers'"
).fetchone()
providers = json.loads(row[0]) if row and row[0] else []
found = next((p for p in providers if p.get("id") == pid), None)
if not found:
    sys.stderr.write("В локальной базе нет провайдера %s\n" % pid); sys.exit(1)
if not found.get("api_key"):
    sys.stderr.write("У провайдера %s не задан ключ\n" % pid); sys.exit(1)
sys.stderr.write("  найден: %s (%s), ключ задан\n" % (found.get("name"), found.get("base_url")))
print(base64.b64encode(json.dumps(found, ensure_ascii=False).encode()).decode())
PY
)

echo "→ Переношу на сервер и перезапускаю бэкенд…"

# Удалённый скрипт целиком уходит в stdin ssh. Программу на питоне кладём во
# временный файл, а полезную нагрузку подаём ей на stdin: иначе heredoc и пайп
# спорят за один и тот же stdin, и до питона ничего не доходит.
{
  cat <<EOS
set -euo pipefail
REMOTE_DB='$REMOTE_DB'
PAYLOAD_B64='$PAYLOAD_B64'
EOS
  cat <<'EOS'
TMP_PY=$(mktemp /tmp/push_provider.XXXXXX.py)
TMP_JSON=$(mktemp /tmp/push_provider.XXXXXX.json)
chmod 600 "$TMP_PY" "$TMP_JSON"
trap 'rm -f "$TMP_PY" "$TMP_JSON"' EXIT

printf '%s' "$PAYLOAD_B64" | base64 -d > "$TMP_JSON"

cat > "$TMP_PY" <<'PYEOF'
import json, sqlite3, sys
from datetime import datetime

db, payload_file = sys.argv[1], sys.argv[2]
with open(payload_file, encoding="utf-8") as f:
    incoming = json.load(f)

conn = sqlite3.connect(db)
row = conn.execute(
    "SELECT value FROM metrics_settings WHERE key='custom_llm_providers'"
).fetchone()
providers = json.loads(row[0]) if row and row[0] else []

# Тем же id заменяем, а не плодим дубли: повторный прогон обновит ключ.
providers = [p for p in providers if p.get("id") != incoming.get("id")]
providers.append(incoming)
raw = json.dumps(providers, ensure_ascii=False)
now = datetime.utcnow().isoformat()

if row:
    conn.execute(
        "UPDATE metrics_settings SET value=?, updated_at=? WHERE key='custom_llm_providers'",
        (raw, now),
    )
else:
    conn.execute(
        "INSERT INTO metrics_settings (key, value, updated_at) VALUES ('custom_llm_providers', ?, ?)",
        (raw, now),
    )
conn.commit()
print("  на сервере провайдеров: %d (%s)" % (
    len(providers), ", ".join(p.get("id", "?") for p in providers)))
PYEOF

# Файлы читает пользователь приложения — отдаём их ему.
chown simpletest "$TMP_PY" "$TMP_JSON"
sudo -u simpletest /opt/simpletest/.venv/bin/python "$TMP_PY" "$REMOTE_DB" "$TMP_JSON"

systemctl restart simpletest-api
sleep 4
echo "  simpletest-api: $(systemctl is-active simpletest-api)"
EOS
} | ssh "$REMOTE_HOST" bash -s

echo "✓ Готово. Проверь: Настройки → LLM Провайдеры → OpenAI → «Тест»."
