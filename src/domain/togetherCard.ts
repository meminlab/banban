/**
 * 홈 맨 위 "함께한 날" 카드 (design.md 5.26, BANB-43) — 화면과 분리된 순수 함수.
 * 날짜는 모두 KST 날짜 문자열 'YYYY-MM-DD'.
 */
import type { CalendarEvent } from '../data/types';
import { addDays, compareOccurrences, daysBetween, nextOccurrence, occurrencesInRange } from './event';
import { formatNumber } from './transactionForm';

/** 기념일 D-day 줄 최대 수 */
export const TOGETHER_CARD_DDAY_MAX = 2;
/** 고정 안 한 기념일은 오늘부터 이 날 수 안(오늘 포함, D-30까지)만 보여 준다 (클라이언트 확정 2026-11-09) */
export const UNPINNED_WINDOW_DAYS = 30;

export interface DdayLine {
  event: CalendarEvent;
  /** 다음 회차 날짜 (오늘 포함) */
  date: string;
  /** 오늘부터 남은 날 수 (0 = 오늘) */
  daysLeft: number;
}

export interface TogetherCard {
  /** 함께한 지 N일째 (함께한 날이 없거나 미래면 null) */
  togetherDays: number | null;
  ddays: DdayLine[];
}

/** 함께한 지 N일째: 첫날이 1일째 (N = 오늘 − 함께한 날 + 1). 없거나 미래 날짜면 null */
export function togetherDays(since: string | null, today: string): number | null {
  if (!since) return null;
  const n = daysBetween(since, today) + 1;
  return n >= 1 ? n : null;
}

/**
 * 기념일 D-day 최대 2줄: 고정한 기념일 먼저(고정한 순서, 다음 회차가 있으면 날짜와 상관없이),
 * 남은 자리는 고정 안 한 기념일 중 30일 안에 오는 것을 가까운 순으로. 지난 것(다음 회차 없음)은 뺀다.
 * 약속·기타·정기 지출일은 넣지 않는다.
 */
export function pickDdays(events: readonly CalendarEvent[], today: string): DdayLine[] {
  const anniversaries = events.filter((e) => e.kind === 'anniversary');

  const pinned: DdayLine[] = anniversaries
    .filter((e) => e.pinned_at != null)
    .sort((a, b) => (a.pinned_at! < b.pinned_at! ? -1 : a.pinned_at! > b.pinned_at! ? 1 : compareOccurrences(a, b)))
    .flatMap((event) => {
      const date = nextOccurrence(event, today);
      return date ? [{ event, date, daysLeft: daysBetween(today, date) }] : [];
    })
    .slice(0, TOGETHER_CARD_DDAY_MAX);

  const windowEnd = addDays(today, UNPINNED_WINDOW_DAYS);
  const upcoming: DdayLine[] = anniversaries
    .filter((e) => e.pinned_at == null)
    .flatMap((event) => {
      const date = occurrencesInRange(event, today, windowEnd)[0];
      return date ? [{ event, date, daysLeft: daysBetween(today, date) }] : [];
    })
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : compareOccurrences(a.event, b.event)));

  return [...pinned, ...upcoming].slice(0, TOGETHER_CARD_DDAY_MAX);
}

/** 카드 내용. 셋 다 없으면 null (카드 숨김) */
export function buildTogetherCard(
  since: string | null,
  events: readonly CalendarEvent[],
  today: string,
): TogetherCard | null {
  const days = togetherDays(since, today);
  const ddays = pickDdays(events, today);
  if (days == null && ddays.length === 0) return null;
  return { togetherDays: days, ddays };
}

// ── 문구 (해요체, design.md 5.26)

// 숫자 끝소리 받침: 0 영 1 일 3 삼 6 육 7 칠 8 팔 → 받침 있음 / 2 이 4 사 5 오 9 구 → 없음
const DIGIT_HAS_BATCHIM: Record<string, boolean> = {
  '0': true, '1': true, '2': false, '3': true, '4': false, '5': false, '6': true, '7': true, '8': true, '9': false,
};

/** 마지막 글자에 받침이 있나. 한글·숫자가 아니면 true(→ "이에요")로 본다 */
export function hasFinalConsonant(word: string): boolean {
  const last = [...word.trim()].pop() ?? '';
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (last in DIGIT_HAS_BATCHIM) return DIGIT_HAS_BATCHIM[last];
  return true;
}

/** "함께한 지 1,977일째예요"의 숫자 부분 */
export const formatTogetherDays = (n: number) => formatNumber(n);

/** "결혼기념일까지 5일 남았어요" / 당일 "오늘은 결혼기념일이에요" · "오늘은 할머니 제사예요" */
export function ddaySentence(title: string, daysLeft: number): string {
  if (daysLeft === 0) return `오늘은 ${title}${hasFinalConsonant(title) ? '이에요' : '예요'}`;
  return `${title}까지 ${formatNumber(daysLeft)}일 남았어요`;
}

/** 카드 버튼 aria-label: "함께한 지 1,977일째, 결혼기념일까지 5일, 오늘 준호 생일. 일정 탭으로 가기" */
export function togetherCardAriaLabel(card: TogetherCard): string {
  const parts = [
    card.togetherDays != null ? `함께한 지 ${formatTogetherDays(card.togetherDays)}일째` : null,
    ...card.ddays.map((d) =>
      d.daysLeft === 0 ? `오늘 ${d.event.title}` : `${d.event.title}까지 ${formatNumber(d.daysLeft)}일`,
    ),
  ].filter(Boolean);
  return `${parts.join(', ')}. 일정 탭으로 가기`;
}
