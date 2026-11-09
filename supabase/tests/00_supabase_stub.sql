-- 로컬 검증용: Supabase가 기본 제공하는 것(auth 스키마, 역할, 기본 권한)만 흉내 낸다.
-- 실제 Supabase 프로젝트에는 실행하지 않는다.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase 기본값(새 테이블을 anon/authenticated에 자동 노출)을 일부러 흉내 낸다.
-- 마이그레이션이 이것을 거두고 명시적으로 부여하는지 검증하기 위함.
-- STRICT=1 이면 기본 노출 없이(자동 노출을 끈 프로젝트) 검증한다.
\if :{?strict}
\else
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
\endif
-- Supabase 실시간 발행 (실제 프로젝트에는 기본으로 있다)
create publication supabase_realtime;
