-- BANB-3 QA 결함 D1·D2 수정 (init 이후 적용)
-- D1 카테고리: 대분류/소분류 2단계만. 자기 자신을 부모로 지정 불가, 소분류가 있는 대분류는 소분류가 될 수 없음.
--    (부모·자식의 type·ledger 일치는 init의 복합 FK (parent_id, ledger_id, type)가 이미 보장)
-- D2 초대: 코드·만료 시각·무효 여부·발급 시각은 서버가 기록(클라이언트 값 무시).
--    멤버는 초대를 "무효로 만들기"만 할 수 있고, 만료일 변경·무효 초대 되살리기는 불가.
--    가계부당 유효(무효 아님) 초대는 최대 1개.

-- ─────────────────────────────────────────────
-- D1. 카테고리 2단계
-- ─────────────────────────────────────────────
create or replace function public.category_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'CATEGORY_SELF_PARENT' using errcode = '23514';
  end if;

  -- 부모 행을 잠가, 동시에 부모를 소분류로 바꾸는 요청과 엇갈려 3단계가 되는 것을 막는다
  select c.parent_id into v_parent_parent
  from public.category c where c.id = new.parent_id
  for share;
  if v_parent_parent is not null then
    raise exception 'CATEGORY_DEPTH_EXCEEDED' using errcode = '23514';
  end if;

  -- 소분류가 있는 카테고리는 소분류가 될 수 없다
  if tg_op = 'UPDATE' and exists (select 1 from public.category c where c.parent_id = new.id) then
    raise exception 'CATEGORY_DEPTH_EXCEEDED' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- D2. 초대
-- ─────────────────────────────────────────────
create or replace function public.invite_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 클라이언트가 보낸 값은 무시하고 서버가 정한다
  new.code       := public.generate_invite_code();
  new.created_at := now();
  new.expires_at := now() + interval '7 days';
  new.is_revoked := false;
  new.created_by := public.current_member_id(new.ledger_id);

  -- 새로 발급하면 이전 초대 무효
  update public.invite set is_revoked = true
  where ledger_id = new.ledger_id and is_revoked = false;
  return new;
end;
$$;

-- 무효 → 유효로 되돌리기 금지 (관리자 포함)
create or replace function public.invite_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_revoked and not new.is_revoked then
    raise exception 'INVITE_CANNOT_UNREVOKE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invite_before_update
before update on public.invite
for each row execute function public.invite_before_update();

-- 로그인 사용자는 is_revoked 열만 수정 가능 (만료일·코드·가계부 변경 불가)
revoke update on public.invite from authenticated;
grant update (is_revoked) on public.invite to authenticated;

-- 가계부당 유효 초대 1개 (동시에 두 번 발급해도 둘 다 유효로 남지 않음)
create unique index invite_one_active_per_ledger on public.invite (ledger_id) where is_revoked = false;
