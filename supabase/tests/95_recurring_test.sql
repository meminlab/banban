-- BANB-44 정기 내역: 같은 가계부 멤버만 보고 쓴다 · 회차는 한 번만(기록/건너뛰기) · 기록한 내역은 source 'recurring'·회차 날짜
--   · 건너뛴 회차는 다른 멤버도 다시 기록 못 함 · 되돌리기 · 주기 규칙(말일·윤년)
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK
-- 사용자: A·B (같은 가계부 L1), X (다른 가계부 LX)
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

grant execute on all functions in schema test to anon, authenticated;
create table test.ctx (key text primary key, val text);
grant all on test.ctx to authenticated;
create function test.v(p_key text) returns uuid language sql stable as $$ select val::uuid from test.ctx where key = p_key $$;
grant execute on function test.v(text) to authenticated;
-- 오늘(KST)
create function test.today() returns date language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;
grant execute on function test.today() to authenticated;
-- 회차 1건 요청 본문
create function test.item(p_id uuid, p_date date, p_record boolean, p_amount bigint default null) returns jsonb
language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('recurring_id', p_id, 'occurs_on', p_date, 'record', p_record, 'amount', p_amount))
$$;
grant execute on function test.item(uuid, date, boolean, bigint) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'a@rec.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000009b1', 'b@rec.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000009f1', 'x@rec.test', '{"full_name": "엑스"}');

-- ── 0. 스키마·권한 모양
select test.expect_count($$select 1 from pg_class where oid in ('public.recurring_transaction'::regclass, 'public.recurring_occurrence'::regclass) and relrowsecurity$$, 2);
select test.expect_count($$select 1 where not has_table_privilege('anon', 'public.recurring_transaction', 'select')
  and not has_table_privilege('anon', 'public.recurring_occurrence', 'select')$$, 1);
select test.expect_count($$select 1 where has_table_privilege('authenticated', 'public.recurring_transaction', 'select,insert,update,delete')$$, 1);
-- 회차는 읽기만 (쓰기는 함수로만)
select test.expect_count($$select 1 where has_table_privilege('authenticated', 'public.recurring_occurrence', 'select')
  and not has_table_privilege('authenticated', 'public.recurring_occurrence', 'insert')
  and not has_table_privilege('authenticated', 'public.recurring_occurrence', 'update')
  and not has_table_privilege('authenticated', 'public.recurring_occurrence', 'delete')$$, 1);
select test.expect_count($$select 1 where has_function_privilege('authenticated', 'public.record_recurring(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_recurring(uuid,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.undo_recurring_record(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.undo_recurring_record(uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.recurring_transaction_before_write()', 'execute')$$, 1);

-- 가계부 L1(A·B), LX(X)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009a1';
insert into test.ctx values ('l1', public.create_ledger('정기 L1', '에이')::text);
insert into public.invite (ledger_id) values (test.v('l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = test.v('l1') and is_revoked = false));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009b1';
select public.join_ledger((select val from test.ctx where key = 'code'), '비');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009f1';
insert into test.ctx values ('lx', public.create_ledger('정기 LX', '엑스')::text);
reset role;
insert into test.ctx select 'm_' || m.display_name, m.id::text from public.member m where m.ledger_id in (test.v('l1'), test.v('lx'));
insert into test.ctx select 'cat', c.id::text from public.category c
  where c.ledger_id = test.v('l1') and c.type = 'expense' and c.parent_id is not null order by c.sort_order limit 1;
insert into test.ctx select 'cat_parent', c.id::text from public.category c
  where c.ledger_id = test.v('l1') and c.type = 'expense' and c.parent_id is null order by c.sort_order limit 1;
insert into test.ctx select 'cat_income', c.id::text from public.category c
  where c.ledger_id = test.v('l1') and c.type = 'income' and c.parent_id is not null order by c.sort_order limit 1;
insert into test.ctx select 'pocket', p.id::text from public.pocket p where p.ledger_id = test.v('l1') order by p.sort_order limit 1;
set role authenticated;

-- ── 1. A 가 정기 내역을 만든다: 매주 오늘 요일, 2주 전부터. 작성자는 보낸 값과 상관없이 로그인한 사람
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009a1';
insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, memo, cycle, weekday, start_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 30000, test.v('cat'), test.v('pocket'), test.v('m_에이'), '주간 장보기', 'weekly',
          extract(dow from test.today())::int, test.today() - 14, test.v('m_비'), test.v('m_비'));
insert into test.ctx select 'weekly', id::text from public.recurring_transaction where memo = '주간 장보기';
select test.expect_count($$select * from public.recurring_transaction where created_by = test.v('m_에이') and updated_by = test.v('m_에이')$$, 1);
-- 매월 31일(= 말일) 수입
insert into public.recurring_transaction (ledger_id, type, amount, category_id, spender_id, memo, cycle, day_of_month, start_on, created_by, updated_by)
  values (test.v('l1'), 'income', 3500000, test.v('cat_income'), test.v('m_비'), '월급', 'monthly', 31, '2026-01-01', test.v('m_에이'), test.v('m_에이'));

-- B 도 본다, X 는 못 본다·못 쓴다·못 고친다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009b1';
select test.expect_count($$select * from public.recurring_transaction$$, 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009f1';
select test.expect_count($$select * from public.recurring_transaction$$, 0);
select test.expect_error($$insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, cycle, weekday, start_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 1, test.v('cat'), test.v('pocket'), test.v('m_에이'), 'weekly', 1, '2026-11-01', test.v('m_x'), test.v('m_x'))$$, 'row-level security');
update public.recurring_transaction set amount = 1 where ledger_id = test.v('l1');
delete from public.recurring_transaction where ledger_id = test.v('l1');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009a1';
select test.expect_count($$select * from public.recurring_transaction where amount <> 1$$, 2);

-- ── 2. 값 규칙
select test.expect_error($$insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, cycle, day_of_month, weekday, start_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 1, test.v('cat'), test.v('pocket'), test.v('m_에이'), 'monthly', 5, 1, '2026-11-01', test.v('m_에이'), test.v('m_에이'))$$, 'recurring_cycle_rule');
select test.expect_error($$insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, cycle, month, day_of_month, start_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 1, test.v('cat'), test.v('pocket'), test.v('m_에이'), 'yearly', 2, 30, '2026-11-01', test.v('m_에이'), test.v('m_에이'))$$, 'recurring_cycle_rule');
select test.expect_error($$insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, cycle, weekday, start_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 1, test.v('cat'), test.v('pocket'), test.v('m_에이'), 'weekly', null, '2026-11-01', test.v('m_에이'), test.v('m_에이'))$$, 'recurring_cycle_rule');
select test.expect_error($$insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, cycle, weekday, start_on, end_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 1, test.v('cat'), test.v('pocket'), test.v('m_에이'), 'weekly', 1, '2026-11-01', '2026-10-01', test.v('m_에이'), test.v('m_에이'))$$, 'recurring_period_rule');
select test.expect_error($$insert into public.recurring_transaction (ledger_id, type, amount, category_id, spender_id, cycle, weekday, start_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 1, test.v('cat'), test.v('m_에이'), 'weekly', 1, '2026-11-01', test.v('m_에이'), test.v('m_에이'))$$, 'recurring_pocket_rule');
select test.expect_error($$insert into public.recurring_transaction (ledger_id, type, amount, category_id, pocket_id, spender_id, cycle, weekday, start_on, created_by, updated_by)
  values (test.v('l1'), 'expense', 1, test.v('cat_parent'), test.v('pocket'), test.v('m_에이'), 'weekly', 1, '2026-11-01', test.v('m_에이'), test.v('m_에이'))$$, 'CATEGORY_MUST_BE_CHILD');
select test.expect_error($$update public.recurring_transaction set ledger_id = test.v('lx') where id = test.v('weekly')$$, '');
-- 정기 내역 내역의 source 값 허용
select test.expect_count($$select 1 from pg_constraint where conname = 'transaction_source_check' and pg_get_constraintdef(oid) like '%recurring%'$$, 1);

-- ── 3. 회차 규칙 (화면 domain/recurring.ts 와 같음): 31일 = 말일, 2월 29일 = 평년 2월 28일
select test.expect_count($$select 1 where public.recurring_occurs_on('monthly', 31::smallint, null, null, '2026-01-01', null, '2026-02-28')
  and not public.recurring_occurs_on('monthly', 31::smallint, null, null, '2026-01-01', null, '2026-02-27')
  and public.recurring_occurs_on('monthly', 31::smallint, null, null, '2026-01-01', null, '2026-04-30')
  and public.recurring_occurs_on('monthly', 15::smallint, null, null, '2026-01-01', '2026-03-15', '2026-03-15')
  and not public.recurring_occurs_on('monthly', 15::smallint, null, null, '2026-01-01', '2026-03-14', '2026-03-15')
  and not public.recurring_occurs_on('monthly', 15::smallint, null, null, '2026-02-01', null, '2026-01-15')
  and public.recurring_occurs_on('yearly', 29::smallint, 2::smallint, null, '2024-02-29', null, '2027-02-28')
  and public.recurring_occurs_on('yearly', 29::smallint, 2::smallint, null, '2024-02-29', null, '2028-02-29')
  and not public.recurring_occurs_on('yearly', 29::smallint, 2::smallint, null, '2024-02-29', null, '2028-02-28')
  and public.recurring_occurs_on('weekly', null, null, 0::smallint, '2026-11-01', null, '2026-11-08')
  and not public.recurring_occurs_on('weekly', null, null, 0::smallint, '2026-11-01', null, '2026-11-09')$$, 1);

-- ── 4. A 가 오늘 회차를 기록(금액 고침) → 내역 1건, source recurring, 날짜 = 회차 날짜, 이름 = 메모
select test.expect_count($$select 1 from jsonb_array_elements(public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today(), true, 31500))) e
  where (e->>'applied')::boolean and e->>'status' = 'recorded' and e->>'transaction_id' is not null$$, 1);
select test.expect_count($$select * from public.transaction where source = 'recurring' and occurred_on = test.today() and amount = 31500
  and memo = '주간 장보기' and is_fixed and created_by = test.v('m_에이') and spender_id = test.v('m_에이')$$, 1);
select test.expect_count($$select * from public.recurring_occurrence o join public.transaction t on t.id = o.transaction_id
  where o.recurring_id = test.v('weekly') and o.occurs_on = test.today() and o.status = 'recorded' and o.decided_by = test.v('m_에이')$$, 1);

-- B 가 다른 기기에서 같은 회차를 또 확인 → 아무것도 안 생김(applied false), 내역은 여전히 1건
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009b1';
select test.expect_count($$select 1 from jsonb_array_elements(public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today(), true))) e
  where not (e->>'applied')::boolean and e->>'status' = 'recorded'$$, 1);
select test.expect_count($$select * from public.transaction where source = 'recurring'$$, 1);

-- ── 5. B 가 지난주 회차를 건너뜀 → 내역 없음. A 가 나중에 기록하려 해도 안 생긴다(다시 제안되지 않음)
select test.expect_count($$select 1 from jsonb_array_elements(public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today() - 7, false))) e
  where (e->>'applied')::boolean and e->>'status' = 'skipped' and e->'transaction_id' = 'null'::jsonb$$, 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009a1';
select test.expect_count($$select 1 from jsonb_array_elements(public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today() - 7, true))) e
  where not (e->>'applied')::boolean and e->>'status' = 'skipped'$$, 1);
select test.expect_count($$select * from public.transaction where source = 'recurring'$$, 1);
select test.expect_count($$select * from public.recurring_occurrence where status = 'skipped' and occurs_on = test.today() - 7$$, 1);

-- ── 6. 회차가 아닌 날·미래·시작 전·없는 정기 내역·다른 가계부 사람 → 거부 (전체 취소)
select test.expect_error($$select public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today() - 3, true))$$, 'RECURRING_BAD_DATE');
select test.expect_error($$select public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today() + 7, true))$$, 'RECURRING_BAD_DATE');
select test.expect_error($$select public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today() - 21, true))$$, 'RECURRING_BAD_DATE');
select test.expect_error($$select public.record_recurring(test.v('l1'), '[]'::jsonb)$$, 'RECURRING_BAD_ITEMS');
-- 여러 건 중 하나가 틀리면 앞 건도 남지 않는다
select test.expect_error($$select public.record_recurring(test.v('l1'),
  test.item(test.v('weekly'), test.today() - 14, true) || test.item(test.v('weekly'), test.today() - 3, true))$$, 'RECURRING_BAD_DATE');
select test.expect_count($$select * from public.recurring_occurrence where occurs_on = test.today() - 14$$, 0);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009f1';
select test.expect_error($$select public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today(), true))$$, 'NOT_IN_LEDGER');
select test.expect_error($$select public.record_recurring(test.v('lx'), test.item(test.v('weekly'), test.today(), true))$$, 'RECURRING_NOT_FOUND');
select test.expect_error($$select public.undo_recurring_record(test.v('l1'), jsonb_build_array(jsonb_build_object('recurring_id', test.v('weekly'), 'occurs_on', test.today())))$$, 'NOT_IN_LEDGER');
select test.expect_count($$select * from public.recurring_occurrence$$, 0);
-- 회차 직접 쓰기는 멤버도 막힌다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009a1';
select test.expect_error($$insert into public.recurring_occurrence (recurring_id, occurs_on, ledger_id, status, decided_by)
  values (test.v('weekly'), test.today() - 14, test.v('l1'), 'skipped', test.v('m_에이'))$$, 'permission denied');
select test.expect_error($$delete from public.recurring_occurrence$$, 'permission denied');

-- ── 7. 되돌리기: 내가 확인한 회차만 지우고 그때 만든 내역도 지운다 → 다시 기록할 수 있다
select public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today() - 14, true));
select test.expect_count($$select * from public.transaction where source = 'recurring'$$, 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009b1';
select test.expect_count($$select 1 where public.undo_recurring_record(test.v('l1'), jsonb_build_array(jsonb_build_object('recurring_id', test.v('weekly'), 'occurs_on', test.today() - 14))) = 0$$, 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009a1';
select test.expect_count($$select 1 where public.undo_recurring_record(test.v('l1'), jsonb_build_array(jsonb_build_object('recurring_id', test.v('weekly'), 'occurs_on', test.today() - 14))) = 1$$, 1);
select test.expect_count($$select * from public.transaction where source = 'recurring'$$, 1);
select test.expect_count($$select * from public.recurring_occurrence where occurs_on = test.today() - 14$$, 0);
select test.expect_count($$select 1 from jsonb_array_elements(public.record_recurring(test.v('l1'), test.item(test.v('weekly'), test.today() - 14, true))) e
  where (e->>'applied')::boolean$$, 1);

-- ── 8. 기록한 내역을 지워도 회차는 "기록함"으로 남는다(다시 제안 안 함). 정기 내역을 지우면 회차는 지워지고 내역은 남는다
delete from public.transaction where occurred_on = test.today() - 14 and source = 'recurring';
select test.expect_count($$select * from public.recurring_occurrence where occurs_on = test.today() - 14 and status = 'recorded' and transaction_id is null$$, 1);
delete from public.recurring_transaction where id = test.v('weekly');
select test.expect_count($$select * from public.recurring_occurrence$$, 0);
select test.expect_count($$select * from public.transaction where source = 'recurring' and occurred_on = test.today()$$, 1);

reset role;
select 'recurring tests passed' as result;

rollback;
