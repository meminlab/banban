-- BANB-42 일정 1: 일정(event) + 가계부 "함께한 날"(ledger.together_since)
--   1) event: 가계부 공유 일정. 반복 일정은 1건만 저장하고 화면에서 펼친다(매년·음력 매년·매월·매주)
--      음력 매년은 음력 월·일(lunar_month/lunar_day)을 저장하고, event_date 에는 첫 회차의 양력 날짜를 둔다
--   2) 만든 사람·수정한 사람·수정 시각은 서버가 기록한다(요청 값 무시). 가계부는 바꿀 수 없다
--   3) D-day 고정(pinned_at): 기념일만, 가계부당 최대 2개. 고정 시각은 서버가 정한다(고정한 순서 = 홈 카드 순서)
--   4) ledger.together_since: 가계부당 날짜 1개(선택). 멤버 누구나 바꿀 수 있다(가계부 이름과 같은 규칙)
--   5) 권한: 가계부 현재 멤버만 조회·추가·수정·삭제 (기존 규칙과 같음, 완화 없음)
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

-- ─────────────────────────────────────────────
-- 1) event
-- ─────────────────────────────────────────────
create table public.event (
  id                uuid primary key default gen_random_uuid(),
  ledger_id         uuid not null references public.ledger (id) on delete cascade,
  title             text not null check (char_length(btrim(title)) between 1 and 20),
  kind              text not null check (kind in ('anniversary', 'appointment', 'bill_day', 'other')),
  event_date        date not null,      -- 첫 회차(양력, KST). 반복은 이 날부터 펼친다
  all_day           boolean not null default true,
  start_time        time,               -- 종일이 아니면 필수 (KST 시각)
  repeat            text not null default 'none' check (repeat in ('none', 'yearly', 'yearly_lunar', 'monthly', 'weekly')),
  lunar_month       smallint,           -- 음력 매년일 때만 (평달 기준, 윤달은 평달로 본다)
  lunar_day         smallint,
  target_member_id  uuid,               -- 누구 일정 (member id). null = 함께
  place             text check (char_length(place) <= 30),
  memo              text check (char_length(memo) <= 100),
  pinned_at         timestamptz,        -- 홈 D-day 고정 시각. null = 고정 안 함
  created_by        uuid not null,
  updated_by        uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (target_member_id, ledger_id) references public.member (id, ledger_id),
  foreign key (created_by, ledger_id) references public.member (id, ledger_id),
  foreign key (updated_by, ledger_id) references public.member (id, ledger_id),
  constraint event_time_rule check (all_day = (start_time is null)),
  -- coalesce: 음력 값이 null 이면 검사 결과가 null(= 통과)이 되므로 false 로 바꿔 막는다
  constraint event_lunar_rule check (coalesce(
    (repeat = 'yearly_lunar' and kind = 'anniversary'
       and lunar_month between 1 and 12 and lunar_day between 1 and 30)
    or (repeat <> 'yearly_lunar' and lunar_month is null and lunar_day is null),
    false
  )),
  constraint event_pin_rule check (pinned_at is null or kind = 'anniversary')
);
create index event_ledger_date_idx on public.event (ledger_id, event_date);
create index event_ledger_pinned_idx on public.event (ledger_id) where pinned_at is not null;

-- 작성자·수정자·시각·고정 시각은 서버가 정한다. 가계부는 바꿀 수 없다. 고정은 가계부당 2개까지
create or replace function public.event_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_member uuid := public.current_member_id(new.ledger_id);
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_member, new.created_by);
    new.created_at := now();
    new.pinned_at := case when new.pinned_at is null then null else now() end;
  else
    if new.ledger_id <> old.ledger_id then
      raise exception 'EVENT_LEDGER_IMMUTABLE';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- null → 값 = 지금 고정, 값 → 값 = 처음 고정한 시각 유지, 값 → null = 고정 풀기
    new.pinned_at := case
      when new.pinned_at is null then null
      else coalesce(old.pinned_at, now())
    end;
  end if;
  new.updated_by := coalesce(v_member, new.updated_by);
  new.updated_at := now();

  -- 새로 고정할 때만 개수 검사. 같은 가계부 동시 고정은 잠금으로 줄 세운다
  if new.pinned_at is not null and (tg_op = 'INSERT' or old.pinned_at is null) then
    perform pg_advisory_xact_lock(hashtextextended('banban.event_pin:' || new.ledger_id::text, 0));
    if (select count(*) from public.event e
         where e.ledger_id = new.ledger_id and e.pinned_at is not null and e.id <> new.id) >= 2 then
      raise exception 'EVENT_PIN_LIMIT' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger event_before_write
before insert or update on public.event
for each row execute function public.event_before_write();

-- ─────────────────────────────────────────────
-- 2) ledger.together_since (함께한 날)
-- ─────────────────────────────────────────────
alter table public.ledger add column together_since date check (together_since >= date '1900-01-01');

-- ─────────────────────────────────────────────
-- 3) 권한
-- ─────────────────────────────────────────────
alter table public.event enable row level security;
revoke all on public.event from public, anon, authenticated;
grant select, insert, update, delete on public.event to authenticated;
create policy event_all on public.event for all to authenticated
  using (public.is_ledger_member(ledger_id)) with check (public.is_ledger_member(ledger_id));

-- 함께한 날은 멤버 누구나 (ledger_update 정책 = 현재 멤버만). member_limit 등 다른 열은 그대로 못 바꾼다
grant update (together_since) on public.ledger to authenticated;

-- 트리거 함수는 직접 부를 수 없다
revoke execute on function public.event_before_write() from public, anon, authenticated;
