/**
 * 카테고리 선택 시트·추가 화면의 계산 (BANB-36 한 단계 격자). 순수 함수.
 *
 * 구조: 내역은 소분류에 저장한다. 대분류마다 같은 이름 소분류(self)가 있고, 화면은 그것을 따로 보이지 않는다.
 * - 대분류 격자 한 단계: 대분류를 누르면 바로 self 가 선택된다.
 * - 그 대분류에 보이는 다른 소분류(subs)가 있으면 그때만 두 번째 단계: 맨 앞 "대분류 이름"(= self) + subs.
 * - 자주 쓰는 8개 먼저: 최근 3개월 내역 수 많은 순(소분류는 대분류로 합산), 같으면 최근 내역 날짜 → 입력 시각 순.
 *   8개가 안 되면 기본 순서로 채운다. 나머지는 "전체 보기".
 */
import type { Category, TransactionType } from '../data/types';
import { checkName } from './catalog';
import type { CategoryGroup } from './transactionForm';

export const FREQUENT_MAX = 8;
/** 자주 쓰는 것을 셀 기간(개월) */
export const FREQUENT_MONTHS = 3;

/** 대분류와 같은 이름의 소분류 = 대분류 자체를 고르는 자리 (화면에 따로 보이지 않음) */
export function isSelfChild(child: Category, parent: Category): boolean {
  return child.parent_id === parent.id && child.name === parent.name;
}

export interface PickerGroup {
  parent: Category;
  /** 대분류 자체 선택지(같은 이름 소분류). 숨겼으면 null */
  self: Category | null;
  /** 보이는 다른 소분류 (사용자가 추가했거나 기존에 쓰던 것). 있으면 두 번째 단계 */
  subs: Category[];
}

export interface PickerModel {
  /** 자주 쓰는 대분류 (최대 8개, 모자라면 기본 순서로 채움) */
  frequent: PickerGroup[];
  /** 나머지 대분류 (기본 순서). "전체 보기"에서 보인다 */
  rest: PickerGroup[];
}

/** 자주 쓰는 순위를 셀 내역 1건 (기간·미래 날짜는 조회에서 거른다) */
export interface CategoryUse {
  category_id: string;
  occurred_on: string;
  created_at: string;
}

export function toPickerGroups(groups: readonly CategoryGroup[]): PickerGroup[] {
  return groups.map(({ parent, children }) => ({
    parent,
    self: children.find((c) => isSelfChild(c, parent)) ?? null,
    subs: children.filter((c) => !isSelfChild(c, parent)),
  }));
}

/** 누르면 바로 선택되는가(두 번째 단계 없음) */
export function selectsDirectly(g: PickerGroup): boolean {
  return g.subs.length === 0;
}

/** 두 번째 단계 선택지: 맨 앞 대분류 이름(self) → 소분류 */
export function secondStepOptions(g: PickerGroup): Category[] {
  return g.self ? [g.self, ...g.subs] : [...g.subs];
}

interface Rank {
  count: number;
  lastOn: string;
  lastAt: string;
}

/**
 * groups: categoryGroups() 결과 (숨김 제외·순서 정렬 끝난 것, 지금 종류만)
 * categories: 그 가계부 카테고리 전부 (소분류 → 대분류를 찾는 데 씀)
 * uses: 최근 3개월 내역 (종류 상관없이 넘겨도 된다 — 지금 종류의 대분류만 센다)
 */
export function buildPickerModel(
  groups: readonly CategoryGroup[],
  categories: readonly Category[],
  uses: readonly CategoryUse[],
  max = FREQUENT_MAX,
): PickerModel {
  const all = toPickerGroups(groups);
  const parentOf = new Map(categories.map((c) => [c.id, c.parent_id ?? c.id]));
  const ranks = new Map<string, Rank>();
  for (const u of uses) {
    const pid = parentOf.get(u.category_id);
    if (!pid) continue;
    const r = ranks.get(pid) ?? { count: 0, lastOn: '', lastAt: '' };
    r.count += 1;
    if (u.occurred_on > r.lastOn || (u.occurred_on === r.lastOn && u.created_at > r.lastAt)) {
      r.lastOn = u.occurred_on;
      r.lastAt = u.created_at;
    }
    ranks.set(pid, r);
  }
  const used = all
    .map((g, order) => ({ g, order, r: ranks.get(g.parent.id) }))
    .filter((x): x is { g: PickerGroup; order: number; r: Rank } => !!x.r)
    .sort(
      (a, b) =>
        b.r.count - a.r.count ||
        b.r.lastOn.localeCompare(a.r.lastOn) ||
        b.r.lastAt.localeCompare(a.r.lastAt) ||
        a.order - b.order,
    )
    .map((x) => x.g)
    .slice(0, max);
  const picked = new Set(used);
  const frequent = [...used, ...all.filter((g) => !picked.has(g)).slice(0, max - used.length)];
  const inFrequent = new Set(frequent);
  return { frequent, rest: all.filter((g) => !inFrequent.has(g)) };
}

/** 그룹 안에 이 카테고리(소분류 id)가 있는가 — 선택 표시·"전체 보기" 자동 펼침 */
export function groupHas(g: PickerGroup, categoryId: string): boolean {
  return g.self?.id === categoryId || g.subs.some((c) => c.id === categoryId);
}

/** 자주 쓰는 것을 셀 기간: 오늘(KST)부터 3개월 전 같은 날 ~ 오늘. 그 달에 같은 날이 없으면 그 달 마지막 날 */
export function frequentRange(today: string, months = FREQUENT_MONTHS): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`, to: today };
}

/** 추가 화면에서 고른 넣을 곳 */
export type ParentChoice = { kind: 'existing'; id: string } | { kind: 'new' };

export type CategoryDraftCheck = { ok: true; name: string } | { ok: false; reason: string };

/**
 * 추가·수정 화면의 저장 가능 여부 (버튼 비활성 + 이유 한 줄).
 * - 이름 1~20자
 * - 같은 대분류 안(새 대분류면 같은 종류의 대분류끼리)에 같은 이름이 없어야 한다 (숨긴 것 포함)
 * 수정: editing 을 넘기면 그 항목의 형제들과 비교하고 자기 자신은 뺀다.
 */
export function checkCategoryDraft(input: {
  name: string;
  type: TransactionType;
  categories: readonly Category[];
  parent?: ParentChoice | null;
  editing?: Category;
}): CategoryDraftCheck {
  const named = checkName(input.name);
  if (!named.ok) return { ok: false, reason: named.error };

  let siblings: Category[];
  if (input.editing) {
    const e = input.editing;
    siblings = input.categories.filter((c) => c.type === e.type && c.parent_id === e.parent_id && c.id !== e.id);
  } else if (!input.parent) {
    return { ok: false, reason: '넣을 대분류를 골라 주세요.' };
  } else if (input.parent.kind === 'new') {
    siblings = input.categories.filter((c) => c.type === input.type && c.parent_id === null);
  } else {
    const parentId = input.parent.id;
    siblings = input.categories.filter((c) => c.parent_id === parentId);
  }
  if (siblings.some((c) => c.name.trim() === named.value)) {
    const parentLevel = input.editing ? input.editing.parent_id === null : input.parent?.kind === 'new';
    return { ok: false, reason: parentLevel ? '같은 이름의 대분류가 이미 있어요.' : '같은 대분류에 같은 이름이 이미 있어요.' };
  }
  return { ok: true, name: named.value };
}
