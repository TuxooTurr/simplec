#!/usr/bin/env bash
set -euo pipefail

# Загрузка .env при наличии
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${PGDATABASE:=simplec}"

SCHEMA_FILE="${SCHEMA_FILE:-simplec/storage/schema_pg.sql}"
SEED_FILE="${SEED_FILE:-}"

export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

command -v psql >/dev/null 2>&1 || { echo "psql не найден. Установите PostgreSQL client."; exit 1; }

echo "[simplec] Проверяем наличие БД: $PGDATABASE"
EXISTS=$(psql -X -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PGDATABASE}'")
if [ "$EXISTS" != "1" ]; then
  echo "[simplec] Создаём базу ${PGDATABASE}"
  psql -X -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${PGDATABASE};"
else
  echo "[simplec] База уже существует"
fi

echo "[simplec] Применяем схему: ${SCHEMA_FILE}"
psql -X -v ON_ERROR_STOP=1 -d "${PGDATABASE}" -f "${SCHEMA_FILE}"

if [ -n "${SEED_FILE}" ] && [ -f "${SEED_FILE}" ]; then
  echo "[simplec] Наполняем сид-данными: ${SEED_FILE}"
  psql -X -v ON_ERROR_STOP=1 -d "${PGDATABASE}" -f "${SEED_FILE}"
fi

echo "[simplec] Готово."
