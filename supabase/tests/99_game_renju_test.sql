-- BANB-53 오목 1+: 판별 룰(free / renju_lite) · 33 금지(흑·백) · 한 수 30초(서버 마감) · 무승부 제안
--   QA 케이스 RJ-01~12 · RX-01 · RL-01/04/05 · TL-01/02/06/07/09/10/11/12/14 · DR-01~11 · GR-01
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK. now() 는 트랜잭션 안에서 같은 값이라 "시간이 지남"은 turn_deadline 을 앞당겨 만든다
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
    when 'a' then '00000000-0000-0000-0000-0000000da001'
    when 'b' then '00000000-0000-0000-0000-0000000db001'
    when 'c' then '00000000-0000-0000-0000-0000000dc001'
    else '00000000-0000-0000-0000-0000000df001' end, false)
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
-- 판 마감을 지금보다 p_sec 초 뒤로 (음수 = 지남). 관리자 권한
create function test.deadline(p_id uuid, p_sec int) returns void language sql security definer as $$
  update public.game set turn_deadline = now() + make_interval(secs => p_sec) where id = p_id
$$;
grant execute on function test.deadline(uuid, int) to authenticated;

/*
 * 33 판정용 판 만들기 (관리자 권한): A = 흑, B = 백, renju_lite 대국 중. p_black / p_white = [[x, y], ...]
 * 둘 차례(p_turn)가 맞게 상대 쪽에 판 끝 줄(흑 = 0·1행, 백 = 13·14행) 돌을 채운다. 이전 A·B 판은 끝낸다
 */
create function test.board(p_black int[], p_white int[], p_turn text) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
  v_b int[] := coalesce(p_black, '{}');
  v_w int[] := coalesce(p_white, '{}');
  v_bn int := coalesce(array_length(p_black, 1), 0);
  v_wn int := coalesce(array_length(p_white, 1), 0);
  v_bfill int[] := array[[1,0],[3,0],[5,0],[7,0],[9,0],[11,0],[13,0],[0,1],[2,1],[4,1],[6,1],[8,1],[10,1],[12,1],[14,1]];
  v_wfill int[] := array[[1,14],[3,14],[5,14],[7,14],[9,14],[11,14],[13,14],[0,13],[2,13],[4,13],[6,13],[8,13],[10,13],[12,13],[14,13]];
  v_need int;
  v_i int;
begin
  update public.game set status = 'finished', end_reason = 'resign', winner_id = black_id, finished_at = now(), draw_offer_by = null
    where ledger_id = test.v('l1') and status = 'active';
  -- 흑 차례: 흑 수 = 백 수 / 백 차례: 흑 수 = 백 수 + 1
  v_need := v_bn - v_wn - case when p_turn = 'black' then 0 else 1 end;
  if v_need > 0 then
    for v_i in 1..v_need loop v_w := v_w || v_wfill[v_i:v_i][1:2]; end loop;
  elsif v_need < 0 then
    for v_i in 1..(-v_need) loop v_b := v_b || v_bfill[v_i:v_i][1:2]; end loop;
  end if;
  v_bn := coalesce(array_length(v_b, 1), 0);
  v_wn := coalesce(array_length(v_w, 1), 0);
  insert into public.game (ledger_id, black_id, white_id, created_by, status, started_at, rule, turn_deadline, move_count)
    values (test.v('l1'), test.v('m_에이'), test.v('m_비'), test.v('m_비'), 'active', now(), 'renju_lite',
            now() + interval '30 seconds', v_bn + v_wn)
    returning id into v_id;
  for v_i in 1..v_bn loop
    insert into public.game_move (game_id, ledger_id, seq, x, y, member_id)
      values (v_id, test.v('l1'), 2 * v_i - 1, v_b[v_i][1], v_b[v_i][2], test.v('m_에이'));
  end loop;
  for v_i in 1..v_wn loop
    insert into public.game_move (game_id, ledger_id, seq, x, y, member_id)
      values (v_id, test.v('l1'), 2 * v_i, v_w[v_i][1], v_w[v_i][2], test.v('m_비'));
  end loop;
  return v_id;
end $$;
grant execute on function test.board(int[], int[], text) to authenticated;

/*
 * 판을 만들고 (p_x, p_y)에 둔다 → 'forbidden' / 'win' / 'ok'. 둘 사람 = p_turn (흑 = A, 백 = B)
 */
create function test.try(p_black int[], p_white int[], p_turn text, p_x int, p_y int) returns text
language plpgsql as $$
declare
  v_id uuid := test.board(p_black, p_white, p_turn);
  v_res jsonb;
begin
  perform test.as_user(case when p_turn = 'black' then 'a' else 'b' end);
  begin
    v_res := public.play_move(v_id, p_x, p_y);
  exception when others then
    if sqlerrm like '%GAME_FORBIDDEN_33%' then
      -- 거부: 돌 없음·차례·마감 그대로 (RX-01)
      if exists (select 1 from public.game_move m where m.game_id = v_id and m.x = p_x and m.y = p_y) then
        raise exception 'TEST FAILED: forbidden move was stored';
      end if;
      return 'forbidden';
    end if;
    raise;
  end;
  return case when v_res->>'end_reason' = 'five' then 'win' else 'ok' end;
end $$;
grant execute on function test.try(int[], int[], text, int, int) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000da001', 'a@renju.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000db001', 'b@renju.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000dc001', 'c@renju.test', '{"full_name": "씨"}'),
  ('00000000-0000-0000-0000-0000000df001', 'x@renju.test', '{"full_name": "엑스"}');

-- ── 0. 스키마·권한 모양
select test.expect_count($$select 1 where has_function_privilege('authenticated', 'public.claim_turn_timeout(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_turn_timeout(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.offer_draw(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.offer_draw(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.respond_draw(uuid,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.respond_draw(uuid,boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.game_server_now()', 'execute')
  and not has_function_privilege('anon', 'public.game_server_now()', 'execute')
  and not has_function_privilege('authenticated', 'public.omok_is_double_three(int[],int[],int,int)', 'execute')
  and not has_function_privilege('authenticated', 'public.game_close_overdue(public.game)', 'execute')
  and not has_function_privilege('authenticated', 'public.game_lock_as_player(uuid)', 'execute')
  and not has_table_privilege('authenticated', 'public.game', 'update')$$, 1);
-- 열 기본값: 새 판 renju_lite (마이그레이션 전 판은 free 로 채워짐 — RL-05 는 운영 확인 쿼리 check_applied.sql)
select test.expect_count($$select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game'
  and column_name = 'rule' and column_default like '%renju_lite%' and is_nullable = 'NO'$$, 1);

set role authenticated;
select test.as_user('a');
insert into test.ctx values ('l1', public.create_ledger('렌주 L1', '에이')::text);
insert into public.invite (ledger_id) values (test.v('l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = test.v('l1') and is_revoked = false));
select test.as_user('b');
select public.join_ledger((select val from test.ctx where key = 'code'), '비');
select test.as_user('c');
select public.join_ledger((select val from test.ctx where key = 'code'), '씨');
select test.as_user('x');
insert into test.ctx values ('lx', public.create_ledger('렌주 LX', '엑스')::text);
reset role;
insert into test.ctx select 'm_' || m.display_name, m.id::text from public.member m where m.ledger_id in (test.v('l1'), test.v('lx'));
set role authenticated;

-- ── RJ. 33 판정 (좌표 = (열 x, 행 y), 흑 = A 가 둔다. 따로 적은 경우 제외)
select test.expect_eq('RJ-01 세로·가로 열린 3', test.try(array[[7,5],[7,6],[5,7],[6,7]], null, 'black', 7, 7), 'forbidden');
select test.expect_eq('RJ-02 한 칸 띈 3', test.try(array[[7,4],[7,5],[5,7],[6,7]], null, 'black', 7, 7), 'forbidden');
select test.expect_eq('RJ-03 한쪽 막힘', test.try(array[[7,5],[7,6],[5,7],[6,7]], array[[7,4]], 'black', 7, 7), 'ok');
select test.expect_eq('RJ-04 한 칸 떨어져 막힘', test.try(array[[7,5],[7,6],[5,7],[6,7]], array[[7,9]], 'black', 7, 7), 'forbidden');
select test.expect_eq('RJ-05 44 허용', test.try(array[[7,4],[7,5],[7,6],[4,7],[5,7],[6,7]], null, 'black', 7, 7), 'ok');
select test.expect_eq('RJ-06 43 허용', test.try(array[[7,4],[7,5],[7,6],[5,7],[6,7]], null, 'black', 7, 7), 'ok');
select test.expect_eq('RJ-07 장목 승리', test.try(array[[7,2],[7,3],[7,4],[7,6],[7,7]], null, 'black', 7, 5), 'win');
select test.expect_eq('RJ-08 5목 + 33 = 승리',
  test.try(array[[7,3],[7,4],[7,5],[7,6],[5,7],[6,7],[5,5],[6,6]], null, 'black', 7, 7), 'win');
select test.expect_eq('RJ-09 다른 곳의 열린 3은 안 셈', test.try(array[[2,2],[3,2],[4,2],[5,7],[6,7]], null, 'black', 7, 7), 'ok');
select test.expect_eq('RJ-10 판 끝은 막힘', test.try(array[[0,7],[1,7],[2,6],[2,5]], null, 'black', 2, 7), 'ok');
select test.expect_eq('RJ-11 백도 금지', test.try(array[[0,0]], array[[7,5],[7,6],[5,7],[6,7]], 'white', 7, 7), 'forbidden');
select test.expect_eq('RJ-12 대각 2방향', test.try(array[[5,5],[6,6],[9,5],[8,6]], null, 'black', 7, 7), 'forbidden');
-- 판정 함수 직접 (한 칸 띈 X_XX 모양 · 막힌 3 + 열린 3 = 허용)
reset role;
select test.expect_count($$select 1 where public.omok_is_double_three(array[4*15+7, 6*15+7, 7*15+7, 7*15+5, 7*15+6], '{}', 7, 7)
  and not public.omok_is_double_three(array[5*15+7, 6*15+7, 7*15+7, 7*15+5, 7*15+6], array[8*15+7, 4*15+7], 7, 7)$$, 1);
set role authenticated;
-- RX-01: 금지 수 뒤에도 차례·마감 그대로, 같은 사람이 다른 곳에 둘 수 있다
select test.as_user('a');
insert into test.ctx values ('rx', test.board(array[[7,5],[7,6],[5,7],[6,7]], null, 'black')::text);
select test.as_user('a');
insert into test.ctx values ('rx_deadline', test.g(test.v('rx'), 'turn_deadline'));
select test.expect_error($$select public.play_move(test.v('rx'), 7, 7)$$, 'GAME_FORBIDDEN_33');
select test.expect_eq('RX-01 차례 그대로', test.g(test.v('rx'), 'move_count'), '8');
select test.expect_eq('RX-01 마감 그대로', test.g(test.v('rx'), 'turn_deadline'), (select val from test.ctx where key = 'rx_deadline'));
select test.expect_eq('RX-01 다른 곳', public.play_move(test.v('rx'), 10, 10)->>'applied', 'true');
-- 관리자라도 renju_lite 대국 중인 판의 마감을 비울 수 없다
reset role;
select test.expect_error($$update public.game set turn_deadline = null where id = test.v('rx')$$, 'game_rule_time');
set role authenticated;

-- ── RL·TL. 초대로 만든 새 판 = renju_lite, 수락 순간 흑 마감 = now() + 30초
reset role;
update public.game set status = 'finished', end_reason = 'resign', winner_id = black_id, finished_at = now(), draw_offer_by = null
  where ledger_id = test.v('l1') and status = 'active';
set role authenticated;
select test.as_user('a');
insert into test.ctx values ('t1', public.invite_game(test.v('l1'), test.v('m_비'))::text);
select test.expect_eq('RL-01 rule', test.g(test.v('t1'), 'rule'), 'renju_lite');
select test.expect_eq('invited: no deadline', test.g(test.v('t1'), 'turn_deadline'), null);
select test.as_user('b');
select test.expect_eq('TL-01 accept', public.respond_game(test.v('t1'), true)->>'turn_deadline',
  to_jsonb(now() + interval '30 seconds')#>>'{}');
-- RL-04 / GR-01: 룰·마감·제안을 직접 못 바꾼다
select test.expect_error($$update public.game set rule = 'free' where id = test.v('t1')$$, 'permission denied');
select test.expect_error($$update public.game set turn_deadline = now() + interval '1 hour' where id = test.v('t1')$$, 'permission denied');
select test.expect_error($$update public.game set draw_offer_by = test.v('m_비') where id = test.v('t1')$$, 'permission denied');
-- TL-02: 수를 두면 마감 = 그 수의 서버 시각 + 30초
select test.expect_eq('TL-02 move', public.play_move(test.v('t1'), 7, 7)->>'turn_deadline', to_jsonb(now() + interval '30 seconds')#>>'{}');
-- TL-06: 마감 전 확정 요청은 거부 (참가자 A 도, 마감 1초 남음)
select test.as_user('a');
select test.deadline(test.v('t1'), 1);
select test.expect_error($$select public.claim_turn_timeout(test.v('t1'))$$, 'GAME_NOT_TIMED_OUT');
-- 마감 = 지금이면 아직 (now() > turn_deadline 일 때만)
select test.deadline(test.v('t1'), 0);
select test.expect_error($$select public.claim_turn_timeout(test.v('t1'))$$, 'GAME_NOT_TIMED_OUT');
select test.expect_eq('deadline = now: move ok', public.play_move(test.v('t1'), 8, 8)->>'applied', 'true');
-- TL-09: 참가자가 아닌 C·다른 가계부 X 는 확정 요청 불가
select test.deadline(test.v('t1'), -1);
select test.as_user('c');
select test.expect_error($$select public.claim_turn_timeout(test.v('t1'))$$, 'GAME_NOT_PLAYER');
select test.as_user('x');
select test.expect_error($$select public.claim_turn_timeout(test.v('t1'))$$, 'GAME_NOT_FOUND');
-- TL-07: 마감 뒤 수는 반영되지 않고 시간 초과로 닫힘 (차례 = 흑 B → A 승)
select test.as_user('b');
select test.expect_eq('TL-07 late move', public.play_move(test.v('t1'), 9, 9)->>'applied', 'false');
select test.expect_count($$select 1 from public.game where id = test.v('t1') and status = 'finished' and end_reason = 'turn_timeout'
  and winner_id = test.v('m_에이') and move_count = 2$$, 1);
select test.expect_count($$select * from public.game_move where game_id = test.v('t1')$$, 2);
-- TL-11: 다시 확정 요청해도 변화 없음
select test.expect_eq('TL-11 claim again', public.claim_turn_timeout(test.v('t1'))->>'applied', 'false');

-- TL-10: 시간이 다 된 쪽 본인이 확정 요청해도 처리됨. 한 판 더도 renju_lite (RL-03 일부)
select test.as_user('a');
insert into test.ctx values ('t2', public.invite_game(test.v('l1'), test.v('m_비'), 'omok', test.v('t1'))::text);
select test.expect_eq('rematch rule', test.g(test.v('t2'), 'rule'), 'renju_lite');
select test.as_user('b');
select public.respond_game(test.v('t2'), true);
-- 흑 = A(흑백 바꿈). A 차례 마감 지남 → A 본인이 확정 → B 승
select test.deadline(test.v('t2'), -5);
select test.as_user('a');
select test.expect_eq('TL-10 self claim', public.claim_turn_timeout(test.v('t2'))->>'end_reason', 'turn_timeout');
select test.expect_eq('TL-10 winner', test.g(test.v('t2'), 'winner_id'), test.v('m_비')::text);

-- TL-12 / TL-14 (Q19): 둘 다 앱 밖, 24시간 넘게 지남 → 열 때(sweep) 시간 초과. 중단(abandoned) 아님
insert into test.ctx values ('t3', public.invite_game(test.v('l1'), test.v('m_씨'))::text);
select test.as_user('c');
select public.respond_game(test.v('t3'), true);
reset role;
update public.game set started_at = now() - interval '25 hours', turn_deadline = now() - interval '25 hours' + interval '30 seconds'
  where id = test.v('t3');
set role authenticated;
select test.expect_eq('TL-12 sweep', public.sweep_games(test.v('l1'))::text, '1');
select test.expect_count($$select 1 from public.game where id = test.v('t3') and status = 'finished' and end_reason = 'turn_timeout'
  and winner_id = test.v('m_에이')$$, 1);
-- 기권도 마감 뒤면 시간 초과가 먼저
select test.as_user('a');
insert into test.ctx values ('t4', public.invite_game(test.v('l1'), test.v('m_씨'))::text);
select test.as_user('c');
select public.respond_game(test.v('t4'), true);
select test.deadline(test.v('t4'), -1);
select test.as_user('a');
select test.expect_eq('resign after deadline', public.resign_game(test.v('t4'))->>'end_reason', 'turn_timeout');
select test.expect_eq('resign after deadline winner', test.g(test.v('t4'), 'winner_id'), test.v('m_에이')::text);

-- ── DR. 무승부 제안: A → B 초대, 흑 = B
insert into test.ctx values ('d1', public.invite_game(test.v('l1'), test.v('m_비'))::text);
select test.as_user('b');
select public.respond_game(test.v('d1'), true);
-- DR-02: 상대 차례(A)엔 제안 불가
select test.as_user('a');
select test.expect_error($$select public.offer_draw(test.v('d1'))$$, 'GAME_NOT_YOUR_TURN');
-- DR-11: 참가자가 아닌 사람
select test.as_user('c');
select test.expect_error($$select public.offer_draw(test.v('d1'))$$, 'GAME_NOT_PLAYER');
-- DR-01: B(흑, 차례) 제안 → 상대 A 화면에 보이도록 draw_offer_by = B
select test.as_user('b');
select test.expect_eq('DR-01 offer', public.offer_draw(test.v('d1'))->>'draw_offer_by', test.v('m_비')::text);
select test.expect_eq('DR-01 offer again', public.offer_draw(test.v('d1'))->>'applied', 'false');
-- 제안한 사람은 수락 못 함
select test.expect_error($$select public.respond_draw(test.v('d1'), true)$$, 'GAME_NOT_DRAW_TARGET');
select test.as_user('c');
select test.expect_error($$select public.respond_draw(test.v('d1'), true)$$, 'GAME_NOT_PLAYER');
-- DR-04: A 거절 → 제안 사라짐, 판 계속, 마감 그대로
select test.as_user('a');
insert into test.ctx values ('d1_deadline', test.g(test.v('d1'), 'turn_deadline'));
select test.expect_eq('DR-04 reject', public.respond_draw(test.v('d1'), false)->>'draw_offer_by', null);
select test.expect_eq('DR-04 status', test.g(test.v('d1'), 'status'), 'active');
select test.expect_eq('DR-04 deadline', test.g(test.v('d1'), 'turn_deadline'), (select val from test.ctx where key = 'd1_deadline'));
-- 이미 사라진 제안에 답하면 applied false
select test.expect_eq('respond no offer', public.respond_draw(test.v('d1'), true)->>'applied', 'false');
-- DR-06: 같은 차례에 다시 제안 불가
select test.as_user('b');
select test.expect_error($$select public.offer_draw(test.v('d1'))$$, 'GAME_DRAW_TOO_SOON');
-- DR-09 (Q18): 제안자가 자기 수를 둬도 제안은 남는다 → 상대가 수락 가능
select public.play_move(test.v('d1'), 7, 7);
select test.as_user('a');
select public.play_move(test.v('d1'), 0, 0);
select test.as_user('b');
select test.expect_eq('DR-06 offer after opp move', public.offer_draw(test.v('d1'))->>'applied', 'true');
select public.play_move(test.v('d1'), 8, 8);
select test.expect_eq('DR-09 offer stays', test.g(test.v('d1'), 'draw_offer_by'), test.v('m_비')::text);
-- 상대(A)는 제안이 남아 있는 동안 자기 제안을 낼 수 없다(답부터)
select test.as_user('a');
select test.expect_error($$select public.offer_draw(test.v('d1'))$$, 'GAME_DRAW_PENDING');
-- DR-05: 상대(A)가 그냥 두면 제안 자동 취소
select public.play_move(test.v('d1'), 0, 1);
select test.expect_eq('DR-05 auto cancel', test.g(test.v('d1'), 'draw_offer_by'), null);
-- DR-08 (Q18): 제안 후 마감이 지난 뒤 수락 → 반영 안 됨, 시간 초과가 먼저
select test.as_user('b');
select public.offer_draw(test.v('d1'));
select test.deadline(test.v('d1'), -1);
select test.as_user('a');
select test.expect_eq('DR-08 late accept', public.respond_draw(test.v('d1'), true)->>'applied', 'false');
select test.expect_count($$select 1 from public.game where id = test.v('d1') and status = 'finished' and end_reason = 'turn_timeout'
  and winner_id = test.v('m_에이') and draw_offer_by is null$$, 1);
-- DR-10: 끝난 판에서 제안·수락
select test.as_user('b');
select test.expect_error($$select public.offer_draw(test.v('d1'))$$, 'GAME_NOT_ACTIVE');
select test.as_user('a');
select test.expect_eq('DR-10 respond finished', public.respond_draw(test.v('d1'), true)->>'applied', 'false');
-- DR-03: 수락 → draw_agreed, 승자 없음 (전적 무)
insert into test.ctx values ('d2', public.invite_game(test.v('l1'), test.v('m_비'))::text);
select test.as_user('b');
select public.respond_game(test.v('d2'), true);
select public.offer_draw(test.v('d2'));
select test.as_user('a');
select test.expect_eq('DR-03 accept', public.respond_draw(test.v('d2'), true)->>'end_reason', 'draw_agreed');
select test.expect_count($$select 1 from public.game where id = test.v('d2') and status = 'finished' and winner_id is null
  and draw_offer_by is null and finished_at is not null$$, 1);
-- DR-07: 제안 중에도 제안자 시계가 흐름 → 마감 지나 확정 = 제안자 패, 제안 사라짐
insert into test.ctx values ('d3', public.invite_game(test.v('l1'), test.v('m_비'))::text);
select test.as_user('b');
select public.respond_game(test.v('d3'), true);
select public.offer_draw(test.v('d3'));
select test.deadline(test.v('d3'), -1);
select test.as_user('a');
select test.expect_eq('DR-07 claim', public.claim_turn_timeout(test.v('d3'))->>'winner_id', test.v('m_에이')::text);
select test.expect_eq('DR-07 offer gone', test.g(test.v('d3'), 'draw_offer_by'), null);

-- ── free 판(옛 판): 마감 없음 · 33 허용 · 확정 요청은 24시간 전엔 거부
reset role;
with g as (
  insert into public.game (ledger_id, black_id, white_id, created_by, status, started_at, rule)
    values (test.v('l1'), test.v('m_에이'), test.v('m_비'), test.v('m_비'), 'active', now(), 'free') returning id)
insert into test.ctx select 'f1', id::text from g;
insert into public.game_move (game_id, ledger_id, seq, x, y, member_id) values
  (test.v('f1'), test.v('l1'), 1, 7, 5, test.v('m_에이')), (test.v('f1'), test.v('l1'), 2, 0, 14, test.v('m_비')),
  (test.v('f1'), test.v('l1'), 3, 7, 6, test.v('m_에이')), (test.v('f1'), test.v('l1'), 4, 2, 14, test.v('m_비')),
  (test.v('f1'), test.v('l1'), 5, 5, 7, test.v('m_에이')), (test.v('f1'), test.v('l1'), 6, 4, 14, test.v('m_비')),
  (test.v('f1'), test.v('l1'), 7, 6, 7, test.v('m_에이')), (test.v('f1'), test.v('l1'), 8, 6, 14, test.v('m_비'));
update public.game set move_count = 8 where id = test.v('f1');
-- 관리자라도 free 판에 마감을 넣을 수 없다
select test.expect_error($$update public.game set turn_deadline = now() where id = test.v('f1')$$, 'game_rule_time');
set role authenticated;
select test.as_user('b');
select test.expect_error($$select public.claim_turn_timeout(test.v('f1'))$$, 'GAME_NOT_TIMED_OUT');
select test.as_user('a');
select test.expect_eq('RL-02 free allows 33', public.play_move(test.v('f1'), 7, 7)->>'turn_deadline', null);

-- ── 값 규칙 (관리자 직접 쓰기)
reset role;
select test.expect_error($$update public.game set end_reason = 'draw_agreed' where id = test.v('t1')$$, 'game_state_rule');
select test.expect_error($$update public.game set draw_offer_by = test.v('m_씨') where id = test.v('f1')$$, 'game_draw_offer_rule');

rollback;
