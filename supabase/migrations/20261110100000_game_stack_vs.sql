-- BANB-55 같이 놀기 2+: 반반 쌓기 실시간 대전 (game.kind 'stack_vs')
--   1) game: kind 'stack_vs' + rule 'stack_vs'(오목 룰과 섞이지 않게). 초대·수락·거절·취소·10분 만료는 오목 함수 그대로
--      bet = 내기 문구(초대한 사람, 선택, 1~30자, 앞뒤 공백 제거). seed = 조각 순서 값(서버가 초대 때 정함, 두 사람 같은 값)
--      끝 사유: topout(먼저 맨 위에 닿음 — 서버에 먼저 도착한 쪽이 패) / quit(그만하기 = 패) / disconnect(30초 안에 못 돌아옴 = 패)
--      둘 다 30초 넘게 없으면 abandoned(timeout) — 누구 탓인지 모르므로 전적에 넣지 않는다
--   2) game_stack_board: 사람마다 판 저장본(state, 화면이 2초마다) + 지운 줄 + 마지막으로 보인 시각(seen_at, 끊김 판정)
--   3) game_stack_garbage: 방해 줄("영수증 줄") 묶음. 서버가 장수(1줄 0 · 2줄 1 · 3줄 2 · 4줄 이상 3)와
--      빈칸 자리(seed·보낸 사람·순번으로 정함 — 두 사람이 고를 수 없음)를 정하고 실시간으로 상대에게 전달한다
--   4) 쓰기는 함수로만: stack_vs_save / stack_vs_send / stack_vs_end / stack_vs_claim_disconnect
--      멤버·참가자·판 상태·순번은 서버가 확인하고, 끝난 판에는 쓰지 않는다. 각자 판의 낙하 계산은 화면이 한다
--      → 점수(지운 줄) 조작을 완전히 막지는 못한다(가족용, 명세 결정 기록)
--   5) 오목 전용 함수(play_move·resign_game·claim_turn_timeout·offer_draw·respond_draw)는 대전 판을 GAME_BAD_KIND 로 거부
--   6) 권한: 가계부 현재 멤버만 읽기, 직접 쓰기 없음 (RLS 완화 없음). 실시간 발행에 game_stack_garbage 추가
--   0) 반반 쌓기 점수 단위 1/100 (클라이언트 결정 2026-11-10): 한 줄 10점 · 두 줄 30점 · 세 줄 60점 (화면 표시는 "점")
--      이미 저장된 최고 기록(game_stack_best.best_amount, 옛 단위 1,000 · 3,000 · 6,000)도 100으로 나눠 맞춘다.
--      옛 값은 모두 1,000의 배수라 나눗셈이 정확하고, "줄 수 × 1,000 ≤ 기록 ≤ 줄 수 × 2,000" 규칙은 "× 10 ~ × 20"이 된다
--      적용 전후 확인: check_applied.sql 맨 아래 "BANB-55 점수 단위" 쿼리 (행 수 같음 · 모든 값 10의 배수 · 합계 1/100)
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

-- ─────────────────────────────────────────────
-- 0) 반반 쌓기 점수 단위 1/100
-- ─────────────────────────────────────────────
alter table public.game_stack_best drop constraint game_stack_best_best_amount_check;
alter table public.game_stack_best drop constraint game_stack_best_rule;
update public.game_stack_best set best_amount = best_amount / 100;
alter table public.game_stack_best add constraint game_stack_best_best_amount_check
  check (best_amount between 10 and 9999999999 and best_amount % 10 = 0);
alter table public.game_stack_best add constraint game_stack_best_rule
  check (best_amount between best_lines * 10::bigint and best_lines * 20::bigint);

-- 판이 끝날 때 1번 부른다 (BANB-52 그대로, 값 규칙만 새 단위: 10점 단위 · 줄 수 × 10 ≤ 점수 ≤ 줄 수 × 20)
create or replace function public.record_stack_score(p_ledger_id uuid, p_amount bigint, p_lines integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id(p_ledger_id);
  v_prev bigint;
begin
  if v_me is null then
    raise exception 'NOT_IN_LEDGER' using errcode = '42501';
  end if;
  if p_amount is null or p_lines is null or p_lines < 1 or p_lines > 4999999
    or p_amount % 10 <> 0 or p_amount < p_lines * 10::bigint or p_amount > p_lines * 20::bigint
    or p_amount > 9999999999 then
    raise exception 'STACK_BAD_SCORE' using errcode = '22023';
  end if;

  select b.best_amount into v_prev from public.game_stack_best b
    where b.ledger_id = p_ledger_id and b.member_id = v_me
    for update;

  if v_prev is null then
    insert into public.game_stack_best (ledger_id, member_id, best_amount, best_lines)
      values (p_ledger_id, v_me, p_amount, p_lines)
      on conflict (ledger_id, member_id) do update
        set best_amount = excluded.best_amount, best_lines = excluded.best_lines, updated_at = now()
        where public.game_stack_best.best_amount < excluded.best_amount;
  elsif p_amount > v_prev then
    update public.game_stack_best set best_amount = p_amount, best_lines = p_lines, updated_at = now()
      where ledger_id = p_ledger_id and member_id = v_me;
  end if;

  return jsonb_build_object(
    'previous_best', v_prev,
    'best_amount', greatest(coalesce(v_prev, 0), p_amount),
    'is_new', v_prev is null or p_amount > v_prev);
end;
$$;
revoke execute on function public.record_stack_score(uuid, bigint, integer) from public, anon;
grant execute on function public.record_stack_score(uuid, bigint, integer) to authenticated;

-- ─────────────────────────────────────────────
-- 1) game 열·규칙
-- ─────────────────────────────────────────────
alter table public.game
  add column bet text,                -- 내기 문구 (stack_vs 만, 선택)
  add column seed integer;            -- 조각 순서 값 (stack_vs 만, 필수)

alter table public.game drop constraint game_kind_check;
alter table public.game add constraint game_kind_check check (kind in ('omok', 'stack_vs'));
alter table public.game drop constraint game_rule_check;
alter table public.game add constraint game_rule_check check (rule in ('free', 'renju_lite', 'stack_vs'));
alter table public.game drop constraint game_end_reason_check;
alter table public.game add constraint game_end_reason_check
  check (end_reason in ('five', 'resign', 'draw', 'timeout', 'turn_timeout', 'draw_agreed', 'topout', 'quit', 'disconnect'));

alter table public.game drop constraint game_state_rule;
alter table public.game add constraint game_state_rule check (coalesce(
  (status = 'invited' and started_at is null and finished_at is null and winner_id is null and end_reason is null and move_count = 0)
  or (status = 'active' and started_at is not null and finished_at is null and winner_id is null and end_reason is null)
  or (status = 'finished' and started_at is not null and finished_at is not null
      and ((end_reason in ('five', 'resign', 'turn_timeout', 'topout', 'quit', 'disconnect') and winner_id is not null)
           or (end_reason in ('draw', 'draw_agreed') and winner_id is null)))
  or (status in ('declined', 'canceled', 'expired') and started_at is null and finished_at is not null
      and winner_id is null and end_reason is null and move_count = 0)
  or (status = 'abandoned' and started_at is not null and finished_at is not null
      and winner_id is null and end_reason = 'timeout'),
  false
));

alter table public.game drop constraint game_rule_time;
alter table public.game add constraint game_rule_time check (coalesce(
  (rule = 'free' and turn_deadline is null and end_reason is distinct from 'turn_timeout')
  or (rule = 'renju_lite' and (status <> 'active' or turn_deadline is not null) and status <> 'abandoned')
  or (rule = 'stack_vs' and turn_deadline is null),
  false
));

-- 종류마다: 오목 = 오목 룰·오목 끝 사유·내기·순서 값 없음 / 대전 = stack_vs 룰·순서 값 있음·수·무승부 제안 없음
alter table public.game add constraint game_kind_rule check (coalesce(
  (kind = 'omok' and rule in ('free', 'renju_lite') and bet is null and seed is null
     and end_reason is distinct from 'topout' and end_reason is distinct from 'quit' and end_reason is distinct from 'disconnect')
  or (kind = 'stack_vs' and rule = 'stack_vs' and seed is not null and move_count = 0
     and draw_offer_by is null and draw_offer_count is null
     and (end_reason is null or end_reason in ('topout', 'quit', 'disconnect', 'timeout'))),
  false
));
alter table public.game add constraint game_bet_rule check (bet is null or (bet = btrim(bet) and char_length(bet) between 1 and 30));

-- ─────────────────────────────────────────────
-- 2) 판 저장본 · 방해 줄
-- ─────────────────────────────────────────────
create table public.game_stack_board (
  game_id        uuid not null,
  ledger_id      uuid not null,
  member_id      uuid not null,
  state          jsonb,                              -- 화면 판 저장본 (돌아왔을 때 이어서). 내용은 화면이 정한다
  lines          integer not null default 0 check (lines between 0 and 100000),   -- 지운 줄 (화면이 센 값)
  seen_at        timestamptz not null default now(), -- 마지막으로 저장·보낸 시각 (30초 끊김 판정)
  topped_out_at  timestamptz,                        -- 맨 위에 닿았다고 알린 시각 (판이 이미 끝났어도 기록 — "아슬아슬")
  updated_at     timestamptz not null default now(),
  primary key (game_id, member_id),
  foreign key (game_id, ledger_id) references public.game (id, ledger_id) on delete cascade,
  foreign key (member_id, ledger_id) references public.member (id, ledger_id),
  constraint game_stack_board_state_rule check (state is null or (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 8192))
);
create index game_stack_board_ledger_idx on public.game_stack_board (ledger_id);

create table public.game_stack_garbage (
  game_id      uuid not null,
  ledger_id    uuid not null,                       -- 권한·실시간 필터용 (판의 가계부와 같다)
  from_member  uuid not null,                       -- 보낸 사람 (받는 사람 = 판의 다른 사람)
  seq          integer not null check (seq between 1 and 100000),   -- 보낸 사람별 1, 2, 3 …
  cleared      smallint not null check (cleared between 2 and 14),  -- 한 번에 지운 줄 수
  lines        smallint not null check (lines between 1 and 3),     -- 보내는 영수증 줄 수
  hole         smallint not null check (hole between 0 and 7),      -- 빈칸 자리 (묶음 안 모든 줄이 같다)
  created_at   timestamptz not null default now(),
  primary key (game_id, from_member, seq),
  foreign key (game_id, ledger_id) references public.game (id, ledger_id) on delete cascade,
  foreign key (from_member, ledger_id) references public.member (id, ledger_id)
);
create index game_stack_garbage_ledger_idx on public.game_stack_garbage (ledger_id);

-- ─────────────────────────────────────────────
-- 3) 계산 (순수 함수 — 화면 domain/stackVs.ts 와 같은 규칙)
-- ─────────────────────────────────────────────
-- 한 번에 지운 줄 → 보내는 영수증 줄: 1줄 0 · 2줄 1 · 3줄 2 · 4줄 이상 3
create or replace function public.stack_vs_lines(p_cleared int) returns int
language sql immutable
set search_path = ''
as $$
  select case when p_cleared is null or p_cleared < 2 then 0 when p_cleared = 2 then 1 when p_cleared = 3 then 2 else 3 end;
$$;

-- 묶음의 빈칸 자리 0~7: 판의 순서 값 + 보낸 사람 + 순번으로 정한다(두 사람 모두 고를 수 없음)
create or replace function public.stack_vs_hole(p_seed int, p_from uuid, p_seq int) returns int
language sql immutable
set search_path = ''
as $$
  select (((hashtextextended(p_seed::text || ':' || p_from::text || ':' || p_seq::text, 0) % 8) + 8) % 8)::int;
$$;

-- 이 시간 동안 저장·보내기가 없으면 끊긴 것으로 본다
create or replace function public.stack_vs_away_limit() returns interval
language sql immutable
set search_path = ''
as $$
  select interval '30 seconds';
$$;

-- 판 하나를 대전 참가자로 열어 잠근다. 오류: GAME_NOT_FOUND(없음·다른 가계부) / GAME_NOT_PLAYER / GAME_BAD_KIND(오목 판)
create or replace function public.stack_vs_lock(p_game_id uuid) returns public.game
language plpgsql
set search_path = ''
as $$
declare
  v_g public.game;
  v_me uuid;
begin
  select * into v_g from public.game g where g.id = p_game_id;
  if not found then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_me := public.current_member_id(v_g.ledger_id);
  if v_me is null then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_me not in (v_g.black_id, v_g.white_id) then
    raise exception 'GAME_NOT_PLAYER' using errcode = '42501';
  end if;
  if v_g.kind <> 'stack_vs' then
    raise exception 'GAME_BAD_KIND' using errcode = '22023';
  end if;
  select * into v_g from public.game g where g.id = p_game_id for update;
  return v_g;
end;
$$;

/*
 * 대전 중인 판의 끊김 판정 (잠근 판). 사람마다 마지막으로 보인 시각 = 저장본 seen_at (없으면 대전 시작 시각)
 *   - 한 사람만 30초 넘게 없음 → 그 사람 패 (disconnect)
 *   - 둘 다 30초 넘게 없음 → abandoned (timeout, 전적에 안 넣음)
 * 결과: 지금 판 (닫지 않았으면 그대로)
 */
create or replace function public.stack_vs_close_overdue(p_game public.game) returns public.game
language plpgsql
set search_path = ''
as $$
declare
  v_g public.game;
  v_black_seen timestamptz;
  v_white_seen timestamptz;
  v_limit timestamptz := now() - public.stack_vs_away_limit();
begin
  if p_game.kind <> 'stack_vs' or p_game.status <> 'active' then
    return p_game;
  end if;
  select coalesce(max(b.seen_at) filter (where b.member_id = p_game.black_id), p_game.started_at),
         coalesce(max(b.seen_at) filter (where b.member_id = p_game.white_id), p_game.started_at)
    into v_black_seen, v_white_seen
    from public.game_stack_board b where b.game_id = p_game.id;
  v_black_seen := coalesce(v_black_seen, p_game.started_at);
  v_white_seen := coalesce(v_white_seen, p_game.started_at);

  if v_black_seen < v_limit and v_white_seen < v_limit then
    update public.game g set status = 'abandoned', end_reason = 'timeout', finished_at = now()
      where g.id = p_game.id returning * into v_g;
  elsif v_black_seen < v_limit then
    update public.game g set status = 'finished', end_reason = 'disconnect', finished_at = now(), winner_id = g.white_id
      where g.id = p_game.id returning * into v_g;
  elsif v_white_seen < v_limit then
    update public.game g set status = 'finished', end_reason = 'disconnect', finished_at = now(), winner_id = g.black_id
      where g.id = p_game.id returning * into v_g;
  else
    return p_game;
  end if;
  return v_g;
end;
$$;

-- 이 가계부의 지난 초대(10분)·멈춘 판(free 24시간)·마감 지난 판(renju_lite 30초)·끊긴 대전(30초)을 닫는다. 바꾼 판 수
create or replace function public.game_close_stale(p_ledger_id uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a int;
  v_b int;
  v_c int;
  v_d int := 0;
  v_g public.game;
  v_closed public.game;
begin
  update public.game g set status = 'expired', finished_at = now()
    where g.ledger_id = p_ledger_id and g.status = 'invited' and g.invite_expires_at <= now();
  get diagnostics v_a = row_count;
  update public.game g set status = 'abandoned', end_reason = 'timeout', finished_at = now(), draw_offer_by = null
    where g.ledger_id = p_ledger_id and g.status = 'active' and g.rule = 'free'
      and coalesce(g.last_move_at, g.started_at) <= now() - interval '24 hours';
  get diagnostics v_b = row_count;
  update public.game g set status = 'finished', end_reason = 'turn_timeout', finished_at = now(), draw_offer_by = null,
      winner_id = case when g.move_count % 2 = 0 then g.white_id else g.black_id end
    where g.ledger_id = p_ledger_id and g.status = 'active' and g.rule = 'renju_lite' and now() > g.turn_deadline;
  get diagnostics v_c = row_count;
  for v_g in
    select * from public.game g
      where g.ledger_id = p_ledger_id and g.status = 'active' and g.kind = 'stack_vs'
      for update
  loop
    v_closed := public.stack_vs_close_overdue(v_g);
    if v_closed.status <> v_g.status then
      v_d := v_d + 1;
    end if;
  end loop;
  return v_a + v_b + v_c + v_d;
end;
$$;

-- 판 결과 (화면이 바로 반영할 값). server_now = 화면 시계 보정용
create or replace function public.game_result(p_game public.game, p_applied boolean) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_game.id, 'kind', p_game.kind, 'status', p_game.status, 'move_count', p_game.move_count,
    'winner_id', p_game.winner_id, 'end_reason', p_game.end_reason, 'applied', p_applied,
    'rule', p_game.rule, 'turn_deadline', p_game.turn_deadline, 'draw_offer_by', p_game.draw_offer_by,
    'draw_offer_count', p_game.draw_offer_count, 'finished_at', p_game.finished_at, 'server_now', now());
$$;

-- 오목 함수의 판 잠금 (BANB-53 그대로 + 대전 판 거부). 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND
create or replace function public.game_lock_as_player(p_game_id uuid) returns public.game
language plpgsql
set search_path = ''
as $$
declare
  v_g public.game;
  v_me uuid;
begin
  select * into v_g from public.game g where g.id = p_game_id;
  if not found then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_me := public.current_member_id(v_g.ledger_id);
  if v_me is null then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_me not in (v_g.black_id, v_g.white_id) then
    raise exception 'GAME_NOT_PLAYER' using errcode = '42501';
  end if;
  if v_g.kind <> 'omok' then
    raise exception 'GAME_BAD_KIND' using errcode = '22023';
  end if;
  select * into v_g from public.game g where g.id = p_game_id for update;
  return v_g;
end;
$$;

-- ─────────────────────────────────────────────
-- 4) 초대 (종류·내기 추가 — 시그니처가 바뀌어 예전 함수를 지운다)
-- ─────────────────────────────────────────────
drop function public.invite_game(uuid, uuid, text, uuid);

/*
 * 초대: 같은 가계부 현재 멤버 p_opponent 에게 한 판. 오목 = 초대받은 사람이 흑 / 대전 = 역할 없음(black = 초대받은 사람)
 * p_rematch_of 를 주면 그 판(같은 두 사람, 같은 종류, 끝난 판)의 "한 판 더". 오목은 흑백을 바꾼다
 * p_bet: 대전 내기 문구(선택). 앞뒤 공백을 지우고 비면 없음, 30자를 넘으면 GAME_BAD_BET. 오목에는 줄 수 없다
 * 오류: NOT_IN_LEDGER / GAME_BAD_KIND / GAME_BAD_OPPONENT / GAME_BAD_BET / GAME_ALREADY_OPEN / GAME_OPPONENT_BUSY / GAME_BAD_REMATCH
 * 결과: 새 판 id
 */
create or replace function public.invite_game(
  p_ledger_id uuid, p_opponent uuid, p_kind text default 'omok', p_rematch_of uuid default null, p_bet text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id(p_ledger_id);
  v_prev public.game;
  v_black uuid;
  v_white uuid;
  v_bet text := nullif(btrim(p_bet), '');
  v_id uuid;
begin
  if v_me is null then
    raise exception 'NOT_IN_LEDGER' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('omok', 'stack_vs') then
    raise exception 'GAME_BAD_KIND' using errcode = '22023';
  end if;
  if p_opponent is null or p_opponent = v_me or not exists (
    select 1 from public.member m where m.id = p_opponent and m.ledger_id = p_ledger_id and m.left_at is null
  ) then
    raise exception 'GAME_BAD_OPPONENT' using errcode = '22023';
  end if;
  if v_bet is not null and (p_kind <> 'stack_vs' or char_length(v_bet) > 30) then
    raise exception 'GAME_BAD_BET' using errcode = '22023';
  end if;

  perform public.game_lock_ledger(p_ledger_id);
  perform public.game_close_stale(p_ledger_id);

  if exists (select 1 from public.game g where g.ledger_id = p_ledger_id and g.status in ('invited', 'active')
               and v_me in (g.black_id, g.white_id)) then
    raise exception 'GAME_ALREADY_OPEN' using errcode = '23505';
  end if;
  if exists (select 1 from public.game g where g.ledger_id = p_ledger_id and g.status in ('invited', 'active')
               and p_opponent in (g.black_id, g.white_id)) then
    raise exception 'GAME_OPPONENT_BUSY' using errcode = '23505';
  end if;

  v_black := p_opponent;
  v_white := v_me;
  if p_rematch_of is not null then
    select * into v_prev from public.game g where g.id = p_rematch_of and g.ledger_id = p_ledger_id;
    if not found or v_prev.kind <> p_kind or v_prev.status not in ('finished', 'abandoned')
       or not (v_me in (v_prev.black_id, v_prev.white_id) and p_opponent in (v_prev.black_id, v_prev.white_id)) then
      raise exception 'GAME_BAD_REMATCH' using errcode = '22023';
    end if;
    if p_kind = 'omok' then
      v_black := v_prev.white_id;
      v_white := v_prev.black_id;
    end if;
  end if;

  if p_kind = 'stack_vs' then
    insert into public.game (ledger_id, kind, rule, black_id, white_id, created_by, rematch_of, bet, seed)
      values (p_ledger_id, 'stack_vs', 'stack_vs', v_black, v_white, v_me, p_rematch_of, v_bet,
              floor(random() * 2147483647)::int)
      returning id into v_id;
  else
    -- 오목 룰은 열 기본값(renju_lite) — 화면이 고르지 않는다
    insert into public.game (ledger_id, kind, black_id, white_id, created_by, rematch_of)
      values (p_ledger_id, 'omok', v_black, v_white, v_me, p_rematch_of)
      returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 5) 대전 쓰기 함수 (security definer, 로그인 사용자만)
-- ─────────────────────────────────────────────

-- 판 결과 + 상대 마지막으로 보인 시각 (기다리는 쪽 30초 표시 보정)
create or replace function public.stack_vs_result(p_game public.game, p_applied boolean, p_me uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select public.game_result(p_game, p_applied) || jsonb_build_object(
    'opp_seen_at', (select coalesce(max(b.seen_at), p_game.started_at) from public.game_stack_board b
                     where b.game_id = p_game.id and b.member_id = case when p_me = p_game.black_id then p_game.white_id else p_game.black_id end));
$$;

/*
 * 판 저장 (화면이 2초마다, 앱을 내릴 때). 마지막으로 보인 시각도 함께 바꾼다(끊김 판정).
 * p_state = null 이면 시각만 (멈춰 기다리는 동안). p_lines = 지금까지 지운 줄
 * 끊김으로 닫혔으면(내가 30초 넘게 없었음 등) 저장하지 않고 결과(applied = false)
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND / GAME_NOT_ACTIVE(끝난 판) / STACK_BAD_STATE
 */
create or replace function public.stack_vs_save(p_game_id uuid, p_state jsonb, p_lines integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  v_g := public.stack_vs_lock(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  v_closed := public.stack_vs_close_overdue(v_g);
  if v_closed.status <> v_g.status then
    return public.stack_vs_result(v_closed, false, v_me);
  end if;
  if v_g.status <> 'active' then
    raise exception 'GAME_NOT_ACTIVE' using errcode = '22023';
  end if;
  if p_lines is null or p_lines not between 0 and 100000
     or (p_state is not null and (jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 8192)) then
    raise exception 'STACK_BAD_STATE' using errcode = '22023';
  end if;
  insert into public.game_stack_board (game_id, ledger_id, member_id, state, lines, seen_at, updated_at)
    values (v_g.id, v_g.ledger_id, v_me, p_state, p_lines, now(), now())
    on conflict (game_id, member_id) do update
      set state = coalesce(excluded.state, public.game_stack_board.state),
          lines = excluded.lines, seen_at = now(), updated_at = now();
  return public.stack_vs_result(v_g, true, v_me);
end;
$$;

/*
 * 방해 줄 보내기: 한 번에 2줄 이상 지웠을 때. p_seq = 내가 보내는 순번(1부터 하나씩) — 같은 순번을 다시 보내면
 * 처음 결과를 돌려준다(applied = false, 다시 시도해도 한 번만). 건너뛴 순번은 STACK_BAD_SEQ
 * 서버가 장수·빈칸 자리를 정하고, 상대는 실시간(game_stack_garbage INSERT)으로 받는다
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND / GAME_NOT_ACTIVE / STACK_BAD_CLEAR / STACK_BAD_SEQ
 * 결과: 판 결과 + {seq, lines, hole}
 */
create or replace function public.stack_vs_send(p_game_id uuid, p_seq integer, p_cleared integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
  v_last int;
  v_row public.game_stack_garbage;
begin
  v_g := public.stack_vs_lock(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  v_closed := public.stack_vs_close_overdue(v_g);
  if v_closed.status <> v_g.status then
    return public.stack_vs_result(v_closed, false, v_me);
  end if;
  if v_g.status <> 'active' then
    raise exception 'GAME_NOT_ACTIVE' using errcode = '22023';
  end if;
  if p_cleared is null or p_cleared not between 2 and 14 then
    raise exception 'STACK_BAD_CLEAR' using errcode = '22023';
  end if;

  select * into v_row from public.game_stack_garbage s
    where s.game_id = v_g.id and s.from_member = v_me and s.seq = p_seq;
  if found then
    return public.stack_vs_result(v_g, false, v_me)
      || jsonb_build_object('seq', v_row.seq, 'lines', v_row.lines, 'hole', v_row.hole);
  end if;
  select coalesce(max(s.seq), 0) into v_last from public.game_stack_garbage s
    where s.game_id = v_g.id and s.from_member = v_me;
  if p_seq is null or p_seq <> v_last + 1 then
    raise exception 'STACK_BAD_SEQ' using errcode = '22023';
  end if;

  insert into public.game_stack_garbage (game_id, ledger_id, from_member, seq, cleared, lines, hole)
    values (v_g.id, v_g.ledger_id, v_me, p_seq, p_cleared, public.stack_vs_lines(p_cleared),
            public.stack_vs_hole(v_g.seed, v_me, p_seq))
    returning * into v_row;
  -- 보내기도 "보임"으로 센다
  insert into public.game_stack_board (game_id, ledger_id, member_id, seen_at)
    values (v_g.id, v_g.ledger_id, v_me, now())
    on conflict (game_id, member_id) do update set seen_at = now();
  return public.stack_vs_result(v_g, true, v_me)
    || jsonb_build_object('seq', v_row.seq, 'lines', v_row.lines, 'hole', v_row.hole);
end;
$$;

/*
 * 끝내기: p_reason = 'topout'(맨 위에 닿음) / 'quit'(그만하기). 부른 사람이 진다.
 * 거의 동시에 둘 다 닿으면 서버에 먼저 도착한 쪽이 패 — 늦게 온 쪽은 applied = false (이미 끝남)
 * topout 은 판이 이미 끝났어도 내 저장본에 닿은 시각을 남긴다("아슬아슬" 표시)
 * 끊김으로 먼저 닫혀야 하는 판이면 그렇게 닫는다(applied = false)
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND / STACK_BAD_REASON
 */
create or replace function public.stack_vs_end(p_game_id uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  if p_reason is null or p_reason not in ('topout', 'quit') then
    raise exception 'STACK_BAD_REASON' using errcode = '22023';
  end if;
  v_g := public.stack_vs_lock(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  -- 끊김 판정이 먼저 (닿은 시각 기록이 "보임"을 바꾸지 않게)
  v_closed := public.stack_vs_close_overdue(v_g);
  if p_reason = 'topout' and v_g.status in ('active', 'finished') then
    insert into public.game_stack_board (game_id, ledger_id, member_id, seen_at, topped_out_at)
      values (v_g.id, v_g.ledger_id, v_me, now(), now())
      on conflict (game_id, member_id) do update set topped_out_at = coalesce(public.game_stack_board.topped_out_at, now());
  end if;
  if v_closed.status <> v_g.status or v_g.status <> 'active' then
    return public.stack_vs_result(v_closed, false, v_me);
  end if;
  update public.game g set status = 'finished', end_reason = p_reason, finished_at = now(),
      winner_id = case when v_me = g.black_id then g.white_id else g.black_id end
    where g.id = v_g.id returning * into v_g;
  return public.stack_vs_result(v_g, true, v_me);
end;
$$;

/*
 * 끊김 확정: 판 참가자 누구든. 서버가 30초 넘게 저장·보내기가 없는 사람이 있을 때만 닫는다
 * (한 사람 = 그 사람 패 / 둘 다 = 중단). 이미 끝난 판이면 지금 상태(applied = false)
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND / GAME_NOT_TIMED_OUT(아직 30초 전)
 */
create or replace function public.stack_vs_claim_disconnect(p_game_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  v_g := public.stack_vs_lock(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  if v_g.status <> 'active' then
    return public.stack_vs_result(v_g, false, v_me);
  end if;
  v_closed := public.stack_vs_close_overdue(v_g);
  if v_closed.status = v_g.status then
    raise exception 'GAME_NOT_TIMED_OUT' using errcode = '22023';
  end if;
  return public.stack_vs_result(v_closed, true, v_me);
end;
$$;

-- ─────────────────────────────────────────────
-- 6) 권한: 가계부 현재 멤버만 읽기, 쓰기는 함수로만
-- ─────────────────────────────────────────────
alter table public.game_stack_board enable row level security;
revoke all on public.game_stack_board from public, anon, authenticated;
grant select on public.game_stack_board to authenticated;
create policy game_stack_board_select on public.game_stack_board for select to authenticated
  using (public.is_ledger_member(ledger_id));

alter table public.game_stack_garbage enable row level security;
revoke all on public.game_stack_garbage from public, anon, authenticated;
grant select on public.game_stack_garbage to authenticated;
create policy game_stack_garbage_select on public.game_stack_garbage for select to authenticated
  using (public.is_ledger_member(ledger_id));

revoke execute on function public.stack_vs_lines(int) from public, anon, authenticated;
revoke execute on function public.stack_vs_hole(int, uuid, int) from public, anon, authenticated;
revoke execute on function public.stack_vs_away_limit() from public, anon, authenticated;
revoke execute on function public.stack_vs_lock(uuid) from public, anon, authenticated;
revoke execute on function public.stack_vs_close_overdue(public.game) from public, anon, authenticated;
revoke execute on function public.stack_vs_result(public.game, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.game_close_stale(uuid) from public, anon, authenticated;
revoke execute on function public.game_result(public.game, boolean) from public, anon, authenticated;
revoke execute on function public.game_lock_as_player(uuid) from public, anon, authenticated;
revoke execute on function public.invite_game(uuid, uuid, text, uuid, text) from public, anon;
revoke execute on function public.stack_vs_save(uuid, jsonb, integer) from public, anon;
revoke execute on function public.stack_vs_send(uuid, integer, integer) from public, anon;
revoke execute on function public.stack_vs_end(uuid, text) from public, anon;
revoke execute on function public.stack_vs_claim_disconnect(uuid) from public, anon;
grant execute on function public.invite_game(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function public.stack_vs_save(uuid, jsonb, integer) to authenticated;
grant execute on function public.stack_vs_send(uuid, integer, integer) to authenticated;
grant execute on function public.stack_vs_end(uuid, text) to authenticated;
grant execute on function public.stack_vs_claim_disconnect(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 7) 실시간: 방해 줄을 상대에게 (Postgres Changes, 구독자 RLS 적용). 판 저장본은 보내지 않는다(메시지 수 절약)
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.game_stack_garbage;
