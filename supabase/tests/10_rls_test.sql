-- 스키마·권한 규칙 테스트. 실패하면 예외로 중단된다.
-- 전체를 한 트랜잭션으로 실행하고 마지막에 ROLLBACK 하므로 테스트 데이터·테스트용 스키마가 남지 않는다.
-- → 실제 Supabase SQL Editor에서도 그대로 실행 가능 ("Success. No rows returned" = 통과)
begin;
-- 사용자: A(가계부 주인), B(초대로 참여), C(3번째 — 상한 초과), X(외부인)

create schema test;
grant usage on schema test to anon, authenticated;

-- sql 실행 시 오류가 나야 하고, 메시지에 pattern이 있어야 통과
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

-- 실행 결과 행 수 확인
create function test.expect_count(p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  if v <> p_expected then
    raise exception 'TEST FAILED: % -> expected % rows, got %', p_sql, p_expected, v;
  end if;
end $$;

-- 영향받은 행 수 확인 (RLS로 막힌 update/delete는 오류 없이 0행)
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

-- 도우미 자체 검증: 잘못된 기대값이면 반드시 실패해야 한다
do $$ begin
  begin perform test.expect_error('select 1', 'x'); raise exception 'META'; exception when others then if sqlerrm = 'META' then raise exception 'expect_error is broken'; end if; end;
  begin perform test.expect_error('select 1/0', 'no-such-text'); raise exception 'META'; exception when others then if sqlerrm = 'META' then raise exception 'expect_error pattern check is broken'; end if; end;
  begin perform test.expect_count('select 1', 2); raise exception 'META'; exception when others then if sqlerrm = 'META' then raise exception 'expect_count is broken'; end if; end;
end $$;

grant execute on all functions in schema test to anon, authenticated;
create table test.ctx (key text primary key, val uuid);
grant all on test.ctx to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test'),
  ('00000000-0000-0000-0000-0000000000ff', 'x@test');

-- ── 1. A가 가계부를 만든다 → 기본 카테고리·주머니 생성
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into test.ctx values ('ledger', public.create_ledger('우리집', 'A'));
select test.expect_count('select * from public.ledger', 1);
select test.expect_count('select * from public.member where role = ''owner''', 1);
select test.expect_count('select * from public.pocket', 4);
select test.expect_count('select * from public.pocket where scope = ''personal'' and name = ''개인용돈''', 1);
-- 대분류 15+6+6 = 27, 소분류 = 식비4 주거3 통신3 교통4 생활2 쇼핑2 건강3 문화3 + 단일 19 = 43
select test.expect_count('select * from public.category where parent_id is null', 27);
select test.expect_count('select * from public.category where parent_id is not null', 43);
select test.expect_count('select * from public.ledger where member_limit = 2', 1);
-- 두 번째 가계부는 못 만든다 (1인 1가계부)
select test.expect_error($$select public.create_ledger('또', 'A')$$, 'ALREADY_IN_LEDGER');
-- member_limit은 클라이언트가 못 바꾼다
select test.expect_error($$update public.ledger set member_limit = 10$$, 'permission denied');
select test.expect_affected($$update public.ledger set name = '반반네'$$, 1);
-- 이름 1~20자
select test.expect_error($$update public.ledger set name = repeat('가', 21)$$, 'check constraint');
select test.expect_error($$update public.ledger set name = '   '$$, 'check constraint');

-- 초대 발급 (두 번 발급 → 첫 번째는 무효)
insert into public.invite (ledger_id) select val from test.ctx where key = 'ledger';
insert into public.invite (ledger_id) select val from test.ctx where key = 'ledger';
select test.expect_count('select * from public.invite where is_revoked = false', 1);
select test.expect_count($$select * from public.invite where code ~ '^[A-Z0-9]{8}$' and expires_at > now() + interval '6 days 23 hours'$$, 2);
reset role;
insert into test.ctx select 'old_invite', id from public.invite where is_revoked;
insert into test.ctx select 'invite', id from public.invite where not is_revoked;

-- ── 2. 외부인 X: 아무것도 못 읽고 못 쓴다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select test.expect_count('select * from public.ledger', 0);
select test.expect_count('select * from public.member', 0);
select test.expect_count('select * from public.invite', 0);
select test.expect_count('select * from public.category', 0);
select test.expect_count('select * from public.pocket', 0);
select test.expect_count('select * from public.transaction', 0);
select test.expect_count('select * from public.asset', 0);
select test.expect_affected($$update public.ledger set name = '해킹'$$, 0);
select test.expect_affected($$delete from public.category$$, 0);
select test.expect_error($$insert into public.pocket (ledger_id, name, scope) select val, '몰래', 'shared' from test.ctx where key = 'ledger'$$, 'row-level security');
select test.expect_error($$insert into public.invite (ledger_id) select val from test.ctx where key = 'ledger'$$, 'row-level security');
select test.expect_error($$insert into public.asset (ledger_id, name, kind) select val, '몰래', 'cash' from test.ctx where key = 'ledger'$$, 'row-level security');
select test.expect_error($$insert into public.member (ledger_id, user_id, display_name) select val, auth.uid(), 'X' from test.ctx where key = 'ledger'$$, 'permission denied');
select test.expect_error($$insert into public.ledger (name, created_by) values ('x', auth.uid())$$, 'permission denied');
-- 내부 함수는 직접 못 부른다
select test.expect_error($$select public.seed_ledger_defaults(val) from test.ctx where key = 'ledger'$$, 'permission denied');
reset role;

-- ── 3. 비로그인(anon)
set role anon;
reset request.jwt.claim.sub;
select test.expect_error('select * from public.transaction', 'permission denied');
select test.expect_error($$select public.join_ledger('AAAAAAAA', 'anon')$$, 'permission denied');
reset role;

-- ── 4. B가 초대 코드로 참여 (무효 코드 / 잘못된 코드 / 정상)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
reset role;
create temp table codes as
  select (select code from public.invite i join test.ctx c on c.val = i.id and c.key = 'invite') as valid,
         (select code from public.invite i join test.ctx c on c.val = i.id and c.key = 'old_invite') as revoked;
grant select on codes to authenticated;
set role authenticated;
select test.expect_error(format('select public.join_ledger(%L, ''B'')', (select revoked from codes)), 'INVITE_NOT_FOUND');
select test.expect_error($$select public.join_ledger('ZZZZZZZZ', 'B')$$, 'INVITE_NOT_FOUND');
select public.join_ledger(lower((select valid from codes)), 'B');  -- 소문자 입력도 허용
select test.expect_count('select * from public.member', 2);
-- 같은 코드로 다시 참여해도 그대로 성공(중복 행 없음)
select public.join_ledger((select valid from codes), 'B');
select test.expect_count('select * from public.member', 2);
-- B는 A의 데이터가 보인다
select test.expect_count('select * from public.ledger where name = ''반반네''', 1);
select test.expect_count('select * from public.category', 70);
-- B는 자기 이름만 바꿀 수 있고, 역할·다른 사람은 못 바꾼다
select test.expect_affected($$update public.member set display_name = '비' where user_id = auth.uid()$$, 1);
select test.expect_affected($$update public.member set display_name = '해킹' where user_id <> auth.uid()$$, 0);
select test.expect_error($$update public.member set role = 'owner'$$, 'permission denied');
reset role;

-- ── 5. C: 상한(2명) 초과로 참여 불가
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.expect_error(format('select public.join_ledger(%L, ''C'')', (select valid from codes)), 'MEMBER_LIMIT_REACHED');
select test.expect_count('select * from public.member', 0);
reset role;

-- ── 6. 만료된 초대
update public.invite set expires_at = now() - interval '1 second'
  where id = (select val from test.ctx where key = 'invite');
set role authenticated;
select test.expect_error(format('select public.join_ledger(%L, ''C'')', (select valid from codes)), 'INVITE_EXPIRED');
reset role;

-- ── 7. 내역 규칙 (B가 입력)
reset role;
insert into test.ctx select 'expense_child', id from public.category where type = 'expense' and name = '외식';
insert into test.ctx select 'expense_parent', id from public.category where type = 'expense' and name = '식비';
insert into test.ctx select 'income_child', id from public.category where type = 'income' and parent_id is not null and name = '급여';
insert into test.ctx select 'pocket', id from public.pocket where name = '공동소비';
insert into test.ctx select 'member_a', id from public.member where display_name = 'A';
insert into test.ctx select 'member_b', id from public.member where user_id = '00000000-0000-0000-0000-00000000000b';
create view test.v as select
  (select val from test.ctx where key = 'ledger') ledger,
  (select val from test.ctx where key = 'expense_child') exp_child,
  (select val from test.ctx where key = 'expense_parent') exp_parent,
  (select val from test.ctx where key = 'income_child') inc_child,
  (select val from test.ctx where key = 'pocket') pocket,
  (select val from test.ctx where key = 'member_a') ma,
  (select val from test.ctx where key = 'member_b') mb;
grant select on test.v to authenticated;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
-- 정상 지출: source 기본값 manual, 작성자 = B (위조 시도해도 B로 기록)
insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, created_by, updated_by, is_fixed)
  select ledger, 'expense', 12000, exp_child, pocket, ma, ma, ma, true from test.v;
select test.expect_count($$select * from public.transaction t, test.v
  where t.source = 'manual' and t.created_by = v.mb and t.updated_by = v.mb and t.spender_id = v.ma
    and t.occurred_on = (now() at time zone 'Asia/Seoul')::date$$, 1);
-- 금액 상한 9,999,999,999원까지 허용, 초과 불가
insert into public.transaction (ledger_id, type, amount, category_id, spender_id)
  select ledger, 'income', 9999999999, inc_child, mb from test.v;
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, spender_id)
  select ledger, 'income', 10000000000, inc_child, mb from test.v$$, 'check constraint');
-- 금액 0 불가
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id)
  select ledger, 'expense', 0, exp_child, pocket, mb from test.v$$, 'check constraint');
-- 지출인데 주머니 없음 불가
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, spender_id)
  select ledger, 'expense', 1000, exp_child, mb from test.v$$, 'transaction_pocket_rule');
-- 수입에 주머니/고정지출 불가
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id)
  select ledger, 'income', 1000, inc_child, pocket, mb from test.v$$, 'transaction_pocket_rule');
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, spender_id, is_fixed)
  select ledger, 'income', 1000, inc_child, mb, true from test.v$$, 'transaction_fixed_rule');
-- 유형과 카테고리 유형 불일치 불가
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, spender_id)
  select ledger, 'income', 1000, exp_child, mb from test.v$$, 'foreign key');
-- 대분류로는 입력 불가
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id)
  select ledger, 'expense', 1000, exp_parent, pocket, mb from test.v$$, 'CATEGORY_MUST_BE_CHILD');
-- 메모 100자 초과 불가
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, spender_id, memo)
  select ledger, 'income', 1000, inc_child, mb, repeat('가', 101) from test.v$$, 'check constraint');
-- 소분류 아래 또 소분류 불가
select test.expect_error($$insert into public.category (ledger_id, type, parent_id, name)
  select ledger, 'expense', exp_child, '3단계' from test.v$$, 'CATEGORY_DEPTH_EXCEEDED');
-- 사용 중인 카테고리·주머니는 삭제 불가 (숨김 처리해야 함)
select test.expect_error($$delete from public.category where id = (select exp_child from test.v)$$, 'foreign key');
select test.expect_error($$delete from public.pocket where id = (select pocket from test.v)$$, 'foreign key');
select test.expect_affected($$update public.pocket set is_hidden = true where id = (select pocket from test.v)$$, 1);
reset role;

-- A가 수정하면 마지막 수정자 = A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.expect_affected($$update public.transaction set amount = 15000, created_by = (select ma from test.v), updated_by = (select mb from test.v) where type = 'expense'$$, 1);
select test.expect_count($$select * from public.transaction t, test.v where t.type = 'expense' and t.updated_by = v.ma and t.created_by = v.mb$$, 1);

-- 자산: 공동(owner null) / 개인, 잔액 음수 불가
insert into public.asset (ledger_id, name, kind, balance) select ledger, '생활비통장', 'checking', 500000 from test.v;
insert into public.asset (ledger_id, name, kind, owner_id, balance) select ledger, 'A 적금', 'installment_saving', ma, 1000000 from test.v;
select test.expect_error($$insert into public.asset (ledger_id, name, kind, balance) select ledger, '마이너스', 'cash', -1 from test.v$$, 'check constraint');
select test.expect_error($$insert into public.asset (ledger_id, name, kind, balance) select ledger, '너무큼', 'cash', 10000000000 from test.v$$, 'check constraint');
select test.expect_error($$insert into public.asset (ledger_id, name, kind) select ledger, repeat('가', 21), 'cash' from test.v$$, 'check constraint');
select test.expect_error($$insert into public.asset (ledger_id, name, kind) select ledger, '이상한종류', 'crypto' from test.v$$, 'check constraint');
select test.expect_count('select * from public.asset', 2);
reset role;

-- ── 8. 외부인 X는 여전히 내역·자산을 못 본다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select test.expect_count('select * from public.transaction', 0);
select test.expect_count('select * from public.asset', 0);
select test.expect_affected('delete from public.transaction', 0);
select test.expect_affected('update public.asset set balance = 0', 0);
reset role;

-- ── 9. 다른 가계부의 카테고리·멤버를 참조할 수 없다 (C가 자기 가계부를 만든 뒤 시도)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into test.ctx values ('ledger_c', public.create_ledger('C네', 'C'));
select test.expect_count('select * from public.ledger', 1);   -- 자기 것만
select test.expect_error($$insert into public.transaction (ledger_id, type, amount, category_id, spender_id)
  select (select val from test.ctx where key = 'ledger_c'), 'income', 1000, inc_child, mb from test.v$$, 'foreign key');
reset role;

-- ── 10. D1 카테고리 2단계 (B, 멤버)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
-- 자기 자신을 부모로 지정 불가
select test.expect_error($$update public.category set parent_id = id where id = (select exp_parent from test.v)$$, 'CATEGORY_SELF_PARENT');
-- 소분류가 있는 대분류(식비)는 다른 대분류(주거) 아래로 갈 수 없음
select test.expect_error($$update public.category set parent_id = (select id from public.category where name = '주거' and parent_id is null)
  where id = (select exp_parent from test.v)$$, 'CATEGORY_DEPTH_EXCEEDED');
-- 소분류를 소분류 아래로 옮길 수 없음
select test.expect_error($$update public.category set parent_id = (select exp_child from test.v)
  where name = '배달' and type = 'expense'$$, 'CATEGORY_DEPTH_EXCEEDED');
-- 부모와 type이 다르면 불가
select test.expect_error($$insert into public.category (ledger_id, type, parent_id, name)
  select ledger, 'income', exp_parent, '섞임' from test.v$$, 'foreign key');
-- 자식이 있는 대분류의 type 변경 불가 (자식과 type이 달라짐)
select test.expect_error($$update public.category set type = 'income' where id = (select exp_parent from test.v)$$, 'foreign key');
-- 정상: 소분류 추가, 소분류를 다른 대분류로 이동, 자식 없는 대분류를 소분류로
insert into public.category (ledger_id, type, parent_id, name) select ledger, 'expense', exp_parent, '야식' from test.v;
select test.expect_affected($$update public.category set parent_id = (select id from public.category where name = '주거' and parent_id is null)
  where name = '야식'$$, 1);
insert into public.category (ledger_id, type, name) select ledger, 'expense', '임시대분류' from test.v;
select test.expect_affected($$update public.category set parent_id = (select exp_parent from test.v) where name = '임시대분류'$$, 1);
select test.expect_count($$select * from public.category c join public.category p on p.id = c.parent_id where p.parent_id is not null$$, 0);
reset role;

-- ── 11. D2 초대 규칙 (A, 멤버)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
-- 클라이언트가 보낸 코드·만료일·무효여부·발급자는 무시
insert into public.invite (ledger_id, code, expires_at, is_revoked, created_by)
  select ledger, 'AAAAAAAA', '2099-01-01', true, mb from test.v;
select test.expect_count($$select * from public.invite i, test.v
  where i.is_revoked = false and i.code <> 'AAAAAAAA' and i.code ~ '^[A-Z0-9]{8}$'
    and i.expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days'
    and i.created_by = v.ma$$, 1);
-- 유효 초대는 항상 1개
select test.expect_count('select * from public.invite where is_revoked = false', 1);
-- 만료일·코드·가계부는 못 바꿈
select test.expect_error($$update public.invite set expires_at = '2099-01-01'$$, 'permission denied');
select test.expect_error($$update public.invite set code = 'BBBBBBBB'$$, 'permission denied');
select test.expect_error($$update public.invite set ledger_id = ledger_id$$, 'permission denied');
-- 무효 초대를 되살릴 수 없음
select test.expect_error($$update public.invite set is_revoked = false where is_revoked$$, 'INVITE_CANNOT_UNREVOKE');
-- 유효 초대를 무효로 만드는 건 가능
select test.expect_affected($$update public.invite set is_revoked = true where is_revoked = false$$, 1);
select test.expect_count('select * from public.invite where is_revoked = false', 0);
reset role;
-- 관리자도 무효 초대를 되살릴 수 없음
select test.expect_error($$update public.invite set is_revoked = false$$, 'INVITE_CANNOT_UNREVOKE');

select 'all RLS/schema tests passed' as result;

rollback;
