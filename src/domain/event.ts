/**
 * 일정 — 반복 펼치기·달력 칸·문구·입력값 검사 (화면과 분리된 순수 함수).
 * 날짜는 모두 KST 날짜 문자열 'YYYY-MM-DD' 로 다룬다 (design.md 5.24·5.25, BANB-2 일정 명세).
 */
import type { CalendarEvent, EventKind, EventRepeat, Member } from '../data/types';
import { addMonths, type YearMonth } from './month';
import { lunarToSolar, lunarToSolarClamped, solarToLunar, type LunarDate } from './lunar';

export const EVENT_TITLE_MAX = 20;
export const EVENT_PLACE_MAX = 30;
export const EVENT_MEMO_MAX = 100;
/** 홈 D-day 고정: 가계부당 최대 (DB 트리거와 같은 값) */
export const EVENT_PIN_MAX = 2;
/** 달력 한 칸에 보이는 최대 줄 수. 넘치면 (MAX - 1)개 + "+n" */
export const CELL_MAX_LINES = 3;
export const TOGETHER_LABEL = '함께';

export const EVENT_KINDS: readonly { value: EventKind; label: string }[] = [
  { value: 'anniversary', label: '기념일' },
  { value: 'appointment', label: '약속' },
  { value: 'bill_day', label: '정기 지출일' },
  { value: 'other', label: '기타' },
];
export const EVENT_KIND_LABEL: Record<EventKind, string> = Object.fromEntries(
  EVENT_KINDS.map((k) => [k.value, k.label]),
) as Record<EventKind, string>;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

// ── 날짜 계산 (UTC 자정으로 계산해 시간대 영향 없음)

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}
function toDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function dayNumber(date: string): number {
  const [y, m, d] = parts(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}
function fromDayNumber(n: number): string {
  const dt = new Date(n * 86_400_000);
  return toDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function addDays(date: string, delta: number): string {
  return fromDayNumber(dayNumber(date) + delta);
}
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** 0 = 일요일 */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** 두 날짜 사이 날 수 (to − from) */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

// ── 반복 펼치기

/**
 * 일정 1건이 [start, end] (둘 다 포함) 안에서 보이는 날짜들. 첫 회차(event_date)보다 앞 날짜는 없다.
 * - 매주: 같은 요일
 * - 매월: 같은 일. 그 달에 없는 날(29~31일)이면 그 달 말일
 * - 매년: 같은 월·일. 2월 29일은 평년에 2월 28일
 * - 매년(음력): 해마다 음력 월·일을 양력으로. 작은달이라 30일이 없으면 29일, 윤달은 평달 기준. 변환 범위 밖이면 그해는 없음
 */
export function occurrencesInRange(
  event: Pick<CalendarEvent, 'event_date' | 'repeat' | 'lunar_month' | 'lunar_day'>,
  start: string,
  end: string,
): string[] {
  const first = event.event_date;
  const from = first > start ? first : start;
  if (from > end) return [];
  const inRange = (d: string) => d >= from && d <= end;
  const out: string[] = [];

  switch (event.repeat) {
    case 'none':
      return inRange(first) ? [first] : [];
    case 'weekly': {
      const offset = (((daysBetween(first, from)) % 7) + 7) % 7;
      for (let d = addDays(from, offset === 0 ? 0 : 7 - offset); d <= end; d = addDays(d, 7)) out.push(d);
      return out;
    }
    case 'monthly': {
      const [, , day] = parts(first);
      for (let ym: YearMonth = from.slice(0, 7); ym <= end.slice(0, 7); ym = addMonths(ym, 1)) {
        const [y, m] = ym.split('-').map(Number);
        const d = toDate(y, m, Math.min(day, daysInMonth(y, m)));
        if (inRange(d)) out.push(d);
      }
      return out;
    }
    case 'yearly': {
      const [, month, day] = parts(first);
      for (let y = Number(from.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
        const d = toDate(y, month, Math.min(day, daysInMonth(y, month)));
        if (inRange(d)) out.push(d);
      }
      return out;
    }
    case 'yearly_lunar': {
      if (event.lunar_month == null || event.lunar_day == null) return [];
      // 음력 해는 양력 해보다 늦게 시작하므로 한 해 앞부터 본다
      for (let y = Number(from.slice(0, 4)) - 1; y <= Number(end.slice(0, 4)); y++) {
        const d = lunarToSolarClamped({ year: y, month: event.lunar_month, day: event.lunar_day });
        if (d && inRange(d)) out.push(d);
      }
      return out.sort();
    }
  }
}

/** 한 날짜에 보이는 일정 1건 (반복 일정이면 그 회차) */
export interface EventOccurrence {
  event: CalendarEvent;
  date: string;
}

const KIND_ORDER: Record<EventKind, number> = { anniversary: 0, bill_day: 1, appointment: 2, other: 3 };

/** 한 칸 안 순서 (design.md 5.24): 종일(기념일 → 정기 지출일 → 약속 → 기타) → 시각 있는 일정(이른 순). 같으면 먼저 만든 것 */
export function compareOccurrences(a: CalendarEvent, b: CalendarEvent): number {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  if (a.all_day) {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
  } else if (a.start_time !== b.start_time) {
    return (a.start_time ?? '') < (b.start_time ?? '') ? -1 : 1;
  }
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 일정들을 [start, end] 안에서 펼쳐 날짜별로 (각 날짜 안은 compareOccurrences 순) */
export function expandEvents(events: readonly CalendarEvent[], start: string, end: string): Map<string, EventOccurrence[]> {
  const byDate = new Map<string, EventOccurrence[]>();
  for (const event of events) {
    for (const date of occurrencesInRange(event, start, end)) {
      const list = byDate.get(date) ?? [];
      list.push({ event, date });
      byDate.set(date, list);
    }
  }
  for (const list of byDate.values()) list.sort((a, b) => compareOccurrences(a.event, b.event));
  return byDate;
}

// ── 달력

export interface CalendarCell {
  date: string;
  /** 보고 있는 달의 날짜인가 (아니면 흐리게) */
  inMonth: boolean;
}

/** 월 달력 칸: 첫 주 일요일부터 마지막 주 토요일까지 (앞뒤 달 날짜 포함), 주 단위 */
export function monthGrid(month: YearMonth): CalendarCell[][] {
  const [y, m] = month.split('-').map(Number);
  const first = toDate(y, m, 1);
  const last = toDate(y, m, daysInMonth(y, m));
  const start = addDays(first, -weekdayOfDate(first));
  const end = addDays(last, 6 - weekdayOfDate(last));
  const weeks: CalendarCell[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i);
      return { date, inMonth: date.slice(0, 7) === month };
    }));
  }
  return weeks;
}

/** 달력에 보이는 범위 (앞뒤 달 날짜 포함) */
export function gridRange(month: YearMonth): { start: string; end: string } {
  const weeks = monthGrid(month);
  return { start: weeks[0][0].date, end: weeks[weeks.length - 1][6].date };
}

/** 칸에 그릴 칩: 최대 3줄. 4개 이상이면 2개 + "+n" (n = 나머지 수) */
export function cellChips<T>(items: readonly T[], maxLines = CELL_MAX_LINES): { shown: T[]; more: number } {
  if (items.length <= maxLines) return { shown: [...items], more: 0 };
  return { shown: items.slice(0, maxLines - 1), more: items.length - (maxLines - 1) };
}

// ── 누구 (색)

/** 일정 색 번호: 함께 = 'together', 멤버 = 참여 순 1~4 (나간 멤버도 자기 자리 그대로 — design.md 1.6) */
export function eventColor(targetMemberId: string | null, members: readonly Member[]): 'together' | 1 | 2 | 3 | 4 {
  if (!targetMemberId) return 'together';
  const ordered = [...members].sort((a, b) => (a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : 0));
  const i = ordered.findIndex((m) => m.id === targetMemberId);
  if (i < 0) return 'together';
  return ((i % 4) + 1) as 1 | 2 | 3 | 4;
}

/** 누구 이름: 함께 / 이름 / 이름 (나감) */
export function targetLabel(targetMemberId: string | null, members: readonly Member[]): string {
  if (!targetMemberId) return TOGETHER_LABEL;
  const m = members.find((x) => x.id === targetMemberId);
  if (!m) return '알 수 없음';
  return m.left_at ? `${m.display_name} (나감)` : m.display_name;
}

// ── 문구

/** '19:00:00' → '오후 7:00', '00:30' → '오전 12:30' */
export function formatTime(time: string): string {
  const [h, min] = time.split(':').map(Number);
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}:${pad2(min)}`;
}

/** 화면낭독용 시각: '오후 7시', '오후 6시 30분' */
function spokenTime(time: string): string {
  const [h, min] = time.split(':').map(Number);
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}시${min ? ` ${min}분` : ''}`;
}

/** '2026-11-14' → '11월 14일 (토)' */
export function formatEventDay(date: string): string {
  const [, m, d] = parts(date);
  return `${m}월 ${d}일 (${WEEKDAYS[weekdayOfDate(date)]})`;
}

/** 반복 문구 (날짜에서 만든다): '매주 토요일' · '매월 14일' · '매년 11월 14일' · '매년 음력 10월 3일'. 안 함 = '' */
export function repeatLabel(
  repeat: EventRepeat,
  date: string,
  lunar?: Pick<LunarDate, 'month' | 'day'> | null,
): string {
  const [, m, d] = parts(date);
  switch (repeat) {
    case 'none':
      return '';
    case 'weekly':
      return `매주 ${WEEKDAYS[weekdayOfDate(date)]}요일`;
    case 'monthly':
      return `매월 ${d}일`;
    case 'yearly':
      return `매년 ${m}월 ${d}일`;
    case 'yearly_lunar':
      return lunar ? `매년 음력 ${lunar.month}월 ${lunar.day}일` : '매년 (음력)';
  }
}

/** 반복 시트 선택지 (design.md 5.25): 안 함 / 매주 (토요일) / 매월 (14일) / 매년 (11월 14일) / 매년 (음력) — 음력은 기념일만 */
export function repeatOptions(date: string, kind: EventKind): { value: EventRepeat; label: string }[] {
  const [, m, d] = parts(date);
  const options: { value: EventRepeat; label: string }[] = [
    { value: 'none', label: '안 함' },
    { value: 'weekly', label: `매주 (${WEEKDAYS[weekdayOfDate(date)]}요일)` },
    { value: 'monthly', label: `매월 (${d}일)` },
    { value: 'yearly', label: `매년 (${m}월 ${d}일)` },
  ];
  if (kind === 'anniversary') options.push({ value: 'yearly_lunar', label: '매년 (음력)' });
  return options;
}

/** 반복 행 짧은 값: '안 함' · '매주' · '매월' · '매년' · '매년 (음력)' */
export const REPEAT_SHORT: Record<EventRepeat, string> = {
  none: '반복 안 함',
  weekly: '매주',
  monthly: '매월',
  yearly: '매년',
  yearly_lunar: '매년 (음력)',
};

/** 이 일정 행의 보조 줄: '누구 · 시각 · 반복 · 장소' (없는 것은 뺀다) */
export function eventSubline(event: CalendarEvent, members: readonly Member[]): string {
  const lunar = event.lunar_month && event.lunar_day ? { month: event.lunar_month, day: event.lunar_day } : null;
  return [
    targetLabel(event.target_member_id, members),
    event.all_day || !event.start_time ? null : formatTime(event.start_time),
    repeatLabel(event.repeat, event.event_date, lunar) || null,
    event.place,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 칸 버튼 aria-label: '11월 14일 토요일, 일정 2개: 결혼기념일 함께, 레스토랑 함께 오후 7시' / 없으면 '11월 14일 토요일, 일정 없음' */
export function dayAriaLabel(date: string, items: readonly EventOccurrence[], members: readonly Member[]): string {
  const [, m, d] = parts(date);
  const head = `${m}월 ${d}일 ${WEEKDAYS[weekdayOfDate(date)]}요일`;
  if (items.length === 0) return `${head}, 일정 없음`;
  const list = items
    .map(({ event }) =>
      [event.title, targetLabel(event.target_member_id, members), event.all_day || !event.start_time ? null : spokenTime(event.start_time)]
        .filter(Boolean)
        .join(' '),
    )
    .join(', ');
  return `${head}, 일정 ${items.length}개: ${list}`;
}

/** D-day 배지: 'D-5' · 'D-day' · 'D+3' (오늘 기준) */
export function formatDday(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'D-day';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

/** 다음 회차 (오늘 포함). 범위 밖 등으로 없으면 null — 고정 배지 D-n 에 쓴다 */
export function nextOccurrence(event: CalendarEvent, today: string): string | null {
  return occurrencesInRange(event, today, addDays(today, 366 * 2))[0] ?? null;
}

// ── 입력값

export type CalendarKind = 'solar' | 'lunar';

export interface EventFormValues {
  title: string;
  kind: EventKind;
  targetMemberId: string | null;
  calendar: CalendarKind;
  /** 양력 날짜 'YYYY-MM-DD' (calendar = solar) */
  date: string;
  /** 음력 날짜 (calendar = lunar) */
  lunar: LunarDate;
  repeat: EventRepeat;
  allDay: boolean;
  /** 'HH:MM' (allDay = false) */
  time: string;
  pinned: boolean;
  place: string;
  memo: string;
}

/** 저장할 값 (DB 열과 같은 이름) */
export interface EventInput {
  title: string;
  kind: EventKind;
  event_date: string;
  all_day: boolean;
  start_time: string | null;
  repeat: EventRepeat;
  lunar_month: number | null;
  lunar_day: number | null;
  target_member_id: string | null;
  place: string | null;
  memo: string | null;
  pinned: boolean;
}

export type EventFormErrors = Partial<Record<'title' | 'date' | 'time' | 'place' | 'memo', string>>;

/** 새 일정 기본값: 종류 약속, 누구 함께, 날짜 = 주어진 날(오늘 또는 고른 날), 종일, 반복 안 함 */
export function newEventValues(date: string): EventFormValues {
  const lunar = solarToLunar(date);
  return {
    title: '',
    kind: 'appointment',
    targetMemberId: null,
    calendar: 'solar',
    date,
    lunar: lunar ? { year: lunar.year, month: lunar.month, day: lunar.day } : { year: Number(date.slice(0, 4)), month: 1, day: 1 },
    repeat: 'none',
    allDay: true,
    time: '19:00',
    pinned: false,
    place: '',
    memo: '',
  };
}

/** 저장된 일정 → 입력값 */
export function eventToValues(event: CalendarEvent): EventFormValues {
  const base = newEventValues(event.event_date);
  const isLunar = event.repeat === 'yearly_lunar' && event.lunar_month != null && event.lunar_day != null;
  const firstLunar = solarToLunar(event.event_date);
  return {
    ...base,
    title: event.title,
    kind: event.kind,
    targetMemberId: event.target_member_id,
    calendar: isLunar ? 'lunar' : 'solar',
    lunar: isLunar
      ? { year: firstLunar?.year ?? base.lunar.year, month: event.lunar_month!, day: event.lunar_day! }
      : base.lunar,
    repeat: event.repeat,
    allDay: event.all_day,
    time: event.start_time ? event.start_time.slice(0, 5) : base.time,
    pinned: event.pinned_at != null,
    place: event.place ?? '',
    memo: event.memo ?? '',
  };
}

/**
 * 종류를 바꿀 때 함께 바뀌는 값: 기념일이 아니면 음력·음력 반복·D-day 고정을 푼다
 * (음력 → 양력으로 돌릴 때는 지금 음력 날짜의 양력 날짜를 쓴다)
 */
export function withKind(values: EventFormValues, kind: EventKind): EventFormValues {
  if (kind === 'anniversary') return { ...values, kind };
  const date = values.calendar === 'lunar' ? (lunarToSolar(values.lunar) ?? values.date) : values.date;
  return {
    ...values,
    kind,
    calendar: 'solar',
    date,
    repeat: values.repeat === 'yearly_lunar' ? 'yearly' : values.repeat,
    pinned: false,
  };
}

/** 양력/음력 전환: 음력이면 반복은 매년(음력)으로 고정, 양력으로 돌아오면 매년 */
export function withCalendar(values: EventFormValues, calendar: CalendarKind): EventFormValues {
  if (calendar === values.calendar) return values;
  if (calendar === 'lunar') {
    const l = solarToLunar(values.date);
    return {
      ...values,
      calendar,
      lunar: l ? { year: l.year, month: l.month, day: l.day } : values.lunar,
      repeat: 'yearly_lunar',
    };
  }
  return { ...values, calendar, date: lunarToSolar(values.lunar) ?? values.date, repeat: 'yearly' };
}

/** 지금 입력값의 첫 회차 양력 날짜 (음력이면 변환, 범위 밖이면 null) */
export function solarDateOf(values: Pick<EventFormValues, 'calendar' | 'date' | 'lunar'>): string | null {
  return values.calendar === 'lunar' ? lunarToSolar(values.lunar) : values.date;
}

export function validateEventForm(
  values: EventFormValues,
): { ok: true; value: EventInput } | { ok: false; errors: EventFormErrors } {
  const errors: EventFormErrors = {};
  const title = values.title.trim();
  if (title.length === 0) errors.title = '제목을 적어 주세요';
  else if ([...title].length > EVENT_TITLE_MAX) errors.title = `제목은 ${EVENT_TITLE_MAX}자까지 쓸 수 있어요`;

  const lunar = values.calendar === 'lunar';
  const eventDate = solarDateOf(values);
  if (lunar && values.kind !== 'anniversary') errors.date = '음력 날짜는 기념일만 고를 수 있어요';
  else if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) errors.date = lunar ? '음력 날짜를 확인해 주세요' : '날짜를 골라 주세요';

  const repeat: EventRepeat = lunar ? 'yearly_lunar' : values.repeat;
  if (!lunar && repeat === 'yearly_lunar') errors.date = '음력 반복은 음력 날짜를 골라 주세요';

  if (!values.allDay && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time)) errors.time = '시각을 골라 주세요';

  const place = values.place.trim();
  const memo = values.memo.trim();
  if ([...place].length > EVENT_PLACE_MAX) errors.place = `장소는 ${EVENT_PLACE_MAX}자까지 쓸 수 있어요`;
  if ([...memo].length > EVENT_MEMO_MAX) errors.memo = `메모는 ${EVENT_MEMO_MAX}자까지 쓸 수 있어요`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      kind: values.kind,
      event_date: eventDate!,
      all_day: values.allDay,
      start_time: values.allDay ? null : `${values.time}:00`,
      repeat,
      lunar_month: lunar ? values.lunar.month : null,
      lunar_day: lunar ? values.lunar.day : null,
      target_member_id: values.targetMemberId,
      place: place || null,
      memo: memo || null,
      pinned: values.kind === 'anniversary' && values.pinned,
    },
  };
}
