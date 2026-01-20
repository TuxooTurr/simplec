#!/usr/bin/env bash
set -euo pipefail

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

export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

command -v psql >/dev/null 2>&1 || { echo "psql не найден."; exit 1; }

echo "Server/version:"
psql -X -Atc "SELECT version();" || true

echo -e "\nTables:"
psql -X -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;"

echo -e "\nCounts:"
psql -X -Atc "SELECT 'test_case' AS t, COUNT(*) FROM test_case
UNION ALL SELECT 'test_data', COUNT(*) FROM test_data
UNION ALL SELECT 'test_case_data', COUNT(*) FROM test_case_data;"

echo -e "\nSample join (first 5):"
psql -X -AtF $'\t' -c "
SELECT tc.key AS case_key, td.key AS data_key, tcd.role, COALESCE(tcd.version_pin, td.version) AS ver
FROM test_case_data tcd
JOIN test_case tc ON tc.id = tcd.test_case_id
JOIN test_data td ON td.id = tcd.test_data_id
ORDER BY tc.key, td.key, tcd.role
LIMIT 5;"
