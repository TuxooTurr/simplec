#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8080}"
HOST="${HOST:-127.0.0.1}"
if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  PORT="$(python3 - <<'PY'
import socket,sys
s=socket.socket()
s.bind(('127.0.0.1',0))
sys.stdout.write(str(s.getsockname()[1]))
s.close()
PY
)"
fi
exec uvicorn simplec.web.app:app --host "$HOST" --port "$PORT" --reload
