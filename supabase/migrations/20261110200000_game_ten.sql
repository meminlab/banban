-- BANB-57 같이 놀기 3: 도토리 열 알 (1인) + 도토리 열 알 대전 (game.kind 'ten_vs')
--   0) 판 = 가로 15 × 세로 8, 칸마다 숫자 1~9. 판은 순서 값(seed)에서 만든다 — 화면 domain/ten.ts tenBoard 와 같은 계산
--      (Lehmer: s = s × 48271 mod 2147483647, 숫자 = 1 + s mod 9). 두 사람·서버가 같은 판을 본다
--   1) 점수 = 터진 도토리 수. 화면이 보낸 드래그 기록(네모 [x1, y1, x2, y2] 목록)을 서버가 같은 판에 차례로 다시 놓아 센다
--      (ten_replay). 합이 10이 아닌 네모는 무효, 이미 터진 칸은 다시 세지 않는다(빈칸은 합 0) → 화면 점수는 참고용
--   2) game_ten_best: 1인 최고 기록 (가계부 × 멤버 1개, 반반 쌓기 game_stack_best 와 같은 방식). 쓰기는 record_ten_score 로만
--      — 서버가 순서 값 + 드래그 기록으로 점수를 다시 계산해 더 높을 때만 바꾼다
--   3) 대전 game: kind 'ten_vs' + rule 'ten_vs'. 초대·수락·거절·취소·10분 만료·내기·1인 1판은 반반 쌓기 대전 함수 그대로
--      수락하는 순간 turn_deadline = 공통 마감(서버 시각) = 수락 + 5초(둘 다 왔어요 1.5초 + 3·2·1) + 120초
--      끝: 마감 뒤 두 사람 기록이 다 오면 바로, 아니면 마감 + 5초에 마지막으로 받은 점수로 확정
--          score(점수가 높은 사람 승) / draw(같은 점수) / quit(그만하기 = 패) / timeout(둘 다 기록이 하나도 없음 = 중단, 전적 제외)
--   4) game_ten_board: 사람마다 드래그 기록·서버가 센 점수·마지막 저장 시각. 판이 끝나기 전에는 자기 기록만 읽는다
--      (같은 판이라 상대가 지운 자리가 답 힌트가 된다 — design.md 5.44)
--   5) 쓰기는 함수로만: ten_vs_save / ten_vs_quit / ten_vs_settle. 멤버·참가자·판 상태·마감은 서버가 확인한다
--      한계(가족용, 결정 기록): 마감 + 5초 안에 온 기록은 받으므로 그 5초 동안 화면을 고쳐 더 한 것은 막지 못한다
--   6) 권한: 가계부 현재 멤버만 읽기, 직접 쓰기 없음 (RLS 완화 없음). 실시간: game 은 이미 발행 중, 상대 점수는 broadcast(저장 안 함)
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

-- ─────────────────────────────────────────────
-- 0) 판 · 다시 계산 (순수 함수 — 화면 domain/ten.ts 와 같은 규칙)
-- ─────────────────────────────────────────────
-- 순서 값 → 판 120칸 (배열 1번 = (x 0, y 0), 칸 번호 = y × 15 + x + 1)
create or replace function public.ten_board(p_seed bigint) returns smallint[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v_s bigint := (mod(mod(coalesce(p_seed, 0), 2147483646) + 2147483646, 2147483646)) + 1;
  v_b smallint[] := array[]::smallint[];
begin
  for i in 1..120 loop
    v_s := mod(v_s * 48271, 2147483647);
    v_b := v_b || (1 + mod(v_s, 9))::smallint;
  end loop;
  return v_b;
end;
$$;

/*
 * 드래그 기록을 순서 값 판에 차례로 놓아 터진 도토리 수를 센다.
 * p_drags = [[x1, y1, x2, y2], ...] (두 모서리 칸, 순서 상관없음). x 0~14, y 0~7, 120개까지
 * 오류: TEN_BAD_DRAGS (모양이 틀림 — 배열 아님·숫자 아님·판 밖·너무 많음)
 */
create or replace function public.ten_replay(p_seed bigint, p_drags jsonb) returns integer
language plpgsql immutable
set search_path = ''
as $$
declare
  v_b smallint[] := public.ten_board(p_seed);
  v_d jsonb;
  v_x1 int; v_y1 int; v_x2 int; v_y2 int;
  v_sum int;
  v_cnt int;
  v_score int := 0;
begin
  if p_drags is null or jsonb_typeof(p_drags) <> 'array' or jsonb_array_length(p_drags) > 120 then
    raise exception 'TEN_BAD_DRAGS' using errcode = '22023';
  end if;
  for v_d in select e.value from jsonb_array_elements(p_drags) e loop
    if jsonb_typeof(v_d) <> 'array' or jsonb_array_length(v_d) <> 4
       or exists (select 1 from jsonb_array_elements(v_d) n where jsonb_typeof(n.value) <> 'number')
       or not ((v_d->>0) ~ '^[0-9]{1,2}$' and (v_d->>1) ~ '^[0-9]$' and (v_d->>2) ~ '^[0-9]{1,2}$' and (v_d->>3) ~ '^[0-9]$') then
      raise exception 'TEN_BAD_DRAGS' using errcode = '22023';
    end if;
    v_x1 := least((v_d->>0)::int, (v_d->>2)::int);
    v_x2 := greatest((v_d->>0)::int, (v_d->>2)::int);
    v_y1 := least((v_d->>1)::int, (v_d->>3)::int);
    v_y2 := greatest((v_d->>1)::int, (v_d->>3)::int);
    if v_x2 > 14 or v_y2 > 7 then
      raise exception 'TEN_BAD_DRAGS' using errcode = '22023';
    end if;
    v_sum := 0;
    v_cnt := 0;
    for y in v_y1..v_y2 loop
      for x in v_x1..v_x2 loop
        v_sum := v_sum + v_b[y * 15 + x + 1];
        if v_b[y * 15 + x + 1] > 0 then
          v_cnt := v_cnt + 1;
        end if;
      end loop;
    end loop;
    if v_sum = 10 then
      for y in v_y1..v_y2 loop
        for x in v_x1..v_x2 loop
          v_b[y * 15 + x + 1] := 0;
        end loop;
      end loop;
      v_score := v_score + v_cnt;
    end if;
  end loop;
  return v_score;
end;
$$;

-- 대전 시간: 공통 마감 = 수락 + 앞둠(5초) + 판(120초). 마감 뒤 기록을 기다리는 시간 5초
create or replace function public.ten_vs_lead() returns interval language sql immutable set search_path = '' as $$ select interval '5 seconds' $$;
create or replace function public.ten_vs_duration() returns interval language sql immutable set search_path = '' as $$ select interval '120 seconds' $$;
create or replace function public.ten_vs_grace() returns interval language sql immutable set search_path = '' as $$ select interval '5 seconds' $$;

-- ─────────────────────────────────────────────
-- 1) 1인 최고 기록
-- ─────────────────────────────────────────────
create table public.game_ten_best (
  ledger_id    uuid not null references public.ledger (id) on delete cascade,
  member_id    uuid not null,
  best_score   integer not null check (best_score between 1 and 120),
  updated_at   timestamptz not null default now(),
  primary key (ledger_id, member_id),
  foreign key (member_id, ledger_id) references public.member (id, ledger_id) on delete cascade
);

/*
 * 1인 판이 끝날 때 1번. 서버가 순서 값 + 드래그 기록으로 점수를 다시 센다(화면 점수는 받지 않는다).
 * 결과: {score(서버가 센 점수), previous_best(이번 판 전, 없으면 null), best_score, is_new}. 0점이면 저장하지 않는다
 * 오류: NOT_IN_LEDGER / TEN_BAD_SEED / TEN_BAD_DRAGS
 */
create or replace function public.record_ten_score(p_ledger_id uuid, p_seed bigint, p_drags jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id(p_ledger_id);
  v_score int;
  v_prev int;
begin
  if v_me is null then
    raise exception 'NOT_IN_LEDGER' using errcode = '42501';
  end if;
  if p_seed is null or p_seed < 0 or p_seed > 2147483647 then
    raise exception 'TEN_BAD_SEED' using errcode = '22023';
  end if;
  v_score := public.ten_replay(p_seed, p_drags);

  select b.best_score into v_prev from public.game_ten_best b
    where b.ledger_id = p_ledger_id and b.member_id = v_me
    for update;
  if v_score > 0 then
    insert into public.game_ten_best (ledger_id, member_id, best_score)
      values (p_ledger_id, v_me, v_score)
      on conflict (ledger_id, member_id) do update
        set best_score = excluded.best_score, updated_at = now()
        where public.game_ten_best.best_score < excluded.best_score;
  end if;

  return jsonb_build_object(
    'score', v_score,
    'previous_best', v_prev,
    'best_score', nullif(greatest(coalesce(v_prev, 0), v_score), 0),
    'is_new', v_score > 0 and (v_prev is null or v_score > v_prev));
end;
$$;

-- ─────────────────────────────────────────────
-- 2) game 규칙 (종류·룰·끝 사유)
-- ─────────────────────────────────────────────
alter table public.game drop constraint game_kind_check;
alter table public.game add constraint game_kind_check check (kind in ('omok', 'stack_vs', 'ten_vs'));
alter table public.game drop constraint game_rule_check;
alter table public.game add constraint game_rule_check check (rule in ('free', 'renju_lite', 'stack_vs', 'ten_vs'));
alter table public.game drop constraint game_end_reason_check;
alter table public.game add constraint game_end_reason_check
  check (end_reason in ('five', 'resign', 'draw', 'timeout', 'turn_timeout', 'draw_agreed', 'topout', 'quit', 'disconnect', 'score'));

alter table public.game drop constraint game_state_rule;
alter table public.game add constraint game_state_rule check (coalesce(
  (status = 'invited' and started_at is null and finished_at is null and winner_id is null and end_reason is null and move_count = 0)
  or (status = 'active' and started_at is not null and finished_at is null and winner_id is null and end_reason is null)
  or (status = 'finished' and started_at is not null and finished_at is not null
      and ((end_reason in ('five', 'resign', 'turn_timeout', 'topout', 'quit', 'disconnect', 'score') and winner_id is not null)
           or (end_reason in ('draw', 'draw_agreed') and winner_id is null)))
  or (status in ('declined', 'canceled', 'expired') and started_at is null and finished_at is not null
      and winner_id is null and end_reason is null and move_count = 0)
  or (status = 'abandoned' and started_at is not null and finished_at is not null
      and winner_id is null and end_reason = 'timeout'),
  false
));

-- ten_vs: 수락한 판(대전 중·끝남·중단)은 공통 마감이 있다 (turn_deadline = 판 마감). 초대·거절·취소·만료는 없음
alter table public.game drop constraint game_rule_time;
alter table public.game add constraint game_rule_time check (coalesce(
  (rule = 'free' and turn_deadline is null and end_reason is distinct from 'turn_timeout')
  or (rule = 'renju_lite' and (status <> 'active' or turn_deadline is not null) and status <> 'abandoned')
  or (rule = 'stack_vs' and turn_deadline is null)
  or (rule = 'ten_vs' and (status in ('invited', 'declined', 'canceled', 'expired')) = (turn_deadline is null)
      and end_reason is distinct from 'turn_timeout'),
  false
));

alter table public.game drop constraint game_kind_rule;
alter table public.game add constraint game_kind_rule check (coalesce(
  (kind = 'omok' and rule in ('free', 'renju_lite') and bet is null and seed is null
     and (end_reason is null or end_reason not in ('topout', 'quit', 'disconnect', 'score')))
  or (kind = 'stack_vs' and rule = 'stack_vs' and seed is not null and move_count = 0
     and draw_offer_by is null and draw_offer_count is null
     and (end_reason is null or end_reason in ('topout', 'quit', 'disconnect', 'timeout')))
  or (kind = 'ten_vs' and rule = 'ten_vs' and seed is not null and move_count = 0
     and draw_offer_by is null and draw_offer_count is null
     and (end_reason is null or end_reason in ('score', 'draw', 'quit', 'timeout'))),
  false
));

-- ─────────────────────────────────────────────
-- 3) 대전 기록
-- ─────────────────────────────────────────────
create table public.game_ten_board (
  game_id     uuid not null,
  ledger_id   uuid not null,
  member_id   uuid not null,
  drags       jsonb not null default '[]'::jsonb,            -- 드래그 기록 (터진 네모만, 화면이 보낸 그대로)
  score       integer not null default 0 check (score between 0 and 120),   -- 서버가 다시 센 점수
  final       boolean not null default false,               -- 마감 뒤 마지막 기록을 보냈음
  saved_at    timestamptz not null default now(),
  primary key (game_id, member_id),
  foreign key (game_id, ledger_id) references public.game (id, ledger_id) on delete cascade,
  foreign key (member_id, ledger_id) references public.member (id, ledger_id),
  constraint game_ten_board_drags_rule check (jsonb_typeof(drags) = 'array' and jsonb_array_length(drags) <= 120)
);
create index game_ten_board_ledger_idx on public.game_ten_board (ledger_id);

-- ─────────────────────────────────────────────
-- 4) 대전 내부 함수
-- ─────────────────────────────────────────────
-- 판 하나를 대전 참가자로 열어 잠근다. 오류: GAME_NOT_FOUND(없음·다른 가계부) / GAME_NOT_PLAYER / GAME_BAD_KIND
create or replace function public.ten_vs_lock(p_game_id uuid) returns public.game
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
  if v_g.kind <> 'ten_vs' then
    raise exception 'GAME_BAD_KIND' using errcode = '22023';
  end if;
  select * into v_g from public.game g where g.id = p_game_id for update;
  return v_g;
end;
$$;

-- 잠근 대전 판을 점수로 닫는다 (마감이 지났거나 두 사람 기록이 다 왔을 때 부른다). 결과: 닫은 판
create or replace function public.ten_vs_close(p_game public.game) returns public.game
language plpgsql
set search_path = ''
as $$
declare
  v_g public.game;
  v_black int;
  v_white int;
  v_rows int;
begin
  select count(*), coalesce(max(b.score) filter (where b.member_id = p_game.black_id), 0),
         coalesce(max(b.score) filter (where b.member_id = p_game.white_id), 0)
    into v_rows, v_black, v_white
    from public.game_ten_board b where b.game_id = p_game.id;
  if v_rows = 0 then
    -- 둘 다 기록이 하나도 오지 않음 → 누구 탓인지 모르므로 중단 (전적에 넣지 않는다)
    update public.game g set status = 'abandoned', end_reason = 'timeout', finished_at = now()
      where g.id = p_game.id returning * into v_g;
  elsif v_black = v_white then
    update public.game g set status = 'finished', end_reason = 'draw', finished_at = now()
      where g.id = p_game.id returning * into v_g;
  else
    update public.game g set status = 'finished', end_reason = 'score', finished_at = now(),
        winner_id = case when v_black > v_white then g.black_id else g.white_id end
      where g.id = p_game.id returning * into v_g;
  end if;
  return v_g;
end;
$$;

-- 마감 + 5초가 지난 대전 판이면 닫는다 (잠근 판). 결과: 지금 판
create or replace function public.ten_vs_close_due(p_game public.game) returns public.game
language plpgsql
set search_path = ''
as $$
begin
  if p_game.kind = 'ten_vs' and p_game.status = 'active' and now() > p_game.turn_deadline + public.ten_vs_grace() then
    return public.ten_vs_close(p_game);
  end if;
  return p_game;
end;
$$;

-- 판 결과 + 내 점수 · (끝난 판이면) 상대 점수 — 서버가 센 값
create or replace function public.ten_vs_result(p_game public.game, p_applied boolean, p_me uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select public.game_result(p_game, p_applied) || jsonb_build_object(
    'my_score', (select coalesce(max(b.score), 0) from public.game_ten_board b where b.game_id = p_game.id and b.member_id = p_me),
    'opp_score', case when p_game.status <> 'active' then
      (select coalesce(max(b.score), 0) from public.game_ten_board b
        where b.game_id = p_game.id and b.member_id = case when p_me = p_game.black_id then p_game.white_id else p_game.black_id end)
    end);
$$;

-- ─────────────────────────────────────────────
-- 5) 기존 함수 넓히기: 지난 판 닫기 · 초대 · 수락
-- ─────────────────────────────────────────────
-- 이 가계부의 지난 초대(10분)·멈춘 판(free 24시간)·마감 지난 판(renju_lite 30초)·끊긴 대전(30초)·마감 지난 도토리 대전(+5초)을 닫는다
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
      where g.ledger_id = p_ledger_id and g.status = 'active' and g.kind in ('stack_vs', 'ten_vs')
      for update
  loop
    if v_g.kind = 'stack_vs' then
      v_closed := public.stack_vs_close_overdue(v_g);
    else
      v_closed := public.ten_vs_close_due(v_g);
    end if;
    if v_closed.status <> v_g.status then
      v_d := v_d + 1;
    end if;
  end loop;
  return v_a + v_b + v_c + v_d;
end;
$$;

/*
 * 초대 (BANB-55 그대로 + 도토리 열 알 대전). 대전(stack_vs·ten_vs) = 순서 값·내기(선택). 오목 = 흑백·내기 없음
 * 오류: NOT_IN_LEDGER / GAME_BAD_KIND / GAME_BAD_OPPONENT / GAME_BAD_BET / GAME_ALREADY_OPEN / GAME_OPPONENT_BUSY / GAME_BAD_REMATCH
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
  if p_kind is null or p_kind not in ('omok', 'stack_vs', 'ten_vs') then
    raise exception 'GAME_BAD_KIND' using errcode = '22023';
  end if;
  if p_opponent is null or p_opponent = v_me or not exists (
    select 1 from public.member m where m.id = p_opponent and m.ledger_id = p_ledger_id and m.left_at is null
  ) then
    raise exception 'GAME_BAD_OPPONENT' using errcode = '22023';
  end if;
  if v_bet is not null and (p_kind = 'omok' or char_length(v_bet) > 30) then
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

  if p_kind = 'omok' then
    -- 오목 룰은 열 기본값(renju_lite) — 화면이 고르지 않는다
    insert into public.game (ledger_id, kind, black_id, white_id, created_by, rematch_of)
      values (p_ledger_id, 'omok', v_black, v_white, v_me, p_rematch_of)
      returning id into v_id;
  else
    insert into public.game (ledger_id, kind, rule, black_id, white_id, created_by, rematch_of, bet, seed)
      values (p_ledger_id, p_kind, p_kind, v_black, v_white, v_me, p_rematch_of, v_bet,
              floor(random() * 2147483647)::int)
      returning id into v_id;
  end if;
  return v_id;
end;
$$;

/*
 * 초대 수락 / 거절 (BANB-53 그대로 + 도토리 열 알 대전). 수락하는 순간:
 *   renju_lite = 흑의 마감 now() + 30초 / ten_vs = 공통 마감 now() + 5초 + 120초 (두 사람 같은 서버 시각)
 */
create or replace function public.respond_game(p_game_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer
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
  if v_me not in (v_g.black_id, v_g.white_id) or v_me = v_g.created_by then
    raise exception 'GAME_NOT_INVITEE' using errcode = '42501';
  end if;

  perform public.game_lock_ledger(v_g.ledger_id);
  perform public.game_close_stale(v_g.ledger_id);
  select * into v_g from public.game g where g.id = p_game_id;
  if v_g.status <> 'invited' then
    return public.game_result(v_g, false);
  end if;

  if p_accept then
    if exists (select 1 from public.game g where g.ledger_id = v_g.ledger_id and g.id <> v_g.id
                 and g.status in ('invited', 'active') and v_me in (g.black_id, g.white_id)) then
      raise exception 'GAME_ALREADY_OPEN' using errcode = '23505';
    end if;
    update public.game g set status = 'active', started_at = now(),
        turn_deadline = case g.rule
          when 'renju_lite' then now() + interval '30 seconds'
          when 'ten_vs' then now() + public.ten_vs_lead() + public.ten_vs_duration()
        end
      where g.id = v_g.id returning * into v_g;
  else
    update public.game g set status = 'declined', finished_at = now() where g.id = v_g.id returning * into v_g;
  end if;
  return public.game_result(v_g, true);
end;
$$;

-- ─────────────────────────────────────────────
-- 6) 대전 쓰기 함수 (security definer, 로그인 사용자만)
-- ─────────────────────────────────────────────

/*
 * 기록 저장: 터질 때마다(묶어서)·마감 뒤 마지막 1번(p_final = true). p_drags = 이 판에서 내가 터뜨린 네모 전부(처음부터)
 * 서버가 같은 판으로 다시 세어 점수를 저장한다. 이미 받은 기록보다 짧은 기록(늦게 도착한 옛 요청)은 무시(applied = false)
 * 마감 + 5초가 지났으면 받지 않고 판을 닫는다(applied = false). 두 사람 마지막 기록이 다 오면 바로 닫는다
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND / GAME_NOT_ACTIVE(초대 중) / TEN_BAD_DRAGS
 * 결과: 판 결과 + my_score (끝난 판이면 opp_score)
 */
create or replace function public.ten_vs_save(p_game_id uuid, p_drags jsonb, p_final boolean default false) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
  v_score int;
  v_prev public.game_ten_board;
  v_final boolean;
  v_finals int;
begin
  v_g := public.ten_vs_lock(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  if v_g.status = 'invited' then
    raise exception 'GAME_NOT_ACTIVE' using errcode = '22023';
  end if;
  v_closed := public.ten_vs_close_due(v_g);
  if v_closed.status <> 'active' then
    return public.ten_vs_result(v_closed, false, v_me);
  end if;
  v_score := public.ten_replay(v_g.seed, p_drags);
  -- "마지막 기록"은 마감이 지난 뒤에 온 것만 (마감 전에 보낸 final 은 보통 저장)
  v_final := coalesce(p_final, false) and now() >= v_g.turn_deadline;

  select * into v_prev from public.game_ten_board b where b.game_id = v_g.id and b.member_id = v_me;
  if found and (jsonb_array_length(p_drags) < jsonb_array_length(v_prev.drags) or (v_prev.final and not v_final)) then
    return public.ten_vs_result(v_g, false, v_me);
  end if;
  insert into public.game_ten_board (game_id, ledger_id, member_id, drags, score, final, saved_at)
    values (v_g.id, v_g.ledger_id, v_me, p_drags, v_score, v_final, now())
    on conflict (game_id, member_id) do update
      set drags = excluded.drags, score = excluded.score, final = excluded.final, saved_at = now();

  -- 마감이 지났고 두 사람 마지막 기록이 다 왔으면 바로 결과
  if now() >= v_g.turn_deadline then
    select count(*) into v_finals from public.game_ten_board b where b.game_id = v_g.id and b.final;
    if v_finals = 2 then
      v_g := public.ten_vs_close(v_g);
    end if;
  end if;
  return public.ten_vs_result(v_g, true, v_me);
end;
$$;

/*
 * 그만하기 = 부른 사람 패 (시작 전·마감 전 모두). 이미 끝났으면 지금 상태(applied = false)
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND / GAME_NOT_ACTIVE(초대 중)
 */
create or replace function public.ten_vs_quit(p_game_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  v_g := public.ten_vs_lock(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  if v_g.status = 'invited' then
    raise exception 'GAME_NOT_ACTIVE' using errcode = '22023';
  end if;
  v_closed := public.ten_vs_close_due(v_g);
  if v_closed.status <> 'active' then
    return public.ten_vs_result(v_closed, false, v_me);
  end if;
  update public.game g set status = 'finished', end_reason = 'quit', finished_at = now(),
      winner_id = case when v_me = g.black_id then g.white_id else g.black_id end
    where g.id = v_g.id returning * into v_g;
  return public.ten_vs_result(v_g, true, v_me);
end;
$$;

/*
 * 결과 확정: 판 참가자 누구든. 마감 + 5초가 지났을 때만 마지막으로 받은 점수로 닫는다
 * 이미 끝난 판이면 지금 상태(applied = false)
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_BAD_KIND / GAME_NOT_ACTIVE(초대 중) / GAME_NOT_TIMED_OUT(아직)
 */
create or replace function public.ten_vs_settle(p_game_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  v_g := public.ten_vs_lock(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  if v_g.status = 'invited' then
    raise exception 'GAME_NOT_ACTIVE' using errcode = '22023';
  end if;
  if v_g.status <> 'active' then
    return public.ten_vs_result(v_g, false, v_me);
  end if;
  v_closed := public.ten_vs_close_due(v_g);
  if v_closed.status = 'active' then
    raise exception 'GAME_NOT_TIMED_OUT' using errcode = '22023';
  end if;
  return public.ten_vs_result(v_closed, true, v_me);
end;
$$;

-- ─────────────────────────────────────────────
-- 7) 권한: 가계부 현재 멤버만 읽기, 쓰기는 함수로만
-- ─────────────────────────────────────────────
alter table public.game_ten_best enable row level security;
revoke all on public.game_ten_best from public, anon, authenticated;
grant select on public.game_ten_best to authenticated;
create policy game_ten_best_select on public.game_ten_best for select to authenticated
  using (public.is_ledger_member(ledger_id));

-- 대전 기록: 판이 끝나기 전에는 자기 기록만 (상대 기록 = 답 힌트)
alter table public.game_ten_board enable row level security;
revoke all on public.game_ten_board from public, anon, authenticated;
grant select on public.game_ten_board to authenticated;
create policy game_ten_board_select on public.game_ten_board for select to authenticated
  using (public.is_ledger_member(ledger_id)
         and (member_id = public.current_member_id(ledger_id)
              or exists (select 1 from public.game g where g.id = game_id and g.status <> 'active')));

revoke execute on function public.ten_board(bigint) from public, anon, authenticated;
revoke execute on function public.ten_replay(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.ten_vs_lead() from public, anon, authenticated;
revoke execute on function public.ten_vs_duration() from public, anon, authenticated;
revoke execute on function public.ten_vs_grace() from public, anon, authenticated;
revoke execute on function public.ten_vs_lock(uuid) from public, anon, authenticated;
revoke execute on function public.ten_vs_close(public.game) from public, anon, authenticated;
revoke execute on function public.ten_vs_close_due(public.game) from public, anon, authenticated;
revoke execute on function public.ten_vs_result(public.game, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.game_close_stale(uuid) from public, anon, authenticated;
revoke execute on function public.invite_game(uuid, uuid, text, uuid, text) from public, anon;
revoke execute on function public.respond_game(uuid, boolean) from public, anon;
revoke execute on function public.record_ten_score(uuid, bigint, jsonb) from public, anon;
revoke execute on function public.ten_vs_save(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.ten_vs_quit(uuid) from public, anon;
revoke execute on function public.ten_vs_settle(uuid) from public, anon;
grant execute on function public.invite_game(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function public.respond_game(uuid, boolean) to authenticated;
grant execute on function public.record_ten_score(uuid, bigint, jsonb) to authenticated;
grant execute on function public.ten_vs_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.ten_vs_quit(uuid) to authenticated;
grant execute on function public.ten_vs_settle(uuid) to authenticated;
