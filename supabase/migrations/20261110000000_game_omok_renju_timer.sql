-- BANB-53 오목 1+: 판별 룰 기록 + 쌍삼(33) 금지(흑·백) + 한 수 30초 + 무승부 제안
--   1) game.rule = 'free' | 'renju_lite'
--      이 마이그레이션 전부터 있던 판(진행 중·끝난 판 모두) = free: 시간 제한 없음 · 24시간 중단 · 33 허용 (예전 그대로)
--      이후 새로 만드는 판(한 판 더 포함) = renju_lite (열 기본값. invite_game 은 룰을 받지 않는다 — 서버만 정한다)
--   2) renju_lite: 한 수 30초. game.turn_deadline = 대국 시작·수를 둘 때마다 서버 now() + 30초
--      마감이 지나면(now() > turn_deadline) 차례인 사람 패 — end_reason 'turn_timeout'. 24시간 중단은 적용하지 않는다(Q19)
--      확정은 예약 작업 없이: 판 참가자 누구든 claim_turn_timeout, 또는 다음 쓰기·sweep_games 때 서버 시각으로 닫는다
--      마감이 지난 뒤 온 수·기권·무승부 답은 반영하지 않고 시간 초과로 닫는다(applied = false)
--   3) renju_lite: 33 금지(흑·백 같은 규칙). 한 수로 "열린 3"이 두 개 이상 생기면 둘 수 없다 → GAME_FORBIDDEN_33
--      열린 3 = 그 수를 지나는 한 줄에서, 빈칸 하나를 더 두면 그 수를 포함한 정확히 4개 연속 + 양끝이 판 안 빈칸(열린 4)이 되는 형태
--      (한 칸 띈 X·XX 포함). 이미 4(빈칸 하나로 5 이상)인 줄은 3으로 세지 않는다 → 44·43 허용. 그 빈칸이 다시 금지수인지는 보지 않는다(단순화)
--      5목(장목 포함)이 되는 수는 33이어도 둘 수 있고 바로 승리(승리가 금지보다 먼저)
--   4) 무승부 제안(두 룰 모두): 내 차례에만 offer_draw. 상대가 respond_draw 로 수락(→ 'draw_agreed', 무) / 거절
--      제안은 상대가 수를 두거나·거절하거나·판이 끝나면 사라진다. 제안자가 자기 수를 둬도 남는다(Q18)
--      같은 판에서 다시 제안은 상대가 한 수 둔 뒤부터: move_count > draw_offer_count (제안할 때의 수)
--      수락은 마감 전(now() <= turn_deadline)만. 마감이 지났으면 시간 초과가 먼저
--   5) game_server_now(): 화면이 서버 시각과의 차이를 보정해 남은 시간을 그린다. game_result 에도 server_now 를 넣는다
--   6) 권한: 직접 쓰기 없음 그대로 (RLS 완화 없음). 새 쓰기 함수는 로그인 사용자만
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

-- ─────────────────────────────────────────────
-- 1) 열·규칙
-- ─────────────────────────────────────────────
alter table public.game
  add column rule text not null default 'free' check (rule in ('free', 'renju_lite')),
  add column turn_deadline timestamptz,           -- renju_lite 대국 중: 지금 차례의 마감 (서버 시각)
  add column draw_offer_by uuid,                  -- 답을 기다리는 무승부 제안을 한 사람 (member id). 없으면 null
  add column draw_offer_count smallint,           -- 마지막 무승부 제안 때의 move_count (다시 제안 제한)
  add constraint game_draw_offer_member foreign key (draw_offer_by, ledger_id) references public.member (id, ledger_id);
-- 위 add column 의 기본값으로 기존 판은 모두 free. 이후 새 판은 renju_lite
alter table public.game alter column rule set default 'renju_lite';

alter table public.game drop constraint game_end_reason_check;
alter table public.game add constraint game_end_reason_check
  check (end_reason in ('five', 'resign', 'draw', 'timeout', 'turn_timeout', 'draw_agreed'));

alter table public.game drop constraint game_state_rule;
alter table public.game add constraint game_state_rule check (coalesce(
  (status = 'invited' and started_at is null and finished_at is null and winner_id is null and end_reason is null and move_count = 0)
  or (status = 'active' and started_at is not null and finished_at is null and winner_id is null and end_reason is null)
  or (status = 'finished' and started_at is not null and finished_at is not null
      and ((end_reason in ('five', 'resign', 'turn_timeout') and winner_id is not null)
           or (end_reason in ('draw', 'draw_agreed') and winner_id is null)))
  or (status in ('declined', 'canceled', 'expired') and started_at is null and finished_at is not null
      and winner_id is null and end_reason is null and move_count = 0)
  or (status = 'abandoned' and started_at is not null and finished_at is not null
      and winner_id is null and end_reason = 'timeout'),
  false
));

-- 룰마다: free = 마감 없음·시간 초과 없음 / renju_lite = 대국 중이면 마감 있음·24시간 중단 없음
alter table public.game add constraint game_rule_time check (coalesce(
  (rule = 'free' and turn_deadline is null and end_reason is distinct from 'turn_timeout')
  or (rule = 'renju_lite' and (status <> 'active' or turn_deadline is not null) and status <> 'abandoned'),
  false
));
-- 무승부 제안은 대국 중에만, 두 사람 중 한 명
alter table public.game add constraint game_draw_offer_rule check (
  draw_offer_by is null or (status = 'active' and draw_offer_by in (black_id, white_id))
);

-- ─────────────────────────────────────────────
-- 2) 판정 (순수 함수 — 화면 domain/omok.ts 의 doubleThreeAt 와 같은 규칙)
-- ─────────────────────────────────────────────
-- 판 칸 값 (1 = 내 돌, 2 = 상대 돌, 0 = 빈칸, -1 = 판 밖). p_board 는 225칸, index = x * 15 + y + 1
create or replace function public.omok_at(p_board int[], p_x int, p_y int) returns int
language sql immutable
set search_path = ''
as $$
  select case when p_x between 0 and 14 and p_y between 0 and 14 then p_board[p_x * 15 + p_y + 1] else -1 end;
$$;

/*
 * (p_x, p_y)에 내 돌을 둔 판에서 33인가. p_mine 은 새 돌을 포함한 내 돌, p_opp 는 상대 돌 (x * 15 + y)
 * 그 수를 지나는 4방향마다:
 *   - 4: 빈칸 e 하나를 더 두면 (p_x, p_y)를 지나는 5개 이상 연속 → 3으로 세지 않는다
 *   - 열린 3: 빈칸 e 하나를 더 두면 (p_x, p_y)와 e 를 포함한 정확히 4개 연속 + 양끝이 판 안 빈칸
 * 열린 3인 방향이 2개 이상이면 true
 */
create or replace function public.omok_is_double_three(p_mine int[], p_opp int[], p_x int, p_y int) returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_b int[] := array_fill(0, array[225]);
  v_dirs int[] := array[[1, 0], [0, 1], [1, 1], [1, -1]];
  v_c int;
  v_dx int;
  v_dy int;
  v_ex int;
  v_ey int;
  v_s int;
  v_t int;
  v_four boolean;
  v_open boolean;
  v_threes int := 0;
begin
  foreach v_c in array coalesce(p_opp, '{}') loop
    v_b[v_c + 1] := 2;
  end loop;
  foreach v_c in array coalesce(p_mine, '{}') loop
    v_b[v_c + 1] := 1;
  end loop;

  for i in 1..4 loop
    v_dx := v_dirs[i][1];
    v_dy := v_dirs[i][2];
    v_four := false;
    v_open := false;
    for k in -4..4 loop
      continue when k = 0;
      v_ex := p_x + k * v_dx;
      v_ey := p_y + k * v_dy;
      continue when public.omok_at(v_b, v_ex, v_ey) <> 0;
      -- e 를 내 돌로 볼 때 (p_x, p_y)를 지나는 연속 구간 [s, t] (방향 위 거리)
      v_s := 0;
      while (v_s - 1 = k) or public.omok_at(v_b, p_x + (v_s - 1) * v_dx, p_y + (v_s - 1) * v_dy) = 1 loop
        v_s := v_s - 1;
      end loop;
      v_t := 0;
      while (v_t + 1 = k) or public.omok_at(v_b, p_x + (v_t + 1) * v_dx, p_y + (v_t + 1) * v_dy) = 1 loop
        v_t := v_t + 1;
      end loop;
      if v_t - v_s + 1 >= 5 then
        v_four := true;
      elsif v_t - v_s + 1 = 4 and k between v_s and v_t
        and public.omok_at(v_b, p_x + (v_s - 1) * v_dx, p_y + (v_s - 1) * v_dy) = 0
        and public.omok_at(v_b, p_x + (v_t + 1) * v_dx, p_y + (v_t + 1) * v_dy) = 0 then
        v_open := true;
      end if;
    end loop;
    if v_open and not v_four then
      v_threes := v_threes + 1;
    end if;
  end loop;
  return v_threes >= 2;
end;
$$;

-- ─────────────────────────────────────────────
-- 3) 시간 마감·멈춘 판
-- ─────────────────────────────────────────────
-- 대국 중인데 끝났어야 하는 판인가: renju_lite = 마감 지남(now() > turn_deadline) / free = 24시간 수 없음
create or replace function public.game_overdue(p_game public.game) returns boolean
language sql stable
set search_path = ''
as $$
  select p_game.status = 'active' and case p_game.rule
    when 'renju_lite' then now() > p_game.turn_deadline
    else coalesce(p_game.last_move_at, p_game.started_at) <= now() - interval '24 hours'
  end;
$$;

-- 잠근 판을 닫는다(끝났어야 하는 판일 때만). renju_lite = 차례인 사람 패(turn_timeout), free = 중단(abandoned)
-- 결과: 지금 판 (닫지 않았으면 그대로)
create or replace function public.game_close_overdue(p_game public.game) returns public.game
language plpgsql
set search_path = ''
as $$
declare
  v_g public.game;
begin
  if not public.game_overdue(p_game) then
    return p_game;
  end if;
  if p_game.rule = 'renju_lite' then
    update public.game g set status = 'finished', end_reason = 'turn_timeout', finished_at = now(), draw_offer_by = null,
        winner_id = case when g.move_count % 2 = 0 then g.white_id else g.black_id end
      where g.id = p_game.id returning * into v_g;
  else
    update public.game g set status = 'abandoned', end_reason = 'timeout', finished_at = now(), draw_offer_by = null
      where g.id = p_game.id returning * into v_g;
  end if;
  return v_g;
end;
$$;

-- 이 가계부의 지난 초대(10분)·멈춘 판(free 24시간)·마감 지난 판(renju_lite 30초)을 닫는다. 바꾼 판 수
create or replace function public.game_close_stale(p_ledger_id uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a int;
  v_b int;
  v_c int;
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
  return v_a + v_b + v_c;
end;
$$;

-- 판 결과 (화면이 바로 반영할 값). server_now = 화면 시계 보정용
create or replace function public.game_result(p_game public.game, p_applied boolean) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_game.id, 'status', p_game.status, 'move_count', p_game.move_count,
    'winner_id', p_game.winner_id, 'end_reason', p_game.end_reason, 'applied', p_applied,
    'rule', p_game.rule, 'turn_deadline', p_game.turn_deadline, 'draw_offer_by', p_game.draw_offer_by,
    'draw_offer_count', p_game.draw_offer_count, 'server_now', now());
$$;

-- 서버 지금 시각 (화면 남은 시간 보정)
create or replace function public.game_server_now() returns timestamptz
language sql stable
set search_path = ''
as $$
  select now();
$$;

-- 판 하나를 참가자로 열어 잠근다. 오류: GAME_NOT_FOUND(없음·다른 가계부) / GAME_NOT_PLAYER
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
  select * into v_g from public.game g where g.id = p_game_id for update;
  return v_g;
end;
$$;

-- ─────────────────────────────────────────────
-- 4) 쓰기 함수 바꾸기 (시그니처 그대로)
-- ─────────────────────────────────────────────

/*
 * 초대 (BANB-49 그대로). 새 판의 rule 은 열 기본값(renju_lite) — 화면이 고르지 않는다
 */
create or replace function public.invite_game(p_ledger_id uuid, p_opponent uuid, p_kind text default 'omok', p_rematch_of uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id(p_ledger_id);
  v_prev public.game;
  v_black uuid;
  v_white uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'NOT_IN_LEDGER' using errcode = '42501';
  end if;
  if p_kind is distinct from 'omok' then
    raise exception 'GAME_BAD_KIND' using errcode = '22023';
  end if;
  if p_opponent is null or p_opponent = v_me or not exists (
    select 1 from public.member m where m.id = p_opponent and m.ledger_id = p_ledger_id and m.left_at is null
  ) then
    raise exception 'GAME_BAD_OPPONENT' using errcode = '22023';
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

  if p_rematch_of is null then
    v_black := p_opponent;
    v_white := v_me;
  else
    select * into v_prev from public.game g where g.id = p_rematch_of and g.ledger_id = p_ledger_id;
    if not found or v_prev.status not in ('finished', 'abandoned')
       or not (v_me in (v_prev.black_id, v_prev.white_id) and p_opponent in (v_prev.black_id, v_prev.white_id)) then
      raise exception 'GAME_BAD_REMATCH' using errcode = '22023';
    end if;
    v_black := v_prev.white_id;
    v_white := v_prev.black_id;
  end if;

  insert into public.game (ledger_id, kind, black_id, white_id, created_by, rematch_of)
    values (p_ledger_id, 'omok', v_black, v_white, v_me, p_rematch_of)
    returning id into v_id;
  return v_id;
end;
$$;

/*
 * 초대 수락 / 거절 (BANB-49 그대로). renju_lite 판은 수락하는 순간 흑의 마감 = now() + 30초
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
        turn_deadline = case when g.rule = 'renju_lite' then now() + interval '30 seconds' end
      where g.id = v_g.id returning * into v_g;
  else
    update public.game g set status = 'declined', finished_at = now() where g.id = v_g.id returning * into v_g;
  end if;
  return public.game_result(v_g, true);
end;
$$;

/*
 * 한 수 두기. 서버가 차례·빈칸·판 상태·멤버를 확인하고 5목·(renju_lite) 33·무승부를 판정한다.
 * 끝났어야 하는 판(renju_lite 마감 지남 / free 24시간)이면 닫고 결과를 돌려준다(applied = false, 돌 없음).
 * renju_lite: 둘 때마다 마감 = now() + 30초. 5목이 되는 수는 33이어도 승리
 * 무승부 제안: 상대가 두면 사라지고, 제안한 사람이 두면 남는다
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_NOT_ACTIVE / GAME_NOT_YOUR_TURN / GAME_BAD_CELL / GAME_CELL_TAKEN / GAME_FORBIDDEN_33
 * 결과: {id, status, move_count, winner_id, end_reason, applied, rule, turn_deadline, draw_offer_by, draw_offer_count, server_now, seq}
 */
create or replace function public.play_move(p_game_id uuid, p_x integer, p_y integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
  v_turn uuid;
  v_seq smallint;
  v_mine int[];
  v_opp int[];
begin
  -- 같은 판의 수는 차례대로 (두 기기 동시 요청·시간 초과 확정 포함)
  v_g := public.game_lock_as_player(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  v_closed := public.game_close_overdue(v_g);
  if v_closed.status <> v_g.status then
    return public.game_result(v_closed, false);
  end if;
  if v_g.status <> 'active' then
    raise exception 'GAME_NOT_ACTIVE' using errcode = '22023';
  end if;
  v_turn := case when v_g.move_count % 2 = 0 then v_g.black_id else v_g.white_id end;
  if v_me <> v_turn then
    raise exception 'GAME_NOT_YOUR_TURN' using errcode = '22023';
  end if;
  if p_x is null or p_y is null or p_x not between 0 and 14 or p_y not between 0 and 14 then
    raise exception 'GAME_BAD_CELL' using errcode = '22023';
  end if;
  if exists (select 1 from public.game_move m where m.game_id = v_g.id and m.x = p_x and m.y = p_y) then
    raise exception 'GAME_CELL_TAKEN' using errcode = '23505';
  end if;

  select coalesce(array_agg(m.x * 15 + m.y) filter (where m.member_id = v_me), '{}'),
         coalesce(array_agg(m.x * 15 + m.y) filter (where m.member_id <> v_me), '{}')
    into v_mine, v_opp
    from public.game_move m where m.game_id = v_g.id;
  v_mine := v_mine || (p_x * 15 + p_y);

  v_seq := v_g.move_count + 1;
  if public.omok_has_five(v_mine, p_x, p_y) then
    insert into public.game_move (game_id, ledger_id, seq, x, y, member_id)
      values (v_g.id, v_g.ledger_id, v_seq, p_x, p_y, v_me);
    update public.game g set move_count = v_seq, last_move_at = now(),
        status = 'finished', winner_id = v_me, end_reason = 'five', finished_at = now(), draw_offer_by = null
      where g.id = v_g.id returning * into v_g;
    return public.game_result(v_g, true) || jsonb_build_object('seq', v_seq);
  end if;
  if v_g.rule = 'renju_lite' and public.omok_is_double_three(v_mine, v_opp, p_x, p_y) then
    raise exception 'GAME_FORBIDDEN_33' using errcode = '22023';
  end if;

  insert into public.game_move (game_id, ledger_id, seq, x, y, member_id)
    values (v_g.id, v_g.ledger_id, v_seq, p_x, p_y, v_me);
  if v_seq = 225 then
    update public.game g set move_count = v_seq, last_move_at = now(),
        status = 'finished', end_reason = 'draw', finished_at = now(), draw_offer_by = null
      where g.id = v_g.id returning * into v_g;
  else
    update public.game g set move_count = v_seq, last_move_at = now(),
        turn_deadline = case when g.rule = 'renju_lite' then now() + interval '30 seconds' end,
        draw_offer_by = case when g.draw_offer_by = v_me then v_me end
      where g.id = v_g.id returning * into v_g;
  end if;
  return public.game_result(v_g, true) || jsonb_build_object('seq', v_seq);
end;
$$;

/*
 * 기권: 대국 중인 판의 두 사람 중 누구나(차례와 상관없이). 상대가 이긴다.
 * 끝났어야 하는 판(마감 지남·24시간)이면 그렇게 닫는다(applied = false). 이미 끝난 판이면 지금 상태(applied = false)
 */
create or replace function public.resign_game(p_game_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  v_g := public.game_lock_as_player(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  v_closed := public.game_close_overdue(v_g);
  if v_closed.status <> v_g.status or v_g.status <> 'active' then
    return public.game_result(v_closed, false);
  end if;
  update public.game g set status = 'finished', end_reason = 'resign', finished_at = now(), draw_offer_by = null,
      winner_id = case when v_me = g.black_id then g.white_id else g.black_id end
    where g.id = v_g.id returning * into v_g;
  return public.game_result(v_g, true);
end;
$$;

/*
 * 시간 초과 확정: 판 참가자 누구든. 서버가 now() > turn_deadline 일 때만 차례인 사람 패로 닫는다.
 * (free 판은 24시간이 지났을 때만 중단으로 닫는다)
 * 이미 끝난 판이면 지금 상태(applied = false, 두 번 불러도 전적은 한 번)
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_NOT_TIMED_OUT(마감 전)
 */
create or replace function public.claim_turn_timeout(p_game_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
begin
  v_g := public.game_lock_as_player(p_game_id);
  if v_g.status <> 'active' then
    return public.game_result(v_g, false);
  end if;
  if not public.game_overdue(v_g) then
    raise exception 'GAME_NOT_TIMED_OUT' using errcode = '22023';
  end if;
  return public.game_result(public.game_close_overdue(v_g), true);
end;
$$;

/*
 * 무승부 제안: 내 차례에만. 상대 화면에 수락/거절. 마감이 지났으면 시간 초과로 닫는다(applied = false)
 * 이미 내가 제안해 둔 상태면 applied = false
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_NOT_ACTIVE / GAME_NOT_YOUR_TURN
 *      / GAME_DRAW_PENDING(상대 제안에 먼저 답하기) / GAME_DRAW_TOO_SOON(상대가 한 수 둔 뒤 다시)
 */
create or replace function public.offer_draw(p_game_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  v_g := public.game_lock_as_player(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  v_closed := public.game_close_overdue(v_g);
  if v_closed.status <> v_g.status then
    return public.game_result(v_closed, false);
  end if;
  if v_g.status <> 'active' then
    raise exception 'GAME_NOT_ACTIVE' using errcode = '22023';
  end if;
  if v_me <> (case when v_g.move_count % 2 = 0 then v_g.black_id else v_g.white_id end) then
    raise exception 'GAME_NOT_YOUR_TURN' using errcode = '22023';
  end if;
  if v_g.draw_offer_by = v_me then
    return public.game_result(v_g, false);
  end if;
  if v_g.draw_offer_by is not null then
    raise exception 'GAME_DRAW_PENDING' using errcode = '22023';
  end if;
  if v_g.draw_offer_count is not null and v_g.move_count <= v_g.draw_offer_count then
    raise exception 'GAME_DRAW_TOO_SOON' using errcode = '22023';
  end if;
  update public.game g set draw_offer_by = v_me, draw_offer_count = g.move_count
    where g.id = v_g.id returning * into v_g;
  return public.game_result(v_g, true);
end;
$$;

/*
 * 무승부 제안에 답하기: 제안받은 사람만(차례와 상관없이). 수락 = 무승부(draw_agreed), 거절 = 제안 사라짐
 * 마감이 지났으면 수락·거절 모두 반영하지 않고 시간 초과로 닫는다(applied = false — 시간 초과가 먼저)
 * 제안이 이미 사라졌거나 판이 끝났으면 지금 상태(applied = false)
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_NOT_DRAW_TARGET(제안한 사람 본인)
 */
create or replace function public.respond_draw(p_game_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_closed public.game;
  v_me uuid;
begin
  v_g := public.game_lock_as_player(p_game_id);
  v_me := public.current_member_id(v_g.ledger_id);
  v_closed := public.game_close_overdue(v_g);
  if v_closed.status <> v_g.status or v_g.status <> 'active' or v_g.draw_offer_by is null then
    return public.game_result(v_closed, false);
  end if;
  if v_g.draw_offer_by = v_me then
    raise exception 'GAME_NOT_DRAW_TARGET' using errcode = '42501';
  end if;
  if p_accept then
    update public.game g set status = 'finished', end_reason = 'draw_agreed', finished_at = now(), draw_offer_by = null
      where g.id = v_g.id returning * into v_g;
  else
    update public.game g set draw_offer_by = null where g.id = v_g.id returning * into v_g;
  end if;
  return public.game_result(v_g, true);
end;
$$;

-- ─────────────────────────────────────────────
-- 5) 권한: 판정·내부 함수는 실행 불가, 쓰기 함수는 로그인 사용자만
-- ─────────────────────────────────────────────
revoke execute on function public.omok_at(int[], int, int) from public, anon, authenticated;
revoke execute on function public.omok_is_double_three(int[], int[], int, int) from public, anon, authenticated;
revoke execute on function public.game_overdue(public.game) from public, anon, authenticated;
revoke execute on function public.game_close_overdue(public.game) from public, anon, authenticated;
revoke execute on function public.game_lock_as_player(uuid) from public, anon, authenticated;
revoke execute on function public.game_server_now() from public, anon;
revoke execute on function public.claim_turn_timeout(uuid) from public, anon;
revoke execute on function public.offer_draw(uuid) from public, anon;
revoke execute on function public.respond_draw(uuid, boolean) from public, anon;
grant execute on function public.game_server_now() to authenticated;
grant execute on function public.claim_turn_timeout(uuid) to authenticated;
grant execute on function public.offer_draw(uuid) to authenticated;
grant execute on function public.respond_draw(uuid, boolean) to authenticated;
