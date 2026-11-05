#!/usr/bin/env bash
# 스키마·권한 규칙 검증: Docker Postgres에 stub + 마이그레이션 + 테스트를 차례로 실행
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=banban-dbtest-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres -q && break
  sleep 1
done
sleep 1
run() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
run < supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "▶ migrate $f"; run < "$f"; done
echo "▶ tests"
run -o /dev/null < supabase/tests/10_rls_test.sql
echo "✅ DB tests passed"
