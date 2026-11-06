-- 마이그레이션 적용 확인 (읽기 전용). Supabase SQL Editor에서 실행.
-- 기대 결과: 8행 모두 rls_enabled = true, anon_select = false, authenticated_select = true,
--           policies: ledger 2 / member 2 / invite 3 / 나머지 1, rpc = true,
--           profile_sync = true (20261106000000 마이그레이션: 프로필 테이블·트리거)
--           invite_rules = true (20261105010000 마이그레이션 적용 여부)
--           leave_rpc = true (20261106120000 마이그레이션: 나가기·다시 참여·보관)
--           n1_rule = true (20261106130000 마이그레이션: 내역에 쓰인 소분류는 대분류로 못 바꿈)
select c.relname                                          as table_name,
       c.relrowsecurity                                   as rls_enabled,
       has_table_privilege('anon', c.oid, 'select')       as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       (to_regprocedure('public.create_ledger(text,text)') is not null
        and to_regprocedure('public.join_ledger(text,text)') is not null) as rpc,
       (to_regprocedure('public.leave_ledger()') is not null) as leave_rpc,
       (to_regclass('public.invite_one_active_per_ledger') is not null
        and not has_column_privilege('authenticated', 'public.invite', 'expires_at', 'update')) as invite_rules,
       exists (select 1 from pg_trigger t
                where t.tgrelid = 'auth.users'::regclass and t.tgname = 'profile_sync_after_auth_user') as profile_sync,
       (select prosrc like '%CATEGORY_IN_USE_MUST_STAY_CHILD%' from pg_proc
         where oid = 'public.category_before_write()'::regprocedure) as n1_rule
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ledger', 'member', 'invite', 'category', 'pocket', 'transaction', 'asset', 'profile')
order by c.relname;
