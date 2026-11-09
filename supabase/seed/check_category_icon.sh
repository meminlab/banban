#!/usr/bin/env bash
# BANB-24 로컬 확인 (Docker Postgres, 운영 DB 아님)
#   기존 가계부가 있는 DB에 20261106170000 마이그레이션 적용 →
#   1) 기본 카테고리 70개(대분류 27 + 소분류 43)에 아이콘이 채워진다
#   2) 이름을 바꾼 기본 카테고리·직접 만든 카테고리는 비어 있다(앱이 대분류 아이콘/첫 글자로 그림)
#   3) 마이그레이션 후 새로 만든 가계부도 70개 모두 아이콘
#   4) check_applied.sql 의 category_icon = true
# 실행: bash supabase/seed/check_category_icon.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=banban-icon-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -q && break; sleep 1; done; sleep 1
run() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
fail() { echo "❌ $*"; exit 1; }
q() { run -At -c "$1"; }

run < supabase/tests/00_supabase_stub.sql
NEW=supabase/migrations/20261106170000_category_icon.sql
# 이 마이그레이션 이전 것만 먼저 적용 (뒤에 생긴 마이그레이션은 이 확인의 전제가 아니다)
for f in supabase/migrations/*.sql; do [[ "$f" < "$NEW" ]] && run < "$f"; done

A=00000000-0000-0000-0000-0000000000a5
echo "▶ 기존 가계부 2개(그중 하나는 이름 바꾼 기본 카테고리 + 직접 만든 카테고리)"
run -o /dev/null <<SQL
insert into auth.users (id, email) values ('$A', 'icon-a@example.com');
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.create_ledger('기존 1', 'A');
select public.create_ledger('기존 2', 'A');
update public.category set name = '밥값' where ledger_id = (select id from public.ledger where name = '기존 2') and name = '외식';
insert into public.category (ledger_id, type, parent_id, name, sort_order)
select ledger_id, 'expense', id, '술', 9 from public.category
 where ledger_id = (select id from public.ledger where name = '기존 2') and name = '식비' and parent_id is null;
reset role;
SQL
run < "$NEW"

L1="(select id from public.ledger where name = '기존 1')"
L2="(select id from public.ledger where name = '기존 2')"
[ "$(q "select count(*) from public.category where ledger_id = $L1 and icon is not null")" = 70 ] || fail "기존 1: 70개 모두 아이콘"
[ "$(q "select count(*) from public.category where ledger_id = $L1 and parent_id is null and icon is not null")" = 27 ] || fail "기존 1: 대분류 27"
echo "  기존 1: 대분류 27 + 소분류 43 = 70개 아이콘 ✓"
[ "$(q "select count(*) from public.category where ledger_id = $L2 and icon is null")" = 2 ] || fail "기존 2: 비어 있는 것 2개(밥값·술)"
[ "$(q "select string_agg(name, ',' order by name) from public.category where ledger_id = $L2 and icon is null")" = "밥값,술" ] || fail "기존 2: 비어 있는 이름"
echo "  기존 2: 이름 바꾼 '밥값'·직접 만든 '술'만 비어 있음 ✓"

echo "▶ 마이그레이션 후 새 가계부"
run -o /dev/null <<SQL
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.create_ledger('새 가계부', 'A');
reset role;
SQL
[ "$(q "select count(*) from public.category where ledger_id = (select id from public.ledger where name = '새 가계부') and icon is not null")" = 70 ] \
  || fail "새 가계부: 70개 모두 아이콘"
echo "  새 가계부: 70개 아이콘 ✓"
# 뒤에 생긴 마이그레이션까지 적용한 뒤 적용 확인 스크립트(최신 기준)를 돌린다
for f in supabase/migrations/*.sql; do [[ "$f" > "$NEW" ]] && run < "$f" >/dev/null 2>&1; done
echo "▶ check_applied.sql"
[ "$(run -A -F, < supabase/tests/check_applied.sql | head -11 | awk -F, -v col=category_icon 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == col) c = i; next } { print $c }' | sort -u)" = "t" ] || fail "check_applied category_icon"
echo "  category_icon = true (10행) ✓"
echo "✅ category icon check passed"
