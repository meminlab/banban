import { describe, expect, it } from 'vitest';
import type { RecurringTransaction } from '../data/types';
import {
  canRecord,
  chipAmount,
  cycleLabel,
  dueDateLabel,
  expandRecurrings,
  firstDateFrom,
  needsShortMonthHint,
  newScheduleDraft,
  nextRecurringDate,
  occurrenceKey,
  occurrenceStatusMap,
  pendingSuggestions,
  recordResultText,
  recurringOccurrences,
  recurringRowText,
  scheduleDraftOf,
  sortRecurringList,
  validateSchedule,
  type RecurringRule,
} from './recurring';

const monthly = (day: number, start = '2026-01-01', end: string | null = null): RecurringRule => ({
  cycle: 'monthly',
  day_of_month: day,
  month: null,
  weekday: null,
  start_on: start,
  end_on: end,
});

function rec(over: Partial<RecurringTransaction> = {}): RecurringTransaction {
  return {
    id: 'r1',
    ledger_id: 'l1',
    type: 'expense',
    amount: 250000,
    category_id: 'c1',
    pocket_id: 'p1',
    spender_id: 'm1',
    memo: '관리비',
    cycle: 'monthly',
    day_of_month: 25,
    month: null,
    weekday: null,
    start_on: '2026-01-01',
    end_on: null,
    is_paused: false,
    created_by: 'm1',
    updated_by: 'm1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('recurringOccurrences', () => {
  it('매월 31일은 짧은 달 말일 (2월 28일, 4월 30일)', () => {
    expect(recurringOccurrences(monthly(31), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
  it('매월 30일: 윤년 2월은 29일', () => {
    expect(recurringOccurrences(monthly(30), '2028-02-01', '2028-03-31')).toEqual(['2028-02-29', '2028-03-30']);
  });
  it('시작일 전·종료일 뒤는 없다', () => {
    expect(recurringOccurrences(monthly(15, '2026-02-16', '2026-04-15'), '2026-01-01', '2026-12-31')).toEqual([
      '2026-03-15',
      '2026-04-15',
    ]);
  });
  it('매주 요일', () => {
    // 2026-11-01 = 일요일
    const r: RecurringRule = { cycle: 'weekly', day_of_month: null, month: null, weekday: 5, start_on: '2026-11-01', end_on: null };
    expect(recurringOccurrences(r, '2026-11-01', '2026-11-30')).toEqual(['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
  });
  it('매년 2월 29일 → 평년 2월 28일', () => {
    const r: RecurringRule = { cycle: 'yearly', day_of_month: 29, month: 2, weekday: null, start_on: '2024-02-29', end_on: null };
    expect(recurringOccurrences(r, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });
  it('nextRecurringDate: 오늘 포함, 끝났으면 null', () => {
    expect(nextRecurringDate(monthly(25), '2026-11-25')).toBe('2026-11-25');
    expect(nextRecurringDate(monthly(25), '2026-11-26')).toBe('2026-12-25');
    expect(nextRecurringDate(monthly(25, '2026-01-01', '2026-10-31'), '2026-11-01')).toBeNull();
  });
});

describe('pendingSuggestions', () => {
  const today = '2026-11-09';
  it('오늘 + 최근 30일 안에 놓친 것, 확인한 것·일시정지는 뺀다, 오래된 날짜 먼저', () => {
    const a = rec({ id: 'a', cycle: 'weekly', day_of_month: null, weekday: 1, created_at: '2026-01-02T00:00:00Z' }); // 월요일
    const b = rec({ id: 'b', day_of_month: 9 });
    const paused = rec({ id: 'p', day_of_month: 9, is_paused: true });
    const decided = occurrenceStatusMap([{ recurring_id: 'a', occurs_on: '2026-10-26', status: 'skipped' }]);
    const due = pendingSuggestions([a, b, paused], decided, today).map((d) => `${d.recurring.id}@${d.date}`);
    // 창: 2026-10-10 ~ 2026-11-09. a: 10-12, 10-19, (10-26 건너뜀), 11-02, 11-09 / b: 11-09 (10-09 는 창 밖)
    expect(due).toEqual(['a@2026-10-12', 'a@2026-10-19', 'a@2026-11-02', 'b@2026-11-09', 'a@2026-11-09']);
  });
  it('30일 경계: 오늘−30일은 포함, 31일 전은 제외', () => {
    const r = rec({ day_of_month: 10 }); // 2026-10-10 = 오늘−30일
    expect(pendingSuggestions([r], new Map(), today).map((d) => d.date)).toEqual(['2026-10-10']);
    // 11-10 기준 10-10 은 31일 전 → 빠진다
    expect(pendingSuggestions([r], new Map(), '2026-11-10').map((d) => d.date)).toEqual(['2026-11-10']);
  });
  it('미래 시작은 제안 없음', () => {
    expect(pendingSuggestions([rec({ start_on: '2026-11-25' })], new Map(), today)).toEqual([]);
  });
});

describe('expandRecurrings / canRecord / sort', () => {
  it('일시정지는 달력에 안 보인다', () => {
    const map = expandRecurrings([rec({ id: 'a' }), rec({ id: 'p', is_paused: true })], '2026-11-01', '2026-11-30');
    expect(map.get('2026-11-25')?.map((r) => r.id)).toEqual(['a']);
  });
  it('기록하기는 오늘·지난 날이고 확인 안 한 회차만', () => {
    const decided = new Map([[occurrenceKey('a', '2026-11-01'), 'recorded']]);
    expect(canRecord('a', '2026-11-09', '2026-11-09', decided)).toBe(true);
    expect(canRecord('a', '2026-11-01', '2026-11-09', decided)).toBe(false);
    expect(canRecord('a', '2026-11-10', '2026-11-09', decided)).toBe(false);
  });
  it('목록은 다음 날짜가 가까운 순, 끝난 것은 뒤', () => {
    const list = sortRecurringList(
      [rec({ id: 'a', day_of_month: 25 }), rec({ id: 'b', day_of_month: 10 }), rec({ id: 'ended', end_on: '2026-01-31' })],
      '2026-11-09',
    );
    expect(list.map((r) => r.id)).toEqual(['b', 'a', 'ended']);
  });
});

describe('문구', () => {
  it('cycleLabel', () => {
    expect(cycleLabel({ cycle: 'monthly', day_of_month: 25, month: null, weekday: null })).toBe('매월 25일');
    expect(cycleLabel({ cycle: 'monthly', day_of_month: 31, month: null, weekday: null })).toBe('매월 말일');
    expect(cycleLabel({ cycle: 'weekly', day_of_month: null, month: null, weekday: 5 })).toBe('매주 금요일');
    expect(cycleLabel({ cycle: 'yearly', day_of_month: 2, month: 3, weekday: null })).toBe('매년 3월 2일');
  });
  it('dueDateLabel', () => {
    expect(dueDateLabel('2026-11-09', '2026-11-09')).toBe('오늘');
    expect(dueDateLabel('2026-11-05', '2026-11-09')).toBe('11월 5일 · 4일 지났어요');
  });
  it('chipAmount', () => {
    expect(chipAmount('expense', 250000)).toBe('−25만');
    expect(chipAmount('income', 3500000)).toBe('+350만');
    expect(chipAmount('saving', 500000)).toBe('50만');
  });
  it('recordResultText', () => {
    expect(recordResultText({ recorded: 2, skipped: 1, already: 0 })).toBe('2건 기록했어요');
    expect(recordResultText({ recorded: 0, skipped: 1, already: 0 })).toBe('이번엔 건너뛰었어요');
    expect(recordResultText({ recorded: 0, skipped: 0, already: 2 })).toBe('이미 다른 기기에서 확인했어요');
  });
});

describe('반복 입력값', () => {
  it('새 기본값: 매월 오늘 일자, 시작 오늘', () => {
    expect(newScheduleDraft('2026-11-09')).toMatchObject({ cycle: 'monthly', dayOfMonth: 9, startOn: '2026-11-09', endOn: '' });
  });
  it('시작 기본값 = 오늘 이후 첫 날짜', () => {
    const d = { ...newScheduleDraft('2026-11-09'), dayOfMonth: 25 };
    expect(firstDateFrom(d, '2026-11-09')).toBe('2026-11-25');
    expect(firstDateFrom({ ...d, cycle: 'weekly', weekday: 1 }, '2026-11-10')).toBe('2026-11-16');
    expect(firstDateFrom({ ...d, cycle: 'yearly', month: 3, dayOfMonth: 2 }, '2026-11-09')).toBe('2027-03-02');
  });
  it('검사: 저장 값은 주기에 맞는 열만 채운다', () => {
    const base = newScheduleDraft('2026-11-09');
    expect(validateSchedule({ ...base, cycle: 'weekly', weekday: 3 })).toEqual({
      ok: true,
      value: { cycle: 'weekly', day_of_month: null, month: null, weekday: 3, start_on: '2026-11-09', end_on: null },
    });
    expect(validateSchedule({ ...base, cycle: 'yearly', month: 2, dayOfMonth: 30 })).toMatchObject({ ok: false });
    expect(validateSchedule({ ...base, endOn: '2026-11-01' })).toEqual({ ok: false, error: '끝나는 날은 시작일보다 뒤여야 해요' });
  });
  it('저장된 값 → 입력값, 짧은 달 안내', () => {
    expect(scheduleDraftOf(rec({ cycle: 'weekly', day_of_month: null, weekday: 2 }))).toMatchObject({ cycle: 'weekly', weekday: 2 });
    expect(needsShortMonthHint({ cycle: 'monthly', dayOfMonth: 30 })).toBe(true);
    expect(needsShortMonthHint({ cycle: 'monthly', dayOfMonth: 31 })).toBe(false);
    expect(needsShortMonthHint({ cycle: 'monthly', dayOfMonth: 28 })).toBe(false);
  });
});

describe('recurringRowText', () => {
  const lookup = { categoryName: (id: string) => (id === 'c1' ? '관리비' : undefined), pocketName: () => '생활비' };
  it('지출은 주머니까지, 이름 없으면 소분류', () => {
    expect(recurringRowText(rec({ memo: null }), lookup, '매월 25일', '민지')).toEqual({ title: '관리비', sub: '매월 25일 · 생활비 · 민지' });
    expect(recurringRowText(rec({ type: 'income', pocket_id: null, memo: '월급' }), lookup, '오늘', '준호')).toEqual({
      title: '월급',
      sub: '오늘 · 준호',
    });
  });
});
