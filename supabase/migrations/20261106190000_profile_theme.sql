-- BANB-29 화면 테마 선택 (사용자별 저장, design.md 5.16)
-- 1) profile.theme: clean | berry | cozy. 기존 사용자·새 사용자 모두 기본 clean.
-- 2) 쓰기는 set_my_theme(p_theme) 한 곳: 로그인한 사람(auth.uid()) 자기 행의 theme 만 바꾼다.
--    profile UPDATE RLS 정책·UPDATE 권한은 추가하지 않는다(화면은 여전히 profile 을 직접 쓰지 못함).
-- 3) 구글 정보 동기화 트리거(sync_profile_from_auth)는 insert 에서 theme 을 넣지 않고(기본값),
--    on conflict 에서 display_name·avatar_url 만 바꾸므로 theme 을 덮어쓰지 않는다 → 트리거는 그대로 둔다.
-- 4) 읽기: 기존 profile_select 정책 그대로 (나 + 같은 가계부 사람).

alter table public.profile
  add column theme text not null default 'clean'
  check (theme in ('clean', 'berry', 'cozy'));

create or replace function public.set_my_theme(p_theme text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  -- 대소문자·공백 변형도 받지 않는다 (null 포함)
  if p_theme is null or p_theme not in ('clean', 'berry', 'cozy') then
    raise exception 'INVALID_THEME' using errcode = '22023';
  end if;
  update public.profile
     set theme = p_theme,
         updated_at = now()
   where id = v_uid;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke execute on function public.set_my_theme(text) from public, anon;
grant execute on function public.set_my_theme(text) to authenticated;
