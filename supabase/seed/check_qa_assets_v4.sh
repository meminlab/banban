#!/usr/bin/env bash
# BANB-25 로컬 확인 (Docker Postgres, 운영 DB 아님)
#   1) 기존 자산이 있는 DB에 20261106160000 마이그레이션 적용 → 자산마다 이력 1행(현재 잔액, 바꾼 사람 없음) (QA AS-22)
#   2) check_applied.sql 의 asset_net_worth = true
#   3) qa_assets_v4.sql: 설정 없이 실행하면 QA_SEED_NOT_ALLOWED 로 멈춤
#   4) qa_assets_v4.sql 2번 실행 → QA v4 기대값(월말·현재 순자산, 사람별)과 SQL 계산이 일치
# 실행: bash supabase/seed/check_qa_assets_v4.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=banban-qa4-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -q && break; sleep 1; done; sleep 1
run() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
fail() { echo "❌ $*"; exit 1; }
q() { run -At -c "$1"; }

run < supabase/tests/00_supabase_stub.sql
NEW=supabase/migrations/20261106160000_asset_net_worth.sql
for f in supabase/migrations/*.sql; do [ "$f" = "$NEW" ] || run < "$f"; done

A=00000000-0000-0000-0000-0000000000a4
B=00000000-0000-0000-0000-0000000000b4
C=00000000-0000-0000-0000-0000000000c4
echo "▶ 1. 기존 자산이 있는 상태에서 마이그레이션"
run -o /dev/null <<SQL
insert into auth.users (id, email) values ('$A', 'qa-a@example.com'), ('$B', 'qa-b@example.com'), ('$C', 'qa-c@example.com');
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.create_ledger('기존 가계부', 'A');
insert into public.asset (ledger_id, name, kind, balance) select id, '기존 통장', 'checking', 1234567 from public.ledger;
insert into public.asset (ledger_id, name, kind, balance) select id, '기존 현금', 'cash', 0 from public.ledger;
reset role;
SQL
run < "$NEW"
[ "$(q "select count(*) from public.asset_balance_history h join public.asset a on a.id = h.asset_id where h.balance = a.balance and h.changed_by is null")" = 2 ] \
  || fail "기존 자산 이력 채우기"
[ "$(q "select count(*) from public.asset_balance_history")" = 2 ] || fail "이력 행 수"
echo "  기존 자산 2개 → 이력 2행 ✓"

echo "▶ 2. check_applied.sql"
run -At -F'|' < supabase/tests/check_applied.sql | head -12
[ "$(run -At -F'|' < supabase/tests/check_applied.sql | head -10 | awk -F'|' '$NF != "t"' | wc -l | tr -d ' ')" = 0 ] || fail "asset_net_worth false"
[ "$(run -At -F'|' < supabase/tests/check_applied.sql | head -10 | wc -l | tr -d ' ')" = 10 ] || fail "check_applied 10행 아님"
echo "  10행 모두 asset_net_worth = t ✓"

echo "▶ 3. 설정 없이 시드 → 거부"
if run < supabase/seed/qa_assets_v4.sql >/dev/null 2>&1; then fail "설정 없이 실행됨"; fi
[ "$(q "select count(*) from public.ledger where name like 'QA 자산 v4%'")" = 0 ] || fail "거부됐는데 데이터가 생김"
echo "  QA_SEED_NOT_ALLOWED ✓"

echo "▶ 4. 시드 2번 실행"
seed() { docker exec -i -e PGOPTIONS='-c banban.qa_seed=test-db-only' "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X; }
seed < supabase/seed/qa_assets_v4.sql >/dev/null
seed < supabase/seed/qa_assets_v4.sql
[ "$(q "select count(*) from public.ledger where name like 'QA 자산 v4%'")" = 2 ] || fail "QA 가계부가 2개가 아님"
[ "$(q "select count(*) from public.ledger where name = '기존 가계부'")" = 1 ] || fail "기존 가계부가 바뀜"

# 월말(=다음 달 1일 00:00 KST 직전) 순자산을 SQL로 계산: 그 시점에 이력이 있고 보관 전인 항목의 마지막 이력 잔액
NW=$(cat <<'SQL'
create or replace function pg_temp.nw(p_owner text, p_at timestamptz) returns bigint language sql as $$
  select coalesce(sum(case when a.kind in ('loan', 'card_payable', 'other_liability') then -v.balance else v.balance end), 0)
  from public.asset a
  join public.ledger l on l.id = a.ledger_id and l.name = 'QA 자산 v4'
  left join public.member m on m.id = a.owner_id
  cross join lateral (select h.balance from public.asset_balance_history h
                      where h.asset_id = a.id and h.changed_at < p_at order by h.changed_at desc, h.id desc limit 1) v
  where (a.archived_at is null or a.archived_at >= p_at)
    and (p_owner = 'all' or coalesce(m.display_name, '공동') = p_owner)
$$;
create or replace function pg_temp.cur(p_owner text) returns bigint language sql as $$
  select coalesce(sum(case when a.kind in ('loan', 'card_payable', 'other_liability') then -a.balance else a.balance end), 0)
  from public.asset a
  join public.ledger l on l.id = a.ledger_id and l.name = 'QA 자산 v4'
  left join public.member m on m.id = a.owner_id
  where a.archived_at is null and (p_owner = 'all' or coalesce(m.display_name, '공동') = p_owner)
$$;
select o, pg_temp.nw(o, '2026-10-01 00:00+09'), pg_temp.nw(o, '2026-11-01 00:00+09'), pg_temp.cur(o)
from unnest(array['all', 'A', 'B', '공동']) o;
SQL
)
GOT=$(echo "$NW" | run -At -F' ')
echo "$GOT"
EXPECTED="all 128000000 127000000 108700000
A 3000000 1000000 1700000
B 25000000 26000000 6000000
공동 100000000 100000000 101000000"
[ "$GOT" = "$EXPECTED" ] || fail "QA v4 기대값과 다름"
echo "✅ QA v4 기준 데이터: 9월 말·10월 말·현재 순자산(합친·A·B·공동) 모두 기대값과 일치"
