-- BANB-42 일정: 같은 가계부 4명이 서로의 일정을 보고, 다른 가계부 사람은 못 본다 · 작성자/수정자 서버 기록
--   · 반복·음력·시각 규칙 · D-day 고정 2개 · 함께한 날(together_since)
-- 한 트랜잭션으로 실행하고 마지막에 ROLLBACK
-- 사용자: A·B·C·D (같은 가계부 L1, 4명 = 인원 상한), X (다른 가계부 LX)
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
create function test.v(p_key text) returns uuid language sql stable as $$ select val::uuid from test.ctx where key = p_key $$;
grant execute on function test.v(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008a1', 'a@event.test', '{"full_name": "에이"}'),
  ('00000000-0000-0000-0000-0000000008b1', 'b@event.test', '{"full_name": "비"}'),
  ('00000000-0000-0000-0000-0000000008c1', 'c@event.test', '{"full_name": "씨"}'),
  ('00000000-0000-0000-0000-0000000008d1', 'd@event.test', '{"full_name": "디"}'),
  ('00000000-0000-0000-0000-0000000008f1', 'x@event.test', '{"full_name": "엑스"}');

-- ── 0. 스키마·권한 모양
select test.expect_count($$select 1 from pg_class where oid = 'public.event'::regclass and relrowsecurity$$, 1);
select test.expect_count($$select 1 where not has_table_privilege('anon', 'public.event', 'select')$$, 1);
select test.expect_count($$select 1 where has_table_privilege('authenticated', 'public.event', 'select,insert,update,delete')$$, 1);
select test.expect_count($$select * from pg_policies where schemaname = 'public' and tablename = 'event'$$, 1);
select test.expect_count($$select 1 where not has_function_privilege('authenticated', 'public.event_before_write()', 'execute')$$, 1);
select test.expect_count($$select 1 where has_column_privilege('authenticated', 'public.ledger', 'together_since', 'update')
  and not has_column_privilege('authenticated', 'public.ledger', 'member_limit', 'update')$$, 1);

-- 가계부 L1(A·B·C·D), LX(X)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
insert into test.ctx values ('l1', public.create_ledger('일정 L1', '에이')::text);
insert into public.invite (ledger_id) values (test.v('l1'));
insert into test.ctx values ('code', (select code from public.invite where ledger_id = test.v('l1') and is_revoked = false));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
select public.join_ledger((select val from test.ctx where key = 'code'), '비');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008c1';
select public.join_ledger((select val from test.ctx where key = 'code'), '씨');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008d1';
select public.join_ledger((select val from test.ctx where key = 'code'), '디');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008f1';
insert into test.ctx values ('lx', public.create_ledger('일정 LX', '엑스')::text);
reset role;
insert into test.ctx select 'm_' || m.display_name, m.id::text from public.member m where m.ledger_id = test.v('l1');
insert into test.ctx select 'm_x', m.id::text from public.member m where m.ledger_id = test.v('lx');
set role authenticated;

-- ── 1. 4명이 각각 일정을 만든다 (작성자는 보낸 값과 상관없이 로그인한 사람)
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
insert into public.event (ledger_id, title, kind, event_date, created_by, updated_by)
  values (test.v('l1'), '결혼기념일', 'anniversary', '2020-06-12', test.v('m_비'), test.v('m_비'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
insert into public.event (ledger_id, title, kind, event_date, all_day, start_time, repeat, target_member_id, created_by, updated_by)
  values (test.v('l1'), '요가', 'appointment', '2026-11-02', false, '19:00', 'weekly', test.v('m_비'), test.v('m_비'), test.v('m_비'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008c1';
insert into public.event (ledger_id, title, kind, event_date, repeat, created_by, updated_by)
  values (test.v('l1'), '카드값', 'bill_day', '2026-01-31', 'monthly', test.v('m_씨'), test.v('m_씨'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008d1';
insert into public.event (ledger_id, title, kind, event_date, repeat, lunar_month, lunar_day, created_by, updated_by)
  values (test.v('l1'), '아버님 제사', 'anniversary', '2026-11-11', 'yearly_lunar', 10, 3, test.v('m_디'), test.v('m_디'));

-- 네 명 모두 4건을 본다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select test.expect_count($$select * from public.event$$, 4);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
select test.expect_count($$select * from public.event$$, 4);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008c1';
select test.expect_count($$select * from public.event$$, 4);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008d1';
select test.expect_count($$select * from public.event$$, 4);
-- 작성자 = 만든 사람 (A 가 B 로 위장해 보낸 값은 무시)
select test.expect_count($$select * from public.event where title = '결혼기념일' and created_by = test.v('m_에이') and updated_by = test.v('m_에이')$$, 1);
select test.expect_count($$select * from public.event where created_by = updated_by$$, 4);

-- ── 2. 다른 가계부 사람(X)은 못 보고, 못 쓰고, 못 고치고, 못 지운다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008f1';
select test.expect_count($$select * from public.event$$, 0);
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, created_by, updated_by)
  values (test.v('l1'), '침입', 'other', '2026-11-09', test.v('m_x'), test.v('m_x'))$$, 'row-level security');
update public.event set title = '해킹' where ledger_id = test.v('l1');
delete from public.event where ledger_id = test.v('l1');
-- X 가 자기 가계부 일정에 L1 멤버를 대상으로 지정할 수 없다 (복합 FK)
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, target_member_id, created_by, updated_by)
  values (test.v('lx'), '남의 멤버', 'other', '2026-11-09', test.v('m_에이'), test.v('m_x'), test.v('m_x'))$$, 'foreign key');
-- 일정을 다른 가계부로 옮길 수 없다
insert into public.event (ledger_id, title, kind, event_date, created_by, updated_by)
  values (test.v('lx'), 'X 일정', 'other', '2026-11-09', test.v('m_x'), test.v('m_x'));
select test.expect_error($$update public.event set ledger_id = test.v('l1') where title = 'X 일정'$$, 'EVENT_LEDGER_IMMUTABLE');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select test.expect_count($$select * from public.event where title in ('결혼기념일', '요가', '카드값', '아버님 제사')$$, 4);
select test.expect_count($$select * from public.event where title = '해킹'$$, 0);
-- A 가 L1 일정을 LX 로 옮기려 해도 막힌다 (트리거가 먼저 막는다. 정책으로도 막힘)
select test.expect_error($$update public.event set ledger_id = test.v('lx') where title = '요가'$$, 'EVENT_LEDGER_IMMUTABLE');
-- 비로그인은 아무것도 못 본다
reset role;
set role anon;
select test.expect_error($$select * from public.event$$, 'permission denied');
reset role;
set role authenticated;

-- ── 3. 수정: 수정자는 고친 사람, 작성자·만든 시각은 그대로
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008c1';
update public.event set title = '결혼기념일 🎉', created_by = test.v('m_디') where title = '결혼기념일';
select test.expect_count($$select * from public.event where title = '결혼기념일 🎉' and created_by = test.v('m_에이') and updated_by = test.v('m_씨')$$, 1);

-- ── 4. 값 규칙
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, created_by, updated_by)
  values (test.v('l1'), '   ', 'other', '2026-11-09', test.v('m_씨'), test.v('m_씨'))$$, 'check constraint');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, created_by, updated_by)
  values (test.v('l1'), repeat('가', 21), 'other', '2026-11-09', test.v('m_씨'), test.v('m_씨'))$$, 'check constraint');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, created_by, updated_by)
  values (test.v('l1'), '종류', 'birthday', '2026-11-09', test.v('m_씨'), test.v('m_씨'))$$, 'check constraint');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, repeat, created_by, updated_by)
  values (test.v('l1'), '반복', 'other', '2026-11-09', 'daily', test.v('m_씨'), test.v('m_씨'))$$, 'check constraint');
-- 종일인데 시각 / 종일 아닌데 시각 없음
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, all_day, start_time, created_by, updated_by)
  values (test.v('l1'), '시각', 'other', '2026-11-09', true, '10:00', test.v('m_씨'), test.v('m_씨'))$$, 'event_time_rule');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, all_day, created_by, updated_by)
  values (test.v('l1'), '시각', 'other', '2026-11-09', false, test.v('m_씨'), test.v('m_씨'))$$, 'event_time_rule');
-- 음력: 기념일 + 음력 매년 + 월 1~12·일 1~30 일 때만
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, repeat, created_by, updated_by)
  values (test.v('l1'), '음력', 'anniversary', '2026-11-11', 'yearly_lunar', test.v('m_씨'), test.v('m_씨'))$$, 'event_lunar_rule');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, repeat, lunar_month, lunar_day, created_by, updated_by)
  values (test.v('l1'), '음력', 'appointment', '2026-11-11', 'yearly_lunar', 10, 3, test.v('m_씨'), test.v('m_씨'))$$, 'event_lunar_rule');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, repeat, lunar_month, lunar_day, created_by, updated_by)
  values (test.v('l1'), '음력', 'anniversary', '2026-11-11', 'yearly_lunar', 13, 3, test.v('m_씨'), test.v('m_씨'))$$, 'event_lunar_rule');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, repeat, lunar_month, lunar_day, created_by, updated_by)
  values (test.v('l1'), '양력인데', 'anniversary', '2026-11-11', 'yearly', 10, 3, test.v('m_씨'), test.v('m_씨'))$$, 'event_lunar_rule');
-- 장소 30자, 메모 100자
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, place, created_by, updated_by)
  values (test.v('l1'), '장소', 'other', '2026-11-09', repeat('가', 31), test.v('m_씨'), test.v('m_씨'))$$, 'check constraint');
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, memo, created_by, updated_by)
  values (test.v('l1'), '메모', 'other', '2026-11-09', repeat('가', 101), test.v('m_씨'), test.v('m_씨'))$$, 'check constraint');
insert into public.event (ledger_id, title, kind, event_date, place, memo, created_by, updated_by)
  values (test.v('l1'), repeat('가', 20), 'other', '2026-11-09', repeat('가', 30), repeat('가', 100), test.v('m_씨'), test.v('m_씨'));

-- ── 5. D-day 고정: 기념일만, 가계부당 2개, 고정 시각은 서버가 정함
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, pinned_at, created_by, updated_by)
  values (test.v('l1'), '약속 고정', 'appointment', '2026-11-20', now(), test.v('m_씨'), test.v('m_씨'))$$, 'event_pin_rule');
update public.event set pinned_at = '2000-01-01' where title = '결혼기념일 🎉';
select test.expect_count($$select * from public.event where title = '결혼기념일 🎉' and pinned_at > '2000-01-02'$$, 1);
insert into test.ctx values ('pin1', (select pinned_at::text from public.event where title = '결혼기념일 🎉'));
-- 다시 고정 값을 보내도 처음 고정 시각 유지
update public.event set pinned_at = '2030-01-01', memo = '고정 유지' where title = '결혼기념일 🎉';
select test.expect_count($$select * from public.event where title = '결혼기념일 🎉'
  and pinned_at = (select val::timestamptz from test.ctx where key = 'pin1')$$, 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008d1';
insert into public.event (ledger_id, title, kind, event_date, pinned_at, created_by, updated_by)
  values (test.v('l1'), '준호 생일', 'anniversary', '1995-03-02', now(), test.v('m_디'), test.v('m_디'));
-- 세 번째는 거부 (추가·수정 모두)
select test.expect_error($$insert into public.event (ledger_id, title, kind, event_date, pinned_at, created_by, updated_by)
  values (test.v('l1'), '세 번째', 'anniversary', '2026-12-25', now(), test.v('m_디'), test.v('m_디'))$$, 'EVENT_PIN_LIMIT');
select test.expect_error($$update public.event set pinned_at = now() where title = '아버님 제사'$$, 'EVENT_PIN_LIMIT');
select test.expect_count($$select * from public.event where pinned_at is not null$$, 2);
-- 하나를 풀면 다시 고정할 수 있다
update public.event set pinned_at = null where title = '준호 생일';
update public.event set pinned_at = now() where title = '아버님 제사';
select test.expect_count($$select * from public.event where pinned_at is not null$$, 2);
-- 다른 가계부 고정 수와는 상관없다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008f1';
insert into public.event (ledger_id, title, kind, event_date, pinned_at, created_by, updated_by)
  values (test.v('lx'), 'X 기념일', 'anniversary', '2026-12-01', now(), test.v('m_x'), test.v('m_x'));
select test.expect_count($$select * from public.event where pinned_at is not null$$, 1);

-- ── 6. 삭제: 멤버는 지울 수 있다 (반복 일정 1건 = 모든 날짜)
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
delete from public.event where title = '요가';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select test.expect_count($$select * from public.event where title = '요가'$$, 0);

-- ── 7. 함께한 날: 멤버는 바꿀 수 있고, 다른 가계부 사람은 못 바꾼다
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008c1';
update public.ledger set together_since = '2021-06-12' where id = test.v('l1');
select test.expect_count($$select * from public.ledger where id = test.v('l1') and together_since = '2021-06-12'$$, 1);
select test.expect_error($$update public.ledger set together_since = '1899-12-31' where id = test.v('l1')$$, 'check constraint');
select test.expect_error($$update public.ledger set member_limit = 10 where id = test.v('l1')$$, 'permission denied');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008f1';
update public.ledger set together_since = '2000-01-01' where id = test.v('l1');
reset role;
select test.expect_count($$select * from public.ledger where id = test.v('l1') and together_since = '2021-06-12'$$, 1);
-- 새 가계부는 함께한 날 없음
select test.expect_count($$select * from public.ledger where id = test.v('lx') and together_since is null$$, 1);

-- ── 8. 나간 멤버: 일정은 남고, 나간 사람은 더 못 본다
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008d1';
select public.leave_ledger(test.v('l1'));
select test.expect_count($$select * from public.event where ledger_id = test.v('l1')$$, 0);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select test.expect_count($$select * from public.event where title = '준호 생일' and created_by = test.v('m_디')$$, 1);
reset role;

select 'event tests passed' as result;

rollback;
