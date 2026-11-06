-- BANB-23 샘플 가계부 (화면 확인용)
--
-- 하는 일
--   * "샘플 가계부"(이름 + 소유자로 식별) 하나만 지우고 다시 만든다. 다른 가계부·데이터는 건드리지 않는다.
--   * 멤버: 소유자(c_owner_email) + 짝꿍(c_partner_email). auth.users 에서 이메일로 찾는다.
--   * 최근 3개월(이번 달 포함) 지출·수입·저축 내역 + 자산 7개.
--     이번 달은 오늘(KST)까지의 날짜만 넣는다(미래 날짜 내역 없음).
--   * 같은 날 다시 돌리면 같은 데이터가 나온다(setseed). 날짜는 실행일 기준이라 언제 돌려도 "최근 3개월"이다.
--
-- 실행 (psql, DB 관리자 계정):  psql "<접속 문자열>" -v ON_ERROR_STOP=1 -f supabase/seed/sample_ledger.sql
--   또는 Supabase SQL Editor 에 파일 전체를 붙여넣고 Run (psql 전용 명령 없음)
-- 실패하면 전체가 취소된다(한 트랜잭션). 1인 가계부 상한(5개)에 걸리면 SAMPLE_LEDGER_LIMIT 오류로 멈춘다.
-- 지우기만 하려면 README "샘플 가계부" 절 참고.

begin;

create temp table _seed_plan (
  d          date    not null,
  type       text    not null,
  cat_parent text    not null,
  cat_child  text    not null,
  pocket     text,
  who        text    not null check (who in ('A', 'B')),  -- A = 소유자, B = 짝꿍
  amount     bigint  not null,
  is_fixed   boolean not null default false,
  memo       text
) on commit drop;

do $$
declare
  c_name          constant text := '샘플 가계부';
  c_owner_email   constant text := 'kicmi032@gmail.com';
  c_partner_email constant text := 'opiw0101@gmail.com';

  -- 경계 사례: 메모 100자(최대)
  c_long_memo constant text := left(
    '거실 냉장고 교체. 10년 쓴 냉장고가 고장 나서 급하게 바꿨다. 카드 12개월 무이자 할부, 배송·설치비 포함, 기존 제품 무료 수거, 연장 보증 5년 추가 가입함. 다음 달부터 할부 시작',
    100);

  -- 변동 지출 템플릿: 대분류|소분류|주머니(P=쓴 사람 개인 주머니)|최소|최대|메모 후보(; 구분, 빈 칸 = 메모 없음)
  -- 같은 줄을 여러 번 넣어 자주 쓰는 항목의 비중을 높인다
  c_tpl constant text[] := array[
    '식비|장보기|공동소비|18000|160000|이마트;;쿠팡 프레시;동네 마트;',
    '식비|장보기|공동소비|9000|60000|;과일;',
    '식비|외식|공동소비|18000|95000|;주말 브런치;;고기 외식',
    '식비|외식|P|9000|16000|점심;;',
    '식비|배달|공동소비|16000|42000|치킨;;마라탕;피자',
    '식비|카페/간식|P|4500|14000|;;',
    '식비|카페/간식|P|3000|9000|;편의점',
    '교통|대중교통|P|1500|3000|;',
    '교통|택시|P|6800|23000|;야근 후 택시',
    '교통|주유|공동소비|55000|82000|;',
    '교통|주차|공동소비|3000|12000|;',
    '생활|생필품|공동소비|8000|55000|다이소;휴지·세제;',
    '쇼핑|의류|P|29000|129000|;가을 니트',
    '쇼핑|미용|P|15000|85000|미용실;',
    '건강|병원|P|5500|45000|치과 정기검진;',
    '건강|약국|P|3500|18000|;',
    '건강|운동|P|10000|30000|요가 1회권;',
    '문화·여가|취미|P|12000|60000|;책',
    '문화·여가|공연|공동소비|28000|140000|영화;뮤지컬',
    '반려동물|반려동물|공동소비|15000|70000|사료;간식;'
  ];

  v_owner   uuid;
  v_partner uuid;
  v_name_a  text;
  v_name_b  text;
  v_count   int;
  v_ledger  uuid;
  v_ma      uuid;
  v_mb      uuid;
  v_today   date := (now() at time zone 'Asia/Seoul')::date;
  v_first   date := (date_trunc('month', v_today) - interval '2 months')::date;
  v_start   date;
  v_dim     int;   -- 그 달의 날 수
  v_upto    int;   -- 그 달에 내역을 넣을 마지막 날(이번 달은 오늘)
  v_n       int;
  v_m       int;
  v_i       int;
  v_parts   text[];
  v_memos   text[];
  v_who     text;
  v_amt     bigint;
  v_planned int;
  v_inserted int;
begin
  perform setseed(0.23);

  -- 1. 사용자 찾기
  select id into v_owner from auth.users where lower(email) = lower(c_owner_email);
  select id into v_partner from auth.users where lower(email) = lower(c_partner_email);
  if v_owner is null or v_partner is null then
    raise exception 'SAMPLE_USER_NOT_FOUND: % / %',
      case when v_owner is null then c_owner_email || ' 없음' else 'ok' end,
      case when v_partner is null then c_partner_email || ' 없음' else 'ok' end;
  end if;

  -- 가계부 안 이름: 그 사람이 가장 최근에 쓴 멤버 이름 → 프로필 이름 → 이메일 앞부분 (20자 이내)
  select left(btrim(coalesce(
           (select m.display_name from public.member m where m.user_id = v_owner order by m.joined_at desc limit 1),
           (select p.display_name from public.profile p where p.id = v_owner),
           split_part(c_owner_email, '@', 1))), 20)
    into v_name_a;
  select left(btrim(coalesce(
           (select m.display_name from public.member m where m.user_id = v_partner order by m.joined_at desc limit 1),
           (select p.display_name from public.profile p where p.id = v_partner),
           split_part(c_partner_email, '@', 1))), 20)
    into v_name_b;

  -- 2. 기존 샘플 가계부 지우기 (이름 + 소유자로만 식별, 하위 데이터는 FK cascade)
  delete from public.ledger where name = c_name and created_by = v_owner;
  get diagnostics v_count = row_count;
  raise notice '기존 샘플 가계부 삭제: %개', v_count;

  -- 3. 1인 가계부 상한 확인 (트리거도 막지만, 원인이 보이게 먼저 검사)
  select count(*) into v_count from public.member where user_id = v_owner and left_at is null;
  if v_count >= public.user_ledger_limit() then
    raise exception 'SAMPLE_LEDGER_LIMIT: % 은(는) 이미 가계부 %개 (상한 %)', c_owner_email, v_count, public.user_ledger_limit();
  end if;
  select count(*) into v_count from public.member where user_id = v_partner and left_at is null;
  if v_count >= public.user_ledger_limit() then
    raise exception 'SAMPLE_LEDGER_LIMIT: % 은(는) 이미 가계부 %개 (상한 %)', c_partner_email, v_count, public.user_ledger_limit();
  end if;

  -- 4. 가계부 + 멤버 + 기본 카테고리·주머니
  insert into public.ledger (name, created_by, created_at)
  values (c_name, v_owner, v_first::timestamp at time zone 'Asia/Seoul')
  returning id into v_ledger;
  insert into public.member (ledger_id, user_id, role, display_name, joined_at)
  values (v_ledger, v_owner, 'owner', v_name_a, v_first::timestamp at time zone 'Asia/Seoul')
  returning id into v_ma;
  insert into public.member (ledger_id, user_id, role, display_name, joined_at)
  values (v_ledger, v_partner, 'member', v_name_b, (v_first + 1)::timestamp at time zone 'Asia/Seoul')
  returning id into v_mb;
  perform public.seed_ledger_defaults(v_ledger);

  -- 5. 내역 계획 (월별)
  for v_m in 0..2 loop
    v_start := (v_first + make_interval(months => v_m))::date;
    v_dim := extract(day from (v_start + interval '1 month' - interval '1 day'))::int;
    v_upto := case when v_m = 2 then extract(day from v_today)::int else v_dim end;

    -- 고정지출 (월세·관리비·통신비·보험·구독)
    insert into _seed_plan (d, type, cat_parent, cat_child, pocket, who, amount, is_fixed, memo) values
      (v_start + 0,  'expense', '주거', '월세',   '공동소비', 'A', 850000, true, '집주인 계좌이체'),
      (v_start + 4,  'expense', '주거', '관리비', '공동소비', 'B', 168000 + v_m * 12500, true, null),
      (v_start + 2,  'expense', '통신', '인터넷', '공동소비', 'B', 33000,  true, null),
      (v_start + 2,  'expense', '통신', '휴대폰', '개인용돈', 'A', 59000,  true, null),
      (v_start + 2,  'expense', '통신', '휴대폰', '개인용돈', 'B', 45000,  true, null),
      (v_start + 3,  'expense', '통신', '구독',   '공동소비', 'A', 17000,  true, '넷플릭스'),
      (v_start + 3,  'expense', '통신', '구독',   '개인용돈', 'B', 14900,  true, '유튜브 프리미엄'),
      (v_start + 1,  'expense', '보험', '보험',   '개인용돈', 'A', 112000, true, '실손+종신'),
      (v_start + 1,  'expense', '보험', '보험',   '개인용돈', 'B', 87000,  true, null),
      (v_start + 19, 'expense', '주거', '공과금', '공동소비', 'A', 58000 + floor(random() * 37000)::bigint, false, '전기·가스');

    -- 수입: 두 사람 월급 + 부수입
    insert into _seed_plan (d, type, cat_parent, cat_child, pocket, who, amount, memo) values
      (v_start + 4,  'income', '급여',   '급여',   null, 'A', 3850000, null),
      (v_start + 24, 'income', '급여',   '급여',   null, 'B', 3200000, '월급'),
      (v_start + 13 + v_m * 3, 'income', '부수입', '부수입', null, case when v_m = 1 then 'A' else 'B' end,
        (array[45000, 120000, 32000])[v_m + 1], (array['중고거래 판매', '블로그 광고 수익', null])[v_m + 1]);

    -- 저축: 적금·청약 (+ 투자/비상금)
    insert into _seed_plan (d, type, cat_parent, cat_child, pocket, who, amount, memo) values
      (v_start + 5,  'saving', '적금', '적금', null, 'A', 500000, '내집마련 적금'),
      (v_start + 5,  'saving', '청약', '청약', null, 'B', 100000, null),
      (v_start + 25, 'saving', '투자', '투자', null, 'A', 300000, '연금저축 ETF');

    -- 달마다 다른 것 (경계 사례 포함)
    if v_m = 0 then
      insert into _seed_plan (d, type, cat_parent, cat_child, pocket, who, amount, memo) values
        (v_start + 20, 'income',  '상여',         '상여',         null,      'A', 4000000, '명절 상여'),
        (v_start + 9,  'expense', '문화·여가',    '여행',         '여행',     'B', 1248000, '제주 3박 4일 항공·숙소'),
        (v_start + 11, 'expense', '문화·여가',    '여행',         '여행',     'A', 386000,  '렌터카·식비'),
        (v_start + 16, 'expense', '경조사·선물',  '경조사·선물',  '경조사비', 'A', 100000,  '대학 동기 결혼식 축의금'),
        (v_start + 17, 'income',  '부수입',       '부수입',       null,      'A', 15000,   '설문조사 리워드'),
        (v_start + 22, 'saving',  '비상금',       '비상금',       null,      'B', 200000,  null);
    elsif v_m = 1 then
      insert into _seed_plan (d, type, cat_parent, cat_child, pocket, who, amount, memo) values
        (v_start + 7,  'expense', '생활',         '가구/가전',    '공동소비', 'A', 2890000, c_long_memo),
        (v_start + 14, 'expense', '경조사·선물',  '경조사·선물',  '경조사비', 'B', 50000,   null),
        (v_start + 21, 'expense', '경조사·선물',  '경조사·선물',  '경조사비', 'A', 150000,  '어머니 생신 선물'),
        (v_start + 27, 'income',  '이자·배당',    '이자·배당',    null,      'A', 18420,   'ETF 분배금'),
        (v_start + 12, 'expense', '생활',         '생필품',       '공동소비', 'B', 100,     '봉투값');
    else
      insert into _seed_plan (d, type, cat_parent, cat_child, pocket, who, amount, memo) values
        (v_start + 2,  'expense', '경조사·선물',  '경조사·선물',  '경조사비', 'B', 100000,  '회사 동료 결혼식'),
        (v_start + 0,  'saving',  '비상금',       '비상금',       null,      'A', 150000,  null);
    end if;

    -- 변동 지출: 한 달 38건, 이번 달은 지난 날 수에 비례(최소 6건)
    v_n := case when v_m = 2 then greatest(6, round(38.0 * v_upto / v_dim)::int) else 38 end;
    for v_i in 1..v_n loop
      v_parts := string_to_array(c_tpl[1 + floor(random() * array_length(c_tpl, 1))::int], '|');
      v_memos := string_to_array(v_parts[6], ';');
      v_who := case when random() < 0.5 then 'A' else 'B' end;
      v_amt := v_parts[4]::bigint + floor(random() * (v_parts[5]::bigint - v_parts[4]::bigint + 1))::bigint;
      v_amt := greatest(100, round(v_amt / 100.0)::bigint * 100);  -- 100원 단위
      insert into _seed_plan (d, type, cat_parent, cat_child, pocket, who, amount, memo)
      values (
        v_start + floor(random() * v_upto)::int,
        'expense', v_parts[1], v_parts[2],
        case when v_parts[3] = 'P' then '개인용돈' else v_parts[3] end,
        v_who, v_amt,
        nullif(v_memos[1 + floor(random() * array_length(v_memos, 1))::int], '')
      );
    end loop;
  end loop;

  -- 미래 날짜는 넣지 않는다
  delete from _seed_plan where d > v_today;
  select count(*) into v_planned from _seed_plan;

  -- 6. 내역 저장 (작성자 = 마지막 수정자 = 쓴 사람)
  insert into public.transaction
    (ledger_id, type, amount, occurred_on, category_id, pocket_id, spender_id, is_fixed, memo, source, created_by, updated_by)
  select v_ledger, p.type, p.amount, p.d, c.id, pk.id,
         case p.who when 'A' then v_ma else v_mb end,
         p.is_fixed, p.memo, 'manual',
         case p.who when 'A' then v_ma else v_mb end,
         case p.who when 'A' then v_ma else v_mb end
  from _seed_plan p
  join public.category par on par.ledger_id = v_ledger and par.type = p.type and par.parent_id is null and par.name = p.cat_parent
  join public.category c   on c.ledger_id = v_ledger and c.parent_id = par.id and c.name = p.cat_child
  left join public.pocket pk on pk.ledger_id = v_ledger and pk.name = p.pocket
  order by p.d;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_planned then
    raise exception 'SAMPLE_PLAN_MISMATCH: 계획 %건 중 %건만 저장 (카테고리·주머니 이름 확인)', v_planned, v_inserted;
  end if;

  -- 7. 자산: 종류 6가지 모두, 공동/개인 섞어서, 하나는 잔액 0, 하나는 이름 20자
  insert into public.asset (ledger_id, name, kind, owner_id, balance, memo) values
    (v_ledger, '생활비 통장',                 'checking',           null, 2350000,  '공과금·카드값 자동이체'),
    (v_ledger, '월급 통장',                   'checking',           v_ma, 1180000,  null),
    (v_ledger, '내집마련 적금',               'installment_saving', null, 6000000,  '24개월 중 12회차'),
    (v_ledger, '1년 정기예금',                'deposit',            v_mb, 15000000, '내년 3월 만기'),
    (v_ledger, '노후대비 연금저축펀드 ETF 투자계좌', 'investment',   v_ma, 8420000,  null),
    (v_ledger, '비상금 현금',                 'cash',               null, 300000,   '서랍 봉투'),
    (v_ledger, '친구에게 빌려준 돈',          'other',              v_mb, 0,        '다 받음');

  raise notice '샘플 가계부 생성: ledger_id=%, 내역 %건, 자산 7개, 기간 % ~ %', v_ledger, v_inserted, v_first, v_today;
end;
$$;

commit;
