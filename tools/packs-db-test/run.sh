#!/usr/bin/env bash
# Testa open_pack / rollback_pack_opening num Postgres descartável (precisa de postgres 16 instalado).
# Uso: tools/packs-db-test/run.sh   (cria um cluster temporário, aplica schema + SQL do repo, roda os testes, apaga tudo)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; D="$(mktemp -d)"; chmod 755 "$D"
BIN=/usr/lib/postgresql/16/bin; PORT=5555
run() { if [ "$(id -u)" = 0 ]; then chown postgres "$D"; su postgres -c "$*"; else sh -c "$*"; fi; }
trap 'run "$BIN/pg_ctl -D $D/data stop -m immediate >/dev/null 2>&1" || true; rm -rf "$D"' EXIT
run "$BIN/initdb -D $D/data -A trust >/dev/null && $BIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
P="psql -h $D -p $PORT -U postgres -q -v ON_ERROR_STOP=1"
$P -f "$ROOT/tools/packs-db-test/schema.sql"
$P -f "$ROOT/supabase/PACKS-V1.sql" 2>&1 | grep -v NOTICE || true
$P -f "$ROOT/supabase/catalog-seeds/default.sql"
psql -h "$D" -p $PORT -U postgres -q -f "$ROOT/tools/packs-db-test/tests.sql" 2>&1 | grep -v NOTICE | tee "$D/out.txt"
if grep -q "FAIL" "$D/out.txt"; then echo "RESULTADO: FALHOU"; exit 1; else echo "RESULTADO: todos os testes passaram"; fi
