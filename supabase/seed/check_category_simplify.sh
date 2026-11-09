#!/usr/bin/env bash
# BANB-36 로컬 확인 (Docker Postgres, 운영 DB 아님)
#   옛 기본값(70개)으로 만든 가계부 2개에 내역을 넣고 20261109000000 마이그레이션 적용 →
#   1) 적용 전/후 category_simplify_snapshot.sql 결과가 같다(월·종류·대분류별 합계, 쓰인 카테고리 이름·숨김)
#   2) 쓰인 것 유지 · 안 쓰인 옛 기본값만 숨김 · 사용자가 만든·이름 바꾼 것 유지 · 사용자가 숨긴 것 숨김 유지
#   3) 없는 기본 대분류 추가, 모든 대분류에 같은 이름 소분류, 기본 20개가 기본 순서로 맨 앞
#   4) 다시 실행해도 바뀌는 것 없음, 새 가계부는 40개(대분류 20 + 같은 이름 소분류 20)
#   5) check_applied.sql 의 category_simplify = true
# 실행: bash supabase/seed/check_category_simplify.sh   (적용 전/후 조회 결과를 out/ 에 남긴다)
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=banban-simplify-$$
OUT=supabase/seed/out
mkdir -p "$OUT"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -q && break; sleep 1; done; sleep 1
run() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
fail() { echo "❌ $*"; exit 1; }
q() { run -At -c "$1"; }

run < supabase/tests/00_supabase_stub.sql
NEW=supabase/migrations/20261109000000_category_simplify.sql
# 이 마이그레이션 이전 것만 먼저 적용 (뒤에 생긴 마이그레이션은 이 확인의 전제가 아니다)
for f in supabase/migrations/*.sql; do [[ "$f" < "$NEW" ]] && run < "$f"; done

A=00000000-0000-0000-0000-0000000036a1
echo "▶ 옛 기본값 가계부 2개: '기존 1'(내역·직접 만든 것·이름 바꾼 것·숨긴 것), '기존 2'(내역 없음)"
run -o /dev/null <<SQL
insert into auth.users (id, email) values ('$A', 'simplify-a@example.com');
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.create_ledger('기존 1', 'A');
select public.create_ledger('기존 2', 'A');
reset role;

create temp view l1 as select id from public.ledger where name = '기존 1';
-- 직접 만든 대분류(안 씀) + 식비 아래 직접 만든 소분류(안 씀)
insert into public.category (ledger_id, type, parent_id, name, sort_order) select id, 'expense', null, '술값', 16 from l1;
insert into public.category (ledger_id, type, parent_id, name, sort_order)
  select ledger_id, 'expense', id, '술값', 1 from public.category where name = '술값' and parent_id is null;
insert into public.category (ledger_id, type, parent_id, name, sort_order)
  select ledger_id, 'expense', id, '야식', 9 from public.category where ledger_id = (select id from l1) and name = '식비' and parent_id is null;
-- 이름 바꾼 옛 기본값(안 씀), 사용자가 숨긴 옛 기본값(새 기본 이름: 용돈), 사용자가 숨긴 쓰인 소분류(배달)
update public.category set name = '배당금' where ledger_id = (select id from l1) and type = 'income' and name = '이자·배당';
update public.category set is_hidden = true where ledger_id = (select id from l1) and type = 'income' and name = '용돈' and parent_id is null;

-- 내역: 지난달·이번 달, 옛 기본 소분류 여러 곳
create temp table plan (d date, type text, parent text, child text, amount bigint);
insert into plan values
  (date_trunc('month', current_date - interval '1 month')::date + 2,  'expense', '식비', '외식',   32000),
  (date_trunc('month', current_date - interval '1 month')::date + 3,  'expense', '식비', '배달',   21000),
  (date_trunc('month', current_date - interval '1 month')::date + 4,  'expense', '주거', '관리비', 180000),
  (date_trunc('month', current_date - interval '1 month')::date + 5,  'expense', '보험', '보험',   112000),
  (date_trunc('month', current_date - interval '1 month')::date + 6,  'expense', '경조사·선물', '경조사·선물', 100000),
  (date_trunc('month', current_date - interval '1 month')::date + 9,  'income',  '급여', '급여',   3850000),
  (date_trunc('month', current_date - interval '1 month')::date + 9,  'income',  '상여', '상여',   500000),
  (date_trunc('month', current_date - interval '1 month')::date + 10, 'saving',  '적금', '적금',   500000),
  (date_trunc('month', current_date)::date,                           'expense', '식비', '외식',   15000),
  (date_trunc('month', current_date)::date,                           'expense', '교통', '택시',   12000);
insert into public.transaction (ledger_id, type, amount, occurred_on, category_id, pocket_id, spender_id, is_fixed, memo, created_by, updated_by)
select l.id, p.type, p.amount, p.d, c.id,
       case when p.type = 'expense' then (select id from public.pocket where ledger_id = l.id and name = '공동소비') end,
       m.id, false, null, m.id, m.id
  from plan p cross join l1 l
  join public.member m on m.ledger_id = l.id
  join public.category par on par.ledger_id = l.id and par.type = p.type and par.parent_id is null and par.name = p.parent
  join public.category c on c.parent_id = par.id and c.name = p.child;
update public.category set is_hidden = true where ledger_id = (select id from l1) and name = '배달';
SQL
[ "$(q "select count(*) from public.transaction")" = 10 ] || fail "내역 10건 준비"

run -At -F'|' < supabase/seed/category_simplify_snapshot.sql > "$OUT/category_simplify_before.txt"
echo "▶ 마이그레이션 적용"
run < "$NEW" 2>&1 | sed 's/^/  /'
run -At -F'|' < supabase/seed/category_simplify_snapshot.sql > "$OUT/category_simplify_after.txt"

echo "▶ 1) 적용 전/후 조회 결과"
diff "$OUT/category_simplify_before.txt" "$OUT/category_simplify_after.txt" || fail "적용 전/후 결과가 다르다"
echo "  같음 ✓ ($(wc -l < "$OUT/category_simplify_before.txt" | tr -d ' ')행, $OUT/category_simplify_before.txt)"

L1="(select id from public.ledger where name = '기존 1')"
L2="(select id from public.ledger where name = '기존 2')"
vis() { # 가계부, 종류 → 보이는 대분류 이름(순서대로)
  q "select string_agg(name, ',' order by sort_order, created_at) from public.category where ledger_id = $1 and type = '$2' and parent_id is null and not is_hidden"
}
children() { # 가계부, 종류, 대분류 → 보이는 소분류(순서대로)
  q "select string_agg(c.name, ',' order by c.sort_order, c.created_at) from public.category c join public.category p on p.id = c.parent_id
      where c.ledger_id = $1 and p.type = '$2' and p.name = '$3' and p.parent_id is null and not c.is_hidden"
}

echo "▶ 2) 기존 1: 쓰인 것 유지 · 안 쓴 옛 기본값만 숨김"
E1="식비,카페·간식,생활·마트,주거·관리비,통신·구독,교통·차량,쇼핑·미용,의료·건강,문화·여행,경조사·선물,교육·육아,기타,주거,교통,보험,술값"
[ "$(vis "$L1" expense)" = "$E1" ] || fail "기존 1 지출 대분류: $(vis "$L1" expense)"
[ "$(vis "$L1" income)" = "급여,부수입,기타,상여,배당금" ] || fail "기존 1 수입 대분류(용돈은 사용자가 숨김 유지): $(vis "$L1" income)"
[ "$(vis "$L1" saving)" = "적금·예금,투자,비상금,기타,적금" ] || fail "기존 1 저축 대분류: $(vis "$L1" saving)"
[ "$(children "$L1" expense 식비)" = "식비,외식,야식" ] || fail "기존 1 식비 소분류(장보기·카페/간식 숨김, 배달은 사용자가 숨김): $(children "$L1" expense 식비)"
[ "$(children "$L1" expense 주거)" = "주거,관리비" ] || fail "기존 1 주거 소분류: $(children "$L1" expense 주거)"
[ "$(children "$L1" expense 교통)" = "교통,택시" ] || fail "기존 1 교통 소분류: $(children "$L1" expense 교통)"
[ "$(children "$L1" expense 술값)" = "술값" ] || fail "기존 1 직접 만든 대분류"
# 숨긴 대분류의 소분류는 그대로(대분류를 다시 켜면 함께 돌아온다)
[ "$(children "$L1" expense 건강)" = "건강,병원,약국,운동" ] || fail "기존 1 숨긴 대분류의 소분류: $(children "$L1" expense 건강)"
[ "$(q "select is_hidden from public.category where ledger_id = $L1 and name = '건강' and parent_id is null")" = t ] || fail "건강 숨김"
echo "  지출 $E1 ✓"
echo "  수입·저축, 식비 > 식비·외식·야식, 숨긴 대분류 소분류 보존 ✓"

echo "▶ 3) 기존 2(내역 없음): 새 기본 20개만 보임"
[ "$(vis "$L2" expense)" = "식비,카페·간식,생활·마트,주거·관리비,통신·구독,교통·차량,쇼핑·미용,의료·건강,문화·여행,경조사·선물,교육·육아,기타" ] || fail "기존 2 지출: $(vis "$L2" expense)"
[ "$(vis "$L2" income)" = "급여,부수입,용돈,기타" ] || fail "기존 2 수입: $(vis "$L2" income)"
[ "$(vis "$L2" saving)" = "적금·예금,투자,비상금,기타" ] || fail "기존 2 저축: $(vis "$L2" saving)"
[ "$(children "$L2" expense 식비)" = "식비" ] || fail "기존 2 식비 소분류: $(children "$L2" expense 식비)"
[ "$(q "select count(*) from public.category p where p.parent_id is null and not exists (select 1 from public.category c where c.parent_id = p.id and c.name = p.name)")" = 0 ] \
  || fail "모든 대분류에 같은 이름 소분류"
[ "$(q "select count(*) from public.category where name = '카페·간식' and parent_id is null and icon = 'coffee'")" = 2 ] || fail "추가한 기본 대분류 아이콘"
echo "  지출 12 · 수입 4 · 저축 4, 같은 이름 소분류 ✓"

echo "▶ 4) 다시 실행 · 새 가계부"
before=$(q "select md5(string_agg(id::text || name || is_hidden || sort_order, ',' order by id)) from public.category")
run < "$NEW" 2>&1 | grep -q "대분류 추가 0, 같은 이름 소분류 추가 0, 대분류 숨김 0, 소분류 숨김 0" || fail "다시 실행 시 변경 0"
[ "$(q "select md5(string_agg(id::text || name || is_hidden || sort_order, ',' order by id)) from public.category")" = "$before" ] || fail "다시 실행 후 카테고리 변화"
run -o /dev/null <<SQL
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.create_ledger('새 가계부', 'A');
reset role;
SQL
LN="(select id from public.ledger where name = '새 가계부')"
[ "$(q "select count(*) from public.category where ledger_id = $LN")" = 40 ] || fail "새 가계부 40개"
[ "$(q "select count(*) from public.category where ledger_id = $LN and not is_hidden and icon is not null")" = 40 ] || fail "새 가계부 모두 보임·아이콘"
echo "  다시 실행 변경 0, 새 가계부 40개 ✓"

echo "▶ 5) check_applied.sql"
[ "$(run -A -F, < supabase/tests/check_applied.sql | head -11 | awk -F, -v col=category_simplify 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == col) c = i; next } { print $c }' | sort -u)" = "t" ] || fail "check_applied category_simplify"
echo "  category_simplify = true (10행) ✓"
echo "✅ category simplify check passed"
