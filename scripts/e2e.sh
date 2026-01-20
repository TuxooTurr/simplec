#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="$(python3 - <<'PY'
import socket,sys
s=socket.socket()
s.bind(('127.0.0.1',0))
sys.stdout.write(str(s.getsockname()[1]))
s.close()
PY
)"
uvicorn simplec.web.app:app --port "$PORT" --log-level warning & PID=$!
for i in $(seq 1 50); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/healthz" || true)
  [ "$CODE" = "200" ] && break
  sleep 0.2
done
curl -s "http://127.0.0.1:$PORT/api/health" >/dev/null
RES=$(curl -s -H "Content-Type: application/json" -d '{"platform":"W","feature":"AUTH","llm_provider":"mock","text":"API JSON smoke"}' "http://127.0.0.1:$PORT/api/generate" | python3 -c "import sys,json;print('ok' if 'out_dir' in json.load(sys.stdin) else 'fail')")
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
echo "$RES"
