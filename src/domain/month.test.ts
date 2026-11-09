import { addMonths, currentYearMonth, formatMonthLabel, formatYearMonth, isInMonth, monthRange } from './month';

describe('month (KST)', () => {
  it('UTC 기준 전날 15:00 이후는 KST로 다음 날 → 월이 넘어간다', () => {
    expect(currentYearMonth(new Date('2026-10-31T14:59:59Z'))).toBe('2026-10');
    expect(currentYearMonth(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11');
  });

  it('달 이동은 연도를 넘긴다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 0)).toBe('2026-11');
  });

  it('조회 범위는 1일 이상 다음 달 1일 미만', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('날짜가 그 달인지 문자열로 판단', () => {
    expect(isInMonth('2026-11-30', '2026-11')).toBe(true);
    expect(isInMonth('2026-12-01', '2026-11')).toBe(false);
    expect(isInMonth('2026-10-31', '2026-11')).toBe(false);
  });

  it('표시 형식', () => {
    expect(formatYearMonth('2026-01')).toBe('2026년 1월');
  });

  it('월 이동 줄: 올해는 연도 없이, 다른 해만 연도 (design.md 5.23)', () => {
    expect(formatMonthLabel('2026-11', '2026-11')).toBe('11월');
    expect(formatMonthLabel('2026-01', '2026-11')).toBe('1월');
    expect(formatMonthLabel('2025-11', '2026-11')).toBe('2025년 11월');
    expect(formatMonthLabel('2027-01', '2026-12')).toBe('2027년 1월');
  });
});
