-- BANB-17 여러 가계부 · 1인 5개 상한 · 마지막으로 본 가계부 · 가계부 간 데이터 분리
-- 10_rls_test.sql 과 같이 한 트랜잭션으로 실행하고 마지막에 ROLLBACK (운영 SQL Editor에서도 실행 가능)
-- 사용자: P(가계부 여러 개), Q(P와 LQ 공동), R(P와 무관한 가계부 LR), T(P와 L2 공동)
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

-- 오류 코드와 detail 둘 다 확인
create function test.expect_error_detail(p_sql text, p_message text, p_detail text) returns void
language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" BUT SUCCEEDED: %', p_message, p_sql;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  if sqlerrm <> p_message or v_detail is distinct from p_detail then
    raise exception 'TEST FAILED: % -> got "%" / detail "%"', p_sql, sqlerrm, v_detail;
  end if;
end $$;

grant execute on all functions in schema test to anon, authenticated;
create table test.ctx (key text primary key, val uuid);
grant all on test.ctx to authenticated;
-- 사용자 id 줄임말
create function test.uid(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000001' || lpad(p, 2, '0'))::uuid $$;
grant execute on function test.uid(text) to authenticated;
create function test.id(p_key text) returns uuid language sql stable as $$
  select val from test.ctx where key = p_key $$;
grant execute on function test.id(text) to authenticated;
-- 관리자 권한으로 현재 유효한 초대 코드 (테스트용)
create function test.code(p_key text) returns text language sql stable security definer as $$
  select code from public.invite where ledger_id = (select val from test.ctx where key = p_key) and is_revoked = false $$;
grant execute on function test.code(text) to authenticated;
-- 현재 로그인 사용자가 참여 중인 가계부 수
create view test.my_active as
  select * from public.member where user_id = auth.uid() and left_at is null;
grant select on test.my_active to authenticated;

insert into auth.users (id, email) values
  (test.uid('11'), 'p@test'), (test.uid('12'), 'q@test'), (test.uid('13'), 'r@test'), (test.uid('14'), 't@test');

-- ── 1. 1인 1가계부 규칙이 없어졌다
select test.expect_count($$select * from pg_indexes where indexname = 'member_one_active_ledger_per_user'$$, 0);
select test.expect_count($$select * from pg_proc where prosrc like '%ALREADY_IN_LEDGER%'$$, 0);

-- ── 2. P가 가계부 3개를 만든다 → 가계부마다 기본 카테고리·주머니가 따로, 마지막으로 본 가계부 = 마지막에 만든 것
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
insert into test.ctx values ('L1', public.create_ledger('부부 공동', 'P'));
insert into test.ctx values ('L2', public.create_ledger('개인', 'P'));
insert into test.ctx values ('L3', public.create_ledger('부모님', 'P'));
select test.expect_count('select * from public.ledger', 3);
select test.expect_count('select * from test.my_active', 3);
select test.expect_count($$select * from public.member where user_id = auth.uid() and role = 'owner'$$, 3);
select test.expect_count($$select ledger_id from public.pocket group by ledger_id having count(*) = 4$$, 3);
select test.expect_count($$select ledger_id from public.category group by ledger_id having count(*) = 40$$, 3);
select test.expect_count($$select * from public.user_preference where user_id = auth.uid() and last_ledger_id = test.id('L3')$$, 1);

-- 전환: 현재 멤버인 가계부만 기록
select public.set_last_ledger(test.id('L1'));
select test.expect_count($$select * from public.user_preference where last_ledger_id = test.id('L1')$$, 1);

-- ── 3. Q가 만든 LQ에 P가 참여 (다른 가계부가 있어도 참여 가능) → 마지막으로 본 가계부 = LQ
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000112';
insert into test.ctx values ('LQ', public.create_ledger('Q네', 'Q'));
insert into public.invite (ledger_id) values (test.id('LQ'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select test.expect_count($$select 1 where public.join_ledger(test.code('LQ'), 'P') = test.id('LQ')$$, 1);
select test.expect_count('select * from test.my_active', 4);
select test.expect_count($$select * from public.user_preference where last_ledger_id = test.id('LQ')$$, 1);
-- 이미 멤버인 가계부의 링크: 중복 없이 그 가계부로 전환만 (마지막으로 본 가계부도 갱신)
select public.set_last_ledger(test.id('L1'));
select test.expect_count($$select 1 where public.join_ledger(test.code('LQ'), 'P') = test.id('LQ')$$, 1);
select test.expect_count('select * from test.my_active', 4);
select test.expect_count($$select * from public.member where ledger_id = test.id('LQ') and user_id = auth.uid()$$, 1);
select test.expect_count($$select * from public.user_preference where last_ledger_id = test.id('LQ')$$, 1);

-- 멤버가 아닌 가계부는 기록 불가
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000113';
insert into test.ctx values ('LR', public.create_ledger('R네', 'R'));
insert into public.invite (ledger_id) values (test.id('LR'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select test.expect_error($$select public.set_last_ledger(test.id('LR'))$$, 'NOT_IN_LEDGER');
-- 마지막으로 본 가계부는 직접 쓸 수 없다 (RPC로만)
select test.expect_error($$insert into public.user_preference (user_id, last_ledger_id) values (auth.uid(), test.id('LR'))$$, 'permission denied');
select test.expect_error($$update public.user_preference set last_ledger_id = test.id('LR')$$, 'permission denied');
-- 내부 함수는 직접 못 부른다
select test.expect_error($$select public.remember_last_ledger(auth.uid(), test.id('LR'))$$, 'permission denied');

-- ── 4. 5개째 만들기 OK, 6번째 만들기·참여는 LEDGER_LIMIT_REACHED (detail = 5)
insert into test.ctx values ('L5', public.create_ledger('다섯째', 'P'));
select test.expect_count('select * from test.my_active', 5);
select test.expect_error_detail($$select public.create_ledger('여섯째', 'P')$$, 'LEDGER_LIMIT_REACHED', '5');
select test.expect_error_detail($$select public.join_ledger(test.code('LR'), 'P')$$, 'LEDGER_LIMIT_REACHED', '5');
select test.expect_count('select * from test.my_active', 5);
reset role;
-- 막힌 만들기는 가계부 행도 남기지 않는다
select test.expect_count($$select * from public.ledger where created_by = test.uid('11')$$, 4);
select test.expect_count($$select * from public.member where ledger_id = test.id('LR') and left_at is null$$, 1);

-- 상한 값은 user_ledger_limit() 한 곳: 6으로 바꾸면 코드 수정 없이 6번째 가능
create or replace function public.user_ledger_limit() returns int language sql immutable set search_path = '' as $$ select 6 $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
insert into test.ctx values ('L6', public.create_ledger('여섯째', 'P'));
select test.expect_error_detail($$select public.create_ledger('일곱째', 'P')$$, 'LEDGER_LIMIT_REACHED', '6');
select public.leave_ledger(test.id('L6'));  -- 혼자라 보관됨
reset role;
create or replace function public.user_ledger_limit() returns int language sql immutable set search_path = '' as $$ select 5 $$;

-- ── 5. 나간 가계부·보관된 가계부는 세지 않는다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select test.expect_count('select * from test.my_active', 5);  -- 보관된 L6 은 빠짐
-- (a) 공동 가계부(LQ)에서 나가면 4개 → 새로 만들기 가능
select public.leave_ledger(test.id('LQ'));
select test.expect_count('select * from test.my_active', 4);
insert into test.ctx values ('L7', public.create_ledger('일곱째', 'P'));
select test.expect_count('select * from test.my_active', 5);
-- (b) 5개 상태에서 예전에 나갔던 LQ에 다시 참여 → 막힘 (다시 참여하면 6개)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000112';
insert into public.invite (ledger_id) values (test.id('LQ'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select test.expect_error_detail($$select public.join_ledger(test.code('LQ'), 'P')$$, 'LEDGER_LIMIT_REACHED', '5');
reset role;
select test.expect_count($$select * from public.member where ledger_id = test.id('LQ') and user_id = test.uid('11') and left_at is not null$$, 1);
-- (c) 혼자 쓰던 가계부(L5)에서 나가면 보관되고 개수에서 빠짐 → 새로 만들기 가능
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select public.leave_ledger(test.id('L5'));
reset role;
select test.expect_count($$select * from public.member where ledger_id = test.id('L5') and left_at is null$$, 0);
select test.expect_count($$select * from public.ledger where id = test.id('L5')$$, 1);  -- 삭제 안 함
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select test.expect_count('select * from test.my_active', 4);
insert into test.ctx values ('L8', public.create_ledger('여덟째', 'P'));
select test.expect_count('select * from test.my_active', 5);

-- ── 6. 나가기: 지금 보던 가계부에서 나가면 마지막으로 본 가계부를 지운다 (다른 가계부면 그대로)
select public.set_last_ledger(test.id('L7'));
select public.leave_ledger(test.id('L8'));
select test.expect_count($$select * from public.user_preference where last_ledger_id = test.id('L7')$$, 1);
select public.leave_ledger(test.id('L7'));
select test.expect_count($$select * from public.user_preference where user_id = auth.uid() and last_ledger_id is null$$, 1);
select test.expect_error($$select public.leave_ledger(test.id('L7'))$$, 'NOT_IN_LEDGER');
select test.expect_error($$select public.leave_ledger(test.id('LR'))$$, 'NOT_IN_LEDGER');  -- 멤버 아닌 가계부
-- 지금 P: L1, L2, L3 (3개)
select test.expect_count('select * from test.my_active', 3);

-- ── 7. 같은 가계부에 같은 사람 현재 멤버 행은 1개만 (DB 규칙)
reset role;
select test.expect_error($$insert into public.member (ledger_id, user_id, display_name) values (test.id('L1'), test.uid('11'), 'P2')$$, 'member_one_active_per_ledger_user');
-- 관리자가 직접 넣어도 1인 상한은 지켜진다
insert into public.member (ledger_id, user_id, display_name) values (test.id('LR'), test.uid('11'), 'P');
insert into public.member (ledger_id, user_id, display_name) select id, test.uid('11'), 'P' from public.ledger where id = test.id('L8');
select test.expect_error_detail($$insert into public.member (ledger_id, user_id, display_name) values (test.id('L5'), test.uid('11'), 'P')$$, 'LEDGER_LIMIT_REACHED', '5');
delete from public.member where user_id = test.uid('11') and ledger_id in (test.id('LR'), test.id('L8')) and left_at is null;

-- ── 8. 가계부 간 데이터 분리 (RLS 그대로: 현재 멤버만)
--   L2: P + T, LQ: Q (P는 나감), L1·L3: P 혼자
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
insert into public.invite (ledger_id) values (test.id('L2'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000114';
select public.join_ledger(test.code('L2'), 'T');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
-- 각 가계부에 내역·자산 1건씩
insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, created_by, updated_by)
select l.id, 'expense', 10000 * n,
       (select c.id from public.category c where c.ledger_id = l.id and c.type = 'expense' and c.parent_id is not null order by c.sort_order, c.name limit 1),
       (select p.id from public.pocket p where p.ledger_id = l.id order by p.sort_order limit 1),
       public.current_member_id(l.id), public.current_member_id(l.id), public.current_member_id(l.id)
from (values (test.id('L1'), 1), (test.id('L2'), 2), (test.id('L3'), 3)) as l(id, n);
insert into public.asset (ledger_id, name, kind, balance)
select id, '통장', 'checking', 1000 from (values (test.id('L1')), (test.id('L2')), (test.id('L3'))) as l(id);
select test.expect_count('select * from public.transaction', 3);
select test.expect_count($$select * from public.transaction where ledger_id = test.id('L2') and amount = 20000$$, 1);
-- 한 가계부 내역에 다른 가계부의 카테고리·주머니·멤버를 쓸 수 없다
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, created_by, updated_by)
  select test.id('L1'), 'expense', 1, c.id, p.id, public.current_member_id(test.id('L1')), public.current_member_id(test.id('L1')), public.current_member_id(test.id('L1'))
  from public.category c, public.pocket p
  where c.ledger_id = test.id('L2') and c.parent_id is not null and c.type = 'expense' and p.ledger_id = test.id('L1') limit 1$$, 'foreign key');
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, created_by, updated_by)
  select test.id('L1'), 'expense', 1, c.id, p.id, public.current_member_id(test.id('L2')), public.current_member_id(test.id('L1')), public.current_member_id(test.id('L1'))
  from public.category c, public.pocket p
  where c.ledger_id = test.id('L1') and c.parent_id is not null and c.type = 'expense' and p.ledger_id = test.id('L1') limit 1$$, 'foreign key');

-- T(L2 멤버): L2 것만. P의 L1·L3 데이터는 0건
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000114';
select test.expect_count('select * from public.ledger', 1);
select test.expect_count($$select * from public.ledger where id = test.id('L2')$$, 1);
select test.expect_count($$select * from public.member where ledger_id <> test.id('L2')$$, 0);
select test.expect_count($$select * from public.invite where ledger_id <> test.id('L2')$$, 0);
select test.expect_count($$select * from public.category where ledger_id <> test.id('L2')$$, 0);
select test.expect_count($$select * from public.pocket where ledger_id <> test.id('L2')$$, 0);
select test.expect_count('select * from public.transaction', 1);
select test.expect_count('select * from public.asset', 1);
select test.expect_count($$select * from public.transaction where ledger_id in (test.id('L1'), test.id('L3'))$$, 0);
-- 다른 가계부 데이터는 수정·삭제도 안 된다 (RLS: 오류 없이 0행)
do $$ declare v bigint; begin
  update public.transaction set amount = 1 where ledger_id in (test.id('L1'), test.id('L3')); get diagnostics v = row_count;
  if v <> 0 then raise exception 'TEST FAILED: T updated other ledger transactions (%)', v; end if;
  -- BANB-25부터 자산은 삭제 대신 보관(delete 권한 없음) → 보관 시도로 확인
  update public.asset set archived_at = now() where ledger_id in (test.id('L1'), test.id('L3')); get diagnostics v = row_count;
  if v <> 0 then raise exception 'TEST FAILED: T archived other ledger assets (%)', v; end if;
end $$;
select test.expect_error($$insert into public.asset (ledger_id, name, kind) values (test.id('L1'), '몰래', 'cash')$$, 'row-level security');
select test.expect_error($$select public.set_last_ledger(test.id('L1'))$$, 'NOT_IN_LEDGER');
-- 프로필: 같은 가계부(L2)의 P는 보이고, P와만 공동인 Q·R은 안 보인다
select test.expect_count($$select * from public.profile where id = test.uid('11')$$, 1);
select test.expect_count($$select * from public.profile where id in (test.uid('12'), test.uid('13'))$$, 0);
-- 마지막으로 본 가계부는 본인 것만 보인다
select test.expect_count('select * from public.user_preference', 1);
select test.expect_count($$select * from public.user_preference where user_id = auth.uid()$$, 1);

-- Q(예전에 P와 LQ 공동, P는 나감): P의 L1·L2·L3 데이터는 0건
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000112';
select test.expect_count('select * from public.ledger', 1);
select test.expect_count($$select * from public.ledger where id = test.id('LQ')$$, 1);
select test.expect_count('select * from public.transaction', 0);
select test.expect_count('select * from public.asset', 0);
select test.expect_count($$select * from public.category where ledger_id <> test.id('LQ')$$, 0);
select test.expect_count($$select * from public.member where ledger_id <> test.id('LQ')$$, 0);
select test.expect_count($$select * from public.user_preference where user_id <> auth.uid()$$, 0);

-- P: 자기 가계부 3개 데이터만 (나간 LQ·L5~L8, 남의 LR 은 0건)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select test.expect_count('select * from public.ledger', 3);
select test.expect_count($$select * from public.category where ledger_id not in (test.id('L1'), test.id('L2'), test.id('L3'))$$, 0);
select test.expect_count($$select * from public.member where ledger_id = test.id('LQ')$$, 0);

-- 비로그인: 아무것도 못 한다
reset role;
set role anon;
reset request.jwt.claim.sub;
select test.expect_error($$select * from public.user_preference$$, 'permission denied');
select test.expect_error($$select public.set_last_ledger('00000000-0000-0000-0000-000000000000')$$, 'permission denied');
reset role;

-- ── 9. 실행 권한: 상한 함수·트리거 함수는 로그인 사용자도 직접 못 부른다
select test.expect_count($$select 1 where not has_function_privilege('authenticated', 'public.user_ledger_limit()', 'execute')
  and not has_function_privilege('authenticated', 'public.remember_last_ledger(uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.set_last_ledger(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_ledger(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.leave_ledger(uuid)', 'execute')$$, 1);

select 'all multi-ledger tests passed' as result;

rollback;
