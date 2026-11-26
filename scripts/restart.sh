#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${CONDA_PREFIX:-}" ]]; then
    PYTHON="$CONDA_PREFIX/bin/python"
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON="$ROOT/.venv/bin/python"
else
    PYTHON=python3
fi
exec "$PYTHON" "$ROOT/scripts/shark_runtime.py" "$@"
