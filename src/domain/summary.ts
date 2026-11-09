/**
 * 홈 월 요약 집계 — UI·저장소와 분리된 순수 함수.
 * 기준: BANB-2 확정 명세 "집계 규칙"
 *   - 월 기준: 내역 날짜의 연-월(KST)
 *   - 수입/지출/저축 = 각 type 합, 남은 돈 = 수입 − 지출 − 저축
 *   - 숨긴 카테고리·주머니의 내역도 포함
 *   - 공동·개인은 주머니의 "현재" scope 기준 (지난 내역 포함)
 */
import type { Category, Member, Pocket, PocketScope, Transaction } from '../data/types';
import { isInMonth, type YearMonth } from './month';

export type SummaryTransaction = Pick<
  Transaction,
  'type' | 'amount' | 'occurred_on' | 'category_id' | 'pocket_id' | 'spender_id' | 'is_fixed'
>;
export type SummaryMember = Pick<Member, 'id' | 'display_name' | 'joined_at' | 'left_at'>;
export type SummaryPocket = Pick<Pocket, 'id' | 'name' | 'scope' | 'sort_order'>;
export type SummaryCategory = Pick<Category, 'id' | 'parent_id' | 'name' | 'sort_order'>;

export interface BreakdownRow {
  key: string;
  label: string;
  amount: number;
  /** 그 달 지출 합계 대비 비율 (0~1). 지출이 0이면 0 */
  ratio: number;
}

export interface MonthSummary {
  month: YearMonth;
  income: number;
  expense: number;
  saving: number;
  /** 수입 − 지출 − 저축 (음수 가능) */
  remaining: number;
  /** 그 달 내역 건수 (전체 type) */
  count: number;
  expenseBy: {
    /** 현재 멤버는 0원이어도 표시, 나간 멤버는 지출이 있을 때만 "(나감)" 붙여 표시. 참여 순 */
    spender: BreakdownRow[];
    /** 지출 있는 주머니만, 금액 큰 순 */
    pocket: BreakdownRow[];
    /** 공동 / 개인 (항상 2줄) */
    scope: BreakdownRow[];
    /** 고정 / 변동 (항상 2줄) */
    fixed: BreakdownRow[];
    /** 카테고리 대분류 상위 3개(TOP_CATEGORY_COUNT), 금액 큰 순 */
    topCategories: BreakdownRow[];
  };
}

export interface SummaryRefs {
  members: SummaryMember[];
  pockets: SummaryPocket[];
  categories: SummaryCategory[];
}

/** 홈 "어디에 썼나" 대분류 상위 개수 (design.md 5.4 3번) */
export const TOP_CATEGORY_COUNT = 3;
export const UNKNOWN_LABEL = '알 수 없음';
export const LEFT_SUFFIX = ' (나감)';
const SCOPE_LABEL: Record<PocketScope, string> = { shared: '공동', personal: '개인' };

function addTo(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function ratioOf(amount: number, total: number): number {
  return total > 0 ? amount / total : 0;
}

/** 금액 큰 순, 같으면 기준 순서(order) → 이름 순 */
function byAmountDesc(order: Map<string, number>) {
  return (a: BreakdownRow, b: BreakdownRow) =>
    b.amount - a.amount ||
    (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER) ||
    a.label.localeCompare(b.label, 'ko');
}

export function computeMonthSummary(
  month: YearMonth,
  transactions: readonly SummaryTransaction[],
  refs: SummaryRefs,
): MonthSummary {
  let income = 0;
  let expense = 0;
  let saving = 0;
  let count = 0;

  const bySpender = new Map<string, number>();
  const byPocket = new Map<string, number>();
  const byScope = new Map<string, number>(); // shared / personal / unknown
  let fixed = 0;
  const byParentCategory = new Map<string, number>();

  const pocketById = new Map(refs.pockets.map((p) => [p.id, p]));
  const categoryById = new Map(refs.categories.map((c) => [c.id, c]));

  for (const t of transactions) {
    if (!isInMonth(t.occurred_on, month)) continue;
    count += 1;
    if (t.type === 'income') {
      income += t.amount;
      continue;
    }
    if (t.type === 'saving') {
      saving += t.amount;
      continue;
    }
    // expense
    expense += t.amount;
    addTo(bySpender, t.spender_id, t.amount);

    const pocket = t.pocket_id ? pocketById.get(t.pocket_id) : undefined;
    addTo(byPocket, pocket?.id ?? 'unknown', t.amount);
    addTo(byScope, pocket?.scope ?? 'unknown', t.amount);

    if (t.is_fixed) fixed += t.amount;

    const category = categoryById.get(t.category_id);
    const parentId = category ? (category.parent_id ?? category.id) : 'unknown';
    addTo(byParentCategory, parentId, t.amount);
  }

  const row = (key: string, label: string, amount: number): BreakdownRow => ({
    key,
    label,
    amount,
    ratio: ratioOf(amount, expense),
  });

  // 사람별: 현재 멤버 전원 + 지출 있는 나간 멤버 + (참조 못 찾은 멤버)
  const membersInOrder = [...refs.members].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  const spender: BreakdownRow[] = [];
  for (const m of membersInOrder) {
    const amount = bySpender.get(m.id) ?? 0;
    bySpender.delete(m.id);
    if (m.left_at && amount === 0) continue;
    spender.push(row(m.id, m.left_at ? `${m.display_name}${LEFT_SUFFIX}` : m.display_name, amount));
  }
  const unknownSpender = [...bySpender.values()].reduce((s, v) => s + v, 0);
  if (unknownSpender > 0) spender.push(row('unknown', UNKNOWN_LABEL, unknownSpender));

  // 주머니별
  const pocketOrder = new Map(refs.pockets.map((p) => [p.id, p.sort_order]));
  const pocket = [...byPocket.entries()]
    .map(([id, amount]) => row(id, pocketById.get(id)?.name ?? UNKNOWN_LABEL, amount))
    .sort(byAmountDesc(pocketOrder));

  // 공동·개인
  const scope: BreakdownRow[] = (['shared', 'personal'] as const).map((s) =>
    row(s, SCOPE_LABEL[s], byScope.get(s) ?? 0),
  );
  const unknownScope = byScope.get('unknown') ?? 0;
  if (unknownScope > 0) scope.push(row('unknown', UNKNOWN_LABEL, unknownScope));

  // 고정·변동
  const fixedRows = [row('fixed', '고정', fixed), row('variable', '변동', expense - fixed)];

  // 카테고리 대분류 상위 3개
  const categoryOrder = new Map(refs.categories.map((c) => [c.id, c.sort_order]));
  const topCategories = [...byParentCategory.entries()]
    .map(([id, amount]) => row(id, categoryById.get(id)?.name ?? UNKNOWN_LABEL, amount))
    .sort(byAmountDesc(categoryOrder))
    .slice(0, TOP_CATEGORY_COUNT);

  return {
    month,
    income,
    expense,
    saving,
    remaining: income - expense - saving,
    count,
    expenseBy: { spender, pocket, scope, fixed: fixedRows, topCategories },
  };
}

/** 지금 멤버 수(나간 멤버 제외). 홈 "누가 썼나"는 1명 이하이면 숨긴다 (design.md 5.23) */
export function activeMemberCount(members: readonly Pick<SummaryMember, 'left_at'>[]): number {
  return members.filter((m) => !m.left_at).length;
}
