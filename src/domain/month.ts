/**
 * 월(YYYY-MM) 계산 — 모두 한국 시간(KST) 기준.
 * 내역 날짜(occurred_on)는 KST 날짜 문자열(YYYY-MM-DD)로 저장되므로 문자열로만 비교한다.
 */

/** 'YYYY-MM' */
export type YearMonth = string;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYearMonth(year: number, month1to12: number): YearMonth {
  return `${year}-${pad2(month1to12)}`;
}

function parse(ym: YearMonth): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error(`잘못된 월 형식: ${ym}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** 지금(또는 주어진 시각)이 KST로 몇 년 몇 월인지 */
export function currentYearMonth(now: Date = new Date()): YearMonth {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return toYearMonth(kst.getUTCFullYear(), kst.getUTCMonth() + 1);
}

/** 달 더하기/빼기 (delta = -1 이전 달, +1 다음 달) */
export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const { year, month } = parse(ym);
  const index = year * 12 + (month - 1) + delta;
  return toYearMonth(Math.floor(index / 12), (index % 12) + 1);
}

/** 조회 범위: start 이상, end 미만 (둘 다 YYYY-MM-DD) */
export function monthRange(ym: YearMonth): { start: string; end: string } {
  return { start: `${ym}-01`, end: `${addMonths(ym, 1)}-01` };
}

/** 내역 날짜(YYYY-MM-DD)가 이 달인가 */
export function isInMonth(date: string, ym: YearMonth): boolean {
  return date.slice(0, 7) === ym;
}

/** '2026년 11월' */
export function formatYearMonth(ym: YearMonth): string {
  const { year, month } = parse(ym);
  return `${year}년 ${month}월`;
}
