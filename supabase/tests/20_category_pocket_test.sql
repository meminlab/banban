-- 카테고리·주머니 관리 규칙 테스트 (BANB-6). 실패하면 예외로 중단된다.
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK → 실제 Supabase SQL Editor에서도 그대로 실행 가능.
begin;
-- 사용자: A(주인), B(멤버), X(외부인)

create schema test6;
grant usage on schema test6 to authenticated;

create function test6.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" BUT SUCCEEDED: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' or sqlerrm not like '%' || p_pattern || '%' then
    raise exception 'TEST FAILED: % -> got "%"', p_sql, sqlerrm;
  end if;
end $$;

create function test6.expect_count(p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  if v <> p_expected then
    raise exception 'TEST FAILED: % -> expected % rows, got %', p_sql, p_expected, v;
  end if;
end $$;

create function test6.expect_affected(p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  if v <> p_expected then
    raise exception 'TEST FAILED: % -> expected % affected, got %', p_sql, p_expected, v;
  end if;
end $$;
grant execute on all functions in schema test6 to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006a0', 'a6@test'),
  ('00000000-0000-0000-0000-0000000006b0', 'b6@test'),
  ('00000000-0000-0000-0000-0000000006f0', 'x6@test');

create table test6.ctx (key text primary key, val uuid);
grant all on test6.ctx to authenticated;

-- ── 준비: A가 가계부를 만들고 B가 참여
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006a0';
insert into test6.ctx values ('ledger', public.create_ledger('카테고리테스트', 'A'));
insert into public.invite (ledger_id) select val from test6.ctx where key = 'ledger';
reset role;
-- 초대 코드를 세션 설정에 담아 B에게 넘긴다 (B는 참여 전이라 invite를 읽을 수 없음)
select set_config('test6.code', (select code from public.invite i join test6.ctx c on c.key = 'ledger'
  and i.ledger_id = c.val where not i.is_revoked), true);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006b0';
select public.join_ledger(current_setting('test6.code'), 'B');
reset role;
select test6.expect_count($$select * from public.member m, test6.ctx c
  where c.key = 'ledger' and m.ledger_id = c.val and m.left_at is null$$, 2);

-- 기본값은 같은 이름 소분류뿐이라(BANB-36) 규칙 확인용 소분류 2개를 식비 아래에 둔다
insert into public.category (ledger_id, type, parent_id, name, sort_order)
select p.ledger_id, 'expense', p.id, v.n, v.o from public.category p, (values ('외식', 1), ('배달', 2)) v(n, o)
 where p.type = 'expense' and p.name = '식비' and p.parent_id is null and p.ledger_id = (select val from test6.ctx where key = 'ledger');
insert into test6.ctx select 'used_child', id from public.category c
  where c.name = '외식' and c.ledger_id = (select val from test6.ctx where key = 'ledger');
insert into test6.ctx select 'unused_child', id from public.category c
  where c.name = '배달' and c.ledger_id = (select val from test6.ctx where key = 'ledger');
insert into test6.ctx select 'food', id from public.category c
  where c.name = '식비' and c.parent_id is null and c.ledger_id = (select val from test6.ctx where key = 'ledger');
insert into test6.ctx select 'pocket', id from public.pocket p
  where p.name = '개인용돈' and p.ledger_id = (select val from test6.ctx where key = 'ledger');
insert into test6.ctx select 'member_a', id from public.member m
  where m.user_id = '00000000-0000-0000-0000-0000000006a0';
create view test6.v as select
  (select val from test6.ctx where key = 'ledger') ledger,
  (select val from test6.ctx where key = 'used_child') used_child,
  (select val from test6.ctx where key = 'unused_child') unused_child,
  (select val from test6.ctx where key = 'food') food,
  (select val from test6.ctx where key = 'pocket') pocket,
  (select val from test6.ctx where key = 'member_a') ma;
grant select on test6.v to authenticated;

-- ── 1. 기본 카테고리·주머니가 모두 있다 (이름까지)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006a0';
select test6.expect_count($$select * from public.pocket where (name, scope) in
  (('공동소비','shared'),('개인용돈','personal'),('여행','shared'),('경조사비','shared')) and not is_hidden$$, 4);
select test6.expect_count($$select * from public.category where parent_id is null and type = 'expense'$$, 12);
select test6.expect_count($$select * from public.category where parent_id is null and type = 'income'$$, 4);
select test6.expect_count($$select * from public.category where parent_id is null and type = 'saving'$$, 4);
-- 대분류마다 같은 이름 소분류 1개
select test6.expect_count($$select * from public.category p join public.category c on c.parent_id = p.id
  where p.name = '경조사·선물' and c.name = '경조사·선물'$$, 1);

-- ── 2. 관리 동작: 추가·이름 변경·순서 변경·숨김 (B가 해도 A에게 보인다)
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006b0';
insert into public.category (ledger_id, type, parent_id, name, sort_order)
  select ledger, 'expense', null, '술', 16 from test6.v;
insert into public.category (ledger_id, type, parent_id, name, sort_order)
  select ledger, 'expense', (select id from public.category where name = '술' and parent_id is null), '술', 1 from test6.v;
select test6.expect_affected($$update public.category set name = '바깥밥' where id = (select used_child from test6.v)$$, 1);
select test6.expect_affected($$update public.category set sort_order = 9 where id = (select unused_child from test6.v)$$, 1);
select test6.expect_affected($$update public.category set is_hidden = true where id = (select unused_child from test6.v)$$, 1);
insert into public.pocket (ledger_id, name, scope, sort_order) select ledger, '취미', 'personal', 5 from test6.v;
select test6.expect_affected($$update public.pocket set scope = 'shared', name = '용돈' where id = (select pocket from test6.v)$$, 1);
select test6.expect_affected($$update public.pocket set is_hidden = true where name = '여행'$$, 1);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006a0';
select test6.expect_count($$select * from public.category where name = '바깥밥'$$, 1);
select test6.expect_count($$select * from public.category c, test6.v where c.id = v.unused_child and c.is_hidden and c.sort_order = 9$$, 1);
select test6.expect_count($$select * from public.category where name = '술'$$, 2);
select test6.expect_count($$select * from public.pocket where name = '용돈' and scope = 'shared'$$, 1);
select test6.expect_count($$select * from public.pocket where name = '취미' and scope = 'personal'$$, 1);
select test6.expect_count($$select * from public.pocket where name = '여행' and is_hidden$$, 1);

-- 이름 1~20자, 공백만 불가
select test6.expect_error($$update public.category set name = '   ' where id = (select food from test6.v)$$, 'check constraint');
select test6.expect_error($$update public.category set name = repeat('가', 21) where id = (select food from test6.v)$$, 'check constraint');
select test6.expect_affected($$update public.category set name = repeat('가', 20) where id = (select food from test6.v)$$, 1);
select test6.expect_error($$update public.pocket set name = '' where id = (select pocket from test6.v)$$, 'check constraint');
select test6.expect_error($$insert into public.pocket (ledger_id, name, scope) select ledger, repeat('a', 21), 'shared' from test6.v$$, 'check constraint');
select test6.expect_error($$update public.pocket set scope = 'mine' where id = (select pocket from test6.v)$$, 'check constraint');

-- ── 3. N1: 내역에 쓰인 소분류는 대분류로 못 바꾼다
insert into public.transaction (ledger_id, type, amount, category_id, pocket_id, spender_id)
  select ledger, 'expense', 8000, used_child, pocket, ma from test6.v;
select test6.expect_error($$update public.category set parent_id = null where id = (select used_child from test6.v)$$,
  'CATEGORY_IN_USE_MUST_STAY_CHILD');
-- 숨김 처리는 허용, 숨겨도 지난 내역의 이름은 그대로 조회된다
select test6.expect_affected($$update public.category set is_hidden = true where id = (select used_child from test6.v)$$, 1);
select test6.expect_affected($$update public.pocket set is_hidden = true where id = (select pocket from test6.v)$$, 1);
select test6.expect_count($$select * from public.transaction t
  join public.category c on c.id = t.category_id
  join public.pocket p on p.id = t.pocket_id
  where c.name = '바깥밥' and c.is_hidden and p.name = '용돈' and p.is_hidden$$, 1);
-- 다른 대분류 아래로 옮기기는 허용 (여전히 소분류)
select test6.expect_affected($$update public.category set parent_id =
  (select id from public.category where name = '술' and parent_id is null) where id = (select used_child from test6.v)$$, 1);
-- 내역에 안 쓰인 소분류는 DB에서 막지 않는다 (화면에서 제공하지 않음)
select test6.expect_affected($$update public.category set parent_id = null where id = (select unused_child from test6.v)$$, 1);
-- 완료 기준: 내역의 category가 대분류를 가리키는 행 0건
select test6.expect_count($$select * from public.transaction t join public.category c on c.id = t.category_id
  where c.parent_id is null$$, 0);

-- ── 4. 외부인은 보지도 바꾸지도 못한다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006f0';
select test6.expect_count('select * from public.category', 0);
select test6.expect_count('select * from public.pocket', 0);
select test6.expect_affected($$update public.category set is_hidden = false$$, 0);
select test6.expect_affected($$update public.pocket set name = '해킹'$$, 0);
select test6.expect_error($$insert into public.pocket (ledger_id, name, scope) select ledger, '해킹', 'shared' from test6.v$$,
  'row-level security');
reset role;

select 'category/pocket tests passed' as result;

rollback;
