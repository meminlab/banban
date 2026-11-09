-- BANB-49 같이 놀기(오목): 서버 판정 테스트
--   차례·빈칸·판 범위 · 5목·장목(6목) 승리 · 판이 차면 무승부 · 기권 · 초대 거절·10분 만료 · 24시간 중단
--   · 한 사람 진행 중 판 1개 · "한 판 더" 흑백 교대 · 같은 가계부 멤버만 보기 · 직접 쓰기 불가
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK (now() 는 트랜잭션 안에서 같은 값)
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
-- 로그인 사용자 바꾸기 (a / b / c / x)
create function test.as_user(p_who text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case p_who
    when 'a' then '00000000-0000-0000-0000-0000000ca001'
    when 'b' then '00000000-0000-0000-0000-0000000cb001'
    when 'c' then '00000000-0000-0000-0000-0000000cc001'
    else '00000000-0000-0000-0000-0000000cf001' end, false)
$$;
grant execute on function test.as_user(text) to authenticated;
-- 판의 지금 결과 (기대값 계산용, 관리자 권한)
create function test.result(p_id uuid, p_applied boolean) returns jsonb language sql security definer as $$
  select public.game_result(g, p_applied) from public.game g where g.id = p_id
$$;
grant execute on function test.result(uuid, boolean) to authenticated;
-- 여러 수를 차례로 둔다: p_moves = [[x, y], ...], 흑·백 사용자를 번갈아. 마지막 결과
create function test.play(p_game uuid, p_black text, p_white text, p_moves int[]) returns jsonb
language plpgsql as $$
declare
  v_res jsonb;
  v_n int := (test.result(p_game, true)->>'move_count')::int;
begin
  for i in 1..array_length(p_moves, 1) loop
    perform test.as_user(case when (v_n + i) % 2 = 1 then p_black else p_white end);
    v_res := public.play_move(p_game, p_moves[i][1], p_moves[i][2]);
  end loop;
  return v_res;
end $$;
grant execute on function test.play(uuid, text, text, int[]) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000ca001', 'a@game.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000cb001', 'b@game.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000cc001', 'c@game.test', '{"full_name": "씨"}'),
  ('00000000-0000-0000-0000-0000000cf001', 'x@game.test', '{"full_name": "엑스"}');

-- ── 0. 스키마·권한 모양
select test.expect_count($$select 1 from pg_class where oid in ('public.game'::regclass, 'public.game_move'::regclass) and relrowsecurity$$, 2);
select test.expect_count($$select 1 where not has_table_privilege('anon', 'public.game', 'select')
  and not has_table_privilege('anon', 'public.game_move', 'select')
  and has_table_privilege('authenticated', 'public.game', 'select')
  and has_table_privilege('authenticated', 'public.game_move', 'select')
  and not has_table_privilege('authenticated', 'public.game', 'insert')
  and not has_table_privilege('authenticated', 'public.game', 'update')
  and not has_table_privilege('authenticated', 'public.game', 'delete')
  and not has_table_privilege('authenticated', 'public.game_move', 'insert')
  and not has_table_privilege('authenticated', 'public.game_move', 'update')
  and not has_table_privilege('authenticated', 'public.game_move', 'delete')$$, 1);
select test.expect_count($$select 1 where has_function_privilege('authenticated', 'public.play_move(uuid,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.play_move(uuid,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.invite_game(uuid,uuid,text,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.invite_game(uuid,uuid,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.respond_game(uuid,boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.resign_game(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.sweep_games(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.game_close_stale(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.omok_has_five(int[],int,int)', 'execute')$$, 1);
select test.expect_count($$select 1 from pg_publication_tables where pubname = 'supabase_realtime'
  and schemaname = 'public' and tablename in ('game', 'game_move')$$, 2);

-- 판정 함수 (5목·장목·4목·가장자리)
select test.expect_count($$select 1 where public.omok_has_five(array[0*15+0, 1*15+0, 2*15+0, 3*15+0, 4*15+0], 2, 0)
  and public.omok_has_five(array[5*15+5, 6*15+6, 7*15+7, 8*15+8, 9*15+9, 10*15+10], 10, 10)
  and public.omok_has_five(array[14*15+0, 13*15+1, 12*15+2, 11*15+3, 10*15+4], 14, 0)
  and public.omok_has_five(array[3*15+10, 3*15+11, 3*15+12, 3*15+13, 3*15+14], 3, 12)
  and not public.omok_has_five(array[0*15+0, 1*15+0, 2*15+0, 3*15+0, 5*15+0], 3, 0)
  and not public.omok_has_five(array[14*15+14, 0*15+0, 0*15+1, 0*15+2], 0, 1)$$, 1);

-- 가계부 L1(A·B·C), LX(X)
set role authenticated;
select test.as_user('a');
insert into test.ctx values ('l1', public.create_ledger('놀이 L1', '에이')::text);
insert into public.invite (ledger_id) values (test.v('l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = test.v('l1') and is_revoked = false));
select test.as_user('b');
select public.join_ledger((select val from test.ctx where key = 'code'), '비');
select test.as_user('c');
select public.join_ledger((select val from test.ctx where key = 'code'), '씨');
select test.as_user('x');
insert into test.ctx values ('lx', public.create_ledger('놀이 LX', '엑스')::text);
reset role;
insert into test.ctx select 'm_' || m.display_name, m.id::text from public.member m where m.ledger_id in (test.v('l1'), test.v('lx'));
set role authenticated;

-- ── 1. 초대: A → B. 흑 = 초대받은 B, 백 = A
select test.as_user('a');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_에이'))$$, 'GAME_BAD_OPPONENT');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_엑스'))$$, 'GAME_BAD_OPPONENT');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'), 'tetris')$$, 'GAME_BAD_KIND');
insert into test.ctx values ('g1', public.invite_game(test.v('l1'), test.v('m_비'))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g1') and status = 'invited'
  and black_id = test.v('m_비') and white_id = test.v('m_에이') and created_by = test.v('m_에이')
  and invite_expires_at = created_at + interval '10 minutes'$$, 1);
-- 진행 중 판 1개: A 는 또 초대 못 함, C 는 B 를 초대 못 함(B 는 초대받은 판이 있음)
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_씨'))$$, 'GAME_ALREADY_OPEN');
select test.as_user('c');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'))$$, 'GAME_OPPONENT_BUSY');
-- 초대한 사람·제3자는 수락 못 함, 다른 가계부 사람은 판이 안 보임
select test.expect_error($$select public.respond_game(test.v('g1'), true)$$, 'GAME_NOT_INVITEE');
select test.as_user('a');
select test.expect_error($$select public.respond_game(test.v('g1'), true)$$, 'GAME_NOT_INVITEE');
select test.as_user('x');
select test.expect_count($$select * from public.game$$, 0);
select test.expect_error($$select public.respond_game(test.v('g1'), true)$$, 'GAME_NOT_FOUND');

-- 수락 전에는 둘 수 없다
select test.as_user('b');
select test.expect_error($$select public.play_move(test.v('g1'), 7, 7)$$, 'GAME_NOT_ACTIVE');
-- B 수락 → active
select test.expect_eq('accept', public.respond_game(test.v('g1'), true)->>'status', 'active');
-- 다시 수락해도 바뀌지 않음
select test.expect_eq('accept again', public.respond_game(test.v('g1'), true)->>'applied', 'false');

-- ── 2. 차례·빈칸·범위
-- 백(A)이 먼저 두면 거부
select test.as_user('a');
select test.expect_error($$select public.play_move(test.v('g1'), 7, 7)$$, 'GAME_NOT_YOUR_TURN');
-- 제3자 C·외부인 X 는 둘 수 없다
select test.as_user('c');
select test.expect_error($$select public.play_move(test.v('g1'), 7, 7)$$, 'GAME_NOT_PLAYER');
select test.as_user('x');
select test.expect_error($$select public.play_move(test.v('g1'), 7, 7)$$, 'GAME_NOT_FOUND');
select test.as_user('b');
select test.expect_error($$select public.play_move(test.v('g1'), 15, 0)$$, 'GAME_BAD_CELL');
select test.expect_error($$select public.play_move(test.v('g1'), 0, -1)$$, 'GAME_BAD_CELL');
select test.expect_eq('first move', public.play_move(test.v('g1'), 7, 7)->>'seq', '1');
-- 흑이 연달아 두면 거부, 백이 같은 칸에 두면 거부
select test.expect_error($$select public.play_move(test.v('g1'), 8, 8)$$, 'GAME_NOT_YOUR_TURN');
select test.as_user('a');
select test.expect_error($$select public.play_move(test.v('g1'), 7, 7)$$, 'GAME_CELL_TAKEN');
-- 직접 쓰기 불가 (수 넣기·판 바꾸기)
select test.expect_error($$insert into public.game_move (game_id, ledger_id, seq, x, y, member_id)
  values (test.v('g1'), test.v('l1'), 2, 0, 0, test.v('m_에이'))$$, 'permission denied');
select test.expect_error($$update public.game set status = 'finished' where id = test.v('g1')$$, 'permission denied');
-- C(같은 가계부)는 판·수를 본다, X 는 못 본다
select test.as_user('c');
select test.expect_count($$select * from public.game_move where game_id = test.v('g1')$$, 1);
select test.as_user('x');
select test.expect_count($$select * from public.game_move$$, 0);

-- ── 3. 5목 승리: 흑 B 가로 (7..11, 7), 백 A 는 (0, 0..3)
select test.expect_eq('five',
  test.play(test.v('g1'), 'b', 'a', array[[0,0], [8,7], [0,1], [9,7], [0,2], [10,7], [0,3], [11,7]])::text,
  (test.result(test.v('g1'), true) || jsonb_build_object('seq', 9))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g1') and status = 'finished' and end_reason = 'five'
  and winner_id = test.v('m_비') and move_count = 9 and finished_at is not null$$, 1);
-- 끝난 판에는 둘 수 없다·기권 안 바뀜
select test.as_user('a');
select test.expect_error($$select public.play_move(test.v('g1'), 1, 1)$$, 'GAME_NOT_ACTIVE');
select test.expect_eq('resign finished', public.resign_game(test.v('g1'))->>'applied', 'false');

-- ── 4. "한 판 더": 흑백 바꿈 (A 흑, B 백). 누가 눌러도 같다
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_씨'), 'omok', test.v('g1'))$$, 'GAME_BAD_REMATCH');
insert into test.ctx values ('g2', public.invite_game(test.v('l1'), test.v('m_비'), 'omok', test.v('g1'))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g2') and black_id = test.v('m_에이')
  and white_id = test.v('m_비') and created_by = test.v('m_에이') and rematch_of = test.v('g1')$$, 1);
-- B 거절 → declined, 다시 초대 가능
select test.as_user('b');
select test.expect_eq('decline', public.respond_game(test.v('g2'), false)->>'status', 'declined');

-- ── 5. 장목(6목) 승리: B 가 다시 한 판 더 (흑 A). A 가 (2,5)(3,5)(4,5)(6,5)(7,5) 다음 (5,5) → 6개
insert into test.ctx values ('g3', public.invite_game(test.v('l1'), test.v('m_에이'), 'omok', test.v('g1'))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g3') and black_id = test.v('m_에이') and white_id = test.v('m_비')$$, 1);
select test.as_user('a');
select public.respond_game(test.v('g3'), true);
select test.expect_eq('overline',
  test.play(test.v('g3'), 'a', 'b', array[[2,5], [0,0], [3,5], [0,1], [4,5], [0,2], [6,5], [0,3], [7,5], [14,14], [5,5]])->>'end_reason',
  'five');
select test.expect_count($$select 1 from public.game where id = test.v('g3') and status = 'finished' and winner_id = test.v('m_에이')$$, 1);

-- ── 6. 기권: A → C, C(흑) 한 수 후 A 가 자기 차례가 아닐 때 기권 → C 승
insert into test.ctx values ('g4', public.invite_game(test.v('l1'), test.v('m_씨'))::text);
select test.as_user('c');
select public.respond_game(test.v('g4'), true);
select public.play_move(test.v('g4'), 7, 7);
select test.as_user('b');
select test.expect_error($$select public.resign_game(test.v('g4'))$$, 'GAME_NOT_PLAYER');
select test.as_user('a');
select test.expect_eq('resign', public.resign_game(test.v('g4'))->>'end_reason', 'resign');
select test.expect_count($$select 1 from public.game where id = test.v('g4') and status = 'finished' and winner_id = test.v('m_씨')$$, 1);

-- ── 7. 초대 10분 만료: A → B 초대를 11분 전으로 → 수락하면 expired (applied false), 상태 저장됨
insert into test.ctx values ('g5', public.invite_game(test.v('l1'), test.v('m_비'))::text);
reset role;
update public.game set created_at = now() - interval '11 minutes', invite_expires_at = now() - interval '1 minute' where id = test.v('g5');
set role authenticated;
select test.as_user('b');
select test.expect_eq('expired', public.respond_game(test.v('g5'), true)::text,
  (test.result(test.v('g5'), false))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g5') and status = 'expired' and finished_at is not null$$, 1);
-- 9분 59초 된 초대는 아직 유효
select test.as_user('a');
insert into test.ctx values ('g6', public.invite_game(test.v('l1'), test.v('m_비'))::text);
reset role;
update public.game set invite_expires_at = now() + interval '1 second' where id = test.v('g6');
set role authenticated;
select test.as_user('b');
select test.expect_eq('not expired', public.respond_game(test.v('g6'), true)->>'status', 'active');

-- ── 8. 24시간 중단: 마지막 수가 24시간 전이면 수를 둘 때 abandoned (timeout), 23시간이면 계속
select public.play_move(test.v('g6'), 7, 7);
reset role;
update public.game set last_move_at = now() - interval '23 hours' where id = test.v('g6');
set role authenticated;
select test.as_user('a');
select test.expect_eq('23h', public.play_move(test.v('g6'), 8, 8)->>'applied', 'true');
reset role;
update public.game set last_move_at = now() - interval '24 hours' where id = test.v('g6');
set role authenticated;
select test.as_user('b');
select test.expect_eq('24h', public.play_move(test.v('g6'), 9, 9)::text,
  (test.result(test.v('g6'), false))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g6') and status = 'abandoned' and end_reason = 'timeout'
  and winner_id is null and move_count = 2$$, 1);
select test.expect_count($$select * from public.game_move where game_id = test.v('g6')$$, 2);
-- 수 없이 수락만 하고 24시간: sweep_games 로 닫힌다 (외부인은 실행 불가)
insert into test.ctx values ('g7', public.invite_game(test.v('l1'), test.v('m_에이'))::text);
select test.as_user('a');
select public.respond_game(test.v('g7'), true);
reset role;
update public.game set started_at = now() - interval '25 hours' where id = test.v('g7');
set role authenticated;
select test.as_user('x');
select test.expect_error($$select public.sweep_games(test.v('l1'))$$, 'NOT_IN_LEDGER');
select test.as_user('c');
select test.expect_eq('sweep', public.sweep_games(test.v('l1'))::text, '1');
select test.expect_count($$select 1 from public.game where id = test.v('g7') and status = 'abandoned'$$, 1);
-- 중단된 판에서도 "한 판 더" 가능
select test.as_user('a');
insert into test.ctx values ('g8', public.invite_game(test.v('l1'), test.v('m_비'), 'omok', test.v('g7'))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g8') and status = 'invited'
  and black_id = test.v('m_비') and white_id = test.v('m_에이')$$, 1);

-- ── 9. 무승부: 5목 없이 225칸이 다 차면 draw. 칸 색 = ((x + 2y) div 2) mod 2 (0 = 흑 113칸, 1 = 백 112칸)
select test.as_user('b');
select public.respond_game(test.v('g8'), false);
insert into test.ctx values ('g9', public.invite_game(test.v('l1'), test.v('m_에이'))::text);
select test.as_user('a');
select public.respond_game(test.v('g9'), true);
select test.expect_eq('draw',
  test.play(test.v('g9'), 'a', 'b', (
    with cells as (
      select x, y, ((x + 2 * y) / 2) % 2 as color,
             row_number() over (partition by ((x + 2 * y) / 2) % 2 order by x, y) as n
      from generate_series(0, 14) x, generate_series(0, 14) y
    )
    select array_agg(array[x, y] order by n, color) from cells
  ))::text,
  (test.result(test.v('g9'), true) || jsonb_build_object('seq', 225))::text);
select test.expect_count($$select 1 from public.game where id = test.v('g9') and status = 'finished' and end_reason = 'draw'
  and winner_id is null and move_count = 225$$, 1);

-- ── 10. 값 규칙 (관리자 직접 쓰기도 상태 규칙을 지킨다)
reset role;
select test.expect_error($$update public.game set winner_id = test.v('m_씨') where id = test.v('g1')$$, 'game_winner_rule');
select test.expect_error($$update public.game set end_reason = 'draw' where id = test.v('g1')$$, 'game_state_rule');

rollback;
