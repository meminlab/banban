import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Member } from '../data/types';
import {
  cellChips,
  dayAriaLabel,
  eventColor,
  eventSubline,
  eventToValues,
  expandEvents,
  formatDday,
  formatTime,
  gridRange,
  monthGrid,
  newEventValues,
  nextOccurrence,
  occurrencesInRange,
  repeatLabel,
  repeatOptions,
  validateEventForm,
  withCalendar,
  withKind,
} from './event';
import { lunarMonthDays, lunarToSolar, lunarToSolarClamped, solarToLunar } from './lunar';

const ev = (id: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  ledger_id: 'L',
  title: id,
  kind: 'appointment',
  event_date: '2026-11-09',
  all_day: true,
  start_time: null,
  repeat: 'none',
  lunar_month: null,
  lunar_day: null,
  target_member_id: null,
  place: null,
  memo: null,
  pinned_at: null,
  created_by: 'm1',
  updated_by: 'm1',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...extra,
});

const member = (id: string, name: string, joined_at: string, left_at: string | null = null): Member => ({
  id,
  ledger_id: 'L',
  user_id: `u-${id}`,
  role: 'member',
  display_name: name,
  joined_at,
  left_at,
});
const MEMBERS = [member('m2', '준호', '2026-01-02'), member('m1', '민지', '2026-01-01'), member('m3', '하나', '2026-01-03', '2026-05-01')];

describe('음력 변환 (korean-lunar-calendar, 한국천문연구원 기준)', () => {
  it('음력 2026년 10월 3일 = 양력 2026-11-11 (BANB-41 시안 확인 값)', () => {
    expect(lunarToSolar({ year: 2026, month: 10, day: 3 })).toBe('2026-11-11');
    expect(solarToLunar('2026-11-11')).toEqual({ year: 2026, month: 10, day: 3, leap: false });
  });
  it('설날: 음력 1월 1일', () => {
    expect(lunarToSolar({ year: 2026, month: 1, day: 1 })).toBe('2026-02-17');
    expect(lunarToSolar({ year: 2027, month: 1, day: 1 })).toBe('2027-02-07');
  });
  it('작은달 30일은 없음 → 펼칠 때는 29일(말일)로', () => {
    // 2026년 음력 1월은 29일까지 (lunarMonthDays 로 확인)
    const small = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((m) => lunarMonthDays(2026, m) === 29)!;
    expect(small).toBeDefined();
    expect(lunarToSolar({ year: 2026, month: small, day: 30 })).toBeNull();
    expect(lunarToSolarClamped({ year: 2026, month: small, day: 30 })).toBe(lunarToSolar({ year: 2026, month: small, day: 29 }));
  });
  it('윤달 날짜는 leap = true 로 알려 준다 (2025년 윤6월)', () => {
    const leapDay = solarToLunar('2025-08-01');
    expect(leapDay?.leap).toBe(true);
    expect(leapDay?.month).toBe(6);
  });
  it('지원 범위 밖이면 null', () => {
    expect(lunarToSolar({ year: 2100, month: 1, day: 1 })).toBeNull();
    expect(solarToLunar('2100-01-01')).toBeNull();
  });
});

describe('반복 펼치기 occurrencesInRange', () => {
  it('안 함: 그날만, 범위 밖이면 없음', () => {
    expect(occurrencesInRange(ev('a'), '2026-11-01', '2026-11-30')).toEqual(['2026-11-09']);
    expect(occurrencesInRange(ev('a'), '2026-12-01', '2026-12-31')).toEqual([]);
  });
  it('매주: 같은 요일, 첫 회차 전에는 없음', () => {
    const e = ev('w', { event_date: '2026-11-07', repeat: 'weekly' }); // 토요일
    expect(occurrencesInRange(e, '2026-11-01', '2026-11-30')).toEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
    expect(occurrencesInRange(e, '2026-12-01', '2026-12-31')).toEqual(['2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26']);
    expect(occurrencesInRange(e, '2026-10-01', '2026-10-31')).toEqual([]);
  });
  it('매월 31일 → 짧은 달은 말일 (2월 28·29일, 4월 30일)', () => {
    const e = ev('m', { event_date: '2026-01-31', repeat: 'monthly' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    expect(occurrencesInRange(e, '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']); // 윤년
  });
  it('매월 15일: 달마다 1번', () => {
    const e = ev('m', { event_date: '2026-11-15', repeat: 'monthly' });
    expect(occurrencesInRange(e, '2026-10-25', '2027-01-20')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });
  it('매년: 같은 월·일, 2월 29일은 평년에 28일', () => {
    const e = ev('y', { event_date: '2020-06-12', repeat: 'yearly' });
    expect(occurrencesInRange(e, '2026-01-01', '2027-12-31')).toEqual(['2026-06-12', '2027-06-12']);
    const leap = ev('y2', { event_date: '2024-02-29', repeat: 'yearly' });
    expect(occurrencesInRange(leap, '2025-01-01', '2028-12-31')).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });
  it('매년 음력: 해마다 양력 날짜가 바뀐다', () => {
    const e = ev('l', { kind: 'anniversary', event_date: '2026-11-11', repeat: 'yearly_lunar', lunar_month: 10, lunar_day: 3 });
    expect(occurrencesInRange(e, '2026-11-01', '2026-11-30')).toEqual(['2026-11-11']);
    const next = lunarToSolar({ year: 2027, month: 10, day: 3 })!;
    expect(next).not.toBe('2027-11-11');
    expect(occurrencesInRange(e, '2027-01-01', '2027-12-31')).toEqual([next]);
    // 첫 회차 전 해는 없음
    expect(occurrencesInRange(e, '2025-01-01', '2025-12-31')).toEqual([]);
  });
  it('매년 음력 12월: 양력으로 다음 해 1·2월에 오는 회차도 잡는다', () => {
    const e = ev('l12', { kind: 'anniversary', event_date: '2026-01-01', repeat: 'yearly_lunar', lunar_month: 12, lunar_day: 1 });
    const want = lunarToSolar({ year: 2026, month: 12, day: 1 })!;
    expect(want.startsWith('2027-01')).toBe(true);
    expect(occurrencesInRange(e, '2027-01-01', '2027-01-31')).toEqual([want]);
  });
  it('매년 음력 30일: 작은달인 해는 29일', () => {
    const small = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((m) => lunarMonthDays(2027, m) === 29)!;
    const big2026 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((m) => m === small && lunarMonthDays(2026, m) === 30);
    const e = ev('l30', { kind: 'anniversary', event_date: '2026-01-01', repeat: 'yearly_lunar', lunar_month: small, lunar_day: 30 });
    const in2027 = occurrencesInRange(e, '2027-01-01', '2028-01-31').filter((d) => d === lunarToSolar({ year: 2027, month: small, day: 29 }));
    expect(in2027).toHaveLength(1);
    if (big2026) expect(occurrencesInRange(e, '2026-01-01', '2026-12-31')).toContain(lunarToSolar({ year: 2026, month: small, day: 30 }));
  });
});

describe('expandEvents · 칸 안 순서', () => {
  it('종일(기념일 → 정기 지출일 → 약속 → 기타) → 시각 있는 일정(이른 순)', () => {
    const d = '2026-11-14';
    const list = [
      ev('late', { event_date: d, all_day: false, start_time: '19:00:00' }),
      ev('other', { event_date: d, kind: 'other' }),
      ev('early', { event_date: d, all_day: false, start_time: '09:30:00' }),
      ev('appt', { event_date: d }),
      ev('bill', { event_date: d, kind: 'bill_day' }),
      ev('anniv', { event_date: d, kind: 'anniversary' }),
    ];
    const map = expandEvents(list, '2026-11-01', '2026-11-30');
    expect(map.get(d)?.map((o) => o.event.id)).toEqual(['anniv', 'bill', 'appt', 'other', 'early', 'late']);
  });
  it('반복 일정은 1건으로 여러 날짜에', () => {
    const map = expandEvents([ev('w', { event_date: '2026-11-02', repeat: 'weekly' })], '2026-11-01', '2026-12-05');
    expect([...map.keys()]).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  });
});

describe('달력 칸', () => {
  it('2026년 11월: 일요일 1일 시작, 5주, 뒤 달 날짜 포함', () => {
    const weeks = monthGrid('2026-11');
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(weeks[4][1]).toEqual({ date: '2026-11-30', inMonth: true });
    expect(weeks[4][6]).toEqual({ date: '2026-12-05', inMonth: false });
    expect(gridRange('2026-11')).toEqual({ start: '2026-11-01', end: '2026-12-05' });
  });
  it('앞 달 날짜도 채운다 (2026년 10월은 목요일 시작)', () => {
    const weeks = monthGrid('2026-10');
    expect(weeks[0].slice(0, 4).map((c) => c.inMonth)).toEqual([false, false, false, false]);
    expect(weeks[0][0].date).toBe('2026-09-27');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
  it('최대 3줄: 3개까지 그대로, 4개 이상이면 2개 + "+n"', () => {
    expect(cellChips([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(cellChips([1, 2, 3, 4])).toEqual({ shown: [1, 2], more: 2 });
    expect(cellChips([1, 2, 3, 4, 5, 6])).toEqual({ shown: [1, 2], more: 4 });
  });
});

describe('누구 색·이름', () => {
  it('함께 = together, 멤버 = 참여 순 1~4 (나간 멤버도 자리 유지)', () => {
    expect(eventColor(null, MEMBERS)).toBe('together');
    expect(eventColor('m1', MEMBERS)).toBe(1);
    expect(eventColor('m2', MEMBERS)).toBe(2);
    expect(eventColor('m3', MEMBERS)).toBe(3);
    expect(eventColor('없음', MEMBERS)).toBe('together');
  });
});

describe('문구', () => {
  it('시각', () => {
    expect(formatTime('19:00:00')).toBe('오후 7:00');
    expect(formatTime('00:30')).toBe('오전 12:30');
    expect(formatTime('12:05:00')).toBe('오후 12:05');
  });
  it('반복 문구', () => {
    expect(repeatLabel('weekly', '2026-11-14')).toBe('매주 토요일');
    expect(repeatLabel('monthly', '2026-11-14')).toBe('매월 14일');
    expect(repeatLabel('yearly', '2026-11-14')).toBe('매년 11월 14일');
    expect(repeatLabel('yearly_lunar', '2026-11-11', { month: 10, day: 3 })).toBe('매년 음력 10월 3일');
    expect(repeatLabel('none', '2026-11-14')).toBe('');
  });
  it('반복 선택지: 음력은 기념일만', () => {
    expect(repeatOptions('2026-11-14', 'appointment').map((o) => o.label)).toEqual([
      '안 함',
      '매주 (토요일)',
      '매월 (14일)',
      '매년 (11월 14일)',
    ]);
    expect(repeatOptions('2026-11-14', 'anniversary').at(-1)).toEqual({ value: 'yearly_lunar', label: '매년 (음력)' });
  });
  it('보조 줄: 누구 · 시각 · 반복 · 장소', () => {
    expect(eventSubline(ev('a', { all_day: false, start_time: '19:00:00', place: '성수동' }), MEMBERS)).toBe('함께 · 오후 7:00 · 성수동');
    expect(
      eventSubline(ev('b', { target_member_id: 'm2', all_day: false, start_time: '10:00:00', repeat: 'weekly', event_date: '2026-11-14' }), MEMBERS),
    ).toBe('준호 · 오전 10:00 · 매주 토요일');
    expect(eventSubline(ev('c', { target_member_id: 'm3' }), MEMBERS)).toBe('하나 (나감)');
    expect(
      eventSubline(ev('d', { kind: 'anniversary', repeat: 'yearly_lunar', event_date: '2026-11-11', lunar_month: 10, lunar_day: 3 }), MEMBERS),
    ).toBe('함께 · 매년 음력 10월 3일');
  });
  it('칸 aria-label: 누구·시각을 글자로', () => {
    const items = [
      { date: '2026-11-14', event: ev('결혼기념일', { kind: 'anniversary' }) },
      { date: '2026-11-14', event: ev('레스토랑', { all_day: false, start_time: '19:00:00' }) },
      { date: '2026-11-14', event: ev('풋살', { target_member_id: 'm2', all_day: false, start_time: '18:30:00' }) },
    ];
    expect(dayAriaLabel('2026-11-14', items, MEMBERS)).toBe(
      '11월 14일 토요일, 일정 3개: 결혼기념일 함께, 레스토랑 함께 오후 7시, 풋살 준호 오후 6시 30분',
    );
    expect(dayAriaLabel('2026-11-15', [], MEMBERS)).toBe('11월 15일 일요일, 일정 없음');
  });
  it('D-day', () => {
    expect(formatDday('2026-11-14', '2026-11-09')).toBe('D-5');
    expect(formatDday('2026-11-09', '2026-11-09')).toBe('D-day');
    expect(formatDday('2026-11-06', '2026-11-09')).toBe('D+3');
  });
  it('다음 회차: 매년 일정은 올해 지났으면 내년', () => {
    expect(nextOccurrence(ev('y', { event_date: '2020-06-12', repeat: 'yearly' }), '2026-11-09')).toBe('2027-06-12');
    expect(nextOccurrence(ev('y', { event_date: '2020-11-09', repeat: 'yearly' }), '2026-11-09')).toBe('2026-11-09');
    expect(nextOccurrence(ev('n', { event_date: '2026-01-01' }), '2026-11-09')).toBeNull();
  });
});

describe('입력값', () => {
  it('새 일정 기본값: 약속 · 함께 · 그 날 · 종일 · 반복 안 함', () => {
    const v = newEventValues('2026-11-14');
    expect(v).toMatchObject({ kind: 'appointment', targetMemberId: null, date: '2026-11-14', allDay: true, repeat: 'none', calendar: 'solar' });
  });
  it('제목: 앞뒤 공백 제거 후 1~20자', () => {
    const v = newEventValues('2026-11-14');
    expect(validateEventForm({ ...v, title: '   ' })).toEqual({ ok: false, errors: { title: '제목을 적어 주세요' } });
    expect(validateEventForm({ ...v, title: '가'.repeat(21) }).ok).toBe(false);
    const ok = validateEventForm({ ...v, title: ` ${'가'.repeat(20)} ` });
    expect(ok.ok && ok.value.title).toBe('가'.repeat(20));
  });
  it('시각: 종일이 아니면 HH:MM 필요, 저장은 HH:MM:00', () => {
    const v = { ...newEventValues('2026-11-14'), title: '풋살', allDay: false, time: '' };
    expect(validateEventForm(v)).toEqual({ ok: false, errors: { time: '시각을 골라 주세요' } });
    const ok = validateEventForm({ ...v, time: '19:30' });
    expect(ok.ok && ok.value).toMatchObject({ all_day: false, start_time: '19:30:00' });
  });
  it('장소 30자·메모 100자, 빈 값은 null', () => {
    const v = { ...newEventValues('2026-11-14'), title: 'a' };
    expect(validateEventForm({ ...v, place: '가'.repeat(31) }).ok).toBe(false);
    expect(validateEventForm({ ...v, memo: '가'.repeat(101) }).ok).toBe(false);
    const ok = validateEventForm({ ...v, place: '  ', memo: '' });
    expect(ok.ok && ok.value).toMatchObject({ place: null, memo: null });
  });
  it('음력 기념일: 반복은 매년(음력), 날짜 = 올해 양력, 음력 월·일 저장', () => {
    let v = { ...newEventValues('2026-11-11'), title: '아버님 제사' };
    v = withKind(v, 'anniversary');
    v = withCalendar(v, 'lunar');
    expect(v.repeat).toBe('yearly_lunar');
    expect(v.lunar).toEqual({ year: 2026, month: 10, day: 3 });
    const ok = validateEventForm(v);
    expect(ok.ok && ok.value).toMatchObject({ event_date: '2026-11-11', repeat: 'yearly_lunar', lunar_month: 10, lunar_day: 3, kind: 'anniversary' });
  });
  it('음력에서 양력으로 돌아오면 매년, 기념일이 아니게 바꾸면 음력·고정이 풀린다', () => {
    let v = withCalendar(withKind({ ...newEventValues('2026-11-11'), title: 'x', pinned: true }, 'anniversary'), 'lunar');
    const back = withCalendar(v, 'solar');
    expect(back).toMatchObject({ calendar: 'solar', repeat: 'yearly', date: '2026-11-11' });
    v = withKind(v, 'appointment');
    expect(v).toMatchObject({ calendar: 'solar', repeat: 'yearly', pinned: false, date: '2026-11-11' });
    const ok = validateEventForm(v);
    expect(ok.ok && ok.value).toMatchObject({ lunar_month: null, lunar_day: null, pinned: false });
  });
  it('D-day 고정은 기념일만 저장', () => {
    const v = { ...newEventValues('2026-11-14'), title: 'x', pinned: true };
    const ok = validateEventForm(v);
    expect(ok.ok && ok.value.pinned).toBe(false);
    const ok2 = validateEventForm({ ...v, kind: 'anniversary' });
    expect(ok2.ok && ok2.value.pinned).toBe(true);
  });
  it('음력 날짜가 범위 밖이면 저장 안 됨', () => {
    const v = withKind({ ...newEventValues('2026-11-11'), title: 'x' }, 'anniversary');
    const bad = { ...v, calendar: 'lunar' as const, repeat: 'yearly_lunar' as const, lunar: { year: 2099, month: 1, day: 1 } };
    expect(validateEventForm(bad)).toEqual({ ok: false, errors: { date: '음력 날짜를 확인해 주세요' } });
  });
  it('저장된 일정 → 입력값 (음력·시각·고정)', () => {
    const v = eventToValues(
      ev('x', {
        kind: 'anniversary',
        repeat: 'yearly_lunar',
        event_date: '2026-11-11',
        lunar_month: 10,
        lunar_day: 3,
        pinned_at: '2026-11-01T00:00:00Z',
      }),
    );
    expect(v).toMatchObject({ calendar: 'lunar', lunar: { year: 2026, month: 10, day: 3 }, pinned: true });
    const t = eventToValues(ev('t', { all_day: false, start_time: '07:05:00', place: '집' }));
    expect(t).toMatchObject({ allDay: false, time: '07:05', place: '집', calendar: 'solar' });
  });
});
