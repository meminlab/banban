-- 마이그레이션 적용 확인 (읽기 전용). Supabase SQL Editor에서 실행.
-- 기대 결과: 7행 모두 rls_enabled = true, anon_select = false, authenticated_select = true,
--           policies: ledger 2 / member 2 / invite 3 / 나머지 1, 마지막 열 rpc = true
select c.relname                                          as table_name,
       c.relrowsecurity                                   as rls_enabled,
       has_table_privilege('anon', c.oid, 'select')       as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       (to_regprocedure('public.create_ledger(text,text)') is not null
        and to_regprocedure('public.join_ledger(text,text)') is not null) as rpc
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ledger', 'member', 'invite', 'category', 'pocket', 'transaction', 'asset')
order by c.relname;
