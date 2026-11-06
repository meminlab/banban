-- BANB-25 자산관리 1단계: 부채·자산 종류 확장 + 잔액 이력 + 보관
--   1) asset.kind: 연금·부동산·자동차, 부채 3종(대출·카드값·기타 부채) 추가. 금액은 모두 0 이상으로 저장하고 부채는 계산할 때 뺀다
--   2) asset.archived_at: 삭제 대신 보관. 시각은 서버가 정한다(클라이언트가 보낸 값은 무시)
--   3) asset_balance_history: 자산을 만들거나 잔액이 바뀔 때마다 1행. 서버 트리거만 기록, 바꾼 사람도 서버가 정한다
--   4) 기존 자산은 이 마이그레이션 시각에 현재 잔액으로 1행씩 채운다 (지난 달 값은 모르므로 만들지 않는다 → 전월 대비 "–")
--   5) 권한: 이력은 가계부 멤버만 조회, 아무도 직접 쓰지 못함. 자산 delete 권한을 거둔다(보관만 가능). 완화 없음
-- 다시 실행하면 "already exists" 오류가 나는 1회용 마이그레이션이다.

-- ─────────────────────────────────────────────
-- 1) 종류 확장
-- ─────────────────────────────────────────────
alter table public.asset drop constraint asset_kind_check;
alter table public.asset add constraint asset_kind_check check (kind in (
  -- 자산
  'checking', 'installment_saving', 'deposit', 'investment', 'pension', 'cash', 'real_estate', 'vehicle', 'other',
  -- 부채
  'loan', 'card_payable', 'other_liability'
));

-- ─────────────────────────────────────────────
-- 2) 보관
-- ─────────────────────────────────────────────
alter table public.asset add column archived_at timestamptz;

-- 보관 시각·가계부는 서버가 정한다
--   insert: archived_at 은 항상 null (보관된 채로 만들 수 없음)
--   update: null → 값  = 지금 보관 (now()), 값 → null = 되살리기, 값 → 다른 값 = 원래 시각 유지
--           ledger_id 는 바꿀 수 없다 (이력이 다른 가계부에 남는 것을 막음)
create or replace function public.asset_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.archived_at := null;
    return new;
  end if;
  if new.ledger_id <> old.ledger_id then
    raise exception 'ASSET_LEDGER_IMMUTABLE';
  end if;
  if new.archived_at is not null then
    new.archived_at := coalesce(old.archived_at, now());
  end if;
  return new;
end;
$$;

create trigger asset_before_write
before insert or update on public.asset
for each row execute function public.asset_before_write();

create index asset_ledger_active_idx on public.asset (ledger_id) where archived_at is null;

-- ─────────────────────────────────────────────
-- 3) 잔액 이력
-- ─────────────────────────────────────────────
create table public.asset_balance_history (
  id          bigint generated always as identity primary key,  -- 같은 시각이면 id 큰 쪽이 나중
  asset_id    uuid not null references public.asset (id) on delete cascade,
  ledger_id   uuid not null references public.ledger (id) on delete cascade,
  balance     bigint not null check (balance between 0 and 9999999999),
  changed_by  uuid,          -- member id. null = 사람이 아닌 기록(마이그레이션 채우기·관리자)
  changed_at  timestamptz not null default now(),
  foreign key (changed_by, ledger_id) references public.member (id, ledger_id)
);
create index asset_balance_history_ledger_idx on public.asset_balance_history (ledger_id, changed_at);
create index asset_balance_history_asset_idx on public.asset_balance_history (asset_id, changed_at);

-- 자산을 만들거나 잔액이 바뀌면 1행. 이름·종류·소유자·메모·보관만 바뀌면 기록하지 않는다
-- 바꾼 사람 = 로그인한 사용자의 이 가계부 member id (요청 값으로 바꿀 수 없음)
create or replace function public.asset_record_balance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.balance is not distinct from old.balance then
    return null;
  end if;
  insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by)
  values (new.id, new.ledger_id, new.balance, public.current_member_id(new.ledger_id));
  return null;
end;
$$;

create trigger asset_record_balance
after insert or update of balance on public.asset
for each row execute function public.asset_record_balance();

-- ─────────────────────────────────────────────
-- 4) 기존 자산 채우기 (현재 잔액, 마이그레이션 시각, 바꾼 사람 없음)
-- ─────────────────────────────────────────────
insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by, changed_at)
select a.id, a.ledger_id, a.balance, null, now()
from public.asset a;

-- ─────────────────────────────────────────────
-- 5) 권한
-- ─────────────────────────────────────────────
alter table public.asset_balance_history enable row level security;
revoke all on public.asset_balance_history from public, anon, authenticated;
grant select on public.asset_balance_history to authenticated;
create policy asset_balance_history_select on public.asset_balance_history for select to authenticated
  using (public.is_ledger_member(ledger_id));

-- 자산은 지우지 않고 보관한다 (이력·지난 달 값 보존). 가계부가 지워질 때의 cascade 는 그대로
revoke delete on public.asset from authenticated;

-- 트리거 함수는 직접 부를 수 없다 (init 의 "모든 함수 실행 권한 회수" 이후 새로 만든 함수라 다시 회수)
revoke execute on function public.asset_before_write() from public, anon, authenticated;
revoke execute on function public.asset_record_balance() from public, anon, authenticated;
