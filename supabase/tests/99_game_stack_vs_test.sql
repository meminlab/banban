-- BANB-55 반반 쌓기 대전: 초대(내기)·같은 조각 순서 값·방해 줄 계산·끝 판정 순서·끊김 30초·끝난 판 거부·멤버만
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK. now() 는 트랜잭션 안에서 같은 값이라 "30초 지남"은 seen_at·started_at 을 앞당겨 만든다
-- 사용자: A·B·C (같은 가계부 L1), X (다른 가계부 LX)
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
    when 'a' then '00000000-0000-0000-0000-0000000ea001'
    when 'b' then '00000000-0000-0000-0000-0000000eb001'
    when 'c' then '00000000-0000-0000-0000-0000000ec001'
    else '00000000-0000-0000-0000-0000000ef001' end, false)
$$;
grant execute on function test.as_user(text) to authenticated;
-- 판 한 열 (관리자 권한)
create function test.g(p_id uuid, p_col text) returns text language plpgsql security definer as $$
declare v text;
begin
  execute format('select (%I)::text from public.game where id = $1', p_col) into v using p_id;
  return v;
end $$;
grant execute on function test.g(uuid, text) to authenticated;
-- 저장본 한 열 (관리자 권한)
create function test.b(p_id uuid, p_member uuid, p_col text) returns text language plpgsql security definer as $$
declare v text;
begin
  execute format('select (%I)::text from public.game_stack_board where game_id = $1 and member_id = $2', p_col) into v using p_id, p_member;
  return v;
end $$;
grant execute on function test.b(uuid, uuid, text) to authenticated;
-- 시간 앞당기기 (관리자 권한): 대전 시작을 p_start 초 전으로, 사람별 마지막으로 보인 시각을 p_sec 초 전으로
create function test.ago(p_id uuid, p_start int) returns void language sql security definer as $$
  update public.game set started_at = now() - make_interval(secs => p_start) where id = p_id
$$;
grant execute on function test.ago(uuid, int) to authenticated;
create function test.seen(p_id uuid, p_member uuid, p_sec int) returns void language sql security definer as $$
  update public.game_stack_board set seen_at = now() - make_interval(secs => p_sec) where game_id = p_id and member_id = p_member
$$;
grant execute on function test.seen(uuid, uuid, int) to authenticated;
-- 끝난 판 정리 (관리자 권한): 다음 초대를 위해
create function test.close(p_id uuid) returns void language sql security definer as $$
  update public.game set status = 'abandoned', end_reason = 'timeout', finished_at = now() where id = p_id and status = 'active'
$$;
grant execute on function test.close(uuid) to authenticated;
-- 서버 빈칸 계산 (관리자 권한 — 화면에서는 실행 불가)
create function test.hole(p_seed int, p_from uuid, p_seq int) returns int language sql security definer as $$
  select public.stack_vs_hole(p_seed, p_from, p_seq)
$$;
grant execute on function test.hole(int, uuid, int) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000ea001', 'a@stackvs.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000eb001', 'b@stackvs.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000ec001', 'c@stackvs.test', '{"full_name": "씨"}'),
  ('00000000-0000-0000-0000-0000000ef001', 'x@stackvs.test', '{"full_name": "엑스"}');

-- ── 0. 스키마·권한 모양
select test.expect_count($$select 1 where has_function_privilege('authenticated', 'public.invite_game(uuid,uuid,text,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.invite_game(uuid,uuid,text,uuid,text)', 'execute')
  and to_regprocedure('public.invite_game(uuid,uuid,text,uuid)') is null
  and has_function_privilege('authenticated', 'public.stack_vs_save(uuid,jsonb,integer)', 'execute')
  and not has_function_privilege('anon', 'public.stack_vs_save(uuid,jsonb,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.stack_vs_send(uuid,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.stack_vs_send(uuid,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.stack_vs_end(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.stack_vs_claim_disconnect(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.stack_vs_close_overdue(public.game)', 'execute')
  and not has_function_privilege('authenticated', 'public.stack_vs_lock(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.stack_vs_hole(int,uuid,int)', 'execute')
  and not has_table_privilege('authenticated', 'public.game_stack_board', 'insert')
  and not has_table_privilege('authenticated', 'public.game_stack_board', 'update')
  and not has_table_privilege('authenticated', 'public.game_stack_garbage', 'insert')
  and not has_table_privilege('authenticated', 'public.game_stack_garbage', 'delete')
  and not has_table_privilege('anon', 'public.game_stack_garbage', 'select')
  and (select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'game_stack_garbage') = 1$$, 1);

-- ── GV. 방해 줄 계산 (순수 함수): 1줄 0 · 2줄 1 · 3줄 2 · 4줄 이상 3, 빈칸 0~7 · 같은 입력이면 같은 자리
select test.expect_eq('GV-01 줄 수', (select string_agg(public.stack_vs_lines(n)::text, ',' order by n) from generate_series(0, 6) n), '0,0,1,2,3,3,3');
select test.expect_count($$select 1 from generate_series(1, 200) s
  where public.stack_vs_hole(12345, '00000000-0000-0000-0000-0000000ea001', s) not between 0 and 7$$, 0);
select test.expect_eq('GV-02 같은 입력 같은 자리',
  (public.stack_vs_hole(777, '00000000-0000-0000-0000-0000000ea001', 3) = public.stack_vs_hole(777, '00000000-0000-0000-0000-0000000ea001', 3))::text, 'true');
-- 빈칸 자리가 한쪽으로 쏠리지 않는다 (200묶음이면 8칸 모두 나온다)
select test.expect_eq('GV-03 빈칸 고루',
  (select count(distinct public.stack_vs_hole(99, '00000000-0000-0000-0000-0000000ea001', s)) from generate_series(1, 200) s)::text, '8');

set role authenticated;
select test.as_user('a');
insert into test.ctx values ('l1', public.create_ledger('대전 L1', '에이')::text);
insert into public.invite (ledger_id) values (test.v('l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = test.v('l1') and is_revoked = false));
select test.as_user('b');
select public.join_ledger((select val from test.ctx where key = 'code'), '비');
select test.as_user('c');
select public.join_ledger((select val from test.ctx where key = 'code'), '씨');
select test.as_user('x');
insert into test.ctx values ('lx', public.create_ledger('대전 LX', '엑스')::text);
reset role;
insert into test.ctx select 'm_' || m.display_name, m.id::text from public.member m where m.ledger_id in (test.v('l1'), test.v('lx'));
set role authenticated;

-- ── IN. 초대·내기
select test.as_user('a');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'), 'stack', null, null)$$, 'GAME_BAD_KIND');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'), 'stack_vs', null, repeat('가', 31))$$, 'GAME_BAD_BET');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'), 'omok', null, '진 사람이 설거지')$$, 'GAME_BAD_BET');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_엑스'), 'stack_vs', null, null)$$, 'GAME_BAD_OPPONENT');
-- 30자는 되고, 앞뒤 공백은 지운다
insert into test.ctx values ('g1', public.invite_game(test.v('l1'), test.v('m_비'), 'stack_vs', null, '  ' || repeat('가', 30) || ' ')::text);
select test.expect_eq('IN-01 내기 30자 저장', test.g(test.v('g1'), 'bet'), repeat('가', 30));
select test.expect_eq('IN-02 종류·룰', test.g(test.v('g1'), 'kind') || '/' || test.g(test.v('g1'), 'rule'), 'stack_vs/stack_vs');
select test.expect_eq('IN-03 순서 값 있음', (test.g(test.v('g1'), 'seed') is not null)::text, 'true');
select test.expect_eq('IN-04 받은 사람 = black', test.g(test.v('g1'), 'black_id'), test.v('m_비')::text);
-- 1인 1판: 대전 초대 중이면 오목도 못 보낸다 (A 다른 판 / B 바쁨)
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_씨'))$$, 'GAME_ALREADY_OPEN');
select test.as_user('c');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'))$$, 'GAME_OPPONENT_BUSY');
-- 내기는 같은 가계부 멤버(참가자 아님 포함)가 읽고, 다른 가계부는 판이 안 보인다
select test.expect_count($$select 1 from public.game where id = test.v('g1') and bet is not null$$, 1);
select test.as_user('x');
select test.expect_count($$select 1 from public.game where id = test.v('g1')$$, 0);
-- 빈 내기 = 없음 (A 초대 취소 후 다시)
select test.as_user('a');
select public.cancel_game(test.v('g1'));
insert into test.ctx values ('g2', public.invite_game(test.v('l1'), test.v('m_비'), 'stack_vs', null, '   ')::text);
select test.expect_eq('IN-05 빈 내기 = 없음', test.g(test.v('g2'), 'bet'), null);
-- 수락 (오목과 같은 함수) → 대전 중, 마감 없음
select test.as_user('b');
select test.expect_eq('IN-06 수락', public.respond_game(test.v('g2'), true)->>'status', 'active');
select test.expect_eq('IN-07 마감 없음', test.g(test.v('g2'), 'turn_deadline'), null);

-- ── KD. 오목 함수는 대전 판을 거부, 대전 함수는 오목 판을 거부
select test.expect_error($$select public.play_move(test.v('g2'), 7, 7)$$, 'GAME_BAD_KIND');
select test.expect_error($$select public.resign_game(test.v('g2'))$$, 'GAME_BAD_KIND');
select test.expect_error($$select public.offer_draw(test.v('g2'))$$, 'GAME_BAD_KIND');
select test.expect_error($$select public.claim_turn_timeout(test.v('g2'))$$, 'GAME_BAD_KIND');

-- ── MB. 멤버만: 다른 가계부 = 판 없음, 같은 가계부 구경꾼 = 참가자 아님
select test.as_user('x');
select test.expect_error($$select public.stack_vs_save(test.v('g2'), '{}'::jsonb, 0)$$, 'GAME_NOT_FOUND');
select test.expect_error($$select public.stack_vs_send(test.v('g2'), 1, 2)$$, 'GAME_NOT_FOUND');
select test.expect_error($$select public.stack_vs_end(test.v('g2'), 'quit')$$, 'GAME_NOT_FOUND');
select test.expect_error($$select public.stack_vs_claim_disconnect(test.v('g2'))$$, 'GAME_NOT_FOUND');
select test.as_user('c');
select test.expect_error($$select public.stack_vs_save(test.v('g2'), '{}'::jsonb, 0)$$, 'GAME_NOT_PLAYER');
select test.expect_error($$select public.stack_vs_send(test.v('g2'), 1, 2)$$, 'GAME_NOT_PLAYER');
select test.expect_error($$select public.stack_vs_end(test.v('g2'), 'quit')$$, 'GAME_NOT_PLAYER');
-- 직접 쓰기 불가
select test.expect_error($$insert into public.game_stack_garbage (game_id, ledger_id, from_member, seq, cleared, lines, hole)
  values (test.v('g2'), test.v('l1'), test.v('m_씨'), 1, 4, 3, 0)$$, 'permission denied');
select test.expect_error($$update public.game_stack_board set lines = 999$$, 'permission denied');

-- ── SV. 저장 (2초마다) + 같은 조각 순서 값
select test.as_user('a');
select test.expect_eq('SV-01 저장', public.stack_vs_save(test.v('g2'), '{"v":1,"board":"........"}'::jsonb, 3)->>'applied', 'true');
select test.expect_eq('SV-02 지운 줄', test.b(test.v('g2'), test.v('m_에이'), 'lines'), '3');
-- 시각만 (state = null) 은 판을 지우지 않는다
select public.stack_vs_save(test.v('g2'), null, 4);
select test.expect_eq('SV-03 판 유지', test.b(test.v('g2'), test.v('m_에이'), 'state'), '{"v": 1, "board": "........"}');
select test.expect_error($$select public.stack_vs_save(test.v('g2'), '[1]'::jsonb, 0)$$, 'STACK_BAD_STATE');
select test.expect_error($$select public.stack_vs_save(test.v('g2'), jsonb_build_object('x', repeat('a', 9000)), 0)$$, 'STACK_BAD_STATE');
select test.expect_error($$select public.stack_vs_save(test.v('g2'), '{}'::jsonb, -1)$$, 'STACK_BAD_STATE');
-- 두 사람이 읽는 순서 값은 같은 판의 값 하나 (B 도 같은 seed)
select test.as_user('b');
select test.expect_eq('SV-04 같은 순서 값', (select seed::text from public.game where id = test.v('g2')), test.g(test.v('g2'), 'seed'));
select public.stack_vs_save(test.v('g2'), '{"v":1}'::jsonb, 0);
-- 같은 가계부 멤버는 저장본을 읽고, 다른 가계부는 못 읽는다
select test.as_user('c');
select test.expect_count($$select 1 from public.game_stack_board where game_id = test.v('g2')$$, 2);
select test.as_user('x');
select test.expect_count($$select 1 from public.game_stack_board where game_id = test.v('g2')$$, 0);

-- ── GB. 방해 줄 보내기: 장수·빈칸은 서버가, 순번 확인, 같은 순번 다시 = 한 번만
select test.as_user('a');
select test.expect_error($$select public.stack_vs_send(test.v('g2'), 1, 1)$$, 'STACK_BAD_CLEAR');
select test.expect_error($$select public.stack_vs_send(test.v('g2'), 2, 2)$$, 'STACK_BAD_SEQ');
insert into test.ctx values ('s1', public.stack_vs_send(test.v('g2'), 1, 2)::text);
select test.expect_eq('GB-01 2줄 → 1장', (select val::jsonb->>'lines' from test.ctx where key = 's1'), '1');
select test.expect_eq('GB-02 빈칸 = 서버 계산',
  (select val::jsonb->>'hole' from test.ctx where key = 's1'),
  test.hole(test.g(test.v('g2'), 'seed')::int, test.v('m_에이'), 1)::text);
select test.expect_eq('GB-03 3줄 → 2장', public.stack_vs_send(test.v('g2'), 2, 3)->>'lines', '2');
select test.expect_eq('GB-04 4줄 → 3장', public.stack_vs_send(test.v('g2'), 3, 4)->>'lines', '3');
select test.expect_eq('GB-05 같은 순번 다시', public.stack_vs_send(test.v('g2'), 3, 4)->>'applied', 'false');
select test.expect_count($$select 1 from public.game_stack_garbage where game_id = test.v('g2')$$, 3);
select test.expect_error($$select public.stack_vs_send(test.v('g2'), 5, 2)$$, 'STACK_BAD_SEQ');
-- B 의 순번은 따로 1부터
select test.as_user('b');
select test.expect_eq('GB-06 사람마다 순번', public.stack_vs_send(test.v('g2'), 1, 2)->>'applied', 'true');
-- 받는 사람(B)과 구경꾼(C)은 보낸 묶음을 읽는다(실시간 RLS), 다른 가계부는 못 읽는다
select test.expect_count($$select 1 from public.game_stack_garbage where game_id = test.v('g2') and from_member = test.v('m_에이')$$, 3);
select test.as_user('x');
select test.expect_count($$select 1 from public.game_stack_garbage where game_id = test.v('g2')$$, 0);

-- ── DC. 끊김 30초: 한 사람만 30초 넘게 없으면 그 사람 패, 30초 전이면 거부
select test.as_user('a');
select test.ago(test.v('g2'), 120);
select test.seen(test.v('g2'), test.v('m_비'), 29);
select test.expect_error($$select public.stack_vs_claim_disconnect(test.v('g2'))$$, 'GAME_NOT_TIMED_OUT');
select test.seen(test.v('g2'), test.v('m_비'), 31);
-- 끊긴 사람(B)이 돌아와 저장해도 이미 늦음 → 저장하지 않고 패로 닫힘 (applied = false)
select test.as_user('b');
select test.expect_eq('DC-01 늦게 돌아옴', public.stack_vs_save(test.v('g2'), '{"late":true}'::jsonb, 9)::jsonb->>'end_reason', 'disconnect');
select test.expect_eq('DC-02 B 패', test.g(test.v('g2'), 'winner_id'), test.v('m_에이')::text);
select test.expect_eq('DC-03 늦은 저장 안 됨', test.b(test.v('g2'), test.v('m_비'), 'lines'), '0');

-- ── FN. 끝난 판 거부
select test.expect_error($$select public.stack_vs_save(test.v('g2'), '{}'::jsonb, 0)$$, 'GAME_NOT_ACTIVE');
select test.expect_error($$select public.stack_vs_send(test.v('g2'), 2, 2)$$, 'GAME_NOT_ACTIVE');
select test.expect_eq('FN-01 끝난 판 끝내기 = 반영 안 됨', public.stack_vs_end(test.v('g2'), 'quit')->>'applied', 'false');
select test.expect_eq('FN-02 승자 그대로', test.g(test.v('g2'), 'winner_id'), test.v('m_에이')::text);
select test.expect_eq('FN-03 확정 다시 = 반영 안 됨', public.stack_vs_claim_disconnect(test.v('g2'))->>'applied', 'false');
select test.expect_count($$select 1 from public.game_stack_garbage where game_id = test.v('g2')$$, 4);

-- ── RM. 한 판 더 (같은 종류만, 받은 사람 = black) + 내기
select test.as_user('a');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'), 'omok', test.v('g2'))$$, 'GAME_BAD_REMATCH');
insert into test.ctx values ('g3', public.invite_game(test.v('l1'), test.v('m_비'), 'stack_vs', test.v('g2'), '커피 사기')::text);
select test.expect_eq('RM-01 한 판 더 black = 받은 사람', test.g(test.v('g3'), 'black_id'), test.v('m_비')::text);
select test.expect_eq('RM-02 앞 판', test.g(test.v('g3'), 'rematch_of'), test.v('g2')::text);
select test.as_user('b');
select public.respond_game(test.v('g3'), true);

-- ── TO. 끝 판정 순서: 먼저 도착한 topout 이 패, 늦게 온 쪽은 반영 안 됨 + 닿은 시각은 남음
select test.as_user('b');
select test.expect_eq('TO-01 먼저 닿음', public.stack_vs_end(test.v('g3'), 'topout')->>'applied', 'true');
select test.as_user('a');
select test.expect_eq('TO-02 늦게 닿음', public.stack_vs_end(test.v('g3'), 'topout')->>'applied', 'false');
select test.expect_eq('TO-03 먼저 닿은 B 패', test.g(test.v('g3'), 'winner_id'), test.v('m_에이')::text);
select test.expect_eq('TO-04 사유', test.g(test.v('g3'), 'end_reason'), 'topout');
select test.expect_eq('TO-05 늦은 쪽 닿은 시각 기록', (test.b(test.v('g3'), test.v('m_에이'), 'topped_out_at') is not null)::text, 'true');
select test.expect_error($$select public.stack_vs_end(test.v('g3'), 'resign')$$, 'STACK_BAD_REASON');

-- ── QT. 그만하기 = 패
insert into test.ctx values ('g4', public.invite_game(test.v('l1'), test.v('m_비'), 'stack_vs', test.v('g3'), null)::text);
select test.as_user('b');
select public.respond_game(test.v('g4'), true);
select test.as_user('a');
select test.expect_eq('QT-01 그만하기', public.stack_vs_end(test.v('g4'), 'quit')->>'end_reason', 'quit');
select test.expect_eq('QT-02 A 패', test.g(test.v('g4'), 'winner_id'), test.v('m_비')::text);

-- ── AB. 둘 다 30초 넘게 없음 → 중단 (전적 없음). 화면 열기(sweep_games)로도 닫힌다
select test.as_user('b');
insert into test.ctx values ('g5', public.invite_game(test.v('l1'), test.v('m_에이'), 'stack_vs', test.v('g4'), null)::text);
select test.as_user('a');
select public.respond_game(test.v('g5'), true);
select public.stack_vs_save(test.v('g5'), '{}'::jsonb, 0);
select test.as_user('b');
select public.stack_vs_save(test.v('g5'), '{}'::jsonb, 0);
select test.ago(test.v('g5'), 120);
select test.seen(test.v('g5'), test.v('m_에이'), 40);
select test.seen(test.v('g5'), test.v('m_비'), 35);
select test.as_user('c');
select test.expect_eq('AB-01 화면 열기로 닫음', public.sweep_games(test.v('l1'))::text, '1');
select test.expect_eq('AB-02 중단', test.g(test.v('g5'), 'status') || '/' || test.g(test.v('g5'), 'end_reason'), 'abandoned/timeout');
select test.expect_eq('AB-03 승자 없음', test.g(test.v('g5'), 'winner_id'), null);

-- ── SW. 저장본이 없는 사람은 시작 시각부터 30초 (수락 후 들어오지 않음) → 그 사람 패, 다른 판 초대 가능
select test.as_user('a');
insert into test.ctx values ('g6', public.invite_game(test.v('l1'), test.v('m_비'), 'stack_vs', null, null)::text);
select test.as_user('b');
select public.respond_game(test.v('g6'), true);
select public.stack_vs_save(test.v('g6'), '{}'::jsonb, 0);
select test.ago(test.v('g6'), 31);
select test.expect_eq('SW-01 확정', public.stack_vs_claim_disconnect(test.v('g6'))->>'winner_id', test.v('m_비')::text);
select test.as_user('a');
insert into test.ctx values ('g7', public.invite_game(test.v('l1'), test.v('m_씨'), 'omok', null, null)::text);
select test.expect_eq('SW-02 다음 판(오목) 초대', test.g(test.v('g7'), 'kind') || '/' || test.g(test.v('g7'), 'rule'), 'omok/renju_lite');

-- ── 값 규칙 (관리자 직접 쓰기)
reset role;
select test.expect_error($$update public.game set bet = ' 앞 공백' where id = test.v('g3')$$, 'game_bet_rule');
select test.expect_error($$update public.game set bet = '내기' where id = test.v('g7')$$, 'game_kind_rule');
select test.expect_error($$update public.game set end_reason = 'five' where id = test.v('g3')$$, 'game_kind_rule');
select test.expect_error($$update public.game set seed = null where id = test.v('g3')$$, 'game_kind_rule');
select test.expect_error($$update public.game set rule = 'renju_lite' where id = test.v('g3')$$, 'game_');

rollback;
