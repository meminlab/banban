/**
 * 카테고리·주머니 계산 (순수 함수, 화면·저장소와 무관)
 * - 정렬, 대분류 > 소분류 트리, 내역 입력에서 고를 수 있는 항목, 순서 바꾸기, 이름 검사
 */
import type { Category, Pocket, PocketScope, TransactionType } from '../data/types';

export const TRANSACTION_TYPES: readonly TransactionType[] = ['expense', 'income', 'saving'];
export const TYPE_LABEL: Record<TransactionType, string> = { expense: '지출', income: '수입', saving: '저축' };
export const SCOPE_LABEL: Record<PocketScope, string> = { shared: '공동', personal: '개인' };

/** 이름 길이 (DB와 같게 앞뒤 공백 제거 후 1~20자, 글자 수 = 코드 포인트 수) */
export const NAME_MAX = 20;

export type NameCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkName(raw: string): NameCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: '이름을 입력해 주세요.' };
  if ([...value].length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자까지 쓸 수 있어요.` };
  return { ok: true, value };
}

interface Ordered {
  id: string;
  sort_order: number;
  created_at: string;
}

/** 순서값 → 만든 시각 → id 순 (같은 순서값이어도 화면마다 같은 순서로 보이게) */
export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

export interface CategoryNode {
  category: Category;
  children: Category[];
}

/** 한 유형의 대분류 > 소분류 트리 (숨긴 항목 포함, 관리 화면용) */
export function buildCategoryTree(categories: readonly Category[], type: TransactionType): CategoryNode[] {
  const ofType = categories.filter((c) => c.type === type);
  return sortByOrder(ofType.filter((c) => c.parent_id === null)).map((parent) => ({
    category: parent,
    children: sortByOrder(ofType.filter((c) => c.parent_id === parent.id)),
  }));
}

/**
 * 내역 입력에서 고를 수 있는 카테고리 트리.
 * 숨긴 대분류(그 아래 소분류 포함)·숨긴 소분류는 빠지고, 고를 소분류가 없는 대분류도 빠진다.
 * 지난 내역 표시는 이 함수를 쓰지 않고 id로 이름을 찾는다(숨겨도 이름이 보이도록).
 */
export function selectableCategoryTree(categories: readonly Category[], type: TransactionType): CategoryNode[] {
  return buildCategoryTree(categories, type)
    .filter((node) => !node.category.is_hidden)
    .map((node) => ({ ...node, children: node.children.filter((c) => !c.is_hidden) }))
    .filter((node) => node.children.length > 0);
}

/**
 * 대분류 아이콘을 바꿀 때 함께 바꿀 소분류: 대분류와 이름이 같고(소분류 없이 만든 대분류의 자동 소분류),
 * 아이콘이 대분류의 원래 아이콘과 같거나 비어 있는 것. 소분류에 따로 다른 아이콘을 줬다면 그대로 둔다.
 * (선택 시트의 "그 밖의 분류"는 이 소분류를 보여 주므로, 대분류만 바꾸면 화면에 반영되지 않는다 — BANB-24 QA 결함 1)
 */
export function iconFollowers(categories: readonly Category[], parent: Category): Category[] {
  if (parent.parent_id !== null) return [];
  return categories.filter(
    (c) => c.parent_id === parent.id && c.name === parent.name && (c.icon === null || c.icon === parent.icon),
  );
}

/**
 * 대분류 이름을 바꿀 때 함께 바꿀 소분류: 대분류와 이름이 같은 것(대분류 자체 선택지, BANB-36).
 * 같이 안 바꾸면 그 소분류가 "보이는 소분류"가 되어 대분류를 한 번에 고를 수 없게 된다.
 * 새 이름과 같은 소분류가 이미 있으면 겹치지 않게 바꾸지 않는다.
 */
export function nameFollowers(categories: readonly Category[], parent: Category, newName: string): Category[] {
  if (parent.parent_id !== null) return [];
  const children = categories.filter((c) => c.parent_id === parent.id);
  if (children.some((c) => c.name === newName)) return [];
  return children.filter((c) => c.name === parent.name);
}

/** 내역 입력에서 고를 수 있는 주머니 (숨긴 것 제외, 순서대로) */
export function selectablePockets(pockets: readonly Pocket[]): Pocket[] {
  return sortByOrder(pockets.filter((p) => !p.is_hidden));
}

/** 새 항목의 순서값: 같은 목록의 맨 뒤 */
export function nextSortOrder(siblings: readonly { sort_order: number }[]): number {
  return siblings.reduce((max, s) => Math.max(max, s.sort_order), 0) + 1;
}

export interface OrderUpdate {
  id: string;
  sort_order: number;
}

/**
 * 목록에서 id 항목을 한 칸 위(-1)/아래(+1)로 옮긴 결과.
 * 1부터 다시 번호를 매기고, 순서값이 바뀌는 항목만 돌려준다. 옮길 수 없으면 빈 배열.
 */
export function moveItem<T extends Ordered>(siblings: readonly T[], id: string, direction: -1 | 1): OrderUpdate[] {
  const list = sortByOrder(siblings);
  const from = list.findIndex((s) => s.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return [];
  [list[from], list[to]] = [list[to], list[from]];
  return list
    .map((s, i) => ({ id: s.id, sort_order: i + 1, before: s.sort_order }))
    .filter((u) => u.sort_order !== u.before)
    .map(({ id: itemId, sort_order }) => ({ id: itemId, sort_order }));
}

/** 목록 안에서의 위치 (맨 위/맨 아래면 이동 버튼을 끈다) */
export function positionOf<T extends Ordered>(siblings: readonly T[], id: string): { isFirst: boolean; isLast: boolean } {
  const list = sortByOrder(siblings);
  const i = list.findIndex((s) => s.id === id);
  return { isFirst: i <= 0, isLast: i < 0 || i === list.length - 1 };
}
