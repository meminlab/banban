-- BANB-36 적용 전/후 비교용 조회 (읽기 전용, 운영 SQL Editor·psql 어디서나)
-- 마이그레이션 20261109000000_category_simplify 적용 직전·직후에 각각 실행해 결과가 같은지 비교한다.
--   1) 가계부·월·종류별 내역 수·합계 (홈 요약·가계부 탭 합계의 바탕)
--   2) 가계부·월·종류·대분류별 합계 (홈 "어디에 썼나", 가계부 탭 대분류 필터)
--   3) 내역에 쓰인 카테고리의 이름·숨김 (쓰인 것은 그대로 보여야 한다)
-- 결과는 개인정보 없이 집계·카테고리 이름만 나온다(메모·금액 개별 행 없음).
select 'month_total' as kind, t.ledger_id::text as ledger, to_char(t.occurred_on, 'YYYY-MM') as month, t.type,
       null::text as category, count(*) as n, sum(t.amount) as total
  from public.transaction t
 group by t.ledger_id, to_char(t.occurred_on, 'YYYY-MM'), t.type
union all
select 'month_parent', t.ledger_id::text, to_char(t.occurred_on, 'YYYY-MM'), t.type,
       p.name, count(*), sum(t.amount)
  from public.transaction t
  join public.category c on c.id = t.category_id
  join public.category p on p.id = c.parent_id
 group by t.ledger_id, to_char(t.occurred_on, 'YYYY-MM'), t.type, p.name
union all
select 'used_category', c.ledger_id::text, null, c.type,
       p.name || ' > ' || c.name || case when c.is_hidden or p.is_hidden then ' (숨김)' else '' end, count(t.id), null
  from public.category c
  join public.category p on p.id = c.parent_id
  join public.transaction t on t.category_id = c.id
 group by c.ledger_id, c.type, p.name, c.name, c.is_hidden, p.is_hidden
order by 1, 2, 3, 4, 5;
