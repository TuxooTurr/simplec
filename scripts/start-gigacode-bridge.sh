#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${SHARK_ENV_FILE:-}" ]]; then
    if [[ ! -r "$SHARK_ENV_FILE" ]]; then
        printf '%s\n' 'Не удалось открыть SHARK_ENV_FILE.' >&2
        exit 2
    fi
    set -a
    source "$SHARK_ENV_FILE"
    set +a
fi
: "${GIGACODE_BRIDGE_KEY:?Укажите отдельный ключ моста в закрытом SHARK_ENV_FILE}"
BRIDGE_PY="${GIGACODE_BRIDGE_PY:-${CONDA_PREFIX:+$CONDA_PREFIX/bin/python}}"
if [[ -z "$BRIDGE_PY" ]]; then
    BRIDGE_PY="$ROOT/.venv/bin/python"
fi
if [[ ! -x "$BRIDGE_PY" ]]; then
    printf '%s\n' 'Активируйте conda-окружение simpletest или укажите GIGACODE_BRIDGE_PY.' >&2
    exit 2
fi
exec "$BRIDGE_PY" "$ROOT/scripts/gigacode_bridge.py"
