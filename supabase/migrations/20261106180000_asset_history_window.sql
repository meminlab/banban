-- BANB-30 잔액 이력을 추이에 필요한 범위만 조회 (조회 행 수 상한에 걸려 최신 이력이 잘리는 것 방지)
--   asset_balance_history_window(가계부, 창 시작) =
--     1) 창 시작 이후(>=) 이력 전부
--     2) 자산마다 창 시작 직전(<) 마지막 이력 1건 — 창 첫 달 값의 기준. 오래 안 바뀐 자산도 추이에 들어가게 한다
--   security invoker: 호출한 사용자의 행 단위 규칙(가계부 멤버만 조회)이 그대로 적용된다. 권한 완화 없음
--   결과가 많으면 클라이언트가 order + range 로 나눠 받는다(src/data/asset.ts)
--   테이블·데이터는 바꾸지 않는다(읽기 전용 함수 추가만)

create or replace function public.asset_balance_history_window(p_ledger_id uuid, p_since timestamptz)
returns setof public.asset_balance_history
language sql stable security invoker
set search_path = ''
as $$
  select h.*
  from public.asset_balance_history h
  where h.ledger_id = p_ledger_id and h.changed_at >= p_since
  union all
  select b.*
  from public.asset a
  cross join lateral (
    select h.*
    from public.asset_balance_history h
    where h.asset_id = a.id and h.ledger_id = p_ledger_id and h.changed_at < p_since
    order by h.changed_at desc, h.id desc
    limit 1
  ) b
  where a.ledger_id = p_ledger_id
$$;

revoke execute on function public.asset_balance_history_window(uuid, timestamptz) from public, anon;
grant execute on function public.asset_balance_history_window(uuid, timestamptz) to authenticated;
