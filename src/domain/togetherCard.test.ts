import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../data/types';
import {
  buildTogetherCard,
  ddaySentence,
  hasFinalConsonant,
  pickDdays,
  togetherCardAriaLabel,
  togetherDays,
} from './togetherCard';

const TODAY = '2026-11-09';

const ann = (id: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  ledger_id: 'L',
  title: id,
  kind: 'anniversary',
  event_date: '2020-11-14',
  all_day: true,
  start_time: null,
  repeat: 'yearly',
  lunar_month: null,
  lunar_day: null,
  target_member_id: null,
  place: null,
  memo: null,
  pinned_at: null,
  created_by: 'm1',
  updated_by: 'm1',
  created_at: `2026-01-01T00:00:00Z`,
  updated_at: '',
  ...extra,
});

const lines = (events: CalendarEvent[], today = TODAY) =>
  pickDdays(events, today).map((d) => `${d.event.title} ${d.date} ${d.daysLeft}`);

describe('함께한 지 N일째', () => {
  it('첫날이 1일째 (오늘 − 함께한 날 + 1)', () => {
    expect(togetherDays(TODAY, TODAY)).toBe(1);
    expect(togetherDays('2026-11-08', TODAY)).toBe(2);
    expect(togetherDays('2021-06-12', TODAY)).toBe(1977); // 시안 숫자
  });
  it('윤년(2월 29일)을 지나도 날 수로 센다', () => {
    expect(togetherDays('2024-02-28', '2024-03-01')).toBe(3);
  });
  it('없거나 미래 날짜면 null', () => {
    expect(togetherDays(null, TODAY)).toBeNull();
    expect(togetherDays('2026-11-10', TODAY)).toBeNull();
  });
});

describe('기념일 D-day 줄 고르기', () => {
  it('고정 안 한 기념일: 30일 안만, 가까운 순, 최대 2줄', () => {
    const events = [
      ann('먼 기념일', { event_date: '2020-12-10' }), // D-31 → 빠짐
      ann('결혼기념일', { event_date: '2019-11-14' }), // D-5
      ann('30일째', { event_date: '2020-12-09' }), // D-30 → 포함
      ann('준호 생일', { event_date: '1990-11-21' }), // D-12
    ];
    expect(lines(events)).toEqual(['결혼기념일 2026-11-14 5', '준호 생일 2026-11-21 12']);
    expect(lines([ann('30일째', { event_date: '2020-12-09' }), ann('먼 기념일', { event_date: '2020-12-10' })])).toEqual([
      '30일째 2026-12-09 30',
    ]);
  });

  it('고정한 것 먼저 (고정한 순서), 30일보다 멀어도 보인다', () => {
    const events = [
      ann('가까운 기념일', { event_date: '2020-11-10' }), // D-1, 고정 안 함
      ann('나중 고정', { event_date: '2020-03-01', pinned_at: '2026-05-02T00:00:00Z' }), // D-112
      ann('먼저 고정', { event_date: '2020-06-01', pinned_at: '2026-05-01T00:00:00Z' }), // D-204
    ];
    expect(lines(events)).toEqual(['먼저 고정 2027-06-01 204', '나중 고정 2027-03-01 112']);
  });

  it('고정 1개면 남은 자리는 가까운 기념일', () => {
    const events = [
      ann('고정', { event_date: '2020-03-01', pinned_at: '2026-05-01T00:00:00Z' }),
      ann('B', { event_date: '2020-11-20' }),
      ann('A', { event_date: '2020-11-10' }),
    ];
    expect(lines(events)).toEqual(['고정 2027-03-01 112', 'A 2026-11-10 1']);
  });

  it('오늘은 포함(D-day), 어제는 빠진다 — 지난 반복 안 함 기념일은 고정이어도 빠진다', () => {
    const events = [
      ann('오늘', { event_date: '2020-11-09' }),
      ann('어제', { event_date: '2020-11-08' }), // 다음 회차는 내년 → 30일 밖
      ann('지난 고정', { event_date: '2026-11-01', repeat: 'none', pinned_at: '2026-05-01T00:00:00Z' }),
    ];
    expect(lines(events)).toEqual(['오늘 2026-11-09 0']);
  });

  it('기념일만 — 약속·기타·정기 지출일은 넣지 않는다', () => {
    const events = [
      ann('약속', { kind: 'appointment', event_date: '2026-11-10', repeat: 'none' }),
      ann('관리비', { kind: 'bill_day', event_date: '2026-01-10', repeat: 'monthly' }),
      ann('기타', { kind: 'other', event_date: '2026-11-11', repeat: 'none' }),
    ];
    expect(lines(events)).toEqual([]);
  });

  it('음력 매년 기념일은 올해 양력 날짜로 센다 (음력 10월 3일 → 2026-11-11)', () => {
    const events = [ann('아버님 제사', { event_date: '2015-11-14', repeat: 'yearly_lunar', lunar_month: 10, lunar_day: 3 })];
    expect(lines(events)).toEqual(['아버님 제사 2026-11-11 2']);
  });

  it('반복 안 함 기념일: 30일 안이면 보이고, 첫 회차 전에는 다음 날짜가 첫 회차', () => {
    expect(lines([ann('첫 여행', { event_date: '2026-11-25', repeat: 'none' })])).toEqual(['첫 여행 2026-11-25 16']);
  });

  it('연말을 넘는 30일 창 (12월 20일 → 1월 5일)', () => {
    expect(lines([ann('새해 기념일', { event_date: '2020-01-05' })], '2026-12-20')).toEqual(['새해 기념일 2027-01-05 16']);
  });
});

describe('카드 내용', () => {
  it('셋 다 없으면 null (카드 숨김)', () => {
    expect(buildTogetherCard(null, [], TODAY)).toBeNull();
    expect(buildTogetherCard(null, [ann('먼 기념일', { event_date: '2020-12-25' })], TODAY)).toBeNull();
  });
  it('함께한 날만 → 1줄 / 기념일만 → D-day 줄만', () => {
    expect(buildTogetherCard('2021-06-12', [], TODAY)).toEqual({ togetherDays: 1977, ddays: [] });
    expect(buildTogetherCard(null, [ann('A', { event_date: '2020-11-10' })], TODAY)?.togetherDays).toBeNull();
  });
});

describe('문구', () => {
  it('"○○까지 n일 남았어요" / 당일 "오늘은 ○○이에요·예요" (받침)', () => {
    expect(ddaySentence('결혼기념일', 5)).toBe('결혼기념일까지 5일 남았어요');
    expect(ddaySentence('결혼기념일', 0)).toBe('오늘은 결혼기념일이에요');
    expect(ddaySentence('할머니 제사', 0)).toBe('오늘은 할머니 제사예요');
    expect(ddaySentence('결혼 10주년', 0)).toBe('오늘은 결혼 10주년이에요');
    expect(ddaySentence('먼 날', 1000)).toBe('먼 날까지 1,000일 남았어요');
  });
  it('받침: 한글·숫자 끝소리, 그 밖은 "이에요"', () => {
    expect(hasFinalConsonant('생일')).toBe(true);
    expect(hasFinalConsonant('제사')).toBe(false);
    expect(hasFinalConsonant('D-2')).toBe(false); // 이
    expect(hasFinalConsonant('D-7')).toBe(true); // 칠
    expect(hasFinalConsonant('Day')).toBe(true);
  });
  it('aria-label: "함께한 지 1,977일째, 결혼기념일까지 5일, 오늘 준호 생일. 일정 탭으로 가기"', () => {
    const card = buildTogetherCard(
      '2021-06-12',
      [ann('결혼기념일', { event_date: '2019-11-14' }), ann('준호 생일', { event_date: '1990-11-09' })],
      TODAY,
    )!;
    expect(togetherCardAriaLabel(card)).toBe('함께한 지 1,977일째, 오늘 준호 생일, 결혼기념일까지 5일. 일정 탭으로 가기');
  });
});
