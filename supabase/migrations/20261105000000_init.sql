-- banban 전체 스키마 (MVP) — BANB-2 "확정 명세" 기준
-- 테이블: ledger, member, invite, category, pocket, transaction, asset
-- 원칙
--   * 모든 데이터는 해당 가계부의 "현재 멤버"만 읽고 쓴다 (RLS)
--   * 다른 가계부의 카테고리·주머니·멤버를 참조하지 못하게 (id, ledger_id) 복합 FK 사용
--   * 가계부 생성·참여는 RPC(create_ledger / join_ledger)로만 한다 (인원 상한·1인 1가계부 규칙을 DB에서 보장)
--   * 금액은 원 단위 정수(bigint)

-- ─────────────────────────────────────────────
-- ledger: 가계부 (공유 단위)
-- ─────────────────────────────────────────────
create table public.ledger (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 30),
  member_limit  int  not null default 2 check (member_limit >= 1),
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- member: 가계부 참여자
--   left_at: 나가기 표시. 행을 지우지 않아 그 사람의 내역(spender 등)이 남는다
--   display_name: 화면에 보일 이름(사용한 사람·마지막 수정자 표시용)
-- ─────────────────────────────────────────────
create table public.member (
  id            uuid primary key default gen_random_uuid(),
  ledger_id     uuid not null references public.ledger (id) on delete cascade,
  user_id       uuid not null references auth.users (id),
  role          text not null default 'member' check (role in ('owner', 'member')),
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 20),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  unique (id, ledger_id)
);
-- MVP: 사용자당 (현재 참여 중인) 가계부 1개
create unique index member_one_active_ledger_per_user on public.member (user_id) where left_at is null;
create index member_ledger_idx on public.member (ledger_id);

-- ─────────────────────────────────────────────
-- invite: 초대 코드 (8자리, 발급 후 7일 만료, 새로 발급하면 이전 것 무효)
-- ─────────────────────────────────────────────
create or replace function public.generate_invite_code() returns text
language sql volatile
set search_path = ''
as $$
  -- 헷갈리는 문자(0/O, 1/I/L) 제외
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

create table public.invite (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledger (id) on delete cascade,
  code        text not null unique default public.generate_invite_code() check (code ~ '^[A-Z0-9]{8}$'),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  is_revoked  boolean not null default false,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (created_by, ledger_id) references public.member (id, ledger_id)
);
create index invite_ledger_idx on public.invite (ledger_id);

-- ─────────────────────────────────────────────
-- category: 카테고리 (대분류 parent_id null / 소분류 parent_id = 대분류)
-- ─────────────────────────────────────────────
create table public.category (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledger (id) on delete cascade,
  type        text not null check (type in ('expense', 'income', 'saving')),
  parent_id   uuid,
  name        text not null check (char_length(btrim(name)) between 1 and 20),
  sort_order  int  not null default 0,
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (id, ledger_id),
  unique (id, ledger_id, type),
  -- 소분류는 같은 가계부·같은 type의 대분류 아래에만
  foreign key (parent_id, ledger_id, type) references public.category (id, ledger_id, type) on delete restrict
);
create index category_ledger_idx on public.category (ledger_id, type, parent_id);

-- ─────────────────────────────────────────────
-- pocket: 주머니 (내역마다 고르는 용도 구분, scope = shared / personal)
-- ─────────────────────────────────────────────
create table public.pocket (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledger (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 20),
  scope       text not null check (scope in ('shared', 'personal')),
  sort_order  int  not null default 0,
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (id, ledger_id)
);
create index pocket_ledger_idx on public.pocket (ledger_id);

-- ─────────────────────────────────────────────
-- transaction: 내역
--   occurred_on: 내역 날짜(KST 기준 날짜를 그대로 저장, 시간 없음)
--   category_id: 소분류만 (트리거로 검사), type 일치는 복합 FK로 보장
--   pocket_id: 지출일 때 필수, 그 외엔 null
--   is_fixed: 지출일 때만 true 가능
--   created_by / updated_by: 작성자 / 마지막 수정자 (member.id, 트리거가 채움)
-- ─────────────────────────────────────────────
create table public.transaction (
  id           uuid primary key default gen_random_uuid(),
  ledger_id    uuid not null references public.ledger (id) on delete cascade,
  type         text not null check (type in ('expense', 'income', 'saving')),
  amount       bigint not null check (amount >= 1),
  occurred_on  date not null default (now() at time zone 'Asia/Seoul')::date,
  category_id  uuid not null,
  pocket_id    uuid,
  spender_id   uuid not null,
  is_fixed     boolean not null default false,
  memo         text check (char_length(memo) <= 100),
  source       text not null default 'manual' check (source in ('manual', 'excel', 'sync')),
  created_by   uuid not null,
  updated_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (category_id, ledger_id, type) references public.category (id, ledger_id, type) on delete restrict,
  foreign key (pocket_id, ledger_id) references public.pocket (id, ledger_id) on delete restrict,
  foreign key (spender_id, ledger_id) references public.member (id, ledger_id),
  foreign key (created_by, ledger_id) references public.member (id, ledger_id),
  foreign key (updated_by, ledger_id) references public.member (id, ledger_id),
  constraint transaction_pocket_rule check ((type = 'expense') = (pocket_id is not null)),
  constraint transaction_fixed_rule check (type = 'expense' or is_fixed = false)
);
create index transaction_ledger_date_idx on public.transaction (ledger_id, occurred_on);

-- ─────────────────────────────────────────────
-- asset: 자산 (잔액 직접 입력, 내역과 연결 안 함)
--   kind: checking(입출금) / installment_saving(적금) / deposit(예금) / investment(투자) / cash(현금) / other(기타)
--   owner_id: 멤버, null = 공동
-- ─────────────────────────────────────────────
create table public.asset (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledger (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  kind        text not null check (kind in ('checking', 'installment_saving', 'deposit', 'investment', 'cash', 'other')),
  owner_id    uuid,
  balance     bigint not null default 0 check (balance >= 0),
  memo        text check (char_length(memo) <= 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (owner_id, ledger_id) references public.member (id, ledger_id)
);
create index asset_ledger_idx on public.asset (ledger_id);

-- ═════════════════════════════════════════════
-- 권한 도우미
-- ═════════════════════════════════════════════

-- 로그인한 사용자가 이 가계부의 현재 멤버인가
create or replace function public.is_ledger_member(p_ledger_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.member m
    where m.ledger_id = p_ledger_id and m.user_id = auth.uid() and m.left_at is null
  );
$$;

-- 로그인한 사용자의 이 가계부 member.id (없으면 null)
create or replace function public.current_member_id(p_ledger_id uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.id from public.member m
  where m.ledger_id = p_ledger_id and m.user_id = auth.uid() and m.left_at is null;
$$;

-- ═════════════════════════════════════════════
-- 트리거
-- ═════════════════════════════════════════════

-- 내역: 작성자/마지막 수정자/수정 시각 자동 기록, 카테고리는 소분류만
create or replace function public.transaction_before_write() returns trigger
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
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(v_member, new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

create trigger transaction_before_write
before insert or update on public.transaction
for each row execute function public.transaction_before_write();

-- 카테고리: 2단계(대분류 > 소분류)까지만
create or replace function public.category_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    select 1 from public.category c where c.id = new.parent_id and c.parent_id is not null
  ) then
    raise exception 'CATEGORY_DEPTH_EXCEEDED' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger category_before_write
before insert or update on public.category
for each row execute function public.category_before_write();

create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger asset_touch_updated_at
before update on public.asset
for each row execute function public.touch_updated_at();

-- 초대: 발급자 자동 기록 + 새로 발급하면 이전 초대 무효
create or replace function public.invite_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := coalesce(public.current_member_id(new.ledger_id), new.created_by);
  update public.invite set is_revoked = true
  where ledger_id = new.ledger_id and is_revoked = false;
  return new;
end;
$$;

create trigger invite_before_insert
before insert on public.invite
for each row execute function public.invite_before_insert();

-- ═════════════════════════════════════════════
-- 기본 카테고리·주머니 (가계부 생성 시 1회)
-- ═════════════════════════════════════════════
create or replace function public.seed_ledger_defaults(p_ledger_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  -- 형식: type|대분류|소분류1,소분류2  (소분류가 없으면 대분류와 같은 이름 1개)
  v_defaults text[] := array[
    'expense|식비|장보기,외식,배달,카페/간식',
    'expense|주거|월세,관리비,공과금',
    'expense|통신|휴대폰,인터넷,구독',
    'expense|교통|대중교통,주유,주차,택시',
    'expense|생활|생필품,가구/가전',
    'expense|쇼핑|의류,미용',
    'expense|건강|병원,약국,운동',
    'expense|문화·여가|취미,공연,여행',
    'expense|경조사·선물|',
    'expense|교육|',
    'expense|보험|',
    'expense|반려동물|',
    'expense|육아|',
    'expense|대출이자|',
    'expense|기타|',
    'income|급여|',
    'income|상여|',
    'income|부수입|',
    'income|용돈|',
    'income|이자·배당|',
    'income|기타|',
    'saving|적금|',
    'saving|예금|',
    'saving|투자|',
    'saving|청약|',
    'saving|비상금|',
    'saving|기타|'
  ];
  v_row text;
  v_parts text[];
  v_children text[];
  v_parent_id uuid;
  v_order int := 0;
  v_child_order int;
  v_child text;
begin
  foreach v_row in array v_defaults loop
    v_parts := string_to_array(v_row, '|');
    v_order := v_order + 1;
    insert into public.category (ledger_id, type, parent_id, name, sort_order)
    values (p_ledger_id, v_parts[1], null, v_parts[2], v_order)
    returning id into v_parent_id;

    v_children := case when coalesce(v_parts[3], '') = '' then array[v_parts[2]]
                       else string_to_array(v_parts[3], ',') end;
    v_child_order := 0;
    foreach v_child in array v_children loop
      v_child_order := v_child_order + 1;
      insert into public.category (ledger_id, type, parent_id, name, sort_order)
      values (p_ledger_id, v_parts[1], v_parent_id, v_child, v_child_order);
    end loop;
  end loop;

  insert into public.pocket (ledger_id, name, scope, sort_order) values
    (p_ledger_id, '공동소비', 'shared', 1),
    (p_ledger_id, '개인용돈', 'personal', 2),
    (p_ledger_id, '여행', 'shared', 3),
    (p_ledger_id, '경조사비', 'shared', 4);
end;
$$;

-- ═════════════════════════════════════════════
-- RPC: 가계부 만들기 / 초대 코드로 참여
--   오류 메시지(코드): NOT_AUTHENTICATED / ALREADY_IN_LEDGER / INVITE_NOT_FOUND / INVITE_EXPIRED / MEMBER_LIMIT_REACHED
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
  if exists (select 1 from public.member where user_id = v_uid and left_at is null) then
    raise exception 'ALREADY_IN_LEDGER' using errcode = 'P0001';
  end if;

  insert into public.ledger (name, created_by) values (btrim(p_name), v_uid)
  returning id into v_ledger_id;
  insert into public.member (ledger_id, user_id, role, display_name)
  values (v_ledger_id, v_uid, 'owner', btrim(p_display_name));
  perform public.seed_ledger_defaults(v_ledger_id);
  return v_ledger_id;
end;
$$;

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

  -- 동시에 여러 명이 참여해도 상한을 넘지 않도록 가계부 행 잠금
  select member_limit into v_limit from public.ledger where id = v_invite.ledger_id for update;
  select count(*) into v_count from public.member where ledger_id = v_invite.ledger_id and left_at is null;
  if v_count >= v_limit then
    raise exception 'MEMBER_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.member (ledger_id, user_id, role, display_name)
  values (v_invite.ledger_id, v_uid, 'member', btrim(p_display_name));
  return v_invite.ledger_id;
end;
$$;

-- ═════════════════════════════════════════════
-- 행 단위 권한 (RLS)
-- ═════════════════════════════════════════════
alter table public.ledger      enable row level security;
alter table public.member      enable row level security;
alter table public.invite      enable row level security;
alter table public.category    enable row level security;
alter table public.pocket      enable row level security;
alter table public.transaction enable row level security;
alter table public.asset       enable row level security;

-- 비로그인(anon)은 아무것도 못 한다
revoke all on public.ledger, public.member, public.invite, public.category,
              public.pocket, public.transaction, public.asset from anon;

-- ledger: 멤버만 조회·이름/상한 수정. 생성은 create_ledger RPC로만, 삭제는 MVP 범위 밖
create policy ledger_select on public.ledger for select to authenticated
  using (public.is_ledger_member(id));
create policy ledger_update on public.ledger for update to authenticated
  using (public.is_ledger_member(id)) with check (public.is_ledger_member(id));
revoke insert, delete on public.ledger from authenticated;
revoke update on public.ledger from authenticated;
grant update (name) on public.ledger to authenticated;  -- member_limit은 클라이언트에서 못 바꿈

-- member: 같은 가계부 멤버끼리 조회. 본인 display_name만 수정. 추가는 RPC로만
create policy member_select on public.member for select to authenticated
  using (public.is_ledger_member(ledger_id));
create policy member_update_self on public.member for update to authenticated
  using (user_id = auth.uid() and left_at is null) with check (user_id = auth.uid());
revoke insert, delete, update on public.member from authenticated;
grant update (display_name) on public.member to authenticated;

-- invite: 멤버만 조회·발급·무효화. 참여는 join_ledger RPC로만
create policy invite_select on public.invite for select to authenticated
  using (public.is_ledger_member(ledger_id));
create policy invite_insert on public.invite for insert to authenticated
  with check (public.is_ledger_member(ledger_id));
create policy invite_update on public.invite for update to authenticated
  using (public.is_ledger_member(ledger_id)) with check (public.is_ledger_member(ledger_id));
revoke delete on public.invite from authenticated;

-- category / pocket / transaction / asset: 멤버만 전부(조회·추가·수정·삭제)
create policy category_all on public.category for all to authenticated
  using (public.is_ledger_member(ledger_id)) with check (public.is_ledger_member(ledger_id));
create policy pocket_all on public.pocket for all to authenticated
  using (public.is_ledger_member(ledger_id)) with check (public.is_ledger_member(ledger_id));
create policy transaction_all on public.transaction for all to authenticated
  using (public.is_ledger_member(ledger_id)) with check (public.is_ledger_member(ledger_id));
create policy asset_all on public.asset for all to authenticated
  using (public.is_ledger_member(ledger_id)) with check (public.is_ledger_member(ledger_id));

-- 함수 실행 권한: RPC 2개만 로그인 사용자에게 공개
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_ledger(text, text) to authenticated;
grant execute on function public.join_ledger(text, text) to authenticated;
grant execute on function public.is_ledger_member(uuid) to authenticated;
grant execute on function public.current_member_id(uuid) to authenticated;
grant execute on function public.generate_invite_code() to authenticated;
