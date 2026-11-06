-- BANB-4 구글 로그인: 사용자 프로필(이름, 프로필 이미지)
-- 구글 로그인으로 auth.users 가 생기거나 바뀔 때 트리거가 profile 을 채운다.
-- 화면(클라이언트)은 읽기만 한다. 쓰기는 트리거(서버)만.

-- ═════════════════════════════════════════════
-- 테이블
-- ═════════════════════════════════════════════
-- profile: 로그인 사용자 1명당 1행 (가계부와 무관한 사용자 정보)
--   display_name: 구글 계정 이름 (없으면 이메일 앞부분). 가계부 안 이름은 member.display_name
--   avatar_url:   구글 프로필 이미지 주소 (https 만, 없으면 null)
create table public.profile (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 100),
  avatar_url    text check (avatar_url is null or avatar_url ~ '^https://'),
  updated_at    timestamptz not null default now()
);

-- ═════════════════════════════════════════════
-- auth.users → profile 동기화
-- ═════════════════════════════════════════════
create or replace function public.profile_values_from_auth(
  p_email text, p_meta jsonb, out o_display_name text, out o_avatar_url text)
language plpgsql immutable
set search_path = ''
as $$
begin
  o_display_name := left(btrim(coalesce(
    nullif(btrim(p_meta ->> 'full_name'), ''),
    nullif(btrim(p_meta ->> 'name'), ''),
    nullif(btrim(split_part(coalesce(p_email, ''), '@', 1)), ''),
    '사용자')), 100);
  o_avatar_url := coalesce(nullif(btrim(p_meta ->> 'avatar_url'), ''), nullif(btrim(p_meta ->> 'picture'), ''));
  if o_avatar_url !~ '^https://' then
    o_avatar_url := null;
  end if;
end $$;

create or replace function public.sync_profile_from_auth() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v record;
begin
  select * into v from public.profile_values_from_auth(new.email, new.raw_user_meta_data);
  insert into public.profile (id, display_name, avatar_url)
  values (new.id, v.o_display_name, v.o_avatar_url)
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url   = excluded.avatar_url,
        updated_at   = now()
    where public.profile.display_name is distinct from excluded.display_name
       or public.profile.avatar_url   is distinct from excluded.avatar_url;
  return new;
end $$;

create trigger profile_sync_after_auth_user
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_profile_from_auth();

-- 이미 있는 사용자 채우기 (적용 시점에 1회)
insert into public.profile (id, display_name, avatar_url)
select u.id, v.o_display_name, v.o_avatar_url
from auth.users u
cross join lateral public.profile_values_from_auth(u.email, u.raw_user_meta_data) v
on conflict (id) do nothing;

-- ═════════════════════════════════════════════
-- 권한
-- ═════════════════════════════════════════════
-- 나, 또는 내가 현재 멤버인 가계부에 참여했던 사람(나간 사람 포함)의 프로필만 볼 수 있다
create or replace function public.can_see_profile(p_user_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user_id = auth.uid()
      or exists (
        select 1
        from public.member me
        join public.member other on other.ledger_id = me.ledger_id
        where me.user_id = auth.uid() and me.left_at is null
          and other.user_id = p_user_id
      );
$$;

alter table public.profile enable row level security;

revoke all on public.profile from public, anon, authenticated;
grant select on public.profile to authenticated;

create policy profile_select on public.profile for select to authenticated
  using (public.can_see_profile(id));

revoke execute on function public.profile_values_from_auth(text, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_profile_from_auth() from public, anon, authenticated;
revoke execute on function public.can_see_profile(uuid) from public, anon;
grant execute on function public.can_see_profile(uuid) to authenticated;
