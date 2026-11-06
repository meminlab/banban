-- BANB-25 QA 테스트 케이스 v4 기준 데이터 (자산관리 1단계)
--
-- ⚠️ 테스트 DB 전용. 운영 DB에서는 실행하지 않는다.
--    잔액 이력·보관 시각을 관리자 권한으로 직접 만든다(앱에서는 서버 시각만 기록됨).
--    실수로 운영에서 돌지 않도록 아래 설정이 없으면 QA_SEED_NOT_ALLOWED 로 멈춘다.
--      psql:        PGOPTIONS='-c banban.qa_seed=test-db-only' psql "<테스트 DB 접속 문자열>" -v ON_ERROR_STOP=1 -f supabase/seed/qa_assets_v4.sql
--      SQL Editor:  파일 맨 위에 `set banban.qa_seed = 'test-db-only';` 한 줄을 붙이고 전체 Run
--
-- 만드는 것 (v4 "기준 데이터", 오늘 = 2026-11-06 KST)
--   * 가계부 L1 "QA 자산 v4"  : 멤버 A(소유자)·B
--   * 가계부 L2 "QA 자산 v4 C": 멤버 C — 권한 테스트(AP)용. 자산 1개("C통장")
--   * L1 자산 6개와 잔액 이력 (KST 시각 = 잔액)
--     1 A통장  입출금  A    09-15=3,000,000 → 10-10=2,000,000 → 11-05 10:00=2,500,000 → 11-05 18:00=2,700,000
--     2 B적금  적금    B    09-15=5,000,000 → 10-31 23:59:59=6,000,000
--     3 우리집 부동산  공동 09-15=300,000,000
--     4 주담대 대출    공동 09-15=200,000,000 → 11-01 00:00:00=199,000,000
--     5 A카드  카드값  A    10-10=1,000,000 (이때 생성)
--     6 B차    자동차  B    09-15=20,000,000, 11-06 00:00:01 보관
--   * 날짜를 옮기려면 c_shift_months 를 바꾼다 (예: 12월에 돌리면 1 → 10·11·12월 데이터)
--
-- 사용자: A·B·C 이메일로 auth.users 에서 찾는다(테스트 DB 앱에 한 번씩 로그인해 있어야 함). 없으면 QA_USER_NOT_FOUND.
-- 다시 실행하면 위 두 가계부(이름 + 만든 사람으로 식별)만 지우고 다시 만든다. 한 트랜잭션이라 실패하면 아무것도 바뀌지 않는다.

begin;

do $$
declare
  c_email_a      constant text := 'qa-a@example.com';   -- ← 테스트 계정으로 바꾼다
  c_email_b      constant text := 'qa-b@example.com';
  c_email_c      constant text := 'qa-c@example.com';
  c_shift_months constant int  := 0;
  c_l1           constant text := 'QA 자산 v4';
  c_l2           constant text := 'QA 자산 v4 C';

  v_a uuid; v_b uuid; v_c uuid;
  v_l1 uuid; v_l2 uuid;
  v_ma uuid; v_mb uuid; v_mc uuid;
  v_id uuid;
  v_base timestamptz := '2026-08-01 00:00:00+09';  -- 멤버 참여 시각
begin
  if coalesce(current_setting('banban.qa_seed', true), '') <> 'test-db-only' then
    raise exception 'QA_SEED_NOT_ALLOWED: 테스트 DB에서만 실행한다. 파일 머리말의 설정 방법 참고';
  end if;

  select id into v_a from auth.users where lower(email) = lower(c_email_a);
  select id into v_b from auth.users where lower(email) = lower(c_email_b);
  select id into v_c from auth.users where lower(email) = lower(c_email_c);
  if v_a is null or v_b is null or v_c is null then
    raise exception 'QA_USER_NOT_FOUND: A=% B=% C=% (테스트 앱에 한 번 로그인해야 함)',
      coalesce(v_a::text, c_email_a || ' 없음'), coalesce(v_b::text, c_email_b || ' 없음'), coalesce(v_c::text, c_email_c || ' 없음');
  end if;

  -- 기존 QA 가계부 지우기 (하위 멤버·자산·이력은 FK cascade)
  delete from public.ledger where (name = c_l1 and created_by = v_a) or (name = c_l2 and created_by = v_c);

  -- 가계부·멤버
  insert into public.ledger (name, created_by, created_at) values (c_l1, v_a, v_base) returning id into v_l1;
  insert into public.member (ledger_id, user_id, role, display_name, joined_at)
    values (v_l1, v_a, 'owner', 'A', v_base) returning id into v_ma;
  insert into public.member (ledger_id, user_id, role, display_name, joined_at)
    values (v_l1, v_b, 'member', 'B', v_base + interval '1 minute') returning id into v_mb;
  perform public.seed_ledger_defaults(v_l1);

  insert into public.ledger (name, created_by, created_at) values (c_l2, v_c, v_base) returning id into v_l2;
  insert into public.member (ledger_id, user_id, role, display_name, joined_at)
    values (v_l2, v_c, 'owner', 'C', v_base) returning id into v_mc;
  perform public.seed_ledger_defaults(v_l2);

  -- 자산·이력: 앱 트리거(보관 시각 = 지금, 이력 = 지금)를 잠시 끄고 시각을 직접 넣는다
  alter table public.asset disable trigger user;

  create temp table _qa (
    no int, name text, kind text, owner uuid, archived timestamptz, hist jsonb
  ) on commit drop;
  insert into _qa values
    (1, 'A통장',  'checking',           v_ma, null,
       '[["2026-09-15 09:00:00", 3000000], ["2026-10-10 09:00:00", 2000000], ["2026-11-05 10:00:00", 2500000], ["2026-11-05 18:00:00", 2700000]]'),
    (2, 'B적금',  'installment_saving', v_mb, null,
       '[["2026-09-15 09:00:00", 5000000], ["2026-10-31 23:59:59", 6000000]]'),
    (3, '우리집', 'real_estate',        null, null,
       '[["2026-09-15 09:00:00", 300000000]]'),
    (4, '주담대', 'loan',               null, null,
       '[["2026-09-15 09:00:00", 200000000], ["2026-11-01 00:00:00", 199000000]]'),
    (5, 'A카드',  'card_payable',       v_ma, null,
       '[["2026-10-10 09:00:00", 1000000]]'),
    (6, 'B차',    'vehicle',            v_mb, '2026-11-06 00:00:01+09',
       '[["2026-09-15 09:00:00", 20000000]]');

  -- KST 시각 문자열 → timestamptz (+ 월 이동)
  create temp table _qa_hist on commit drop as
  select q.no, q.name, q.kind, q.owner, q.archived + make_interval(months => c_shift_months) as archived,
         (h.v ->> 0)::timestamp at time zone 'Asia/Seoul' + make_interval(months => c_shift_months) as at,
         (h.v ->> 1)::bigint as balance,
         h.ord
  from _qa q, jsonb_array_elements(q.hist) with ordinality as h(v, ord);

  insert into public.asset (ledger_id, name, kind, owner_id, balance, archived_at, created_at, updated_at)
  select v_l1, q.name, q.kind, q.owner,
         (select h.balance from _qa_hist h where h.no = q.no order by h.at desc limit 1),
         (select max(h.archived) from _qa_hist h where h.no = q.no),
         (select min(h.at) from _qa_hist h where h.no = q.no),
         greatest((select max(h.at) from _qa_hist h where h.no = q.no),
                  coalesce((select max(h.archived) from _qa_hist h where h.no = q.no), '-infinity'))
  from _qa q order by q.no;

  -- 이력: 바꾼 사람 = 소유자(공동이면 A)
  insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by, changed_at)
  select a.id, v_l1, h.balance, coalesce(h.owner, v_ma), h.at
  from _qa_hist h join public.asset a on a.ledger_id = v_l1 and a.name = h.name
  order by h.at, h.no;

  -- L2: C 자산 1개 (권한 테스트용)
  insert into public.asset (ledger_id, name, kind, owner_id, balance, created_at, updated_at)
  values (v_l2, 'C통장', 'checking', v_mc, 1000000, v_base, v_base) returning id into v_id;
  insert into public.asset_balance_history (asset_id, ledger_id, balance, changed_by, changed_at)
  values (v_id, v_l2, 1000000, v_mc, v_base);

  alter table public.asset enable trigger user;

  raise notice 'QA v4 기준 데이터: L1=% (A=%, B=%), L2=% (C=%)', v_l1, v_ma, v_mb, v_l2, v_mc;
end;
$$;

-- 확인: 기대: L1 자산 6 / 보관 1 / 이력 11행, L2 자산 1 / 이력 1행
select l.name,
       (select count(*) from public.asset a where a.ledger_id = l.id) as assets,
       (select count(*) from public.asset a where a.ledger_id = l.id and a.archived_at is not null) as archived,
       (select count(*) from public.asset_balance_history h where h.ledger_id = l.id) as history_rows
from public.ledger l
where l.name in ('QA 자산 v4', 'QA 자산 v4 C')
order by l.name;

commit;
