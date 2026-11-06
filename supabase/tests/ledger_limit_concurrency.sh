#!/usr/bin/env bash
# BANB-17 동시 요청 검증 (로컬 Docker): 가계부 4개인 사용자가 만들기 2건 / 만들기+참여를 동시에 → 1건만 성공, 5개를 넘지 않음
# 실행: bash supabase/tests/ledger_limit_concurrency.sh  (기대: 각 경우 [s1] ok, [s2] ERROR: LEDGER_LIMIT_REACHED, active=5)
set -uo pipefail
NAME=banban-conc-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -q && break; sleep 1; done; sleep 1
run() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
run < supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do run < "$f"; done
run <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.create_ledger('a'||g, 'P') from generate_series(1,4) g;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.create_ledger('other', 'Q');
insert into public.invite (ledger_id) select id from public.ledger;
SQL
CODE=$(run -At -c "select code from public.invite where is_revoked = false")
s() { # $1 = sql call, $2 = delay before start
  sleep "$2"
  docker exec -i "$NAME" psql -U postgres -q -X -At <<SQL 2>&1 | grep -E 'LEDGER_LIMIT|ok' | sed "s/^/[$3] /"
begin;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'ok ' || ($1)::text;
select pg_sleep(2);
commit;
SQL
}
echo "== case 1: create + create"
s "public.create_ledger('x','P')" 0 s1 & s "public.create_ledger('y','P')" 0.5 s2 & wait
run -At -c "select 'active=' || count(*) from public.member where user_id='00000000-0000-0000-0000-000000000001' and left_at is null"
echo "== case 2: (4개로 되돌린 뒤) create + join"
run -q -c "delete from public.member where user_id='00000000-0000-0000-0000-000000000001' and ledger_id in (select id from public.ledger where name in ('x','y'))"
run -At -c "select 'active=' || count(*) from public.member where user_id='00000000-0000-0000-0000-000000000001' and left_at is null"
s "public.create_ledger('z','P')" 0 s1 & s "public.join_ledger('$CODE','P')" 0.5 s2 & wait
run -At -c "select 'active=' || count(*) from public.member where user_id='00000000-0000-0000-0000-000000000001' and left_at is null"
