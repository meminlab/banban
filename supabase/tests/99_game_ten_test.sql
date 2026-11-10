-- BANB-57 도토리 열 알: 판 만들기(화면과 같은 값)·서버 다시 세기(조작 방지)·1인 최고 기록·대전(공통 마감·기록 저장·끝 판정·그만하기)·권한
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK. now() 는 트랜잭션 안에서 같은 값이라 "마감 지남"은 turn_deadline 을 앞당겨 만든다
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
    when 'a' then '00000000-0000-0000-0000-0000001ea001'
    when 'b' then '00000000-0000-0000-0000-0000001eb001'
    when 'c' then '00000000-0000-0000-0000-0000001ec001'
    else '00000000-0000-0000-0000-0000001ef001' end, false)
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
-- 마감을 p_sec 초 전으로 (관리자 권한) — 음수면 앞으로
create function test.deadline_ago(p_id uuid, p_sec int) returns void language sql security definer as $$
  update public.game set turn_deadline = now() - make_interval(secs => p_sec) where id = p_id
$$;
grant execute on function test.deadline_ago(uuid, int) to authenticated;
-- 판 순서 값을 정한다 (관리자 권한 — 점수 기대값을 알기 위해)
create function test.set_seed(p_id uuid, p_seed int) returns void language sql security definer as $$
  update public.game set seed = p_seed where id = p_id
$$;
grant execute on function test.set_seed(uuid, int) to authenticated;
-- 서버 계산 (관리자 권한 — 화면에서는 실행 불가)
create function test.board(p_seed bigint) returns text language sql security definer as $$
  select array_to_string(public.ten_board(p_seed), '')
$$;
create function test.replay(p_seed bigint, p_drags jsonb) returns int language sql security definer as $$
  select public.ten_replay(p_seed, p_drags)
$$;
grant execute on function test.board(bigint) to authenticated;
grant execute on function test.replay(bigint, jsonb) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000001ea001', 'a@ten.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000001eb001', 'b@ten.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000001ec001', 'c@ten.test', '{"full_name": "씨"}'),
  ('00000000-0000-0000-0000-0000001ef001', 'x@ten.test', '{"full_name": "엑스"}');

-- ── 0. 스키마·권한 모양
select test.expect_count($$select 1 where has_function_privilege('authenticated', 'public.record_ten_score(uuid,bigint,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_ten_score(uuid,bigint,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.ten_vs_save(uuid,jsonb,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.ten_vs_save(uuid,jsonb,boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.ten_vs_quit(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.ten_vs_settle(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.ten_board(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.ten_replay(bigint,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.ten_vs_close(public.game)', 'execute')
  and not has_function_privilege('authenticated', 'public.ten_vs_lock(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.respond_game(uuid,boolean)', 'execute')
  and not has_table_privilege('authenticated', 'public.game_ten_best', 'insert')
  and not has_table_privilege('authenticated', 'public.game_ten_best', 'update')
  and not has_table_privilege('authenticated', 'public.game_ten_board', 'insert')
  and not has_table_privilege('authenticated', 'public.game_ten_board', 'update')
  and not has_table_privilege('anon', 'public.game_ten_board', 'select')$$, 1);

-- ── TB. 판 만들기: 화면 domain/ten.test.ts BOARD_12345 와 같은 값
select test.expect_eq('TB-01 seed 12345 판 (화면과 같음)', test.board(12345),
  '228278914719738259522249128589589554257357577534221579584232151192247578269629688624841938783578812673676571888323197534');
select test.expect_eq('TB-02 0 과 2^31-2 같은 판', (test.board(0) = test.board(2147483646))::text, 'true');
select test.expect_eq('TB-03 120칸 · 1~9', (select (length(test.board(777)) = 120 and test.board(777) !~ '0')::text), 'true');

-- ── TR. 다시 세기 (화면 DRAGS_12345 와 같음): 2 + 2 + 이미 터진 칸 0 + 합 ≠ 10 0 + 모서리 반대 2 + 빈칸 걸친 합 10 → 2 = 8
select test.expect_eq('TR-01 서버 점수', test.replay(12345, '[[1,0,2,0],[6,0,7,0],[1,0,2,0],[0,0,0,0],[4,4,3,4],[4,5,4,3]]')::text, '8');
select test.expect_eq('TR-02 빈 기록 0점', test.replay(12345, '[]')::text, '0');
-- 조작: 합이 10이 아닌 큰 네모를 많이 보내도 0점
select test.expect_eq('TR-03 가짜 네모 0점', test.replay(12345, (select jsonb_agg('[0,0,14,7]'::jsonb) from generate_series(1, 60)))::text, '0');
select test.expect_error($$select test.replay(1, '{}')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$select test.replay(1, '[[0,0,15,0]]')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$select test.replay(1, '[[0,0,0,8]]')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$select test.replay(1, '[[0,0,1]]')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$select test.replay(1, '[[0,0,1.5,0]]')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$select test.replay(1, '[[-1,0,1,0]]')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$select test.replay(1, '[["0",0,1,0]]')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$select test.replay(1, (select jsonb_agg('[0,0,0,0]'::jsonb) from generate_series(1, 121)))$$, 'TEN_BAD_DRAGS');

set role authenticated;
select test.as_user('a');
insert into test.ctx values ('l1', public.create_ledger('도토리 L1', '에이')::text);
insert into public.invite (ledger_id) values (test.v('l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = test.v('l1') and is_revoked = false));
select test.as_user('b');
select public.join_ledger((select val from test.ctx where key = 'code'), '비');
select test.as_user('c');
select public.join_ledger((select val from test.ctx where key = 'code'), '씨');
select test.as_user('x');
insert into test.ctx values ('lx', public.create_ledger('도토리 LX', '엑스')::text);
reset role;
insert into test.ctx select 'm_' || m.display_name, m.id::text from public.member m where m.ledger_id in (test.v('l1'), test.v('lx'));
set role authenticated;

-- ── SO. 1인 최고 기록: 서버가 다시 센 점수만, 더 높을 때만, 0점은 저장 안 함, 다른 가계부 못 봄
select test.as_user('a');
select test.expect_eq('SO-01 0점', public.record_ten_score(test.v('l1'), 12345, '[[0,0,0,0]]')::text,
  '{"score": 0, "is_new": false, "best_score": null, "previous_best": null}');
select test.expect_count($$select 1 from public.game_ten_best$$, 0);
select test.expect_eq('SO-02 첫 기록 = 서버 점수 8',
  public.record_ten_score(test.v('l1'), 12345, '[[1,0,2,0],[6,0,7,0],[1,0,2,0],[0,0,0,0],[4,4,3,4],[4,5,4,3]]')::text,
  '{"score": 8, "is_new": true, "best_score": 8, "previous_best": null}');
select test.expect_eq('SO-03 낮은 점수는 그대로', public.record_ten_score(test.v('l1'), 12345, '[[1,0,2,0]]')::text,
  '{"score": 2, "is_new": false, "best_score": 8, "previous_best": 8}');
select test.expect_eq('SO-04 저장값', (select best_score::text from public.game_ten_best where member_id = test.v('m_에이')), '8');
select test.expect_error($$select public.record_ten_score(test.v('l1'), -1, '[]')$$, 'TEN_BAD_SEED');
select test.expect_error($$select public.record_ten_score(test.v('l1'), 1, '[[0,0,99,0]]')$$, 'TEN_BAD_DRAGS');
select test.expect_error($$insert into public.game_ten_best (ledger_id, member_id, best_score) values (test.v('l1'), test.v('m_에이'), 120)$$, 'permission denied');
select test.as_user('b');
select test.expect_count($$select 1 from public.game_ten_best where ledger_id = test.v('l1')$$, 1);
select test.as_user('x');
select test.expect_count($$select 1 from public.game_ten_best$$, 0);
select test.expect_error($$select public.record_ten_score(test.v('l1'), 1, '[]')$$, 'NOT_IN_LEDGER');

-- ── IN. 대전 초대 (반반 쌓기 대전과 같은 함수) · 수락 = 공통 마감
select test.as_user('a');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'), 'ten', null, null)$$, 'GAME_BAD_KIND');
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_비'), 'ten_vs', null, repeat('가', 31))$$, 'GAME_BAD_BET');
insert into test.ctx values ('g1', public.invite_game(test.v('l1'), test.v('m_비'), 'ten_vs', null, ' 진 사람이 설거지 ')::text);
select test.expect_eq('IN-01 종류·룰·내기', test.g(test.v('g1'), 'kind') || '/' || test.g(test.v('g1'), 'rule') || '/' || test.g(test.v('g1'), 'bet'),
  'ten_vs/ten_vs/진 사람이 설거지');
select test.expect_eq('IN-02 순서 값 있음 · 마감 없음', (test.g(test.v('g1'), 'seed') is not null and test.g(test.v('g1'), 'turn_deadline') is null)::text, 'true');
-- 초대 중에는 기록·그만하기 불가
select test.expect_error($$select public.ten_vs_save(test.v('g1'), '[]', false)$$, 'GAME_NOT_ACTIVE');
-- 1인 1판: 대전 초대 중이면 다른 판 불가
select test.expect_error($$select public.invite_game(test.v('l1'), test.v('m_씨'), 'omok', null, null)$$, 'GAME_ALREADY_OPEN');
select test.as_user('b');
select test.expect_eq('IN-03 수락', public.respond_game(test.v('g1'), true)->>'status', 'active');
select test.expect_eq('IN-04 공통 마감 = 수락 + 125초',
  (test.g(test.v('g1'), 'turn_deadline')::timestamptz - test.g(test.v('g1'), 'started_at')::timestamptz)::text, '00:02:05');
select test.set_seed(test.v('g1'), 12345);

-- ── KD. 다른 게임 함수는 도토리 대전 판을 거부, 도토리 함수는 다른 판을 거부
select test.expect_error($$select public.play_move(test.v('g1'), 7, 7)$$, 'GAME_BAD_KIND');
select test.expect_error($$select public.stack_vs_save(test.v('g1'), '{}'::jsonb, 0)$$, 'GAME_BAD_KIND');
select test.expect_error($$select public.stack_vs_end(test.v('g1'), 'quit')$$, 'GAME_BAD_KIND');

-- ── MB. 멤버만: 다른 가계부 = 판 없음, 구경꾼 = 참가자 아님, 직접 쓰기 없음
select test.as_user('x');
select test.expect_error($$select public.ten_vs_save(test.v('g1'), '[]', false)$$, 'GAME_NOT_FOUND');
select test.expect_error($$select public.ten_vs_quit(test.v('g1'))$$, 'GAME_NOT_FOUND');
select test.expect_error($$select public.ten_vs_settle(test.v('g1'))$$, 'GAME_NOT_FOUND');
select test.expect_count($$select 1 from public.game where id = test.v('g1')$$, 0);
select test.as_user('c');
select test.expect_error($$select public.ten_vs_save(test.v('g1'), '[]', false)$$, 'GAME_NOT_PLAYER');
select test.expect_error($$select public.ten_vs_quit(test.v('g1'))$$, 'GAME_NOT_PLAYER');
select test.expect_error($$insert into public.game_ten_board (game_id, ledger_id, member_id, score) values (test.v('g1'), test.v('l1'), test.v('m_씨'), 99)$$, 'permission denied');

-- ── SV. 기록 저장: 서버가 다시 센다 (화면 점수는 받지 않음), 짧은 옛 기록은 무시
select test.as_user('a');
select test.expect_eq('SV-01 저장 → 서버 점수', public.ten_vs_save(test.v('g1'), '[[1,0,2,0],[6,0,7,0]]', false)->>'my_score', '4');
select test.expect_eq('SV-02 조작 네모는 0점', public.ten_vs_save(test.v('g1'), '[[1,0,2,0],[6,0,7,0],[0,0,14,7]]', false)->>'my_score', '4');
select test.expect_eq('SV-03 짧은 옛 기록 무시', public.ten_vs_save(test.v('g1'), '[[1,0,2,0]]', false)->>'applied', 'false');
select test.expect_eq('SV-04 대전 중 상대 점수 비공개', public.ten_vs_save(test.v('g1'), '[[1,0,2,0],[6,0,7,0],[0,0,14,7]]', false)->>'opp_score', null);
select test.expect_error($$select public.ten_vs_save(test.v('g1'), '[[0,0,20,0]]', false)$$, 'TEN_BAD_DRAGS');
select test.as_user('b');
select public.ten_vs_save(test.v('g1'), '[[1,0,2,0]]', false);
-- 대전 중에는 자기 기록만 보인다 (상대 네모 = 답 힌트)
select test.expect_count($$select 1 from public.game_ten_board where game_id = test.v('g1')$$, 1);
select test.as_user('c');
select test.expect_count($$select 1 from public.game_ten_board where game_id = test.v('g1')$$, 0);
-- 마감 전 확정 요청은 거부
select test.as_user('a');
select test.expect_error($$select public.ten_vs_settle(test.v('g1'))$$, 'GAME_NOT_TIMED_OUT');
-- 마감 전 마지막 기록(final)이 둘 다 와도 마감 전이면 끝나지 않는다
select public.ten_vs_save(test.v('g1'), '[[1,0,2,0],[6,0,7,0]]', true);
select test.as_user('b');
select test.expect_eq('SV-05 마감 전엔 계속', public.ten_vs_save(test.v('g1'), '[[1,0,2,0]]', true)->>'status', 'active');

-- ── EN. 마감 뒤: 두 사람 마지막 기록이 다 오면 바로 끝, 점수 높은 사람 승
select test.deadline_ago(test.v('g1'), 1);
select test.as_user('a');
select test.expect_eq('EN-01 마지막 기록', public.ten_vs_save(test.v('g1'), '[[1,0,2,0],[6,0,7,0],[4,4,3,4]]', true)->>'status', 'active');
select test.as_user('b');
select test.expect_eq('EN-02 둘 다 왔음 → 끝', (public.ten_vs_save(test.v('g1'), '[[1,0,2,0]]', true) - 'server_now' - 'turn_deadline' - 'finished_at' - 'id')::text,
  '{"kind": "ten_vs", "rule": "ten_vs", "status": "finished", "applied": true, "my_score": 2, "opp_score": 6, "winner_id": "' || test.v('m_에이') || '", "end_reason": "score", "move_count": 0, "draw_offer_by": null, "draw_offer_count": null}');
-- 끝난 판: 두 사람 기록 모두 보임, 더 저장해도 반영 안 됨
select test.expect_count($$select 1 from public.game_ten_board where game_id = test.v('g1')$$, 2);
select test.expect_eq('EN-03 끝난 판 저장 무시', public.ten_vs_save(test.v('g1'), '[[1,0,2,0],[6,0,7,0],[4,4,3,4],[4,5,4,3]]', true)->>'applied', 'false');
select test.expect_eq('EN-04 확정은 지금 상태', public.ten_vs_settle(test.v('g1'))->>'applied', 'false');

-- ── GR. 마감 + 5초까지 기록이 안 오면 마지막으로 받은 점수로 확정 (같으면 무승부)
select test.as_user('b');
insert into test.ctx values ('g2', public.invite_game(test.v('l1'), test.v('m_에이'), 'ten_vs', test.v('g1'), null)::text);
select test.as_user('a');
select public.respond_game(test.v('g2'), true);
select test.set_seed(test.v('g2'), 12345);
select public.ten_vs_save(test.v('g2'), '[[1,0,2,0]]', false);
select test.as_user('b');
select public.ten_vs_save(test.v('g2'), '[[6,0,7,0]]', false);
-- 마감 3초 뒤: 아직 5초 안 → 기록 받음 · 확정 거부
select test.deadline_ago(test.v('g2'), 3);
select test.expect_eq('GR-01 마감 뒤 5초 안 저장', public.ten_vs_save(test.v('g2'), '[[6,0,7,0]]', true)->>'applied', 'true');
select test.expect_error($$select public.ten_vs_settle(test.v('g2'))$$, 'GAME_NOT_TIMED_OUT');
-- 마감 6초 뒤: A 마지막 기록 없음 → 받은 점수(2:2)로 무승부. 늦은 기록은 받지 않는다
select test.deadline_ago(test.v('g2'), 6);
select test.as_user('a');
select test.expect_eq('GR-02 늦은 기록 거부', public.ten_vs_save(test.v('g2'), '[[1,0,2,0],[6,0,7,0],[4,4,3,4]]', true)->>'applied', 'false');
select test.expect_eq('GR-03 무승부', test.g(test.v('g2'), 'status') || '/' || test.g(test.v('g2'), 'end_reason') || '/' || coalesce(test.g(test.v('g2'), 'winner_id'), '-'), 'finished/draw/-');

-- ── QT. 그만하기 = 부른 사람 패 (시작 전도)
select test.as_user('a');
insert into test.ctx values ('g3', public.invite_game(test.v('l1'), test.v('m_비'), 'ten_vs', null, null)::text);
select test.as_user('b');
select public.respond_game(test.v('g3'), true);
select test.expect_eq('QT-01 그만하기', public.ten_vs_quit(test.v('g3'))->>'end_reason', 'quit');
select test.expect_eq('QT-02 B 패', test.g(test.v('g3'), 'winner_id'), test.v('m_에이')::text);
select test.expect_eq('QT-03 다시 그만하기 = 지금 상태', public.ten_vs_quit(test.v('g3'))->>'applied', 'false');

-- ── AB. 둘 다 기록이 하나도 없이 마감 + 5초 → 중단 (전적 없음). 화면 열기(sweep_games)로도 닫힌다
select test.as_user('a');
insert into test.ctx values ('g4', public.invite_game(test.v('l1'), test.v('m_비'), 'ten_vs', null, null)::text);
select test.as_user('b');
select public.respond_game(test.v('g4'), true);
select test.deadline_ago(test.v('g4'), 10);
select test.as_user('c');
select test.expect_eq('AB-01 화면 열기로 닫음', public.sweep_games(test.v('l1'))::text, '1');
select test.expect_eq('AB-02 중단', test.g(test.v('g4'), 'status') || '/' || test.g(test.v('g4'), 'end_reason'), 'abandoned/timeout');

-- ── DC. 거절·취소한 대전 판은 마감 없음 (규칙 위반 없이 닫힘)
select test.as_user('a');
insert into test.ctx values ('g5', public.invite_game(test.v('l1'), test.v('m_비'), 'ten_vs', null, null)::text);
select test.as_user('b');
select test.expect_eq('DC-01 거절', public.respond_game(test.v('g5'), false)->>'status', 'declined');
select test.as_user('a');
insert into test.ctx values ('g6', public.invite_game(test.v('l1'), test.v('m_비'), 'ten_vs', null, null)::text);
select test.expect_eq('DC-02 취소', public.cancel_game(test.v('g6'))->>'status', 'canceled');

-- ── 다른 게임은 그대로: 반반 쌓기 대전 수락 = 마감 없음, 오목 = 흑 30초
select test.as_user('a');
insert into test.ctx values ('g7', public.invite_game(test.v('l1'), test.v('m_비'), 'stack_vs', null, null)::text);
select test.as_user('b');
select public.respond_game(test.v('g7'), true);
select test.expect_eq('OT-01 반반 쌓기 대전 마감 없음', test.g(test.v('g7'), 'turn_deadline'), null);
select public.stack_vs_end(test.v('g7'), 'quit');
select test.as_user('a');
insert into test.ctx values ('g8', public.invite_game(test.v('l1'), test.v('m_비'), 'omok', null, null)::text);
select test.as_user('b');
select public.respond_game(test.v('g8'), true);
select test.expect_eq('OT-02 오목 흑 30초',
  (test.g(test.v('g8'), 'turn_deadline')::timestamptz - test.g(test.v('g8'), 'started_at')::timestamptz)::text, '00:00:30');

-- ── 값 규칙 (관리자 직접 쓰기)
reset role;
select test.expect_error($$update public.game set end_reason = 'topout' where id = test.v('g1')$$, 'game_kind_rule');
select test.expect_error($$update public.game set end_reason = 'score' where id = test.v('g8')$$, 'game_');
select test.expect_error($$update public.game set turn_deadline = null where id = test.v('g1')$$, 'game_rule_time');
select test.expect_error($$update public.game set seed = null where id = test.v('g1')$$, 'game_kind_rule');
select test.expect_error($$update public.game_ten_board set score = 121 where game_id = test.v('g1')$$, 'check');

rollback;
