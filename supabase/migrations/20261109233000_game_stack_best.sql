-- BANB-52 반반 쌓기 1인 모드: 가계부 × 멤버 최고 기록
--   1) game_stack_best: (가계부, 멤버)마다 최고 기록 1개만 남긴다 (판마다 기록 목록은 1차에 없음, design.md 5.35)
--      같은 사람이라도 가계부가 다르면 기록이 따로다
--   2) 쓰기는 함수 record_stack_score 로만: 로그인 사용자 본인 기록만, 더 높을 때만 바꾼다
--      판 진행은 화면에서 하므로 서버는 값이 규칙 안인지만 본다
--      (한 번에 1~3줄 · 줄당 1,000~2,000원 → 1,000원 단위, 줄 수 × 1,000 ≤ 금액 ≤ 줄 수 × 2,000)
--   3) 권한: 같은 가계부 현재 멤버만 읽기. 직접 쓰기 없음 (RLS 완화 없음)
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

create table public.game_stack_best (
  ledger_id    uuid not null references public.ledger (id) on delete cascade,
  member_id    uuid not null,
  best_amount  bigint not null check (best_amount between 1000 and 9999999999 and best_amount % 1000 = 0),
  best_lines   integer not null check (best_lines between 1 and 4999999),
  updated_at   timestamptz not null default now(),
  primary key (ledger_id, member_id),
  foreign key (member_id, ledger_id) references public.member (id, ledger_id) on delete cascade,
  constraint game_stack_best_rule check (best_amount between best_lines * 1000::bigint and best_lines * 2000::bigint)
);

-- 판이 끝날 때 1번 부른다. 결과: 이번 판 전 최고 기록(previous_best, 없으면 null) · 지금 최고 기록 · 새 기록인지
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
    or p_amount % 1000 <> 0 or p_amount < p_lines * 1000::bigint or p_amount > p_lines * 2000::bigint
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

alter table public.game_stack_best enable row level security;
revoke all on public.game_stack_best from public, anon, authenticated;
grant select on public.game_stack_best to authenticated;
create policy game_stack_best_select on public.game_stack_best for select to authenticated
  using (public.is_ledger_member(ledger_id));

revoke execute on function public.record_stack_score(uuid, bigint, integer) from public, anon;
grant execute on function public.record_stack_score(uuid, bigint, integer) to authenticated;
