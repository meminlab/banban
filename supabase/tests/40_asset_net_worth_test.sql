-- BANB-25 자산관리 1단계: 종류 확장 · 잔액 이력(트리거) · 보관 · 권한
-- 10_rls_test.sql 과 같이 한 트랜잭션으로 실행하고 마지막에 ROLLBACK (운영 SQL Editor에서도 실행 가능)
-- 사용자: A(L1 소유자), B(L1 멤버 → 나중에 나감), C(L2만), 비로그인(anon)
-- QA v4 매핑: AS-01·03·04·05·08·09·10·11·12·13·23, AP-01~08
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

create function test.expect_true(p_sql text) returns void
language plpgsql as $$
declare v boolean;
begin
  execute 'select (' || p_sql || ')' into v;
  if v is distinct from true then
    raise exception 'TEST FAILED: expected true: %', p_sql;
  end if;
end $$;

grant execute on all functions in schema test to anon, authenticated;
create table test.ctx (key text primary key, val uuid);
grant all on test.ctx to authenticated;
create function test.id(p_key text) returns uuid language sql stable as $$
  select val from test.ctx where key = p_key $$;
grant execute on function test.id(text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000004a1', 'a@nw.test'),
  ('00000000-0000-0000-0000-0000000004b1', 'b@nw.test'),
  ('00000000-0000-0000-0000-0000000004c1', 'c@nw.test');

-- ── 준비: A가 L1, C가 L2를 만들고 B가 L1에 참여
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
insert into test.ctx values ('l1', public.create_ledger('자산 L1', 'A'));
insert into public.invite (ledger_id) values (test.id('l1'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004c1';
insert into test.ctx values ('l2', public.create_ledger('자산 L2', 'C'));
reset role;
create temp table codes as select code from public.invite where ledger_id = (select val from test.ctx where key = 'l1') and not is_revoked;
grant select on codes to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004b1';
select public.join_ledger((select code from codes), 'B');
reset role;
insert into test.ctx select 'ma', id from public.member where ledger_id = (select val from test.ctx where key = 'l1') and display_name = 'A';
insert into test.ctx select 'mb', id from public.member where ledger_id = (select val from test.ctx where key = 'l1') and display_name = 'B';
insert into test.ctx select 'mc', id from public.member where ledger_id = (select val from test.ctx where key = 'l2');

-- ── 1. 종류 12개 모두 저장 (AS-01), 부채도 양수·같은 범위 (AS-03·04·05)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
insert into public.asset (ledger_id, name, kind, owner_id, balance)
select test.id('l1'), k, k, null, 1000
from unnest(array['checking', 'installment_saving', 'deposit', 'investment', 'pension', 'cash',
                  'real_estate', 'vehicle', 'other', 'loan', 'card_payable', 'other_liability']) k;
select test.expect_count($$select * from public.asset where ledger_id = test.id('l1')$$, 12);
select test.expect_error($$insert into public.asset (ledger_id, name, kind, balance) values (test.id('l1'), '이상', 'crypto', 1)$$, 'check constraint');
select test.expect_error($$insert into public.asset (ledger_id, name, kind, balance) values (test.id('l1'), '음수부채', 'loan', -1)$$, 'check constraint');
select test.expect_error($$insert into public.asset (ledger_id, name, kind, balance) values (test.id('l1'), '큰부채', 'loan', 10000000000)$$, 'check constraint');
insert into public.asset (ledger_id, name, kind, balance) values (test.id('l1'), '0원부채', 'loan', 0);
insert into public.asset (ledger_id, name, kind, balance) values (test.id('l1'), '최대부채', 'loan', 9999999999);

-- ── 2. 생성 시 이력 1행, 바꾼 사람 = 로그인한 A (AS-10)
select test.expect_count($$select * from public.asset_balance_history where ledger_id = test.id('l1')$$, 14);
select test.expect_count($$select * from public.asset_balance_history where ledger_id = test.id('l1') and changed_by = test.id('ma')$$, 14);
insert into public.asset (ledger_id, name, kind, owner_id, balance) values (test.id('l1'), '생활비', 'checking', test.id('ma'), 100);
reset role;
insert into test.ctx select 'asset', id from public.asset where name = '생활비' and ledger_id = (select val from test.ctx where key = 'l1');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select test.expect_count($$select * from public.asset_balance_history where asset_id = test.id('asset') and balance = 100$$, 1);

-- ── 3. 잔액이 바뀔 때만 이력 (AS-08·09)
select test.expect_affected($$update public.asset set name = '생활비 통장', memo = '메모', owner_id = null, kind = 'deposit' where id = test.id('asset')$$, 1);
select test.expect_affected($$update public.asset set balance = 100 where id = test.id('asset')$$, 1);   -- 같은 잔액 다시 저장
select test.expect_count($$select * from public.asset_balance_history where asset_id = test.id('asset')$$, 1);
select test.expect_affected($$update public.asset set balance = 200 where id = test.id('asset')$$, 1);
select test.expect_count($$select * from public.asset_balance_history where asset_id = test.id('asset')$$, 2);
reset role;

-- B가 바꾸면 바꾼 사람 = B (AS-08, AS-23: 두 사람이 바꾸면 이력 2행, 나중 값이 현재 잔액)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004b1';
select test.expect_affected($$update public.asset set balance = 300 where id = test.id('asset')$$, 1);
select test.expect_count($$select * from public.asset_balance_history where asset_id = test.id('asset') and balance = 300 and changed_by = test.id('mb')$$, 1);
select test.expect_true($$(select balance from public.asset where id = test.id('asset')) = 300$$);

-- ── 4. 이력은 아무도 직접 쓰지 못한다 (AP-04·05)
select test.expect_error($$insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by) values (test.id('asset'), test.id('l1'), 1, test.id('ma'))$$, 'permission denied');
select test.expect_error($$update public.asset_balance_history set changed_by = test.id('ma')$$, 'permission denied');
select test.expect_error($$delete from public.asset_balance_history$$, 'permission denied');
-- 바꾼 사람을 요청으로 넣을 칸이 없다 (asset 에 changed_by 없음)
select test.expect_error($$update public.asset set changed_by = test.id('ma') where id = test.id('asset')$$, 'changed_by');
reset role;

-- ── 5. 삭제 대신 보관 (AS-11·12·13, Q10)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select test.expect_error($$delete from public.asset where id = test.id('asset')$$, 'permission denied');
-- 보관 시각은 서버가 정한다: 과거 시각을 보내도 지금(now())으로
select test.expect_affected($$update public.asset set archived_at = '2020-01-01' where id = test.id('asset')$$, 1);
select test.expect_true($$(select archived_at from public.asset where id = test.id('asset')) = now()$$);
-- 이미 보관된 자산의 보관 시각은 바꿀 수 없다
select test.expect_affected($$update public.asset set archived_at = '2030-01-01' where id = test.id('asset')$$, 1);
select test.expect_true($$(select archived_at from public.asset where id = test.id('asset')) = now()$$);
-- 보관해도 행·이력은 남는다, 보관만으로 이력이 생기지 않는다
select test.expect_count($$select * from public.asset_balance_history where asset_id = test.id('asset')$$, 3);
-- 되살리기 = archived_at 지움
select test.expect_affected($$update public.asset set archived_at = null where id = test.id('asset')$$, 1);
select test.expect_count($$select * from public.asset where id = test.id('asset') and archived_at is null$$, 1);
-- 보관된 채로 만들 수 없다
insert into public.asset (ledger_id, name, kind, balance, archived_at) values (test.id('l1'), '바로보관', 'cash', 1, '2020-01-01');
select test.expect_count($$select * from public.asset where name = '바로보관' and archived_at is null$$, 1);
-- 다시 보관 (아래 외부인·나간 멤버 테스트용)
select test.expect_affected($$update public.asset set archived_at = now() where id = test.id('asset')$$, 1);
-- 자산을 다른 가계부로 옮길 수 없다 (A가 두 가계부 멤버여도) — A는 L2 멤버가 아니라 RLS로도 막히지만, 트리거 규칙 자체를 확인
reset role;
select test.expect_error($$update public.asset set ledger_id = (select val from test.ctx where key = 'l2') where id = (select val from test.ctx where key = 'asset')$$, 'ASSET_LEDGER_IMMUTABLE');

-- ── 6. 다른 가계부 멤버 C: 이력·보관 자산을 못 보고 못 바꾼다 (AP-01·02·06·07)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004c1';
select test.expect_count($$select * from public.asset_balance_history where ledger_id = test.id('l1')$$, 0);
select test.expect_count($$select * from public.asset_balance_history$$, 0);   -- C의 L2에는 아직 자산 없음
select test.expect_count($$select * from public.asset where archived_at is not null$$, 0);
select test.expect_count($$select * from public.asset where ledger_id = test.id('l1')$$, 0);
select test.expect_affected($$update public.asset set archived_at = null where id = test.id('asset')$$, 0);
select test.expect_affected($$update public.asset set archived_at = now() where ledger_id = test.id('l1')$$, 0);
-- L2 자산 소유자를 L1 멤버(B)로 지정 불가
select test.expect_error($$insert into public.asset (ledger_id, name, kind, owner_id, balance) values (test.id('l2'), 'C통장', 'checking', test.id('mb'), 1)$$, 'foreign key');
insert into public.asset (ledger_id, name, kind, owner_id, balance) values (test.id('l2'), 'C통장', 'checking', test.id('mc'), 1);
select test.expect_count($$select * from public.asset_balance_history$$, 1);   -- 자기 것만
reset role;

-- ── 7. 비로그인: 거부 (AP-03)
set role anon;
select test.expect_error($$select * from public.asset_balance_history$$, 'permission denied');
select test.expect_error($$select * from public.asset$$, 'permission denied');
reset role;

-- ── 8. 나간 B: L1 이력·보관 자산 0건 (AP-08)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004b1';
select public.leave_ledger(test.id('l1'));
select test.expect_count($$select * from public.asset_balance_history$$, 0);
select test.expect_count($$select * from public.asset$$, 0);
reset role;

-- ── 9. 트리거 함수는 직접 못 부른다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select test.expect_error($$select public.asset_record_balance()$$, 'permission denied');
reset role;

select 'asset net worth tests passed' as result;

rollback;
