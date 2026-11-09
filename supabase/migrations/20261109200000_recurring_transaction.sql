-- BANB-44 일정 3: 정기 내역(recurring_transaction) + 회차 기록(recurring_occurrence) + transaction.source 'recurring'
--   1) transaction.source 에 'recurring' 추가 (정기 내역 확인으로 만든 내역)
--   2) recurring_transaction: 가계부 공유 정기 내역. 유형·금액·카테고리(소분류)·주머니(지출만)·사용한 사람·이름(memo)
--      주기 monthly(day_of_month 1~31, 31 = 말일) / weekly(weekday 0=일~6) / yearly(month + day_of_month)
--      그 달에 없는 날(29~31일, 평년 2월 29일)은 그 달 말일. 시작일 필수·종료일 선택·일시정지
--   3) recurring_occurrence: 회차(정기 내역 × 날짜)마다 1행 — recorded(내역 만듦) / skipped(건너뜀).
--      기본 키 (recurring_id, occurs_on) 로 "같은 날 같은 정기 내역은 한 번만"을 DB가 보장한다(두 기기·두 멤버 동시 확인 포함).
--      건너뛴 회차도 남겨 다음 실행·다른 기기·다른 멤버에게 다시 제안되지 않는다.
--      직접 쓰기는 막고 record_recurring / undo_recurring_record 함수로만 쓴다
--   4) 권한: 가계부 현재 멤버만 (기존 규칙과 같음, 완화 없음)
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

-- ─────────────────────────────────────────────
-- 1) transaction.source
-- ─────────────────────────────────────────────
alter table public.transaction drop constraint transaction_source_check;
alter table public.transaction add constraint transaction_source_check
  check (source in ('manual', 'excel', 'sync', 'recurring'));

-- ─────────────────────────────────────────────
-- 2) recurring_transaction
-- ─────────────────────────────────────────────
create table public.recurring_transaction (
  id            uuid primary key default gen_random_uuid(),
  ledger_id     uuid not null references public.ledger (id) on delete cascade,
  type          text not null check (type in ('expense', 'income', 'saving')),
  amount        bigint not null check (amount between 1 and 9999999999),
  category_id   uuid not null,          -- 소분류만 (트리거로 검사)
  pocket_id     uuid,                   -- 지출일 때 필수
  spender_id    uuid not null,
  memo          text check (char_length(memo) <= 100),   -- 정기 내역 이름 (기록한 내역의 메모)
  cycle         text not null check (cycle in ('monthly', 'weekly', 'yearly')),
  day_of_month  smallint,               -- monthly·yearly: 1~31 (31 = 말일)
  month         smallint,               -- yearly: 1~12
  weekday       smallint,               -- weekly: 0(일)~6(토)
  start_on      date not null,          -- 이 날부터 (KST 날짜)
  end_on        date,                   -- 이 날까지 (선택)
  is_paused     boolean not null default false,
  created_by    uuid not null,
  updated_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, ledger_id),
  foreign key (category_id, ledger_id, type) references public.category (id, ledger_id, type) on delete restrict,
  foreign key (pocket_id, ledger_id) references public.pocket (id, ledger_id) on delete restrict,
  foreign key (spender_id, ledger_id) references public.member (id, ledger_id),
  foreign key (created_by, ledger_id) references public.member (id, ledger_id),
  foreign key (updated_by, ledger_id) references public.member (id, ledger_id),
  constraint recurring_pocket_rule check ((type = 'expense') = (pocket_id is not null)),
  -- coalesce: null 이 섞이면 검사 결과가 null(= 통과)이 되므로 false 로 바꿔 막는다
  constraint recurring_cycle_rule check (coalesce(
    (cycle = 'monthly' and day_of_month between 1 and 31 and month is null and weekday is null)
    or (cycle = 'weekly' and weekday between 0 and 6 and day_of_month is null and month is null)
    or (cycle = 'yearly' and weekday is null and month between 1 and 12 and day_of_month between 1 and
          (case when month = 2 then 29 when month in (4, 6, 9, 11) then 30 else 31 end)),
    false
  )),
  constraint recurring_period_rule check (end_on is null or end_on >= start_on)
);
create index recurring_transaction_ledger_idx on public.recurring_transaction (ledger_id);

-- 작성자·수정자·시각은 서버가 정한다. 가계부는 바꿀 수 없다. 카테고리는 소분류만
create or replace function public.recurring_transaction_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_member uuid := public.current_member_id(new.ledger_id);
begin
  if exists (select 1 from public.category c where c.id = new.category_id and c.parent_id is null) then
    raise exception 'CATEGORY_MUST_BE_CHILD' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_member, new.created_by);
    new.created_at := now();
  else
    if new.ledger_id <> old.ledger_id then
      raise exception 'RECURRING_LEDGER_IMMUTABLE';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(v_member, new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

create trigger recurring_transaction_before_write
before insert or update on public.recurring_transaction
for each row execute function public.recurring_transaction_before_write();

-- ─────────────────────────────────────────────
-- 3) recurring_occurrence (회차 기록)
-- ─────────────────────────────────────────────
create table public.recurring_occurrence (
  recurring_id    uuid not null,
  occurs_on       date not null,           -- 회차 날짜 (기록한 내역의 날짜와 같다)
  ledger_id       uuid not null references public.ledger (id) on delete cascade,
  status          text not null check (status in ('recorded', 'skipped')),
  transaction_id  uuid references public.transaction (id) on delete set null,  -- 내역을 나중에 지워도 회차는 "기록함"으로 남는다
  decided_by      uuid not null,           -- member id
  decided_at      timestamptz not null default now(),
  primary key (recurring_id, occurs_on),
  foreign key (recurring_id, ledger_id) references public.recurring_transaction (id, ledger_id) on delete cascade,
  foreign key (decided_by, ledger_id) references public.member (id, ledger_id),
  constraint recurring_occurrence_tx_rule check (status = 'recorded' or transaction_id is null)
);
create index recurring_occurrence_ledger_date_idx on public.recurring_occurrence (ledger_id, occurs_on);

-- 날짜 d 가 이 정기 내역의 회차인가 (화면 domain/recurring.ts occurrencesInRange 와 같은 규칙)
create or replace function public.recurring_occurs_on(
  p_cycle text, p_day_of_month smallint, p_month smallint, p_weekday smallint,
  p_start_on date, p_end_on date, p_date date
) returns boolean
language sql immutable
set search_path = ''
as $$
  select p_date >= p_start_on
     and (p_end_on is null or p_date <= p_end_on)
     and case p_cycle
       when 'weekly' then extract(dow from p_date)::int = p_weekday
       when 'monthly' then extract(day from p_date)::int =
         least(p_day_of_month::int, extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int)
       when 'yearly' then extract(month from p_date)::int = p_month
         and extract(day from p_date)::int =
           least(p_day_of_month::int, extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int)
       else false
     end;
$$;

/*
 * 회차 확인: p_items = [{"recurring_id": uuid, "occurs_on": "YYYY-MM-DD", "record": true|false, "amount": 숫자|null}, ...]
 *   record = true  → 내역 1건 생성(source 'recurring', 날짜 = 회차 날짜, 금액 = amount 또는 정기 내역 금액) + 회차 'recorded'
 *   record = false → 회차 'skipped' (내역 없음)
 * 이미 누가 확인한 회차는 아무것도 하지 않고 applied = false 로 돌려준다(중복 내역 없음).
 * 동시에 같은 회차를 확인하면 기본 키에서 한쪽만 들어가고 다른 쪽은 그 결과를 기다린 뒤 applied = false.
 * 회차가 아닌 날짜·오늘(KST) 이후 날짜·다른 가계부 정기 내역이면 전체를 취소한다.
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
    select * into v_r from public.recurring_transaction r
      where r.id = v_item.recurring_id and r.ledger_id = p_ledger_id;
    if not found then
      raise exception 'RECURRING_NOT_FOUND' using errcode = 'P0002';
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

/*
 * 방금 한 확인 되돌리기(토스트 "되돌리기"): p_items = [{"recurring_id", "occurs_on"}, ...]
 * 내가 확인한 회차만 지우고, 그때 만든 내역도 지운다 → 다시 제안된다. 지운 회차 수를 돌려준다
 */
create or replace function public.undo_recurring_record(p_ledger_id uuid, p_items jsonb) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_member uuid := public.current_member_id(p_ledger_id);
  v_tx uuid[];
  v_count int;
begin
  if v_member is null then
    raise exception 'NOT_IN_LEDGER' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'RECURRING_BAD_ITEMS' using errcode = '22023';
  end if;
  with gone as (
    delete from public.recurring_occurrence o
    using jsonb_to_recordset(p_items) as x(recurring_id uuid, occurs_on date)
    where o.recurring_id = x.recurring_id and o.occurs_on = x.occurs_on
      and o.ledger_id = p_ledger_id and o.decided_by = v_member
    returning o.transaction_id
  )
  select array_agg(transaction_id) filter (where transaction_id is not null), count(*) into v_tx, v_count from gone;
  if v_tx is not null then
    delete from public.transaction t where t.id = any (v_tx) and t.ledger_id = p_ledger_id;
  end if;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────────
-- 4) 권한
-- ─────────────────────────────────────────────
alter table public.recurring_transaction enable row level security;
revoke all on public.recurring_transaction from public, anon, authenticated;
grant select, insert, update, delete on public.recurring_transaction to authenticated;
create policy recurring_transaction_all on public.recurring_transaction for all to authenticated
  using (public.is_ledger_member(ledger_id)) with check (public.is_ledger_member(ledger_id));

-- 회차는 멤버가 읽기만. 쓰기는 record_recurring / undo_recurring_record 로만
alter table public.recurring_occurrence enable row level security;
revoke all on public.recurring_occurrence from public, anon, authenticated;
grant select on public.recurring_occurrence to authenticated;
create policy recurring_occurrence_select on public.recurring_occurrence for select to authenticated
  using (public.is_ledger_member(ledger_id));

revoke execute on function public.recurring_transaction_before_write() from public, anon, authenticated;
revoke execute on function public.record_recurring(uuid, jsonb) from public, anon;
revoke execute on function public.undo_recurring_record(uuid, jsonb) from public, anon;
grant execute on function public.record_recurring(uuid, jsonb) to authenticated;
grant execute on function public.undo_recurring_record(uuid, jsonb) to authenticated;
