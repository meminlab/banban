-- BANB-52 반반 쌓기: 가계부 × 멤버 최고 기록
--   본인 기록만 쓰기 · 더 높을 때만 바뀜 · 값 규칙 · 같은 가계부 멤버만 보기 · 다른 가계부 기록은 따로 · 직접 쓰기 불가
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK
-- 사용자: A·B (같은 가계부 L1), X (다른 가계부 LX). A 는 LX 에도 들어가 가계부별 기록을 본다
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

create function test.expect_eq(p_label text, p_got text, p_expected text) returns void
language plpgsql as $$
begin
  if p_got is distinct from p_expected then
    raise exception 'TEST FAILED: % -> expected %, got %', p_label, p_expected, p_got;
  end if;
end $$;

grant execute on all functions in schema test to anon, authenticated;
create table test.ctx (key text primary key, val text);
grant all on test.ctx to authenticated;
create function test.v(p_key text) returns uuid language sql stable as $$ select val::uuid from test.ctx where key = p_key $$;
grant execute on function test.v(text) to authenticated;
create function test.as_user(p_who text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case p_who
    when 'a' then '00000000-0000-0000-0000-0000000da001'
    when 'b' then '00000000-0000-0000-0000-0000000db001'
    else '00000000-0000-0000-0000-0000000df001' end, false)
$$;
grant execute on function test.as_user(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000da001', 'a@stack.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000db001', 'b@stack.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000df001', 'x@stack.test', '{"full_name": "엑스"}');

-- ── 0. 스키마·권한 모양
select test.expect_count($$select 1 from pg_class where oid = 'public.game_stack_best'::regclass and relrowsecurity$$, 1);
select test.expect_count($$select 1 where not has_table_privilege('anon', 'public.game_stack_best', 'select')
  and has_table_privilege('authenticated', 'public.game_stack_best', 'select')
  and not has_table_privilege('authenticated', 'public.game_stack_best', 'insert')
  and not has_table_privilege('authenticated', 'public.game_stack_best', 'update')
  and not has_table_privilege('authenticated', 'public.game_stack_best', 'delete')
  and has_function_privilege('authenticated', 'public.record_stack_score(uuid,bigint,integer)', 'execute')
  and not has_function_privilege('anon', 'public.record_stack_score(uuid,bigint,integer)', 'execute')$$, 1);

-- 가계부 L1(A·B), LX(X, A)
set role authenticated;
select test.as_user('a');
insert into test.ctx values ('l1', public.create_ledger('쌓기 L1', '에이')::text);
insert into public.invite (ledger_id) values (test.v('l1'));
insert into test.ctx values ('code1', (select code from public.invite where ledger_id = test.v('l1') and is_revoked = false));
select test.as_user('b');
select public.join_ledger((select val from test.ctx where key = 'code1'), '비');
select test.as_user('x');
insert into test.ctx values ('lx', public.create_ledger('쌓기 LX', '엑스')::text);
insert into public.invite (ledger_id) values (test.v('lx'));
insert into test.ctx values ('codex', (select code from public.invite where ledger_id = test.v('lx') and is_revoked = false));
select test.as_user('a');
select public.join_ledger((select val from test.ctx where key = 'codex'), '에이');
reset role;
insert into test.ctx select 'm1_' || m.display_name, m.id::text from public.member m where m.ledger_id = test.v('l1');
insert into test.ctx select 'mx_' || m.display_name, m.id::text from public.member m where m.ledger_id = test.v('lx');
set role authenticated;

-- ── 1. 첫 기록: previous_best = null, 새 기록
select test.as_user('a');
select test.expect_eq('first', public.record_stack_score(test.v('l1'), 12000, 11)::text,
  '{"is_new": true, "best_amount": 12000, "previous_best": null}');
select test.expect_count($$select 1 from public.game_stack_best where ledger_id = test.v('l1') and member_id = test.v('m1_에이')
  and best_amount = 12000 and best_lines = 11$$, 1);

-- ── 2. 낮거나 같은 점수는 기록을 바꾸지 않는다
select test.expect_eq('lower', public.record_stack_score(test.v('l1'), 5000, 4)::text,
  '{"is_new": false, "best_amount": 12000, "previous_best": 12000}');
select test.expect_eq('same', public.record_stack_score(test.v('l1'), 12000, 12)::text,
  '{"is_new": false, "best_amount": 12000, "previous_best": 12000}');
select test.expect_count($$select 1 from public.game_stack_best where member_id = test.v('m1_에이') and best_lines = 11$$, 1);

-- ── 3. 더 높으면 바뀐다
select test.expect_eq('higher', public.record_stack_score(test.v('l1'), 28000, 20)::text,
  '{"is_new": true, "best_amount": 28000, "previous_best": 12000}');

-- ── 4. 값 규칙: 0줄·1,000원 단위 아님·줄당 1,000원 미만·2,000원 초과·음수
select test.expect_error($$select public.record_stack_score(test.v('l1'), 0, 0)$$, 'STACK_BAD_SCORE');
select test.expect_error($$select public.record_stack_score(test.v('l1'), 1500, 1)$$, 'STACK_BAD_SCORE');
select test.expect_error($$select public.record_stack_score(test.v('l1'), 9000, 10)$$, 'STACK_BAD_SCORE');
select test.expect_error($$select public.record_stack_score(test.v('l1'), 3000, 1)$$, 'STACK_BAD_SCORE');
select test.expect_error($$select public.record_stack_score(test.v('l1'), -1000, 1)$$, 'STACK_BAD_SCORE');
select test.expect_error($$select public.record_stack_score(test.v('l1'), null, 1)$$, 'STACK_BAD_SCORE');

-- ── 5. 멤버가 아니면 쓰기 불가 (X 는 L1 멤버 아님)
select test.as_user('x');
select test.expect_error($$select public.record_stack_score(test.v('l1'), 1000, 1)$$, 'NOT_IN_LEDGER');

-- ── 6. 같은 사람이라도 가계부가 다르면 기록이 따로
select test.as_user('a');
select test.expect_eq('other ledger first', public.record_stack_score(test.v('lx'), 3000, 2)::text,
  '{"is_new": true, "best_amount": 3000, "previous_best": null}');
select test.expect_count($$select 1 from public.game_stack_best where member_id = test.v('m1_에이') and best_amount = 28000$$, 1);

-- ── 7. 읽기: 같은 가계부 멤버만. B 는 L1 기록만, X 는 LX 기록만 본다
select test.as_user('b');
select public.record_stack_score(test.v('l1'), 32000, 30);
select test.expect_count($$select 1 from public.game_stack_best$$, 2);
select test.expect_count($$select 1 from public.game_stack_best where ledger_id = test.v('lx')$$, 0);
select test.as_user('x');
select test.expect_count($$select 1 from public.game_stack_best$$, 1);
select test.expect_count($$select 1 from public.game_stack_best where ledger_id = test.v('l1')$$, 0);
-- A 는 두 가계부 멤버라 둘 다 본다 (화면은 지금 가계부만 거른다)
select test.as_user('a');
select test.expect_count($$select 1 from public.game_stack_best$$, 3);

-- ── 8. 직접 쓰기 불가 (본인 행이라도)
select test.expect_error($$insert into public.game_stack_best (ledger_id, member_id, best_amount, best_lines)
  values (test.v('l1'), test.v('m1_에이'), 999000, 999)$$, 'permission denied');
select test.expect_error($$update public.game_stack_best set best_amount = 999000 where member_id = test.v('m1_에이')$$, 'permission denied');
select test.expect_error($$delete from public.game_stack_best where member_id = test.v('m1_비')$$, 'permission denied');

-- ── 9. 나간 멤버는 읽기·쓰기 불가
reset role;
update public.member set left_at = now() where id = test.v('m1_비');
set role authenticated;
select test.as_user('b');
select test.expect_count($$select 1 from public.game_stack_best$$, 0);
select test.expect_error($$select public.record_stack_score(test.v('l1'), 40000, 30)$$, 'NOT_IN_LEDGER');

-- ── 10. 값 규칙 (관리자 직접 쓰기도)
reset role;
select test.expect_error($$update public.game_stack_best set best_amount = 1500 where member_id = test.v('m1_에이')$$, 'game_stack_best_best_amount_check');
select test.expect_error($$update public.game_stack_best set best_amount = 100000 where member_id = test.v('m1_에이')$$, 'game_stack_best_rule');

rollback;
