/**
 * 가계부 탭(월 달력·목록·필터)의 계산 로직 — UI·저장소와 분리된 순수 함수.
 * 날짜는 모두 KST 날짜 문자열(YYYY-MM-DD)로 다룬다 (내역 occurred_on 이 KST 날짜로 저장됨).
 */
import type { Category, Member, Pocket, Transaction, TransactionType } from '../data/types';
import { currentYearMonth, isInMonth, type YearMonth } from './month';
import { TYPE_ORDER } from './transactionForm';

// ── 필터

/** 각 항목이 비어 있으면 "전체". 한 항목 안에서는 하나라도 맞으면(또는), 항목끼리는 모두 맞아야(그리고) 통과 */
export interface LedgerFilter {
  types: TransactionType[];
  /** member id */
  spenders: string[];
  /** 카테고리 대분류 id (그 아래 소분류 내역이 모두 포함된다) */
  categories: string[];
  /** pocket id. 주머니가 없는 내역(수입·저축)은 주머니 필터를 고르면 빠진다 */
  pockets: string[];
}

export type FilterKey = keyof LedgerFilter;

export const EMPTY_FILTER: LedgerFilter = { types: [], spenders: [], categories: [], pockets: [] };

export function activeFilterCount(f: LedgerFilter): number {
  return f.types.length + f.spenders.length + f.categories.length + f.pockets.length;
}

/** 값이 있으면 빼고 없으면 넣는다 */
export function toggleFilter(f: LedgerFilter, key: FilterKey, value: string): LedgerFilter {
  const list: string[] = f[key];
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return { ...f, [key]: next };
}

/** 소분류 id → 대분류 id (대분류 자신은 자기 id) */
export function parentIdMap(categories: Pick<Category, 'id' | 'parent_id'>[]): Map<string, string> {
  return new Map(categories.map((c) => [c.id, c.parent_id ?? c.id]));
}

type FilterableTx = Pick<Transaction, 'type' | 'spender_id' | 'category_id' | 'pocket_id'>;

export function filterTransactions<T extends FilterableTx>(
  transactions: readonly T[],
  filter: LedgerFilter,
  categories: Pick<Category, 'id' | 'parent_id'>[],
): T[] {
  if (activeFilterCount(filter) === 0) return [...transactions];
  const parentOf = parentIdMap(categories);
  return transactions.filter(
    (t) =>
      (filter.types.length === 0 || filter.types.includes(t.type)) &&
      (filter.spenders.length === 0 || filter.spenders.includes(t.spender_id)) &&
      (filter.categories.length === 0 || filter.categories.includes(parentOf.get(t.category_id) ?? t.category_id)) &&
      (filter.pockets.length === 0 || (t.pocket_id !== null && filter.pockets.includes(t.pocket_id))),
  );
}

// ── 필터 선택지

export interface FilterOption {
  id: string;
  label: string;
}

const byOrder = (a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko');

/** 사람: 현재 멤버(참여 순) + 이 달 내역에 나오는 나간 멤버("이름 (나감)") */
export function spenderFilterOptions(members: Member[], usedIds: ReadonlySet<string>): FilterOption[] {
  return members
    .filter((m) => m.left_at === null || usedIds.has(m.id))
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
    .map((m) => ({ id: m.id, label: m.left_at ? `${m.display_name} (나감)` : m.display_name }));
}

/** 주머니: 숨기지 않은 것 + 이 달 내역에 쓰인 숨긴 주머니. 순서대로 */
export function pocketFilterOptions(pockets: Pocket[], usedIds: ReadonlySet<string>): FilterOption[] {
  return pockets
    .filter((p) => !p.is_hidden || usedIds.has(p.id))
    .sort(byOrder)
    .map((p) => ({ id: p.id, label: p.name }));
}

export interface CategoryFilterGroup {
  type: TransactionType;
  options: FilterOption[];
}

/** 카테고리: 유형별 대분류. 숨긴 대분류는 이 달 내역에 쓰였을 때만 */
export function categoryFilterGroups(categories: Category[], usedCategoryIds: ReadonlySet<string>): CategoryFilterGroup[] {
  const parentOf = parentIdMap(categories);
  const usedParents = new Set([...usedCategoryIds].map((id) => parentOf.get(id) ?? id));
  return TYPE_ORDER.map((type) => ({
    type,
    options: categories
      .filter((c) => c.type === type && c.parent_id === null && (!c.is_hidden || usedParents.has(c.id)))
      .sort(byOrder)
      .map((c) => ({ id: c.id, label: c.name })),
  })).filter((g) => g.options.length > 0);
}

// ── 날짜별 묶기·합계

export interface DayTotals {
  expense: number;
  income: number;
  saving: number;
  count: number;
}

const ZERO: DayTotals = { expense: 0, income: 0, saving: 0, count: 0 };

/** 날짜(YYYY-MM-DD) → 그날 합계. 그 달 내역만 */
export function dailyTotals(
  transactions: readonly Pick<Transaction, 'type' | 'amount' | 'occurred_on'>[],
  month: YearMonth,
): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const t of transactions) {
    if (!isInMonth(t.occurred_on, month)) continue;
    const cur = map.get(t.occurred_on) ?? { ...ZERO };
    cur[t.type] += t.amount;
    cur.count += 1;
    map.set(t.occurred_on, cur);
  }
  return map;
}

export interface DayGroup<T> {
  date: string;
  items: T[];
}

/** 날짜별로 묶기: 최근 날짜가 위, 같은 날은 나중에 입력한 것이 위 */
export function groupByDate<T extends Pick<Transaction, 'occurred_on' | 'created_at'>>(
  transactions: readonly T[],
): DayGroup<T>[] {
  const sorted = [...transactions].sort(
    (a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at),
  );
  const groups: DayGroup<T>[] = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.occurred_on) last.items.push(t);
    else groups.push({ date: t.occurred_on, items: [t] });
  }
  return groups;
}

// ── 달력

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** 그 달 달력: 일요일 시작 주 단위. 그 달이 아닌 칸은 null */
export function calendarWeeks(month: YearMonth): (string | null)[][] {
  const [y, m] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = 일
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** '2026-11-06' → 요일 번호(0 = 일) */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** '2026-11-06' → '11월 6일 (금)' */
export function formatDayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAY_LABELS[weekdayOf(date)]})`;
}

/** '2026-11-06' → 6 */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/**
 * 달력 칸용 짧은 금액 (360px에서 한 칸 ≈ 46px). 실제보다 커 보이지 않게 내림.
 *   9,500 → "9,500" / 12,500 → "1.2만" / 1,240,000 → "124만" / 12,345,678 → "1234만" / 150,000,000 → "1.5억" / 2,500,000,000 → "25억"
 * 정확한 금액은 칸의 접근성 이름과 그날 내역 목록에서 보인다.
 */
export function compactWon(amount: number): string {
  const n = Math.max(0, Math.trunc(amount));
  if (n < 10_000) return n.toLocaleString('ko-KR');
  const unit = n < 100_000_000 ? { size: 10_000, name: '만' } : { size: 100_000_000, name: '억' };
  const v = n / unit.size;
  if (v < 10) {
    const oneDecimal = Math.floor(v * 10) / 10;
    return `${Number.isInteger(oneDecimal) ? oneDecimal : oneDecimal.toFixed(1)}${unit.name}`;
  }
  return `${Math.floor(v)}${unit.name}`;
}

// ── 화면 상태 ↔ 주소(쿼리)

export type LedgerViewMode = 'list' | 'calendar';

export interface LedgerQuery {
  month: YearMonth;
  view: LedgerViewMode;
  /** 달력에서 고른 날짜 (그 달 안일 때만) */
  day: string | null;
  filter: LedgerFilter;
}

const ID_RE = /^[0-9a-zA-Z-]{1,64}$/;
const FILTER_PARAM: Record<FilterKey, string> = { types: 'type', spenders: 'spender', categories: 'category', pockets: 'pocket' };

function listParam(params: URLSearchParams, name: string): string[] {
  const raw = params.get(name);
  if (!raw) return [];
  return [...new Set(raw.split(',').filter((v) => ID_RE.test(v)))];
}

/** 주소 쿼리 → 화면 상태. 잘못된 값은 기본값으로 */
export function parseLedgerQuery(params: URLSearchParams, now: Date = new Date()): LedgerQuery {
  const rawMonth = params.get('month');
  const month = rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : currentYearMonth(now);
  const view: LedgerViewMode = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const rawDay = params.get('day');
  // 그 달 달력에 있는 날짜만 (2026-11-31 같은 없는 날짜·다른 달은 버림)
  const day = rawDay && calendarWeeks(month).some((w) => w.includes(rawDay)) ? rawDay : null;
  return {
    month,
    view,
    day,
    filter: {
      types: listParam(params, FILTER_PARAM.types).filter((t): t is TransactionType => (TYPE_ORDER as string[]).includes(t)),
      spenders: listParam(params, FILTER_PARAM.spenders),
      categories: listParam(params, FILTER_PARAM.categories),
      pockets: listParam(params, FILTER_PARAM.pockets),
    },
  };
}

/** 화면 상태 → 주소 쿼리 (기본값은 생략: 이번 달·목록·필터 없음 → 빈 문자열) */
export function buildLedgerQuery(q: LedgerQuery, now: Date = new Date()): string {
  const params = new URLSearchParams();
  if (q.month !== currentYearMonth(now)) params.set('month', q.month);
  if (q.view === 'calendar') params.set('view', 'calendar');
  if (q.day && isInMonth(q.day, q.month)) params.set('day', q.day);
  for (const key of Object.keys(FILTER_PARAM) as FilterKey[]) {
    if (q.filter[key].length > 0) params.set(FILTER_PARAM[key], q.filter[key].join(','));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
