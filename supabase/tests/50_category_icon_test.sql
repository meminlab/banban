-- BANB-24 카테고리 아이콘: 기본값 아이콘 · 형식 검사 · 멤버 수정 권한
-- 10_rls_test.sql 과 같이 한 트랜잭션으로 실행하고 마지막에 ROLLBACK (운영 SQL Editor에서도 실행 가능)
-- 사용자: A(L1 소유자), X(외부인)
begin;

create schema test;
grant usage on schema test to anon, authenticated;

create function test.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" BUT SUCCEEDED: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' or sqlerrm not like '%' || p_pattern || '%' then
    raise exception 'TEST FAILED: % -> got "%"', p_sql, sqlerrm;
  end if;
end $$;

create function test.expect_count(p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  if v <> p_expected then
    raise exception 'TEST FAILED: % -> expected % rows, got %', p_sql, p_expected, v;
  end if;
end $$;

create function test.expect_affected(p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  if v <> p_expected then
    raise exception 'TEST FAILED: % -> expected % affected, got %', p_sql, p_expected, v;
  end if;
end $$;

grant execute on all functions in schema test to anon, authenticated;
create table test.ctx (key text primary key, val uuid);
grant all on test.ctx to authenticated;
create function test.id(p_key text) returns uuid language sql stable as $$
  select val from test.ctx where key = p_key $$;
grant execute on function test.id(text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'a@icon.test'),
  ('00000000-0000-0000-0000-0000000005f1', 'x@icon.test');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000005a1';
insert into test.ctx values ('l1', public.create_ledger('아이콘 L1', 'A'));

-- ── 1. 새 가계부 기본 카테고리 70개(대분류 27 + 소분류 43) 모두 아이콘이 있다
select test.expect_count($$select * from public.category where ledger_id = test.id('l1') and parent_id is null and icon is not null$$, 27);
select test.expect_count($$select * from public.category where ledger_id = test.id('l1') and parent_id is not null and icon is not null$$, 43);
-- 매핑 표본 (design.md 4.1)
select test.expect_count($$select * from public.category where ledger_id = test.id('l1') and parent_id is null and name = '식비' and icon = 'utensils-crossed'$$, 1);
select test.expect_count($$select c.* from public.category c join public.category p on p.id = c.parent_id
  where c.ledger_id = test.id('l1') and p.name = '교통' and c.name = '택시' and c.icon = 'car-taxi-front'$$, 1);
select test.expect_count($$select c.* from public.category c join public.category p on p.id = c.parent_id
  where c.ledger_id = test.id('l1') and c.type = 'saving' and p.name = '청약' and c.name = '청약' and c.icon = 'building-complex'$$, 1);
select test.expect_count($$select * from public.category where ledger_id = test.id('l1') and name = '기타' and icon = 'ellipsis'$$, 6);
-- 대분류·소분류 아이콘 종류 수 (겹치는 것 빼고 48종: 대분류 25 + 소분류 24 − smartphone)
select test.expect_count($$select distinct icon from public.category where ledger_id = test.id('l1')$$, 48);

-- ── 2. 멤버는 아이콘을 바꾸고 지울 수 있다, 새로 만드는 카테고리는 아이콘 없이도 된다
select test.expect_affected($$update public.category set icon = 'dog' where ledger_id = test.id('l1') and name = '반려동물' and parent_id is not null$$, 1);
select test.expect_affected($$update public.category set icon = null where ledger_id = test.id('l1') and name = '육아' and parent_id is not null$$, 1);
insert into public.category (ledger_id, type, parent_id, name, sort_order)
values (test.id('l1'), 'expense', null, '직접 만든 대분류', 99);
insert into public.category (ledger_id, type, parent_id, name, sort_order, icon)
select test.id('l1'), 'expense', id, '강아지 미용', 1, 'scissors' from public.category
 where ledger_id = test.id('l1') and parent_id is null and name = '반려동물';
select test.expect_count($$select * from public.category where ledger_id = test.id('l1') and name = '직접 만든 대분류' and icon is null$$, 1);

-- ── 3. 형식 검사: kebab-case 소문자·숫자, 40자 이하만
select test.expect_error($$update public.category set icon = 'Utensils' where ledger_id = test.id('l1') and name = '외식'$$, 'check constraint');
select test.expect_error($$update public.category set icon = 'utensils crossed' where ledger_id = test.id('l1') and name = '외식'$$, 'check constraint');
select test.expect_error($$update public.category set icon = '' where ledger_id = test.id('l1') and name = '외식'$$, 'check constraint');
select test.expect_error($$update public.category set icon = repeat('a', 41) where ledger_id = test.id('l1') and name = '외식'$$, 'check constraint');
-- 목록 밖이어도 형식만 맞으면 저장된다(앱이 대신 그림)
select test.expect_affected($$update public.category set icon = 'rocket' where ledger_id = test.id('l1') and name = '외식'$$, 1);

-- ── 4. 외부인은 다른 가계부 아이콘을 못 바꾼다, 매핑 함수는 직접 못 부른다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000005f1';
select test.expect_affected($$update public.category set icon = 'dog' where ledger_id = test.id('l1')$$, 0);
select test.expect_error($$select public.default_category_icon('expense', '식비', null)$$, 'permission denied');
select test.expect_error($$select public.seed_ledger_defaults(test.id('l1'))$$, 'permission denied');
reset role;

select 'category icon tests passed' as result;

rollback;
