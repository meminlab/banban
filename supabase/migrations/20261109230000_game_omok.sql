-- BANB-49 같이 놀기 1차: 오목 실시간 대전 (game + game_move + 서버 판정 함수)
--   1) game: 가계부 안 두 멤버의 판. 흑 = 초대받은 사람(초대한 사람이 백), "한 판 더"는 흑백을 바꾼다
--      상태 invited(초대, 10분) → active(대국) → finished(five/resign/draw) / declined(거절) / canceled(초대한 사람이 취소)
--      / expired(10분 지남) / abandoned(24시간 수 없음, timeout)
--   2) game_move: 판의 수(순번·x·y·둔 사람). (판, 칸)은 한 번만
--   3) 쓰기는 함수로만: invite_game / respond_game / cancel_game / play_move / resign_game / sweep_games
--      차례·빈칸·판 상태·멤버 확인과 5목(6목 이상 장목 포함)·무승부 판정은 서버가 한다. 화면이 보낸 값은 칸 좌표만 쓴다
--      한 사람은 가계부 안에서 진행 중인 판(invited·active) 1개까지 (가계부 단위 잠금으로 동시 요청도 막는다)
--      초대 만료·24시간 중단은 쓰기·sweep_games 때 서버 시각으로 닫는다(예약 작업 없음)
--   4) 권한: 가계부 현재 멤버만 읽기. 직접 쓰기 없음 (RLS 완화 없음)
--   5) 실시간: supabase_realtime 발행에 game·game_move 추가 (구독자도 RLS 로 걸러진다)
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

-- ─────────────────────────────────────────────
-- 1) game
-- ─────────────────────────────────────────────
create table public.game (
  id                 uuid primary key default gen_random_uuid(),
  ledger_id          uuid not null references public.ledger (id) on delete cascade,
  kind               text not null default 'omok' check (kind in ('omok')),
  black_id           uuid not null,          -- member id (선공)
  white_id           uuid not null,          -- member id
  status             text not null default 'invited'
                       check (status in ('invited', 'active', 'finished', 'declined', 'canceled', 'expired', 'abandoned')),
  winner_id          uuid,                   -- finished(five·resign)일 때만
  end_reason         text check (end_reason in ('five', 'resign', 'draw', 'timeout')),
  move_count         smallint not null default 0 check (move_count between 0 and 225),
  created_by         uuid not null,          -- 초대한 사람 (member id)
  rematch_of         uuid references public.game (id) on delete set null,  -- "한 판 더"로 만든 판이면 앞 판
  created_at         timestamptz not null default now(),
  invite_expires_at  timestamptz not null default now() + interval '10 minutes',
  started_at         timestamptz,            -- 수락한 시각
  last_move_at       timestamptz,            -- 마지막 수 시각 (24시간 중단 기준 = coalesce(last_move_at, started_at))
  finished_at        timestamptz,
  unique (id, ledger_id),
  foreign key (black_id, ledger_id) references public.member (id, ledger_id),
  foreign key (white_id, ledger_id) references public.member (id, ledger_id),
  foreign key (created_by, ledger_id) references public.member (id, ledger_id),
  foreign key (winner_id, ledger_id) references public.member (id, ledger_id),
  constraint game_players_rule check (black_id <> white_id and created_by in (black_id, white_id)),
  constraint game_winner_rule check (winner_id is null or winner_id in (black_id, white_id)),
  -- 상태마다 채워져야 하는 값 (coalesce: null 이 섞여 검사를 통과하지 않게)
  constraint game_state_rule check (coalesce(
    (status = 'invited' and started_at is null and finished_at is null and winner_id is null and end_reason is null and move_count = 0)
    or (status = 'active' and started_at is not null and finished_at is null and winner_id is null and end_reason is null)
    or (status = 'finished' and started_at is not null and finished_at is not null
        and ((end_reason in ('five', 'resign') and winner_id is not null) or (end_reason = 'draw' and winner_id is null)))
    or (status in ('declined', 'canceled', 'expired') and started_at is null and finished_at is not null
        and winner_id is null and end_reason is null and move_count = 0)
    or (status = 'abandoned' and started_at is not null and finished_at is not null
        and winner_id is null and end_reason = 'timeout'),
    false
  ))
);
create index game_ledger_created_idx on public.game (ledger_id, created_at desc);
create index game_open_idx on public.game (ledger_id) where status in ('invited', 'active');

-- ─────────────────────────────────────────────
-- 2) game_move
-- ─────────────────────────────────────────────
create table public.game_move (
  game_id     uuid not null,
  ledger_id   uuid not null,                  -- 권한·실시간 필터용 (판의 가계부와 같다)
  seq         smallint not null check (seq between 1 and 225),   -- 1 = 첫 수(흑)
  x           smallint not null check (x between 0 and 14),
  y           smallint not null check (y between 0 and 14),
  member_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, seq),
  unique (game_id, x, y),
  foreign key (game_id, ledger_id) references public.game (id, ledger_id) on delete cascade,
  foreign key (member_id, ledger_id) references public.member (id, ledger_id)
);
create index game_move_ledger_idx on public.game_move (ledger_id);

-- ─────────────────────────────────────────────
-- 3) 판정 (순수 함수 — 화면 domain/omok.ts 와 같은 규칙)
-- ─────────────────────────────────────────────
-- p_cells = 한 사람의 돌 위치(x * 15 + y). (p_x, p_y)를 지나는 가로·세로·대각 중 5개 이상 이어진 줄이 있나 (장목 포함)
create or replace function public.omok_has_five(p_cells int[], p_x int, p_y int) returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_dirs int[] := array[[1, 0], [0, 1], [1, 1], [1, -1]];
  v_dx int;
  v_dy int;
  v_len int;
  v_k int;
begin
  for i in 1..4 loop
    v_dx := v_dirs[i][1];
    v_dy := v_dirs[i][2];
    v_len := 1;
    v_k := 1;
    while p_x + v_k * v_dx between 0 and 14 and p_y + v_k * v_dy between 0 and 14
      and ((p_x + v_k * v_dx) * 15 + (p_y + v_k * v_dy)) = any (p_cells) loop
      v_len := v_len + 1;
      v_k := v_k + 1;
    end loop;
    v_k := 1;
    while p_x - v_k * v_dx between 0 and 14 and p_y - v_k * v_dy between 0 and 14
      and ((p_x - v_k * v_dx) * 15 + (p_y - v_k * v_dy)) = any (p_cells) loop
      v_len := v_len + 1;
      v_k := v_k + 1;
    end loop;
    if v_len >= 5 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- 이 가계부의 지난 초대(10분)·멈춘 판(24시간)을 닫는다. 바꾼 판 수
create or replace function public.game_close_stale(p_ledger_id uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a int;
  v_b int;
begin
  update public.game g set status = 'expired', finished_at = now()
    where g.ledger_id = p_ledger_id and g.status = 'invited' and g.invite_expires_at <= now();
  get diagnostics v_a = row_count;
  update public.game g set status = 'abandoned', end_reason = 'timeout', finished_at = now()
    where g.ledger_id = p_ledger_id and g.status = 'active'
      and coalesce(g.last_move_at, g.started_at) <= now() - interval '24 hours';
  get diagnostics v_b = row_count;
  return v_a + v_b;
end;
$$;

-- 가계부 단위 잠금: 초대·수락이 동시에 와도 "한 사람 진행 중 판 1개"가 깨지지 않게
create or replace function public.game_lock_ledger(p_ledger_id uuid) returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('banban.game:' || p_ledger_id::text, 0));
$$;

-- 판 결과 (화면이 바로 반영할 값)
create or replace function public.game_result(p_game public.game, p_applied boolean) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_game.id, 'status', p_game.status, 'move_count', p_game.move_count,
    'winner_id', p_game.winner_id, 'end_reason', p_game.end_reason, 'applied', p_applied);
$$;

-- ─────────────────────────────────────────────
-- 4) 쓰기 함수 (security definer, 로그인 사용자만)
-- ─────────────────────────────────────────────

/*
 * 초대: 같은 가계부 현재 멤버 p_opponent 에게 오목 한 판. 초대받은 사람이 흑.
 * p_rematch_of 를 주면 그 판(같은 두 사람, 끝난 판)의 흑백을 바꿔 새 초대를 만든다("한 판 더").
 * 오류: NOT_IN_LEDGER / GAME_BAD_KIND / GAME_BAD_OPPONENT / GAME_ALREADY_OPEN(내가 진행 중) / GAME_OPPONENT_BUSY / GAME_BAD_REMATCH
 * 결과: 새 판 id
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
 * 초대 수락(p_accept = true) / 거절. 초대받은 사람만.
 * 10분이 지났으면 expired 로 닫고 그 결과를 돌려준다(applied = false). 이미 답한 판이면 지금 상태(applied = false)
 * 오류: GAME_NOT_FOUND / GAME_NOT_INVITEE / GAME_ALREADY_OPEN(수락하는 사람이 다른 판 진행 중)
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
    update public.game g set status = 'active', started_at = now() where g.id = v_g.id returning * into v_g;
  else
    update public.game g set status = 'declined', finished_at = now() where g.id = v_g.id returning * into v_g;
  end if;
  return public.game_result(v_g, true);
end;
$$;

/*
 * 초대 취소: 초대한 사람만, 아직 답이 없는 초대만. 이미 수락·거절·만료됐으면 지금 상태(applied = false)
 */
create or replace function public.cancel_game(p_game_id uuid) returns jsonb
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
  if v_me <> v_g.created_by then
    raise exception 'GAME_NOT_INVITER' using errcode = '42501';
  end if;

  perform public.game_lock_ledger(v_g.ledger_id);
  perform public.game_close_stale(v_g.ledger_id);
  select * into v_g from public.game g where g.id = p_game_id;
  if v_g.status <> 'invited' then
    return public.game_result(v_g, false);
  end if;
  update public.game g set status = 'canceled', finished_at = now() where g.id = v_g.id returning * into v_g;
  return public.game_result(v_g, true);
end;
$$;

/*
 * 한 수 두기. (p_x, p_y) = 0~14. 서버가 차례·빈칸·판 상태·멤버를 확인하고 5목·무승부를 판정한다.
 * 24시간 수가 없던 판이면 abandoned 로 닫고 결과를 돌려준다(applied = false).
 * 오류: GAME_NOT_FOUND / GAME_NOT_PLAYER / GAME_NOT_ACTIVE / GAME_NOT_YOUR_TURN / GAME_BAD_CELL / GAME_CELL_TAKEN
 * 결과: {id, status, move_count, winner_id, end_reason, applied, seq}
 */
create or replace function public.play_move(p_game_id uuid, p_x integer, p_y integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_g public.game;
  v_me uuid;
  v_turn uuid;
  v_seq smallint;
  v_cells int[];
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

  -- 같은 판의 수는 차례대로 (두 기기 동시 요청 포함)
  select * into v_g from public.game g where g.id = p_game_id for update;
  if v_g.status = 'active' and coalesce(v_g.last_move_at, v_g.started_at) <= now() - interval '24 hours' then
    update public.game g set status = 'abandoned', end_reason = 'timeout', finished_at = now()
      where g.id = v_g.id returning * into v_g;
    return public.game_result(v_g, false);
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

  v_seq := v_g.move_count + 1;
  insert into public.game_move (game_id, ledger_id, seq, x, y, member_id)
    values (v_g.id, v_g.ledger_id, v_seq, p_x, p_y, v_me);

  select array_agg(m.x * 15 + m.y) into v_cells from public.game_move m
    where m.game_id = v_g.id and m.member_id = v_me;

  if public.omok_has_five(v_cells, p_x, p_y) then
    update public.game g set move_count = v_seq, last_move_at = now(),
        status = 'finished', winner_id = v_me, end_reason = 'five', finished_at = now()
      where g.id = v_g.id returning * into v_g;
  elsif v_seq = 225 then
    update public.game g set move_count = v_seq, last_move_at = now(),
        status = 'finished', end_reason = 'draw', finished_at = now()
      where g.id = v_g.id returning * into v_g;
  else
    update public.game g set move_count = v_seq, last_move_at = now()
      where g.id = v_g.id returning * into v_g;
  end if;
  return public.game_result(v_g, true) || jsonb_build_object('seq', v_seq);
end;
$$;

/*
 * 기권: 대국 중인 판의 두 사람 중 누구나(차례와 상관없이). 상대가 이긴다.
 * 24시간이 지난 판이면 abandoned 로 닫는다(applied = false). 이미 끝난 판이면 지금 상태(applied = false)
 */
create or replace function public.resign_game(p_game_id uuid) returns jsonb
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
  if v_me not in (v_g.black_id, v_g.white_id) then
    raise exception 'GAME_NOT_PLAYER' using errcode = '42501';
  end if;

  select * into v_g from public.game g where g.id = p_game_id for update;
  if v_g.status = 'active' and coalesce(v_g.last_move_at, v_g.started_at) <= now() - interval '24 hours' then
    update public.game g set status = 'abandoned', end_reason = 'timeout', finished_at = now()
      where g.id = v_g.id returning * into v_g;
    return public.game_result(v_g, false);
  end if;
  if v_g.status <> 'active' then
    return public.game_result(v_g, false);
  end if;
  update public.game g set status = 'finished', end_reason = 'resign', finished_at = now(),
      winner_id = case when v_me = g.black_id then g.white_id else g.black_id end
    where g.id = v_g.id returning * into v_g;
  return public.game_result(v_g, true);
end;
$$;

-- 화면을 열 때 지난 초대·멈춘 판을 닫는다(상대 화면에도 실시간으로 반영). 닫은 판 수
create or replace function public.sweep_games(p_ledger_id uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
begin
  if public.current_member_id(p_ledger_id) is null then
    raise exception 'NOT_IN_LEDGER' using errcode = '42501';
  end if;
  return public.game_close_stale(p_ledger_id);
end;
$$;

-- ─────────────────────────────────────────────
-- 5) 권한: 가계부 현재 멤버만 읽기, 쓰기는 함수로만
-- ─────────────────────────────────────────────
alter table public.game enable row level security;
revoke all on public.game from public, anon, authenticated;
grant select on public.game to authenticated;
create policy game_select on public.game for select to authenticated
  using (public.is_ledger_member(ledger_id));

alter table public.game_move enable row level security;
revoke all on public.game_move from public, anon, authenticated;
grant select on public.game_move to authenticated;
create policy game_move_select on public.game_move for select to authenticated
  using (public.is_ledger_member(ledger_id));

revoke execute on function public.omok_has_five(int[], int, int) from public, anon, authenticated;
revoke execute on function public.game_close_stale(uuid) from public, anon, authenticated;
revoke execute on function public.game_lock_ledger(uuid) from public, anon, authenticated;
revoke execute on function public.game_result(public.game, boolean) from public, anon, authenticated;
revoke execute on function public.invite_game(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.respond_game(uuid, boolean) from public, anon;
revoke execute on function public.cancel_game(uuid) from public, anon;
revoke execute on function public.play_move(uuid, integer, integer) from public, anon;
revoke execute on function public.resign_game(uuid) from public, anon;
revoke execute on function public.sweep_games(uuid) from public, anon;
grant execute on function public.invite_game(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.respond_game(uuid, boolean) to authenticated;
grant execute on function public.cancel_game(uuid) to authenticated;
grant execute on function public.play_move(uuid, integer, integer) to authenticated;
grant execute on function public.resign_game(uuid) to authenticated;
grant execute on function public.sweep_games(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 6) 실시간: 수·상태 변화를 구독자에게 보낸다 (Postgres Changes, 구독자 RLS 적용)
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.game, public.game_move;
