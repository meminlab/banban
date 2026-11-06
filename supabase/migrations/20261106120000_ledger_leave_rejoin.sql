-- BANB-5 가계부 생성·초대·참여: 나가기 / 다시 참여 / 보관된 가계부 (명세 보강 Q1·Q2·Q8)
--   * leave_ledger(): 멤버 나가기. 행은 지우지 않고 left_at 기록 → 그 사람의 내역·자산은 남는다
--       - owner가 나가면 남은 멤버 중 가장 먼저 참여한(joined_at) 사람이 owner
--       - 마지막 멤버가 나가면 가계부는 삭제하지 않고 보관(현재 멤버 0명 = 아무도 못 봄), 초대는 모두 무효
--   * join_ledger(): 다시 참여하면 예전 member 행을 되살린다 → 과거 내역(spender_id 등)이 다시 그 사람으로 연결
--       - 보관된 가계부(현재 멤버 0명)의 초대는 무효 코드로 처리 (INVITE_NOT_FOUND)
--       - MEMBER_LIMIT_REACHED 오류의 detail 에 현재 상한(member_limit)을 실어 보낸다 → 화면 문구 "현재 최대 N명"
--   보관 여부는 별도 컬럼 없이 "현재 멤버 0명"으로 판단한다 (스키마 변경 없음)

-- ─────────────────────────────────────────────
-- 참여 (init 의 join_ledger 교체)
-- ─────────────────────────────────────────────
create or replace function public.join_ledger(p_code text, p_display_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.invite;
  v_limit int;
  v_count int;
  v_current uuid;
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

  select ledger_id into v_current from public.member where user_id = v_uid and left_at is null;
  if v_current = v_invite.ledger_id then
    return v_current; -- 이미 이 가계부 멤버: 그대로 성공
  elsif v_current is not null then
    raise exception 'ALREADY_IN_LEDGER' using errcode = 'P0001';
  end if;

  -- 동시에 여러 명이 참여·나가기를 해도 상한·보관 판단이 어긋나지 않도록 가계부 행 잠금
  select member_limit into v_limit from public.ledger where id = v_invite.ledger_id for update;
  select count(*) into v_count from public.member where ledger_id = v_invite.ledger_id and left_at is null;
  if v_count = 0 then
    -- 보관된 가계부: 초대는 무효 (leave_ledger 가 이미 무효로 만들지만 한 번 더 막는다)
    raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_count >= v_limit then
    raise exception 'MEMBER_LIMIT_REACHED' using errcode = 'P0001', detail = v_limit::text;
  end if;

  -- 예전에 이 가계부에서 나갔던 사람이면 그 행을 되살린다 (이름·과거 내역 연결 유지)
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
  return v_invite.ledger_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 나가기
--   오류: NOT_AUTHENTICATED / NOT_IN_LEDGER
-- ─────────────────────────────────────────────
create or replace function public.leave_ledger() returns void
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

  select * into v_me from public.member where user_id = v_uid and left_at is null;
  if not found then
    raise exception 'NOT_IN_LEDGER' using errcode = 'P0001';
  end if;

  -- join_ledger 와 같은 순서(가계부 → 멤버)로 잠가 동시 처리 시 엇갈리지 않게
  perform 1 from public.ledger where id = v_me.ledger_id for update;

  update public.member set left_at = now(), role = 'member'
  where id = v_me.id and left_at is null;
  if not found then
    raise exception 'NOT_IN_LEDGER' using errcode = 'P0001'; -- 동시에 두 번 누른 경우
  end if;

  if v_me.role = 'owner' then
    update public.member set role = 'owner'
    where id = (
      select m.id from public.member m
      where m.ledger_id = v_me.ledger_id and m.left_at is null
      order by m.joined_at, m.id
      limit 1
    );
  end if;

  -- 마지막 멤버가 나갔으면 보관: 초대 모두 무효
  if not exists (select 1 from public.member where ledger_id = v_me.ledger_id and left_at is null) then
    update public.invite set is_revoked = true
    where ledger_id = v_me.ledger_id and is_revoked = false;
  end if;
end;
$$;

revoke execute on function public.leave_ledger() from public, anon, authenticated;
grant execute on function public.leave_ledger() to authenticated;
-- create or replace 는 기존 권한을 유지하지만, 기본 권한 설정과 무관하게 한 번 더 명시
revoke execute on function public.join_ledger(text, text) from public, anon;
grant execute on function public.join_ledger(text, text) to authenticated;
