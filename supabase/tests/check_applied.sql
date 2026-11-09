-- 마이그레이션 적용 확인 (읽기 전용). Supabase SQL Editor에서 실행.
-- 기대 결과: 10행 모두 rls_enabled = true, anon_select = false, authenticated_select = true,
--           policies: ledger 2 / member 2 / invite 3 / 나머지 1, rpc = true,
--           profile_sync = true (20261106000000 마이그레이션: 프로필 테이블·트리거)
--           invite_rules = true (20261105010000 마이그레이션 적용 여부)
--           leave_rpc = true (20261106120000 마이그레이션: 나가기·다시 참여·보관)
--           n1_rule = true (20261106130000 마이그레이션: 내역에 쓰인 소분류는 대분류로 못 바꿈)
--           member_limit_4 = true (20261106140000 마이그레이션: 기본 상한 4, 기존 가계부 모두 4, 멤버는 못 바꿈)
--           multi_ledger = true (20261106150000 마이그레이션: 1인 1가계부 제거, 1인 상한 5, 마지막으로 본 가계부, leave_ledger(uuid))
--           asset_net_worth = true (20261106160000 마이그레이션: 자산 종류 12개, 보관, 잔액 이력 트리거, 이력 직접 쓰기·자산 삭제 불가)
--           category_icon = true (20261106170000 마이그레이션: category.icon 컬럼·기본 매핑 함수, 새 가계부 기본값에 아이콘 — 20261109000000 이후 기본값은 default_categories_v2)
--           history_window = true (20261106180000 마이그레이션: 잔액 이력 범위 조회 함수, 로그인 사용자만 실행·권한 규칙 그대로)
--           profile_theme = true (20261106190000 마이그레이션: profile.theme 기본 clean·허용 값 3종, set_my_theme 로그인 사용자만, profile 직접 수정 불가 그대로)
--           category_simplify = true (20261109000000 마이그레이션: 새 기본 카테고리 20개, 모든 가계부에 기본 20개 대분류, 목록 함수 직접 실행 불가)
--           event_calendar = true (20261109100000 마이그레이션: event 테이블·작성자 트리거·고정 2개 규칙, ledger.together_since 멤버 수정 가능)
--           (asset_balance_history·event 행이 추가되어 11행. 이력 테이블·event policies 1)
--           recurring = true (20261109200000 마이그레이션: 정기 내역·회차 테이블, transaction.source 'recurring', 기록·되돌리기 함수 로그인 사용자만, 회차 직접 쓰기 불가)
--           (recurring_transaction·recurring_occurrence 행이 추가되어 13행. 둘 다 policies 1)
--           game_omok = true (20261109230000 마이그레이션: 같이 놀기 판·수 테이블 직접 쓰기 불가, 판정 함수 로그인 사용자만, 실시간 발행에 game·game_move)
--           (game·game_move 행이 추가되어 15행. 둘 다 policies 1)
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
                     and t.tgname = 'member_enforce_user_ledger_limit')) as multi_ledger,
       (to_regclass('public.asset_balance_history') is not null
        and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'asset' and column_name = 'archived_at')
        and (select pg_get_constraintdef(oid) like '%other_liability%' from pg_constraint
              where conrelid = 'public.asset'::regclass and conname = 'asset_kind_check')
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.asset'::regclass and t.tgname = 'asset_record_balance')
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.asset'::regclass and t.tgname = 'asset_before_write')
        and not has_table_privilege('authenticated', 'public.asset', 'delete')
        and not has_table_privilege('authenticated', 'public.asset_balance_history', 'insert')
        and not has_table_privilege('authenticated', 'public.asset_balance_history', 'update')
        and not has_table_privilege('authenticated', 'public.asset_balance_history', 'delete')
        and not exists (select 1 from public.asset a
                         where not exists (select 1 from public.asset_balance_history h where h.asset_id = a.id))) as asset_net_worth,
       (exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'category' and column_name = 'icon')
        and to_regprocedure('public.default_category_icon(text,text,text)') is not null
        and (select prosrc like '%icon%' from pg_proc
              where oid = 'public.seed_ledger_defaults(uuid)'::regprocedure)
        and not has_function_privilege('authenticated', 'public.default_category_icon(text,text,text)', 'execute')) as category_icon,
       (to_regprocedure('public.asset_balance_history_window(uuid,timestamptz)') is not null
        and has_function_privilege('authenticated', 'public.asset_balance_history_window(uuid,timestamptz)', 'execute')
        and not has_function_privilege('anon', 'public.asset_balance_history_window(uuid,timestamptz)', 'execute')
        and not (select prosecdef from pg_proc
                  where oid = 'public.asset_balance_history_window(uuid,timestamptz)'::regprocedure)) as history_window,
       (exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profile' and column_name = 'theme'
                   and is_nullable = 'NO' and column_default like '''clean''%')
        and to_regprocedure('public.set_my_theme(text)') is not null
        and has_function_privilege('authenticated', 'public.set_my_theme(text)', 'execute')
        and not has_function_privilege('anon', 'public.set_my_theme(text)', 'execute')
        and not has_table_privilege('authenticated', 'public.profile', 'update')
        and not exists (select 1 from public.profile where theme not in ('clean', 'berry', 'cozy'))) as profile_theme,
       (to_regprocedure('public.default_categories_v2()') is not null
        and (select count(*) from public.default_categories_v2()) = 20
        and (select prosrc like '%default_categories_v2%' from pg_proc
              where oid = 'public.seed_ledger_defaults(uuid)'::regprocedure)
        and not has_function_privilege('authenticated', 'public.default_categories_v2()', 'execute')
        -- 모든 가계부에 새 기본 20개(같은 이름 대분류)가 있다
        and not exists (select 1 from public.ledger l cross join public.default_categories_v2() d
                         where not exists (select 1 from public.category p where p.ledger_id = l.id and p.type = d.type
                                             and p.parent_id is null and p.name = d.name))
       ) as category_simplify,
       (to_regclass('public.event') is not null
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.event'::regclass and t.tgname = 'event_before_write')
        and exists (select 1 from pg_constraint where conrelid = 'public.event'::regclass and conname = 'event_lunar_rule')
        and exists (select 1 from pg_constraint where conrelid = 'public.event'::regclass and conname = 'event_pin_rule')
        and not has_function_privilege('authenticated', 'public.event_before_write()', 'execute')
        and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'ledger' and column_name = 'together_since')
        and has_column_privilege('authenticated', 'public.ledger', 'together_since', 'update')
        and not has_column_privilege('authenticated', 'public.ledger', 'member_limit', 'update')) as event_calendar,
       (to_regclass('public.recurring_transaction') is not null
        and to_regclass('public.recurring_occurrence') is not null
        and (select pg_get_constraintdef(oid) like '%recurring%' from pg_constraint
              where conrelid = 'public.transaction'::regclass and conname = 'transaction_source_check')
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.recurring_transaction'::regclass
                     and t.tgname = 'recurring_transaction_before_write')
        and has_function_privilege('authenticated', 'public.record_recurring(uuid,jsonb)', 'execute')
        and not has_function_privilege('anon', 'public.record_recurring(uuid,jsonb)', 'execute')
        and has_function_privilege('authenticated', 'public.undo_recurring_record(uuid,jsonb)', 'execute')
        and not has_table_privilege('authenticated', 'public.recurring_occurrence', 'insert')
        and not has_table_privilege('authenticated', 'public.recurring_occurrence', 'delete')) as recurring,
       (to_regclass('public.game') is not null
        and to_regclass('public.game_move') is not null
        and not has_table_privilege('authenticated', 'public.game', 'insert')
        and not has_table_privilege('authenticated', 'public.game', 'update')
        and not has_table_privilege('authenticated', 'public.game_move', 'insert')
        and has_function_privilege('authenticated', 'public.play_move(uuid,integer,integer)', 'execute')
        and not has_function_privilege('anon', 'public.play_move(uuid,integer,integer)', 'execute')
        and has_function_privilege('authenticated', 'public.invite_game(uuid,uuid,text,uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.cancel_game(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public.game_close_stale(uuid)', 'execute')
        and (select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
              and schemaname = 'public' and tablename in ('game', 'game_move')) = 2) as game_omok,
       (to_regclass('public.game_stack_best') is not null
        and not has_table_privilege('authenticated', 'public.game_stack_best', 'insert')
        and not has_table_privilege('authenticated', 'public.game_stack_best', 'update')
        and has_function_privilege('authenticated', 'public.record_stack_score(uuid,bigint,integer)', 'execute')
        and not has_function_privilege('anon', 'public.record_stack_score(uuid,bigint,integer)', 'execute')) as game_stack
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ledger', 'member', 'invite', 'category', 'pocket', 'transaction', 'asset', 'profile', 'user_preference', 'asset_balance_history', 'event', 'recurring_transaction', 'recurring_occurrence', 'game', 'game_move', 'game_stack_best')
order by c.relname;

-- 가계부 상한 분포 (BANB-16 적용 후 기대: member_limit = 4 한 줄만)
select member_limit, count(*) as ledgers from public.ledger group by member_limit order by member_limit;

-- 1인당 참여 중인 가계부 수 분포 (BANB-17: 5를 넘는 행이 없어야 함)
select active_ledgers, count(*) as users from (
  select user_id, count(*) as active_ledgers from public.member where left_at is null group by user_id
) q group by active_ledgers order by active_ledgers;

-- BANB-24 카테고리 아이콘 채움 현황 (기대: 기본 카테고리는 icon 있음. 비어 있는 것은 이름 바꾼 기본값·직접 만든 것뿐)
select (icon is not null) as has_icon, (parent_id is null) as is_parent, count(*) from public.category group by 1, 2 order by 1, 2;
