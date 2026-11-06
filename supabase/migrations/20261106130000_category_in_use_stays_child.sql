-- BANB-6 (BANB-3 QA 경미 결함 N1)
-- 내역에 쓰인 소분류는 대분류로 바꿀 수 없다 (parent_id → null 거부).
--   * 내역의 category는 항상 소분류여야 한다. 지금까지는 내역 저장 때만 검사해서,
--     나중에 그 소분류를 대분류로 바꾸면 내역이 대분류를 가리키게 됐다.
--   * 숨김(is_hidden)·이름·순서 변경은 그대로 허용.
--   * 동시성: 내역 저장 트리거가 카테고리 행을 FOR SHARE로 잠가, "내역 저장"과 "소분류 → 대분류 변경"이
--     엇갈려 둘 다 통과하는 일을 막는다. (카테고리 UPDATE는 그 잠금이 풀린 뒤 실행되고, 커밋된 내역을 본다)

-- 0. 적용 전 확인: 이미 대분류를 가리키는 내역이 있으면 적용을 멈춘다 (조용히 넘어가지 않음)
do $$
begin
  if exists (
    select 1 from public.transaction t
    join public.category c on c.id = t.category_id
    where c.parent_id is null
  ) then
    raise exception 'N1: 대분류를 가리키는 내역이 있습니다. 데이터를 먼저 정리한 뒤 다시 적용하세요.';
  end if;
end $$;

-- 1. 카테고리: 2단계 규칙(20261105010000) + 내역에 쓰인 소분류는 대분류로 못 바꿈
create or replace function public.category_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_parent uuid;
begin
  if new.parent_id is null then
    -- 소분류 → 대분류 변경: 내역에 쓰였으면 거부
    if tg_op = 'UPDATE' and old.parent_id is not null
       and exists (select 1 from public.transaction t where t.category_id = new.id) then
      raise exception 'CATEGORY_IN_USE_MUST_STAY_CHILD' using errcode = '23514';
    end if;
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

-- 2. 내역: 카테고리 행을 잠그고 소분류인지 확인 (나머지 동작은 init과 같음)
create or replace function public.transaction_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_member uuid := public.current_member_id(new.ledger_id);
  v_parent uuid;
begin
  select c.parent_id into v_parent
  from public.category c where c.id = new.category_id
  for share;
  if found and v_parent is null then
    raise exception 'CATEGORY_MUST_BE_CHILD' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_member, new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(v_member, new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;
