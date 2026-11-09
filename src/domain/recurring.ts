/**
 * 정기 내역 — 회차 펼치기·기록 제안·문구·반복 입력값 (화면과 분리된 순수 함수).
 * 날짜는 모두 KST 날짜 문자열 'YYYY-MM-DD'. 회차 규칙은 DB 함수 recurring_occurs_on 과 같다 (design.md 5.27, BANB-2 C2).
 */
import type { RecurringCycle, RecurringOccurrence, RecurringTransaction, TransactionType } from '../data/types';
import { addDays, daysBetween, daysInMonth, weekdayOfDate } from './event';
import { compactWon } from './ledgerView';
import { addMonths, type YearMonth } from './month';

/** 지난 날 놓친 회차를 이만큼 거슬러 제안한다 (오늘 포함 오늘−30일까지) */
export const SUGGEST_WINDOW_DAYS = 30;
/** 매월 31일 = 말일 (그 달에 없는 날은 말일로) */
export const LAST_DAY = 31;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 반복 규칙 (DB 열과 같은 이름) */
export type RecurringRule = Pick<
  RecurringTransaction,
  'cycle' | 'day_of_month' | 'month' | 'weekday' | 'start_on' | 'end_on'
>;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function toDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * [start, end] (둘 다 포함) 안의 회차 날짜. 시작일 전·종료일 뒤는 없다.
 * - 매주: 그 요일 / 매월: 그 일(그 달에 없으면 말일) / 매년: 그 월·일(평년 2월 29일 → 2월 28일)
 */
export function recurringOccurrences(rule: RecurringRule, start: string, end: string): string[] {
  const from = rule.start_on > start ? rule.start_on : start;
  const to = rule.end_on && rule.end_on < end ? rule.end_on : end;
  if (from > to) return [];
  const out: string[] = [];
  switch (rule.cycle) {
    case 'weekly': {
      if (rule.weekday == null) return [];
      const offset = (rule.weekday - weekdayOfDate(from) + 7) % 7;
      for (let d = addDays(from, offset); d <= to; d = addDays(d, 7)) out.push(d);
      return out;
    }
    case 'monthly': {
      if (rule.day_of_month == null) return [];
      for (let ym: YearMonth = from.slice(0, 7); ym <= to.slice(0, 7); ym = addMonths(ym, 1)) {
        const [y, m] = ym.split('-').map(Number);
        const d = toDate(y, m, Math.min(rule.day_of_month, daysInMonth(y, m)));
        if (d >= from && d <= to) out.push(d);
      }
      return out;
    }
    case 'yearly': {
      if (rule.month == null || rule.day_of_month == null) return [];
      for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
        const d = toDate(y, rule.month, Math.min(rule.day_of_month, daysInMonth(y, rule.month)));
        if (d >= from && d <= to) out.push(d);
      }
      return out;
    }
  }
}

/** date 이후(그날 포함) 첫 회차. 종료일이 지났으면 null */
export function nextRecurringDate(rule: RecurringRule, date: string): string | null {
  return recurringOccurrences(rule, date, addDays(date, 366 * 2))[0] ?? null;
}

/** 회차 키: 'recurringId|YYYY-MM-DD' */
export function occurrenceKey(recurringId: string, date: string): string {
  return `${recurringId}|${date}`;
}

/** 이미 확인한(기록·건너뜀) 회차 → 키별 상태 */
export function occurrenceStatusMap(rows: readonly Pick<RecurringOccurrence, 'recurring_id' | 'occurs_on' | 'status'>[]) {
  return new Map(rows.map((o) => [occurrenceKey(o.recurring_id, o.occurs_on), o.status]));
}

/** 기록 제안 1건 (정기 내역 × 회차 날짜) */
export interface RecurringDue {
  recurring: RecurringTransaction;
  date: string;
}

/** 제안을 볼 때 읽을 회차 범위: 오늘−30일 ~ 오늘 */
export function suggestRange(today: string): { start: string; end: string } {
  return { start: addDays(today, -SUGGEST_WINDOW_DAYS), end: today };
}

/**
 * 기록할지 물어볼 회차: 일시정지 아님, 오늘 + 최근 30일 안에 놓친 것, 아직 기록·건너뛰기 안 한 것.
 * 순서 = 오래된 날짜 먼저, 같은 날이면 먼저 만든 정기 내역
 */
export function pendingSuggestions(
  recurrings: readonly RecurringTransaction[],
  decided: ReadonlyMap<string, unknown>,
  today: string,
): RecurringDue[] {
  const { start, end } = suggestRange(today);
  const out: RecurringDue[] = [];
  for (const r of recurrings) {
    if (r.is_paused) continue;
    for (const date of recurringOccurrences(r, start, end)) {
      if (!decided.has(occurrenceKey(r.id, date))) out.push({ recurring: r, date });
    }
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.recurring.created_at.localeCompare(b.recurring.created_at) ||
      a.recurring.id.localeCompare(b.recurring.id),
  );
}

/** 정기 내역들을 [start, end] 에서 펼쳐 날짜별로 (일시정지는 빼고, 같은 날은 먼저 만든 순) — 일정 탭 칩 */
export function expandRecurrings(
  recurrings: readonly RecurringTransaction[],
  start: string,
  end: string,
): Map<string, RecurringTransaction[]> {
  const byDate = new Map<string, RecurringTransaction[]>();
  const sorted = [...recurrings]
    .filter((r) => !r.is_paused)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const r of sorted) {
    for (const date of recurringOccurrences(r, start, end)) {
      const list = byDate.get(date) ?? [];
      list.push(r);
      byDate.set(date, list);
    }
  }
  return byDate;
}

/** 이 회차를 지금 기록할 수 있나: 오늘·지난 날이고 아직 확인 안 한 것 (날짜 시트 "기록하기") */
export function canRecord(recurringId: string, date: string, today: string, decided: ReadonlyMap<string, unknown>): boolean {
  return date <= today && !decided.has(occurrenceKey(recurringId, date));
}

/**
 * 정기 내역 목록 순서 (design.md 5.27): 다음 날짜가 가까운 순. 일시정지도 같은 기준으로 섞고,
 * 끝난 것(다음 날짜 없음)은 맨 뒤. 같으면 먼저 만든 것
 */
export function sortRecurringList(recurrings: readonly RecurringTransaction[], today: string): RecurringTransaction[] {
  const next = new Map(recurrings.map((r) => [r.id, nextRecurringDate(r, today)]));
  return [...recurrings].sort((a, b) => {
    const na = next.get(a.id);
    const nb = next.get(b.id);
    if (na !== nb) {
      if (!na) return 1;
      if (!nb) return -1;
      return na < nb ? -1 : 1;
    }
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}

// ── 문구

/** 주기 문구: '매월 25일' · '매월 말일' · '매주 금요일' · '매년 3월 2일' */
export function cycleLabel(rule: Pick<RecurringRule, 'cycle' | 'day_of_month' | 'month' | 'weekday'>): string {
  switch (rule.cycle) {
    case 'monthly':
      return rule.day_of_month === LAST_DAY ? '매월 말일' : `매월 ${rule.day_of_month}일`;
    case 'weekly':
      return `매주 ${WEEKDAYS[rule.weekday ?? 0]}요일`;
    case 'yearly':
      return `매년 ${rule.month}월 ${rule.day_of_month}일`;
  }
}

/** 제안 행 날짜: 오늘이면 '오늘', 지난 날이면 '11월 5일 · 4일 지났어요' */
export function dueDateLabel(date: string, today: string): string {
  const late = daysBetween(date, today);
  if (late <= 0) return '오늘';
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 · ${late}일 지났어요`;
}

/** 달력 칩 금액 (만 단위 줄여 쓰기): 지출 '−25만' · 수입 '+350만' · 저축 '50만' */
export function chipAmount(type: TransactionType, amount: number): string {
  const sign = type === 'expense' ? '−' : type === 'income' ? '+' : '';
  return `${sign}${compactWon(amount)}`;
}

/** 화면낭독용 금액: '지출 250,000원' */
export function spokenAmount(type: TransactionType, amount: number): string {
  const word = type === 'expense' ? '지출' : type === 'income' ? '수입' : '저축';
  return `${word} ${amount.toLocaleString('ko-KR')}원`;
}

/** 기록 결과 토스트: 'n건 기록했어요' / 모두 건너뜀 '건너뛰었어요' / 이미 다른 기기에서 처리 */
export function recordResultText(result: { recorded: number; skipped: number; already: number }): string {
  if (result.recorded > 0) return `${result.recorded}건 기록했어요`;
  if (result.skipped > 0) return '이번엔 건너뛰었어요';
  return result.already > 0 ? '이미 다른 기기에서 확인했어요' : '바뀐 게 없어요';
}

// ── 반복 입력값

export interface RecurringScheduleDraft {
  cycle: RecurringCycle;
  /** 매월·매년: 1~31 (31 = 말일) */
  dayOfMonth: number;
  /** 매년: 1~12 */
  month: number;
  /** 매주: 0(일)~6 */
  weekday: number;
  startOn: string;
  /** 비우면 '' (정하지 않음) */
  endOn: string;
}

/** 반복 저장 값 (DB 열과 같은 이름) */
export type RecurringScheduleValues = Pick<
  RecurringTransaction,
  'cycle' | 'day_of_month' | 'month' | 'weekday' | 'start_on' | 'end_on'
>;

/** 주기·날짜만 반영한 규칙 (시작일·종료일 무시) — 시작일 기본값 계산용 */
function ruleOf(d: RecurringScheduleDraft, startOn: string, endOn: string | null): RecurringRule {
  return {
    cycle: d.cycle,
    day_of_month: d.cycle === 'weekly' ? null : d.dayOfMonth,
    month: d.cycle === 'yearly' ? d.month : null,
    weekday: d.cycle === 'weekly' ? d.weekday : null,
    start_on: startOn,
    end_on: endOn,
  };
}

/** 이 주기로 date 이후(그날 포함) 첫 날짜 — 시작 기본값 (design.md 5.27 "기본 오늘 이후 첫 날짜") */
export function firstDateFrom(d: RecurringScheduleDraft, date: string): string {
  return nextRecurringDate(ruleOf(d, date, null), date) ?? date;
}

/** 새 정기 내역 기본값: 매월 오늘 일자(31일이면 말일), 시작 = 오늘, 종료 없음 */
export function newScheduleDraft(today: string): RecurringScheduleDraft {
  const [, m, d] = today.split('-').map(Number);
  return { cycle: 'monthly', dayOfMonth: d, month: m, weekday: weekdayOfDate(today), startOn: today, endOn: '' };
}

/** 저장된 정기 내역 → 반복 입력값 */
export function scheduleDraftOf(r: RecurringTransaction): RecurringScheduleDraft {
  const [, m, d] = r.start_on.split('-').map(Number);
  return {
    cycle: r.cycle,
    dayOfMonth: r.day_of_month ?? d,
    month: r.month ?? m,
    weekday: r.weekday ?? weekdayOfDate(r.start_on),
    startOn: r.start_on,
    endOn: r.end_on ?? '',
  };
}

/** 그 월에 고를 수 있는 마지막 일 (매년: 2월은 29일까지) */
export function maxDayOfMonth(month: number): number {
  return month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 짧은 달 안내가 필요한가 (매월 29·30일. 말일은 그 자체로 말일) */
export function needsShortMonthHint(d: Pick<RecurringScheduleDraft, 'cycle' | 'dayOfMonth'>): boolean {
  return d.cycle === 'monthly' && d.dayOfMonth >= 29 && d.dayOfMonth < LAST_DAY;
}

/** 지금 입력값의 주기 문구 ('매월 25일' 등) */
export function draftCycleLabel(d: RecurringScheduleDraft): string {
  return cycleLabel(ruleOf(d, d.startOn, null));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateSchedule(
  d: RecurringScheduleDraft,
): { ok: true; value: RecurringScheduleValues } | { ok: false; error: string } {
  if (d.cycle === 'monthly' && !(d.dayOfMonth >= 1 && d.dayOfMonth <= LAST_DAY)) return { ok: false, error: '날짜를 골라 주세요' };
  if (d.cycle === 'weekly' && !(d.weekday >= 0 && d.weekday <= 6)) return { ok: false, error: '요일을 골라 주세요' };
  if (d.cycle === 'yearly' && !(d.month >= 1 && d.month <= 12 && d.dayOfMonth >= 1 && d.dayOfMonth <= maxDayOfMonth(d.month)))
    return { ok: false, error: '날짜를 골라 주세요' };
  if (!DATE_RE.test(d.startOn)) return { ok: false, error: '시작일을 골라 주세요' };
  if (d.endOn && !DATE_RE.test(d.endOn)) return { ok: false, error: '끝나는 날을 다시 골라 주세요' };
  if (d.endOn && d.endOn < d.startOn) return { ok: false, error: '끝나는 날은 시작일보다 뒤여야 해요' };
  return { ok: true, value: ruleOf(d, d.startOn, d.endOn || null) };
}

/** 정기 내역 행 글자: 제목 = 이름(메모, 없으면 소분류) / 보조 = '앞말 · 주머니(지출만) · 사람' */
export function recurringRowText(
  r: Pick<RecurringTransaction, 'type' | 'memo' | 'category_id' | 'pocket_id'>,
  lookup: { categoryName: (id: string) => string | undefined; pocketName: (id: string) => string | undefined },
  lead: string,
  spender: string,
): { title: string; sub: string } {
  const title = r.memo?.trim() || lookup.categoryName(r.category_id) || '알 수 없음';
  const pocket = r.type === 'expense' && r.pocket_id ? lookup.pocketName(r.pocket_id) : undefined;
  return { title, sub: [lead, pocket, spender].filter(Boolean).join(' · ') };
}
