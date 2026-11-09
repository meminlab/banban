-- BANB-36 카테고리 간소화: 기본 20개(지출 12·수입 4·저축 4) 한 단계 + 기존 가계부 안 쓴 옛 카테고리 숨김
--
-- 구조는 그대로: 내역은 소분류에 저장한다. 기본 대분류마다 같은 이름 소분류 1개를 두고, 앱은 그 소분류를 화면에 따로 보이지 않는다
-- (대분류를 누르면 바로 그 소분류가 선택된다).
--
-- 1) 새 가계부 기본값(seed_ledger_defaults)을 20개로 바꾼다.
-- 2) 기존 가계부:
--    a. 새 기본 20개 중 그 가계부에 같은 (종류, 대분류 이름)이 없는 것을 추가한다(같은 이름 소분류 포함).
--    b. 같은 이름 소분류가 없는 대분류에 하나 만든다(예: 옛 "식비" → 소분류 "식비" 추가). 대분류 자체를 고르는 자리다.
--    c. 내역에 쓰이지 않은 "옛 기본 카테고리"(BANB-3 기본 70개와 이름이 같은 것)만 숨긴다. 삭제·통합·내역 변경은 하지 않는다.
--       - 대분류: 새 기본 이름이 아니고, 그 아래 소분류가 하나도 쓰이지 않았으면 숨김(소분류는 그대로 두어, 대분류를 다시 켜면 함께 돌아온다)
--       - 소분류: 보이는 대분류 아래에서 쓰이지 않았으면 숨김. 단, 새 기본 대분류의 같은 이름 소분류는 숨기지 않는다
--       - 사용자가 직접 만들었거나 이름을 바꾼 카테고리, 이미 숨긴 것은 건드리지 않는다(숨김 해제도 하지 않음)
--    d. 대분류 순서: 새 기본 20개를 기본 순서(1~12 / 1~4 / 1~4)로, 나머지 대분류는 그 뒤에 원래 순서대로.
--       같은 이름 소분류는 소분류 중 맨 앞(0).
-- 3) 권한 규칙(RLS)·테이블 구조 변경 없음.

-- ─────────────────────────────────────────────
-- 새 기본 목록 (이 이름·순서 그대로, 아이콘은 design.md 5.17 목록 안에서)
-- ─────────────────────────────────────────────
create or replace function public.default_categories_v2()
returns table (type text, name text, sort_order int, icon text)
language sql immutable
set search_path = ''
as $$
  select v.type, v.name, v.sort_order, v.icon from (values
    ('expense', '식비',        1, 'utensils-crossed'),
    ('expense', '카페·간식',   2, 'coffee'),
    ('expense', '생활·마트',   3, 'shopping-basket'),
    ('expense', '주거·관리비', 4, 'house'),
    ('expense', '통신·구독',   5, 'smartphone'),
    ('expense', '교통·차량',   6, 'car'),
    ('expense', '쇼핑·미용',   7, 'shopping-bag'),
    ('expense', '의료·건강',   8, 'heart-pulse'),
    ('expense', '문화·여행',   9, 'plane'),
    ('expense', '경조사·선물', 10, 'gift'),
    ('expense', '교육·육아',   11, 'graduation-cap'),
    ('expense', '기타',        12, 'ellipsis'),
    ('income',  '급여',        1, 'banknote'),
    ('income',  '부수입',      2, 'coins'),
    ('income',  '용돈',        3, 'hand-coins'),
    ('income',  '기타',        4, 'ellipsis'),
    ('saving',  '적금·예금',   1, 'piggy-bank'),
    ('saving',  '투자',        2, 'chart-line'),
    ('saving',  '비상금',      3, 'life-buoy'),
    ('saving',  '기타',        4, 'ellipsis')
  ) as v(type, name, sort_order, icon);
$$;

-- 새 가계부 기본 카테고리: 대분류 20 + 같은 이름 소분류 20
create or replace function public.seed_ledger_defaults(p_ledger_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  d record;
  v_parent_id uuid;
begin
  for d in select * from public.default_categories_v2() order by type, sort_order loop
    insert into public.category (ledger_id, type, parent_id, name, sort_order, icon)
    values (p_ledger_id, d.type, null, d.name, d.sort_order, d.icon)
    returning id into v_parent_id;
    insert into public.category (ledger_id, type, parent_id, name, sort_order, icon)
    values (p_ledger_id, d.type, v_parent_id, d.name, 0, d.icon);
  end loop;

  insert into public.pocket (ledger_id, name, scope, sort_order) values
    (p_ledger_id, '공동소비', 'shared', 1),
    (p_ledger_id, '개인용돈', 'personal', 2),
    (p_ledger_id, '여행', 'shared', 3),
    (p_ledger_id, '경조사비', 'shared', 4);
end;
$$;

revoke execute on function public.default_categories_v2() from public, anon, authenticated;
revoke execute on function public.seed_ledger_defaults(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 기존 가계부 정리 (한 번만, 다시 실행해도 결과가 같다)
-- ─────────────────────────────────────────────
do $$
declare
  v_added_parents int;
  v_added_children int;
  v_hidden_parents int;
  v_hidden_children int;
begin
  -- 옛 기본 카테고리 목록 (BANB-3 init 기본값 70개). 이 이름과 같은 것만 숨김 대상이다
  create temp table old_default (type text, parent text, child text) on commit drop;
  insert into old_default (type, parent, child)
  select x.type, x.parent, unnest(x.children)
  from (values
    ('expense', '식비',        array['장보기', '외식', '배달', '카페/간식']),
    ('expense', '주거',        array['월세', '관리비', '공과금']),
    ('expense', '통신',        array['휴대폰', '인터넷', '구독']),
    ('expense', '교통',        array['대중교통', '주유', '주차', '택시']),
    ('expense', '생활',        array['생필품', '가구/가전']),
    ('expense', '쇼핑',        array['의류', '미용']),
    ('expense', '건강',        array['병원', '약국', '운동']),
    ('expense', '문화·여가',   array['취미', '공연', '여행']),
    ('expense', '경조사·선물', array['경조사·선물']),
    ('expense', '교육',        array['교육']),
    ('expense', '보험',        array['보험']),
    ('expense', '반려동물',    array['반려동물']),
    ('expense', '육아',        array['육아']),
    ('expense', '대출이자',    array['대출이자']),
    ('expense', '기타',        array['기타']),
    ('income',  '급여',        array['급여']),
    ('income',  '상여',        array['상여']),
    ('income',  '부수입',      array['부수입']),
    ('income',  '용돈',        array['용돈']),
    ('income',  '이자·배당',   array['이자·배당']),
    ('income',  '기타',        array['기타']),
    ('saving',  '적금',        array['적금']),
    ('saving',  '예금',        array['예금']),
    ('saving',  '투자',        array['투자']),
    ('saving',  '청약',        array['청약']),
    ('saving',  '비상금',      array['비상금']),
    ('saving',  '기타',        array['기타'])
  ) as x(type, parent, children);

  -- c. 숨김 (추가보다 먼저: 새로 추가하는 기본 항목은 아직 안 쓰였으므로 대상에서 빠지게)
  --    내역에 쓰인 소분류
  create temp table used_child on commit drop as
    select distinct t.category_id as id from public.transaction t;

  -- 대분류: 옛 기본 이름, 새 기본 이름 아님, 보이는 상태, 그 아래 쓰인 소분류 없음
  update public.category p
     set is_hidden = true
   where p.parent_id is null
     and not p.is_hidden
     and exists (select 1 from old_default o where o.type = p.type and o.parent = p.name)
     and not exists (select 1 from public.default_categories_v2() d where d.type = p.type and d.name = p.name)
     and not exists (
       select 1 from public.category c join used_child u on u.id = c.id where c.parent_id = p.id
     );
  get diagnostics v_hidden_parents = row_count;

  -- 소분류: 보이는 대분류 아래, 옛 기본 (대분류, 소분류) 이름, 안 쓰임.
  --   새 기본 대분류의 같은 이름 소분류(경조사·선물, 기타, 급여 …)는 한 번에 고르는 자리라 남긴다
  update public.category c
     set is_hidden = true
    from public.category p
   where c.parent_id = p.id
     and not p.is_hidden
     and not c.is_hidden
     and exists (select 1 from old_default o where o.type = c.type and o.parent = p.name and o.child = c.name)
     and not exists (select 1 from used_child u where u.id = c.id)
     and not (
       c.name = p.name
       and exists (select 1 from public.default_categories_v2() d where d.type = p.type and d.name = p.name)
     );
  get diagnostics v_hidden_children = row_count;

  -- a. 없는 기본 대분류 추가 (같은 종류에 같은 이름 대분류가 있으면 숨김이어도 추가하지 않는다)
  insert into public.category (ledger_id, type, parent_id, name, sort_order, icon)
  select l.id, d.type, null, d.name, d.sort_order, d.icon
    from public.ledger l
   cross join public.default_categories_v2() d
   where not exists (
     select 1 from public.category p
      where p.ledger_id = l.id and p.type = d.type and p.parent_id is null and p.name = d.name
   );
  get diagnostics v_added_parents = row_count;

  -- b. 같은 이름 소분류가 없는 대분류에 하나 추가 (방금 추가한 대분류·옛 식비/주거 … 포함).
  --    = 두 번째 단계 맨 앞 "대분류 이름" 선택지(Q17). is_hidden 은 false: 화면은 이름으로 구분해 따로 보이지 않고,
  --    is_hidden 은 "사용자가 숨김"에만 쓴다(사용자가 전에 숨긴 것이 다시 나타나지 않게)
  insert into public.category (ledger_id, type, parent_id, name, sort_order, icon)
  select p.ledger_id, p.type, p.id, p.name, 0, p.icon
    from public.category p
   where p.parent_id is null
     and not exists (select 1 from public.category c where c.parent_id = p.id and c.name = p.name);
  get diagnostics v_added_children = row_count;

  -- d. 순서: 새 기본 대분류 → 그 밖의 대분류(원래 순서 유지)
  update public.category p
     set sort_order = d.sort_order
    from public.default_categories_v2() d
   where p.parent_id is null and d.type = p.type and d.name = p.name
     and p.sort_order <> d.sort_order;

  update public.category p
     set sort_order = 100 + r.rn
    from (
      select c.id, row_number() over (partition by c.ledger_id, c.type order by c.sort_order, c.created_at, c.id) as rn
        from public.category c
       where c.parent_id is null
         and not exists (select 1 from public.default_categories_v2() d where d.type = c.type and d.name = c.name)
    ) r
   where p.id = r.id;

  update public.category c
     set sort_order = 0
    from public.category p
   where c.parent_id = p.id and c.name = p.name and c.sort_order <> 0;

  raise notice 'BANB-36: 대분류 추가 %, 같은 이름 소분류 추가 %, 대분류 숨김 %, 소분류 숨김 %',
    v_added_parents, v_added_children, v_hidden_parents, v_hidden_children;
end $$;
