-- BANB-60 record_recurring: 일시정지한 정기 내역의 회차는 거부한다 (RECURRING_PAUSED, 전체 취소)
--   화면은 일시정지한 정기 내역을 제안하지 않지만, 한 기기가 제안 시트를 연 채 다른 멤버가 일시정지하면 기록될 수 있었다.
--   정기 내역 행을 for share 로 읽어, 확인과 동시에 들어온 일시정지는 확인이 끝난 뒤에 반영된다.
--   종료(end_on 이후 날짜)는 이미 RECURRING_BAD_DATE 로 거부된다. 권한·실행 권한은 그대로(create or replace 는 grant 를 유지).
-- 다시 실행해도 같은 결과(create or replace).

/*
 * 회차 확인: p_items = [{"recurring_id": uuid, "occurs_on": "YYYY-MM-DD", "record": true|false, "amount": 숫자|null}, ...]
 *   record = true  → 내역 1건 생성(source 'recurring', 날짜 = 회차 날짜, 금액 = amount 또는 정기 내역 금액) + 회차 'recorded'
 *   record = false → 회차 'skipped' (내역 없음)
 * 이미 누가 확인한 회차는 아무것도 하지 않고 applied = false 로 돌려준다(중복 내역 없음).
 * 동시에 같은 회차를 확인하면 기본 키에서 한쪽만 들어가고 다른 쪽은 그 결과를 기다린 뒤 applied = false.
 * 회차가 아닌 날짜·오늘(KST) 이후 날짜·다른 가계부 정기 내역·일시정지한 정기 내역(RECURRING_PAUSED)이면 전체를 취소한다.
 * 결과: [{"recurring_id", "occurs_on", "status", "transaction_id", "applied"}, ...] (보낸 순서)
 */
create or replace function public.record_recurring(p_ledger_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_member uuid := public.current_member_id(p_ledger_id);
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_item record;
  v_r public.recurring_transaction;
  v_tx uuid;
  v_out jsonb := '[]'::jsonb;
  v_row public.recurring_occurrence;
  v_inserted int;
begin
  if v_member is null then
    raise exception 'NOT_IN_LEDGER' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'RECURRING_BAD_ITEMS' using errcode = '22023';
  end if;

  for v_item in
    select x.recurring_id, x.occurs_on, coalesce(x.record, false) as record, x.amount
    from jsonb_to_recordset(p_items) as x(recurring_id uuid, occurs_on date, record boolean, amount bigint)
  loop
    -- for share: 확인하는 동안 다른 멤버의 일시정지·수정은 이 확인이 끝날 때까지 기다린다
    select * into v_r from public.recurring_transaction r
      where r.id = v_item.recurring_id and r.ledger_id = p_ledger_id
      for share;
    if not found then
      raise exception 'RECURRING_NOT_FOUND' using errcode = 'P0002';
    end if;
    -- 일시정지한 정기 내역의 회차는 기록·건너뛰기 모두 받지 않는다 (제안 시트를 연 사이 다른 멤버가 일시정지한 경우)
    if v_r.is_paused then
      raise exception 'RECURRING_PAUSED' using errcode = '22023';
    end if;
    if v_item.occurs_on is null or v_item.occurs_on > v_today
       or not public.recurring_occurs_on(v_r.cycle, v_r.day_of_month, v_r.month, v_r.weekday, v_r.start_on, v_r.end_on, v_item.occurs_on) then
      raise exception 'RECURRING_BAD_DATE' using errcode = '22023';
    end if;

    insert into public.recurring_occurrence (recurring_id, occurs_on, ledger_id, status, decided_by)
      values (v_r.id, v_item.occurs_on, p_ledger_id, case when v_item.record then 'recorded' else 'skipped' end, v_member)
      on conflict (recurring_id, occurs_on) do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted = 0 then
      select * into v_row from public.recurring_occurrence o
        where o.recurring_id = v_r.id and o.occurs_on = v_item.occurs_on;
      v_out := v_out || jsonb_build_object('recurring_id', v_r.id, 'occurs_on', v_item.occurs_on,
        'status', v_row.status, 'transaction_id', v_row.transaction_id, 'applied', false);
      continue;
    end if;

    v_tx := null;
    if v_item.record then
      insert into public.transaction
        (ledger_id, type, amount, occurred_on, category_id, pocket_id, spender_id, is_fixed, memo, source, created_by, updated_by)
      values
        (p_ledger_id, v_r.type, coalesce(v_item.amount, v_r.amount), v_item.occurs_on, v_r.category_id, v_r.pocket_id,
         v_r.spender_id, v_r.type = 'expense', v_r.memo, 'recurring', v_member, v_member)
      returning id into v_tx;
      update public.recurring_occurrence o set transaction_id = v_tx
        where o.recurring_id = v_r.id and o.occurs_on = v_item.occurs_on;
    end if;

    v_out := v_out || jsonb_build_object('recurring_id', v_r.id, 'occurs_on', v_item.occurs_on,
      'status', case when v_item.record then 'recorded' else 'skipped' end, 'transaction_id', v_tx, 'applied', true);
  end loop;
  return v_out;
end;
$$;
