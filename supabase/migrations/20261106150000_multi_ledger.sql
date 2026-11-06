-- BANB-17 여러 가계부 만들기·참여 + 가계부 전환 + 마지막으로 본 가계부 기억 (1인 최대 5개)
--   * 1인 1가계부 규칙 제거: member_one_active_ledger_per_user 인덱스, ALREADY_IN_LEDGER 오류
--     대신 같은 가계부에 같은 사람이 두 번 들어가지 못하게 (ledger_id, user_id) 현재 멤버 1행만
--   * 1인당 가계부 상한: 현재 참여 중(left_at is null)인 가계부 수 = 만든 것 + 참여한 것
--       - 나간 가계부·보관된 가계부(현재 멤버 0명)는 세지 않는다 (둘 다 내 member 행의 left_at 이 채워져 있음)
--       - 상한 값은 public.user_ledger_limit() 한 곳 (바꾸려면 이 함수만 create or replace)
--       - member 행이 "현재 멤버"가 되는 모든 경로(새로 참여·다시 참여·만들기)를 트리거가 막는다.
--         사용자별 잠금으로 동시 요청도 상한을 넘지 않는다. 오류: LEDGER_LIMIT_REACHED (detail = 상한 값)
--   * 마지막으로 본 가계부: user_preference.last_ledger_id (서버 저장 → 기기·홈 화면 앱이 달라도 같은 가계부)
--       - 본인만 읽는다. 쓰기는 set_last_ledger RPC(현재 멤버인 가계부만), 만들기·참여 RPC가 자동 기록
--   * 나가기: leave_ledger() → leave_ledger(p_ledger_id) (어느 가계부에서 나갈지 지정)
--   * 권한 규칙(RLS)은 그대로 "현재 멤버" 기준. 완화 없음

-- ═════════════════════════════════════════════
-- 1. 1인 1가계부 규칙 제거
-- ═════════════════════════════════════════════
drop index if exists public.member_one_active_ledger_per_user;
-- 같은 가계부에는 현재 멤버 행 1개만 (기존 규칙에서는 사용자당 1개였으므로 기존 데이터는 항상 만족)
create unique index member_one_active_per_ledger_user on public.member (ledger_id, user_id) where left_at is null;
-- 내 가계부 목록·개수 조회용
create index member_active_user_idx on public.member (user_id) where left_at is null;

-- ═════════════════════════════════════════════
-- 2. 1인당 가계부 상한 (설정값 한 곳)
-- ═════════════════════════════════════════════
create or replace function public.user_ledger_limit() returns int
language sql immutable
set search_path = ''
as $$ select 5 $$;

-- member 행이 현재 멤버가 될 때(새 행 또는 나갔던 행 되살리기) 상한 검사
create or replace function public.member_enforce_user_ledger_limit() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_limit int := public.user_ledger_limit();
  v_count int;
begin
  if new.left_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.left_at is null then
    return new; -- 이미 현재 멤버였던 행 (이름 수정 등)
  end if;

  -- 같은 사용자의 만들기·참여가 동시에 와도 하나씩 검사하도록 사용자 단위 잠금 (트랜잭션 끝까지 유지)
  perform pg_advisory_xact_lock(hashtextextended('banban.user_ledgers:' || new.user_id::text, 0));
  select count(*) into v_count from public.member
  where user_id = new.user_id and left_at is null and id <> new.id;
  if v_count >= v_limit then
    raise exception 'LEDGER_LIMIT_REACHED' using errcode = 'P0001', detail = v_limit::text;
  end if;
  return new;
end;
$$;

create trigger member_enforce_user_ledger_limit
before insert or update of left_at on public.member
for each row execute function public.member_enforce_user_ledger_limit();

-- ═════════════════════════════════════════════
-- 3. 마지막으로 본 가계부
-- ═════════════════════════════════════════════
create table public.user_preference (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  last_ledger_id  uuid references public.ledger (id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.user_preference enable row level security;
revoke all on public.user_preference from public, anon, authenticated;
grant select on public.user_preference to authenticated;
-- 본인 것만 읽는다. 쓰기는 RPC로만 (현재 멤버인 가계부만 기록되게)
create policy user_preference_select_self on public.user_preference for select to authenticated
  using (user_id = auth.uid());

-- 내부용: 기록 (권한 검사는 호출하는 쪽에서)
create or replace function public.remember_last_ledger(p_user_id uuid, p_ledger_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.user_preference (user_id, last_ledger_id, updated_at)
  values (p_user_id, p_ledger_id, now())
  on conflict (user_id) do update
    set last_ledger_id = excluded.last_ledger_id, updated_at = excluded.updated_at;
$$;

-- 가계부 전환 시 화면이 호출. 현재 멤버가 아니면 NOT_IN_LEDGER
create or replace function public.set_last_ledger(p_ledger_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.member
    where ledger_id = p_ledger_id and user_id = v_uid and left_at is null
  ) then
    raise exception 'NOT_IN_LEDGER' using errcode = 'P0001';
  end if;
  perform public.remember_last_ledger(v_uid, p_ledger_id);
end;
$$;

-- ═════════════════════════════════════════════
-- 4. 만들기 (init 의 create_ledger 교체): 1인 1가계부 검사 제거, 만든 가계부를 마지막으로 본 가계부로
-- ═════════════════════════════════════════════
create or replace function public.create_ledger(p_name text, p_display_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ledger_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  insert into public.ledger (name, created_by) values (btrim(p_name), v_uid)
  returning id into v_ledger_id;
  -- 1인 상한은 member 트리거가 검사 (넘으면 LEDGER_LIMIT_REACHED, 가계부 행도 함께 취소)
  insert into public.member (ledger_id, user_id, role, display_name)
  values (v_ledger_id, v_uid, 'owner', btrim(p_display_name));
  perform public.seed_ledger_defaults(v_ledger_id);
  perform public.remember_last_ledger(v_uid, v_ledger_id);
  return v_ledger_id;
end;
$$;

-- ═════════════════════════════════════════════
-- 5. 참여 (20261106120000 의 join_ledger 교체)
--   * 다른 가계부가 있어도 참여 가능
--   * 이미 이 가계부 멤버면 그대로 성공 (화면은 그 가계부로 전환만)
--   * 성공하면 그 가계부를 마지막으로 본 가계부로
--   오류: NOT_AUTHENTICATED / INVITE_NOT_FOUND / INVITE_EXPIRED / MEMBER_LIMIT_REACHED / LEDGER_LIMIT_REACHED
-- ═════════════════════════════════════════════
create or replace function public.join_ledger(p_code text, p_display_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.invite;
  v_limit int;
  v_count int;
  v_past uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_invite from public.invite
  where code = upper(btrim(p_code)) and is_revoked = false;
  if not found then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED' using errcode = 'P0001';
  end if;

  -- 동시에 여러 명이 참여·나가기를 해도 상한·보관 판단이 어긋나지 않도록 가계부 행 잠금
  -- (같은 사람이 같은 링크를 두 번 눌러도 두 번째는 잠금 뒤에서 "이미 멤버"로 끝난다)
  select member_limit into v_limit from public.ledger where id = v_invite.ledger_id for update;

  if exists (
    select 1 from public.member
    where ledger_id = v_invite.ledger_id and user_id = v_uid and left_at is null
  ) then
    perform public.remember_last_ledger(v_uid, v_invite.ledger_id);
    return v_invite.ledger_id; -- 이미 이 가계부 멤버: 전환만
  end if;

  select count(*) into v_count from public.member where ledger_id = v_invite.ledger_id and left_at is null;
  if v_count = 0 then
    -- 보관된 가계부: 초대는 무효 (leave_ledger 가 이미 무효로 만들지만 한 번 더 막는다)
    raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_count >= v_limit then
    raise exception 'MEMBER_LIMIT_REACHED' using errcode = 'P0001', detail = v_limit::text;
  end if;

  -- 예전에 이 가계부에서 나갔던 사람이면 그 행을 되살린다 (이름·과거 내역 연결 유지)
  -- 1인 상한은 member 트리거가 검사 (넘으면 LEDGER_LIMIT_REACHED)
  select id into v_past from public.member
  where ledger_id = v_invite.ledger_id and user_id = v_uid and left_at is not null
  order by joined_at desc
  limit 1;
  if v_past is not null then
    update public.member
       set left_at = null, joined_at = now(), role = 'member'
     where id = v_past;
  else
    insert into public.member (ledger_id, user_id, role, display_name)
    values (v_invite.ledger_id, v_uid, 'member', btrim(p_display_name));
  end if;
  perform public.remember_last_ledger(v_uid, v_invite.ledger_id);
  return v_invite.ledger_id;
end;
$$;

-- ═════════════════════════════════════════════
-- 6. 나가기: 가계부를 지정한다 (leave_ledger() 교체)
--   오류: NOT_AUTHENTICATED / NOT_IN_LEDGER
-- ═════════════════════════════════════════════
drop function if exists public.leave_ledger();

create or replace function public.leave_ledger(p_ledger_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.member;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- join_ledger 와 같은 순서(가계부 → 멤버)로 잠가 동시 처리 시 엇갈리지 않게
  perform 1 from public.ledger where id = p_ledger_id for update;

  select * into v_me from public.member
  where ledger_id = p_ledger_id and user_id = v_uid and left_at is null;
  if not found then
    raise exception 'NOT_IN_LEDGER' using errcode = 'P0001'; -- 멤버가 아님 / 동시에 두 번 누른 경우
  end if;

  update public.member set left_at = now(), role = 'member' where id = v_me.id;

  if v_me.role = 'owner' then
    update public.member set role = 'owner'
    where id = (
      select m.id from public.member m
      where m.ledger_id = p_ledger_id and m.left_at is null
      order by m.joined_at, m.id
      limit 1
    );
  end if;

  -- 마지막 멤버가 나갔으면 보관: 초대 모두 무효
  if not exists (select 1 from public.member where ledger_id = p_ledger_id and left_at is null) then
    update public.invite set is_revoked = true
    where ledger_id = p_ledger_id and is_revoked = false;
  end if;

  -- 마지막으로 본 가계부였으면 지운다 (화면이 남은 가계부 중 가장 최근에 참여한 곳을 고른다)
  update public.user_preference set last_ledger_id = null, updated_at = now()
  where user_id = v_uid and last_ledger_id = p_ledger_id;
end;
$$;

-- ═════════════════════════════════════════════
-- 함수 실행 권한
-- ═════════════════════════════════════════════
revoke execute on function public.user_ledger_limit() from public, anon, authenticated;
revoke execute on function public.member_enforce_user_ledger_limit() from public, anon, authenticated;
revoke execute on function public.remember_last_ledger(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_last_ledger(uuid) from public, anon;
grant execute on function public.set_last_ledger(uuid) to authenticated;
revoke execute on function public.leave_ledger(uuid) from public, anon;
grant execute on function public.leave_ledger(uuid) to authenticated;
-- create or replace 는 기존 권한을 유지하지만, 기본 권한 설정과 무관하게 한 번 더 명시
revoke execute on function public.create_ledger(text, text) from public, anon;
grant execute on function public.create_ledger(text, text) to authenticated;
revoke execute on function public.join_ledger(text, text) from public, anon;
grant execute on function public.join_ledger(text, text) to authenticated;
