#!/usr/bin/env bash
# BANB-44 동시 확인 검증 (로컬 Docker): 두 멤버(두 기기)가 같은 정기 내역의 같은 회차를 동시에 "기록하기"
#   case 1: 기록 + 기록   → 한쪽만 applied=true, 내역 1건
#   case 2: 기록 + 건너뛰기 → 먼저 들어간 쪽만 반영, 내역은 0건 또는 1건이고 회차 1행
# 실행: bash supabase/tests/recurring_concurrency.sh  (기대: 각 case 에서 applied true 1개 / false 1개, rows=1, tx 가 회차 상태와 맞음)
set -uo pipefail
NAME=banban-rconc-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -q && break; sleep 1; done; sleep 1
run() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
run < supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do run < "$f" >/dev/null; done
run <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.create_ledger('conc', 'P');
insert into public.invite (ledger_id) select id from public.ledger;
SQL
CODE=$(run -At -c "select code from public.invite where is_revoked = false")
run <<SQL
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.join_ledger('$CODE', 'Q');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, memo, cycle, weekday, start_on, created_by, updated_by)
select l.id, 'expense', 10000, c.id, p.id, m.id, '동시', 'weekly', extract(dow from (now() at time zone 'Asia/Seoul')::date)::int,
       (now() at time zone 'Asia/Seoul')::date - 7, m.id, m.id
from public.ledger l
join public.member m on m.ledger_id = l.id and m.display_name = 'P'
join lateral (select id from public.category where ledger_id = l.id and type = 'expense' and parent_id is not null order by sort_order limit 1) c on true
join lateral (select id from public.pocket where ledger_id = l.id order by sort_order limit 1) p on true;
SQL
LEDGER=$(run -At -c "select id from public.ledger")
REC=$(run -At -c "select id from public.recurring_transaction")
s() { # $1 = user suffix, $2 = occurs_on expr, $3 = record, $4 = delay, $5 = label
  sleep "$4"
  docker exec -i "$NAME" psql -U postgres -q -X -At <<SQL 2>&1 | sed "s/^/[$5] /"
begin;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000$1';
select e->>'status' || ' applied=' || (e->>'applied')
  from jsonb_array_elements(public.record_recurring('$LEDGER',
    jsonb_build_array(jsonb_build_object('recurring_id', '$REC', 'occurs_on', $2, 'record', $3)))) e;
select pg_sleep(2);
commit;
SQL
}
TODAY="(now() at time zone 'Asia/Seoul')::date"
echo "== case 1: 기록 + 기록 (오늘)"
s 1 "$TODAY" true 0 A & s 2 "$TODAY" true 0.5 B & wait
run -At -c "select 'rows=' || count(*) || ' tx=' || (select count(*) from public.transaction where source = 'recurring' and occurred_on = $TODAY) from public.recurring_occurrence where occurs_on = $TODAY"
echo "== case 2: 기록 + 건너뛰기 (지난주)"
s 1 "$TODAY - 7" true 0 A & s 2 "$TODAY - 7" false 0.5 B & wait
run -At -c "select 'rows=' || count(*) || ' status=' || min(status) || ' tx=' || (select count(*) from public.transaction where source = 'recurring' and occurred_on = $TODAY - 7) from public.recurring_occurrence where occurs_on = $TODAY - 7"
