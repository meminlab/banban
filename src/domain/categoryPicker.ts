/**
 * 카테고리 선택 시트·추가 화면의 계산 (design.md 5.17). 순수 함수.
 */
import type { Category, TransactionType } from '../data/types';
import { checkName } from './catalog';
import type { CategoryGroup } from './transactionForm';

export const RECENT_MAX = 4;

export interface PickerModel {
  /** 이 사람이 최근 쓴 소분류 (겹치지 않게, 최대 4개). 없으면 빈 배열 → 줄을 숨긴다 */
  recent: Category[];
  /** 소분류가 대분류와 다른 이름으로 있는 대분류: 구역 하나씩 */
  sections: CategoryGroup[];
  /** 대분류와 같은 이름의 소분류 하나뿐인 것(경조사·선물, 교육 …): 마지막 "그 밖의 분류" 격자 */
  others: Category[];
}

function isSingleSameName(g: CategoryGroup): boolean {
  return g.children.length === 1 && g.children[0].name === g.parent.name;
}

/**
 * groups: categoryGroups() 결과 (숨김 제외·순서 정렬 끝난 것)
 * recentCategoryIds: 최근 쓴 순서의 내역 category_id (겹쳐도 됨)
 */
export function buildPickerModel(groups: readonly CategoryGroup[], recentCategoryIds: readonly string[]): PickerModel {
  const selectable = new Map(groups.flatMap((g) => g.children.map((c) => [c.id, c] as const)));
  const recent: Category[] = [];
  for (const id of recentCategoryIds) {
    const c = selectable.get(id);
    if (c && !recent.includes(c)) recent.push(c);
    if (recent.length === RECENT_MAX) break;
  }
  return {
    recent,
    sections: groups.filter((g) => !isSingleSameName(g)),
    others: groups.filter(isSingleSameName).map((g) => g.children[0]),
  };
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
