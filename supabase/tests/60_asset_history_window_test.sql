-- BANB-30 잔액 이력 범위 조회 함수 asset_balance_history_window(가계부, 창 시작)
-- 다른 테스트와 같이 한 트랜잭션으로 실행하고 마지막에 ROLLBACK (운영 SQL Editor에서도 실행 가능)
-- 확인: 창 시작 이후 전부 + 자산마다 직전 마지막 1건(같은 시각이면 id 큰 쪽), 이력 1,000건 넘는 자산, 보관 자산,
--       멤버만 조회(외부인 0건, 나간 사람 0건), 비로그인 실행 불가
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
  ('00000000-0000-0000-0000-0000000006a1', 'a@hw.test'),
  ('00000000-0000-0000-0000-0000000006b1', 'b@hw.test'),
  ('00000000-0000-0000-0000-0000000006c1', 'c@hw.test');

-- ── 준비: A가 L1, C가 L2를 만들고 B가 L1에 참여
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006a1';
insert into test.ctx values ('l1', public.create_ledger('이력 L1', 'A'));
insert into public.invite (ledger_id) values (test.id('l1'));
insert into public.asset (ledger_id, name, kind, balance) values
  (test.id('l1'), '활발통장', 'checking', 1),
  (test.id('l1'), '오래된집', 'real_estate', 1),
  (test.id('l1'), '옛대출', 'loan', 1),
  (test.id('l1'), '보관차', 'vehicle', 1),
  (test.id('l1'), '새적금', 'installment_saving', 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006c1';
insert into test.ctx values ('l2', public.create_ledger('이력 L2', 'C'));
insert into public.asset (ledger_id, name, kind, balance) values (test.id('l2'), 'C통장', 'checking', 1);
reset role;
create temp table codes as select code from public.invite where ledger_id = (select val from test.ctx where key = 'l1') and not is_revoked;
grant select on codes to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006b1';
select public.join_ledger((select code from codes), 'B');
reset role;
insert into test.ctx select name, id from public.asset where name in ('활발통장', '오래된집', '옛대출', '보관차', '새적금', 'C통장');

-- 트리거가 만든 생성 이력(지금 시각)을 지우고 과거 시각 이력을 관리자 권한으로 넣는다 (새적금은 생성 이력만 = 창 안에만 있음)
delete from public.asset_balance_history
where asset_id in (select val from test.ctx where key in ('활발통장', '오래된집', '옛대출', '보관차', 'C통장'));
-- 활발통장: 2025-02-01 부터 10시간 간격 1,500건 (~2026-10-19) + 이번 달 1건
insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by, changed_at)
select test.id('활발통장'), test.id('l1'), 1000 + i, null, timestamptz '2025-02-01 09:00+09' + i * interval '10 hours'
from generate_series(0, 1499) i;
insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by, changed_at)
values (test.id('활발통장'), test.id('l1'), 2222, null, timestamptz '2026-11-03 09:00+09');
-- 오래된집: 같은 시각 2건 → id 큰 쪽(410)이 기준값
insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by, changed_at) values
  (test.id('오래된집'), test.id('l1'), 400, null, timestamptz '2024-03-01 09:00+09'),
  (test.id('오래된집'), test.id('l1'), 410, null, timestamptz '2024-03-01 09:00+09');
insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by, changed_at) values
  (test.id('옛대출'), test.id('l1'), 50, null, timestamptz '2025-01-10 09:00+09'),
  (test.id('옛대출'), test.id('l1'), 30, null, timestamptz '2025-04-10 09:00+09'),
  (test.id('보관차'), test.id('l1'), 15, null, timestamptz '2025-03-01 09:00+09'),
  (test.id('C통장'), test.id('l2'), 7, null, timestamptz '2025-03-01 09:00+09');
update public.asset set archived_at = now() where id = test.id('보관차');

-- 창 시작 2026-06-01 00:00 KST 의 기대 결과 (관리자 권한으로 전체 이력에서 계산)
create temp table expected as
  select h.* from public.asset_balance_history h
  where h.ledger_id = (select val from test.ctx where key = 'l1') and h.changed_at >= timestamptz '2026-06-01 00:00+09'
  union all
  (select distinct on (h.asset_id) h.* from public.asset_balance_history h
   where h.ledger_id = (select val from test.ctx where key = 'l1') and h.changed_at < timestamptz '2026-06-01 00:00+09'
   order by h.asset_id, h.changed_at desc, h.id desc);
grant select on expected to authenticated;

select test.expect_count($$select * from public.asset_balance_history where asset_id = test.id('활발통장')$$, 1501);
select test.expect_count($$select * from expected where asset_id = test.id('활발통장') and changed_at < '2026-06-01 00:00+09'$$, 1);

-- ── 1. A(멤버): 기대 결과와 행 단위로 같다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006a1';
select test.expect_true($$not exists (
  (select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') except all select * from expected)
  union all
  (select * from expected except all select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09')))$$);
-- 활발통장: 창 안 전부 + 직전 1건
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where asset_id = test.id('활발통장') and changed_at >= '2026-06-01 00:00+09'$$,
  (select count(*) from expected where asset_id = (select val from test.ctx where key = '활발통장') and changed_at >= '2026-06-01 00:00+09'));
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where asset_id = test.id('활발통장') and changed_at < '2026-06-01 00:00+09'$$, 1);
select test.expect_true($$(select balance from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where asset_id = test.id('활발통장') and changed_at < '2026-06-01 00:00+09')
  = (select balance from public.asset_balance_history where asset_id = test.id('활발통장') and changed_at < '2026-06-01 00:00+09' order by changed_at desc limit 1)$$);
-- 6개월 넘게 안 바뀐 자산·부채·보관 자산도 기준값 1건씩, 같은 시각이면 id 큰 쪽
select test.expect_true($$(select balance from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where asset_id = test.id('오래된집')) = 410$$);
select test.expect_true($$(select balance from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where asset_id = test.id('옛대출')) = 30$$);
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where asset_id = test.id('보관차')$$, 1);
-- 창 안에만 있는 자산(새적금)은 창 안 이력만
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where asset_id = test.id('새적금')$$, 1);
-- 창을 아주 이르게 잡으면 전체 이력과 같다
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2000-01-01')$$, 1507);
-- 다른 가계부 행은 섞이지 않는다
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09') where ledger_id <> test.id('l1')$$, 0);
reset role;

-- ── 2. B(멤버)도 같은 결과
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006b1';
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2026-06-01 00:00+09')$$, (select count(*) from expected));
reset role;

-- ── 3. 외부인 C: L1 0건, 자기 가계부는 보인다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006c1';
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2000-01-01')$$, 0);
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l2'), '2026-06-01 00:00+09')$$, 1);
reset role;

-- ── 4. 비로그인: 실행 불가
set role anon;
select test.expect_error($$select * from public.asset_balance_history_window('00000000-0000-0000-0000-000000000000', now())$$, 'permission denied');
reset role;

-- ── 5. 나간 B: 0건
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006b1';
select public.leave_ledger(test.id('l1'));
select test.expect_count($$select * from public.asset_balance_history_window(test.id('l1'), '2000-01-01')$$, 0);
reset role;

select 'asset history window tests passed' as result;

rollback;
