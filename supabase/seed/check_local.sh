#!/usr/bin/env bash
# BANB-23 샘플 가계부 스크립트 로컬 확인 (Docker Postgres, 운영 DB 아님)
#   1) 소유자만 있는 상태(짝꿍 계정 없음)에서 2번 실행 → 샘플 1개, 멤버 = 소유자 1명, 기존 가계부 행 수 그대로
#   2) 짝꿍 계정이 가입해 있어도 실행 성공, 멤버는 여전히 소유자 1명
#   3) 소유자가 다른 가계부 5개면 SAMPLE_LEDGER_LIMIT 로 멈추고 아무것도 바뀌지 않음
# 실행: bash supabase/seed/check_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=banban-seed-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -q && break; sleep 1; done; sleep 1
run() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
fail() { echo "❌ $*"; exit 1; }
q() { run -At -c "$1"; }
run < supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do run < "$f"; done

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
SAMPLE="from public.ledger l where l.name = '샘플 가계부'"
run -o /dev/null <<SQL
insert into auth.users (id, email, raw_user_meta_data) values ('$A', 'kicmi032@gmail.com', '{"full_name":"맴맴"}');
-- 기존(실사용 흉내) 가계부: 지워지면 안 되는 데이터
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.create_ledger('우리집 가계부', '맴맴');
insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, created_by, updated_by)
select l.id, 'expense', 12345, c.id, p.id, m.id, m.id, m.id
from public.ledger l join public.member m on m.ledger_id = l.id
join public.category c on c.ledger_id = l.id and c.name = '외식'
join public.pocket p on p.ledger_id = l.id and p.name = '공동소비';
reset role;
SQL

counts() {
  run -At -F' ' <<'SQL'
select 'other_ledgers', count(*) from public.ledger where name <> '샘플 가계부'
union all select 'other_tx', count(*) from public.transaction t join public.ledger l on l.id = t.ledger_id where l.name <> '샘플 가계부'
union all select 'other_cat', count(*) from public.category t join public.ledger l on l.id = t.ledger_id where l.name <> '샘플 가계부'
union all select 'other_member', count(*) from public.member t join public.ledger l on l.id = t.ledger_id where l.name <> '샘플 가계부'
union all select 'other_asset', count(*) from public.asset t join public.ledger l on l.id = t.ledger_id where l.name <> '샘플 가계부'
union all select 'sample_ledgers', count(*) from public.ledger where name = '샘플 가계부'
union all select 'sample_members', count(*) from public.member m join public.ledger l on l.id = m.ledger_id where l.name = '샘플 가계부'
union all select 'sample_tx', count(*) from public.transaction t join public.ledger l on l.id = t.ledger_id where l.name = '샘플 가계부'
union all select 'sample_asset', count(*) from public.asset t join public.ledger l on l.id = t.ledger_id where l.name = '샘플 가계부';
SQL
}
check_sample() { # 멤버 = 소유자(owner) 1명, 모든 내역·개인 자산이 소유자 멤버
  [ "$(q "select count(*) $SAMPLE")" = 1 ] || fail "샘플이 1개가 아님"
  [ "$(q "select string_agg(m.user_id || ':' || m.role, ',') from public.member m join public.ledger l on l.id = m.ledger_id where l.name = '샘플 가계부'")" = "$A:owner" ] || fail "멤버가 소유자 1명이 아님"
  [ "$(q "select count(*) from public.transaction t join public.ledger l on l.id = t.ledger_id join public.member m on m.ledger_id = l.id where l.name = '샘플 가계부' and not (t.spender_id = m.id and t.created_by = m.id and t.updated_by = m.id)")" = 0 ] || fail "소유자가 아닌 작성자·사용한 사람"
  [ "$(q "select count(*) from public.asset a join public.ledger l on l.id = a.ledger_id join public.member m on m.ledger_id = l.id where l.name = '샘플 가계부' and a.owner_id is not null and a.owner_id <> m.id")" = 0 ] || fail "소유자가 아닌 자산 주인"
}

echo "▶ 실행 전"; BEFORE=$(counts | grep '^other'); echo "$BEFORE"
echo "▶ 1회차 (짝꿍 계정 없음)"; run < supabase/seed/sample_ledger.sql
echo "▶ 2회차 (다시 만들기)"; run < supabase/seed/sample_ledger.sql
echo "▶ 실행 후"; counts
[ "$BEFORE" = "$(counts | grep '^other')" ] || fail "기존 데이터가 바뀜"
check_sample

echo "▶ 짝꿍 계정이 가입해 있어도 멤버로 넣지 않음"
q "insert into auth.users (id, email) values ('$B', 'opiw0101@gmail.com')" >/dev/null
run < supabase/seed/sample_ledger.sql
check_sample
[ "$BEFORE" = "$(counts | grep '^other')" ] || fail "기존 데이터가 바뀜"

echo "▶ 월별 요약"
run <<'SQL'
select to_char(occurred_on, 'YYYY-MM') as month, type, count(*) as n, sum(amount) as total
from public.transaction t join public.ledger l on l.id = t.ledger_id where l.name = '샘플 가계부'
group by 1, 2 order by 1, 2;
select to_char(occurred_on, 'YYYY-MM') as month, p.scope, count(*) as n
from public.transaction t join public.ledger l on l.id = t.ledger_id join public.pocket p on p.id = t.pocket_id
where l.name = '샘플 가계부' and t.type = 'expense' group by 1, 2 order by 1, 2;
select a.name, kind, case when owner_id is null then '공동' else '개인' end as owner, balance, char_length(a.name) as len
from public.asset a join public.ledger l on l.id = a.ledger_id where l.name = '샘플 가계부';
select max(char_length(memo)) as max_memo, count(*) filter (where memo is null) as no_memo, count(*) filter (where memo is not null) as with_memo,
       max(amount) as max_amount, min(amount) as min_amount, count(*) filter (where is_fixed) as fixed, max(occurred_on) as last_day
from public.transaction t join public.ledger l on l.id = t.ledger_id where l.name = '샘플 가계부';
SQL

echo "▶ 상한 확인: 샘플을 지운 뒤 소유자가 다른 가계부 5개면 멈춤"
run -At -o /dev/null <<SQL
delete from public.ledger where name = '샘플 가계부';
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.create_ledger('a' || g, '맴맴') from generate_series(1, 4) g;
reset role;
SQL
[ "$(q "select count(*) from public.member where user_id = '$A' and left_at is null")" = 5 ] || fail "준비 실패: 소유자 가계부가 5개가 아님"
SNAP=$(counts)
if run < supabase/seed/sample_ledger.sql 2>err.txt; then rm -f err.txt; fail "상한인데 성공함"; fi
grep -q SAMPLE_LEDGER_LIMIT err.txt || { cat err.txt; rm -f err.txt; fail "다른 오류로 멈춤"; }
echo "  멈춤: $(grep -o 'SAMPLE_LEDGER_LIMIT.*' err.txt)"; rm -f err.txt
[ "$SNAP" = "$(counts)" ] || fail "실패했는데 데이터가 바뀜"
echo "✅ 샘플 가계부 스크립트 확인 끝"
