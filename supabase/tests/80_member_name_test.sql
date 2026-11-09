-- BANB-45 설정 › 내 이름: 가계부별 내 이름(member.display_name) 바꾸기
-- 마이그레이션 없음. 기존 권한(update(display_name) 열 권한 + member_update_self 정책)이 아래를 지키는지 확인한다.
--   * 지금 가계부의 내 행만 바뀌고, 다른 가계부의 내 이름은 그대로
--   * 같은 가계부의 다른 멤버 행은 바꿀 수 없다 (0행)
--   * 나간 가계부의 내 행은 바꿀 수 없다 (0행)
--   * display_name 외 열(user_id·ledger_id·role·left_at)은 바꿀 수 없다
--   * 1~20자(앞뒤 공백 제거 후) 규칙은 DB도 막는다
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK (운영 SQL Editor에서도 실행 가능)
-- 사용자: A(가계부 L1·L2), B(L1), C(L1에 들어왔다 나감)
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
create table test.ctx (key text primary key, val text);
grant all on test.ctx to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008a1', 'a@name.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000008b1', 'b@name.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000008c1', 'c@name.test', '{"full_name": "씨"}');

-- ── 준비: A 가 L1·L2 를 만든다. B 는 L1 에 참여, C 는 L1 에 참여했다가 나간다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
insert into test.ctx values ('l1', public.create_ledger('이름 L1', '에이')::text);
insert into test.ctx values ('l2', public.create_ledger('이름 L2', '에이')::text);
insert into public.invite (ledger_id) values ((select val::uuid from test.ctx where key = 'l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = (select val::uuid from test.ctx where key = 'l1') and is_revoked = false));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
select public.join_ledger((select val from test.ctx where key = 'code'), '비');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008c1';
select public.join_ledger((select val from test.ctx where key = 'code'), '씨');
select public.leave_ledger((select val::uuid from test.ctx where key = 'l1'));
reset role;
insert into test.ctx select 'a1', id from public.member where user_id = '00000000-0000-0000-0000-0000000008a1' and ledger_id = (select val::uuid from test.ctx where key = 'l1');
insert into test.ctx select 'a2', id from public.member where user_id = '00000000-0000-0000-0000-0000000008a1' and ledger_id = (select val::uuid from test.ctx where key = 'l2');
insert into test.ctx select 'b1', id from public.member where user_id = '00000000-0000-0000-0000-0000000008b1';
insert into test.ctx select 'c1', id from public.member where user_id = '00000000-0000-0000-0000-0000000008c1';
select test.expect_count($$select * from test.ctx where key in ('a1', 'a2', 'b1', 'c1')$$, 4);

-- ── 1. A 가 L1 에서 내 이름을 바꾼다 (앱과 같은 조건: ledger_id + user_id + left_at is null) → L1 행만 바뀐다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select test.expect_affected($$update public.member set display_name = '남편'
  where ledger_id = (select val::uuid from test.ctx where key = 'l1') and user_id = auth.uid() and left_at is null$$, 1);
reset role;
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'a1') and display_name = '남편'$$, 1);
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'a2') and display_name = '에이'$$, 1);  -- 다른 가계부 그대로
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'b1') and display_name = '비'$$, 1);

-- ── 2. 같은 가계부의 다른 멤버(B) 행은 못 바꾼다: id 로 직접 지정해도 0행, B 이름 그대로
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select test.expect_affected($$update public.member set display_name = '해킹' where id = (select val::uuid from test.ctx where key = 'b1')$$, 0);
select test.expect_affected($$update public.member set display_name = '해킹'
  where ledger_id = (select val::uuid from test.ctx where key = 'l1') and user_id <> auth.uid()$$, 0);
-- 나간 멤버(C) 행도 못 바꾼다
select test.expect_affected($$update public.member set display_name = '해킹' where id = (select val::uuid from test.ctx where key = 'c1')$$, 0);
reset role;
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'b1') and display_name = '비'$$, 1);
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'c1') and display_name = '씨'$$, 1);

-- ── 3. 나간 가계부의 내 행은 본인도 못 바꾼다 (C)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008c1';
select test.expect_affected($$update public.member set display_name = '다시씨' where user_id = auth.uid()$$, 0);
reset role;
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'c1') and display_name = '씨'$$, 1);

-- ── 4. display_name 외 열은 바꿀 수 없다 (열 권한 없음)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select test.expect_error($$update public.member set role = 'owner' where id = (select val::uuid from test.ctx where key = 'a1')$$, 'permission denied');
select test.expect_error($$update public.member set user_id = '00000000-0000-0000-0000-0000000008b1' where id = (select val::uuid from test.ctx where key = 'a1')$$, 'permission denied');
select test.expect_error($$update public.member set ledger_id = (select val::uuid from test.ctx where key = 'l2') where id = (select val::uuid from test.ctx where key = 'a1')$$, 'permission denied');
select test.expect_error($$update public.member set left_at = now() where id = (select val::uuid from test.ctx where key = 'a1')$$, 'permission denied');

-- ── 5. 글자 수 규칙: 앞뒤 공백 제거 후 1~20자 (이모지 1개 = 1자)
select test.expect_error($$update public.member set display_name = '' where id = (select val::uuid from test.ctx where key = 'a1')$$, 'check constraint');
select test.expect_error($$update public.member set display_name = '   ' where id = (select val::uuid from test.ctx where key = 'a1')$$, 'check constraint');
select test.expect_error($$update public.member set display_name = repeat('가', 21) where id = (select val::uuid from test.ctx where key = 'a1')$$, 'check constraint');
select test.expect_affected($$update public.member set display_name = repeat('가', 20) where id = (select val::uuid from test.ctx where key = 'a1')$$, 1);
select test.expect_affected($$update public.member set display_name = repeat('😀', 20) where id = (select val::uuid from test.ctx where key = 'a1')$$, 1);
reset role;
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'a1') and display_name = repeat('😀', 20)$$, 1);
select test.expect_count($$select * from public.member where id = (select val::uuid from test.ctx where key = 'a2') and display_name = '에이'$$, 1);

-- ── 6. 비로그인(anon)은 아무것도 못 바꾼다
set role anon;
select test.expect_error($$update public.member set display_name = '해킹'$$, 'permission denied');
reset role;

select 'member name tests passed' as result;

rollback;
