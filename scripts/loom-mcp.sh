#!/usr/bin/env bash
# Запуск MCP-сервера Loom из любого каталога — так его регистрирует GigaCode:
#   gigacode mcp add loom -e DROPUP_CONSOLE_URL=... -e SIMPLETEST_LOGIN=... \
#     -e SIMPLETEST_PASSWORD=... /полный/путь/к/simplec/scripts/loom-mcp.sh
# Аргументы пробрасываются: scripts/loom-mcp.sh --http  (HTTP на 127.0.0.1:8765/mcp)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
if [ -x "$REPO/.venv/bin/python" ]; then
  PY="$REPO/.venv/bin/python"
elif [ -n "${CONDA_PREFIX:-}" ] && [ -x "$CONDA_PREFIX/bin/python" ]; then
  PY="$CONDA_PREFIX/bin/python"
else
  PY="$(command -v python3)"
fi
exec "$PY" -m mcp_server "$@"
