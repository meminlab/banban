-- BANB-24 카테고리 아이콘
-- 1) category.icon: Lucide 아이콘 이름(kebab-case, 예: utensils-crossed). null 허용 = 앱이 대분류 아이콘 → 이름 첫 글자로 대신 그린다.
--    앱은 design.md 5.17 목록(70개)에 있는 이름만 그리고, 모르는 이름도 같은 방식으로 대신 그린다(깨지지 않게).
-- 2) 기본 카테고리 아이콘 매핑(design.md 4.1)을 함수 하나에 두고, 새 가계부 기본값과 기존 가계부 채우기에 같이 쓴다.
-- 3) 기존 가계부: 아이콘이 비어 있는 카테고리 중 기본값과 (종류, 대분류 이름, 소분류 이름)이 같은 것만 채운다.
--    사용자가 이름을 바꿨거나 직접 만든 카테고리는 비워 둔다(앱에서 대분류 아이콘/첫 글자로 보임).

alter table public.category
  add column icon text
  check (icon is null or (char_length(icon) <= 40 and icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));

-- 기본 카테고리 아이콘 (design.md 4.1). p_child = null 이면 대분류.
-- 소분류가 대분류와 같은 이름(소분류 없이 만든 대분류)이면 대분류 아이콘. 모르는 조합은 null.
create or replace function public.default_category_icon(p_type text, p_parent text, p_child text) returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_child is null or p_child = p_parent then (
      select v.icon from (values
        ('expense', '식비', 'utensils-crossed'),
        ('expense', '주거', 'house'),
        ('expense', '통신', 'smartphone'),
        ('expense', '교통', 'bus'),
        ('expense', '생활', 'shopping-basket'),
        ('expense', '쇼핑', 'shopping-bag'),
        ('expense', '건강', 'heart-pulse'),
        ('expense', '문화·여가', 'ticket'),
        ('expense', '경조사·선물', 'gift'),
        ('expense', '교육', 'graduation-cap'),
        ('expense', '보험', 'shield-check'),
        ('expense', '반려동물', 'paw-print'),
        ('expense', '육아', 'baby'),
        ('expense', '대출이자', 'percent'),
        ('expense', '기타', 'ellipsis'),
        ('income', '급여', 'banknote'),
        ('income', '상여', 'sparkles'),
        ('income', '부수입', 'coins'),
        ('income', '용돈', 'hand-coins'),
        ('income', '이자·배당', 'trending-up'),
        ('income', '기타', 'ellipsis'),
        ('saving', '적금', 'piggy-bank'),
        ('saving', '예금', 'landmark'),
        ('saving', '투자', 'chart-line'),
        ('saving', '청약', 'building-complex'),
        ('saving', '비상금', 'life-buoy'),
        ('saving', '기타', 'ellipsis')
      ) as v(type, parent, icon)
      where v.type = p_type and v.parent = p_parent)
    else (
      select v.icon from (values
        ('expense', '식비', '장보기', 'shopping-cart'),
        ('expense', '식비', '외식', 'utensils'),
        ('expense', '식비', '배달', 'bike'),
        ('expense', '식비', '카페/간식', 'coffee'),
        ('expense', '주거', '월세', 'key-round'),
        ('expense', '주거', '관리비', 'building'),
        ('expense', '주거', '공과금', 'zap'),
        ('expense', '통신', '휴대폰', 'smartphone'),
        ('expense', '통신', '인터넷', 'wifi'),
        ('expense', '통신', '구독', 'tv'),
        ('expense', '교통', '대중교통', 'tram-front'),
        ('expense', '교통', '주유', 'fuel'),
        ('expense', '교통', '주차', 'parking-meter'),
        ('expense', '교통', '택시', 'car-taxi-front'),
        ('expense', '생활', '생필품', 'spray-can'),
        ('expense', '생활', '가구/가전', 'sofa'),
        ('expense', '쇼핑', '의류', 'shirt'),
        ('expense', '쇼핑', '미용', 'scissors'),
        ('expense', '건강', '병원', 'hospital'),
        ('expense', '건강', '약국', 'pill'),
        ('expense', '건강', '운동', 'dumbbell'),
        ('expense', '문화·여가', '취미', 'palette'),
        ('expense', '문화·여가', '공연', 'drama'),
        ('expense', '문화·여가', '여행', 'plane')
      ) as v(type, parent, child, icon)
      where v.type = p_type and v.parent = p_parent and v.child = p_child)
  end;
$$;

-- 새 가계부 기본 카테고리: init.sql 과 같은 목록·순서 + 아이콘
create or replace function public.seed_ledger_defaults(p_ledger_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  -- 형식: type|대분류|소분류1,소분류2  (소분류가 없으면 대분류와 같은 이름 1개)
  v_defaults text[] := array[
    'expense|식비|장보기,외식,배달,카페/간식',
    'expense|주거|월세,관리비,공과금',
    'expense|통신|휴대폰,인터넷,구독',
    'expense|교통|대중교통,주유,주차,택시',
    'expense|생활|생필품,가구/가전',
    'expense|쇼핑|의류,미용',
    'expense|건강|병원,약국,운동',
    'expense|문화·여가|취미,공연,여행',
    'expense|경조사·선물|',
    'expense|교육|',
    'expense|보험|',
    'expense|반려동물|',
    'expense|육아|',
    'expense|대출이자|',
    'expense|기타|',
    'income|급여|',
    'income|상여|',
    'income|부수입|',
    'income|용돈|',
    'income|이자·배당|',
    'income|기타|',
    'saving|적금|',
    'saving|예금|',
    'saving|투자|',
    'saving|청약|',
    'saving|비상금|',
    'saving|기타|'
  ];
  v_row text;
  v_parts text[];
  v_children text[];
  v_parent_id uuid;
  v_order int := 0;
  v_child_order int;
  v_child text;
begin
  foreach v_row in array v_defaults loop
    v_parts := string_to_array(v_row, '|');
    v_order := v_order + 1;
    insert into public.category (ledger_id, type, parent_id, name, sort_order, icon)
    values (p_ledger_id, v_parts[1], null, v_parts[2], v_order,
            public.default_category_icon(v_parts[1], v_parts[2], null))
    returning id into v_parent_id;

    v_children := case when coalesce(v_parts[3], '') = '' then array[v_parts[2]]
                       else string_to_array(v_parts[3], ',') end;
    v_child_order := 0;
    foreach v_child in array v_children loop
      v_child_order := v_child_order + 1;
      insert into public.category (ledger_id, type, parent_id, name, sort_order, icon)
      values (p_ledger_id, v_parts[1], v_parent_id, v_child, v_child_order,
              public.default_category_icon(v_parts[1], v_parts[2], v_child));
    end loop;
  end loop;

  insert into public.pocket (ledger_id, name, scope, sort_order) values
    (p_ledger_id, '공동소비', 'shared', 1),
    (p_ledger_id, '개인용돈', 'personal', 2),
    (p_ledger_id, '여행', 'shared', 3),
    (p_ledger_id, '경조사비', 'shared', 4);
end;
$$;

-- 기존 가계부 채우기 (아이콘이 비어 있는 것만, 이름이 기본값과 같은 것만)
update public.category c
   set icon = public.default_category_icon(c.type, c.name, null)
 where c.parent_id is null and c.icon is null;

update public.category c
   set icon = public.default_category_icon(c.type, p.name, c.name)
  from public.category p
 where c.parent_id = p.id and c.icon is null;

revoke execute on function public.default_category_icon(text, text, text) from public, anon, authenticated;
revoke execute on function public.seed_ledger_defaults(uuid) from public, anon, authenticated;
