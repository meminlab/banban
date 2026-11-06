-- 마이그레이션 적용 확인 (읽기 전용). Supabase SQL Editor에서 실행.
-- 기대 결과: 9행 모두 rls_enabled = true, anon_select = false, authenticated_select = true,
--           policies: ledger 2 / member 2 / invite 3 / 나머지 1, rpc = true,
--           profile_sync = true (20261106000000 마이그레이션: 프로필 테이블·트리거)
--           invite_rules = true (20261105010000 마이그레이션 적용 여부)
--           leave_rpc = true (20261106120000 마이그레이션: 나가기·다시 참여·보관)
--           n1_rule = true (20261106130000 마이그레이션: 내역에 쓰인 소분류는 대분류로 못 바꿈)
--           member_limit_4 = true (20261106140000 마이그레이션: 기본 상한 4, 기존 가계부 모두 4, 멤버는 못 바꿈)
--           multi_ledger = true (20261106150000 마이그레이션: 1인 1가계부 제거, 1인 상한 5, 마지막으로 본 가계부, leave_ledger(uuid))
--           (leave_rpc 는 20261106150000 이후 leave_ledger(uuid) 기준)
select c.relname                                          as table_name,
       c.relrowsecurity                                   as rls_enabled,
       has_table_privilege('anon', c.oid, 'select')       as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       (to_regprocedure('public.create_ledger(text,text)') is not null
        and to_regprocedure('public.join_ledger(text,text)') is not null) as rpc,
       (to_regprocedure('public.leave_ledger(uuid)') is not null) as leave_rpc,
       (to_regclass('public.invite_one_active_per_ledger') is not null
        and not has_column_privilege('authenticated', 'public.invite', 'expires_at', 'update')) as invite_rules,
       exists (select 1 from pg_trigger t
                where t.tgrelid = 'auth.users'::regclass and t.tgname = 'profile_sync_after_auth_user') as profile_sync,
       (select prosrc like '%CATEGORY_IN_USE_MUST_STAY_CHILD%' from pg_proc
         where oid = 'public.category_before_write()'::regprocedure) as n1_rule,
       ((select column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'ledger' and column_name = 'member_limit') = '4'
        and not exists (select 1 from public.ledger where member_limit <> 4)
        and not has_column_privilege('authenticated', 'public.ledger', 'member_limit', 'update')) as member_limit_4,
       (to_regclass('public.member_one_active_ledger_per_user') is null
        and to_regclass('public.member_one_active_per_ledger_user') is not null
        and to_regclass('public.user_preference') is not null
        and to_regprocedure('public.leave_ledger()') is null
        and to_regprocedure('public.set_last_ledger(uuid)') is not null
        and (select public.user_ledger_limit()) = 5
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.member'::regclass
                     and t.tgname = 'member_enforce_user_ledger_limit')) as multi_ledger
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ledger', 'member', 'invite', 'category', 'pocket', 'transaction', 'asset', 'profile', 'user_preference')
order by c.relname;

-- 가계부 상한 분포 (BANB-16 적용 후 기대: member_limit = 4 한 줄만)
select member_limit, count(*) as ledgers from public.ledger group by member_limit order by member_limit;

-- 1인당 참여 중인 가계부 수 분포 (BANB-17: 5를 넘는 행이 없어야 함)
select active_ledgers, count(*) as users from (
  select user_id, count(*) as active_ledgers from public.member where left_at is null group by user_id
) q group by active_ledgers order by active_ledgers;
