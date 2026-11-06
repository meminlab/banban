-- BANB-29 화면 테마: profile.theme 기본값·허용 값 · set_my_theme 은 자기 행만 · 동기화 트리거가 theme 을 덮지 않음
-- 10_rls_test.sql 과 같이 한 트랜잭션으로 실행하고 마지막에 ROLLBACK (운영 SQL Editor에서도 실행 가능)
-- 사용자: A, B(A 와 같은 가계부), X(외부인)
begin;

create schema test;
grant usage on schema test to anon, authenticated;

create function test.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" BUT SUCCEEDED: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' or sqlerrm not like '%' || p_pattern || '%' then
    raise exception 'TEST FAILED: % -> got "%"', p_sql, sqlerrm;
  end if;
end $$;

create function test.expect_count(p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  if v <> p_expected then
    raise exception 'TEST FAILED: % -> expected % rows, got %', p_sql, p_expected, v;
  end if;
end $$;

grant execute on all functions in schema test to anon, authenticated;
create table test.ctx (key text primary key, val text);
grant all on test.ctx to authenticated;

-- ── 1. 스키마: not null default 'clean', 허용 값 검사
select test.expect_count($$select * from information_schema.columns
  where table_schema = 'public' and table_name = 'profile' and column_name = 'theme'
    and data_type = 'text' and is_nullable = 'NO' and column_default like '''clean''%'$$, 1);

-- 새 사용자 → profile 생성 시 theme = clean
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a1', 'a@theme.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000007b1', 'b@theme.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000007f1', 'x@theme.test', '{"full_name": "엑스"}');
select test.expect_count($$select * from public.profile where id::text like '00000000-0000-0000-0000-0000000007%' and theme = 'clean'$$, 3);

-- 허용 밖 값은 테이블 제약으로도 막힌다 (관리자 직접 수정 포함)
select test.expect_error($$update public.profile set theme = 'dark' where id = '00000000-0000-0000-0000-0000000007a1'$$, 'check constraint');
select test.expect_error($$update public.profile set theme = null where id = '00000000-0000-0000-0000-0000000007a1'$$, 'null value');

-- ── 2. 함수 권한: anon 은 실행 불가, authenticated 는 가능. 인자는 테마 하나뿐(다른 사람 id 를 넘길 방법 없음)
select test.expect_count($$select * from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_my_theme'$$, 1);
select test.expect_count($$select * from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_my_theme' and p.pronargs = 1 and p.prosecdef$$, 1);
select test.expect_count($$select 1 where not has_function_privilege('anon', 'public.set_my_theme(text)', 'execute')$$, 1);
select test.expect_count($$select 1 where has_function_privilege('authenticated', 'public.set_my_theme(text)', 'execute')$$, 1);
-- profile UPDATE 권한·정책은 여전히 없다 (RLS 완화 아님)
select test.expect_count($$select 1 where not has_table_privilege('authenticated', 'public.profile', 'update')$$, 1);
select test.expect_count($$select * from pg_policies where schemaname = 'public' and tablename = 'profile' and cmd <> 'SELECT'$$, 0);

-- A·B 같은 가계부
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000007a1';
insert into test.ctx values ('l1', public.create_ledger('테마 L1', '에이')::text);
insert into public.invite (ledger_id) values ((select val::uuid from test.ctx where key = 'l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = (select val::uuid from test.ctx where key = 'l1') and is_revoked = false));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000007b1';
select public.join_ledger((select val from test.ctx where key = 'code'), '비');

-- ── 3. A 가 자기 테마를 바꾼다 → A 행만 바뀐다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000007a1';
select public.set_my_theme('berry');
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007a1' and theme = 'berry'$$, 1);
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007b1' and theme = 'clean'$$, 1);
select public.set_my_theme('cozy');
select public.set_my_theme('clean');
select public.set_my_theme('cozy');
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007a1' and theme = 'cozy'$$, 1);

-- ── 4. 허용 밖 값은 거부, 기존 값 유지 (대소문자·공백·빈 값·null·긴 값)
select test.expect_error($$select public.set_my_theme('dark')$$, 'INVALID_THEME');
select test.expect_error($$select public.set_my_theme('Clean')$$, 'INVALID_THEME');
select test.expect_error($$select public.set_my_theme(' clean')$$, 'INVALID_THEME');
select test.expect_error($$select public.set_my_theme('clean ')$$, 'INVALID_THEME');
select test.expect_error($$select public.set_my_theme('')$$, 'INVALID_THEME');
select test.expect_error($$select public.set_my_theme(null)$$, 'INVALID_THEME');
select test.expect_error($$select public.set_my_theme(repeat('a', 10000))$$, 'INVALID_THEME');
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007a1' and theme = 'cozy'$$, 1);

-- ── 5. 다른 사람 테마는 직접 수정 불가 (UPDATE 권한 없음) → B 값 그대로
select test.expect_error($$update public.profile set theme = 'cozy' where id = '00000000-0000-0000-0000-0000000007b1'$$, 'permission denied');
select test.expect_error($$update public.profile set display_name = '해킹' where id = '00000000-0000-0000-0000-0000000007a1'$$, 'permission denied');

-- ── 6. 읽기 범위는 기존 그대로: A 는 자기 + 같은 가계부 B 의 theme 만 본다, X 는 못 본다
select test.expect_count($$select id, theme from public.profile$$, 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000007f1';
select test.expect_count($$select id, theme from public.profile$$, 1);
-- X 가 함수를 불러도 X 자기 행만 바뀐다
select public.set_my_theme('berry');
reset role;
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007f1' and theme = 'berry'$$, 1);
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007a1' and theme = 'cozy'$$, 1);
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007b1' and theme = 'clean'$$, 1);

-- ── 7. 비로그인(anon)·sub 없는 authenticated
set role anon;
select test.expect_error($$select public.set_my_theme('berry')$$, 'permission denied');
reset role;
set role authenticated;
set request.jwt.claim.sub = '';
select test.expect_error($$select public.set_my_theme('berry')$$, 'NOT_SIGNED_IN');
reset role;

-- ── 8. 구글 정보 동기화(이름·사진 변경 재로그인)는 theme 을 덮지 않는다
update auth.users
   set raw_user_meta_data = '{"full_name": "에이 새이름", "avatar_url": "https://example.com/a.png"}'
 where id = '00000000-0000-0000-0000-0000000007a1';
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007a1'
  and display_name = '에이 새이름' and avatar_url = 'https://example.com/a.png' and theme = 'cozy'$$, 1);
update auth.users set email = 'a2@theme.test' where id = '00000000-0000-0000-0000-0000000007a1';
select test.expect_count($$select * from public.profile where id = '00000000-0000-0000-0000-0000000007a1' and theme = 'cozy'$$, 1);

-- ── 9. profile 행이 없는 사용자(정상 흐름에선 없음)는 오류
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000007ee';
select test.expect_error($$select public.set_my_theme('berry')$$, 'PROFILE_NOT_FOUND');
reset role;

select 'profile theme tests passed' as result;

rollback;
