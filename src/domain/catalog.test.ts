import type { Category, Pocket } from '../data/types';
import {
  buildCategoryTree,
  checkName,
  moveItem,
  nextSortOrder,
  positionOf,
  selectableCategoryTree,
  selectablePockets,
  sortByOrder,
} from './catalog';

function cat(id: string, parent: string | null, sort: number, extra: Partial<Category> = {}): Category {
  return {
    id,
    ledger_id: 'L',
    type: 'expense',
    parent_id: parent,
    name: id,
    sort_order: sort,
    is_hidden: false,
    created_at: '2026-11-06T00:00:00Z',
    ...extra,
  };
}

function pocket(id: string, sort: number, extra: Partial<Pocket> = {}): Pocket {
  return { id, ledger_id: 'L', name: id, scope: 'shared', sort_order: sort, is_hidden: false, created_at: '2026-11-06T00:00:00Z', ...extra };
}

describe('checkName', () => {
  it('앞뒤 공백을 지운 값을 돌려준다', () => {
    expect(checkName('  식비 ')).toEqual({ ok: true, value: '식비' });
  });
  it.each(['', '   ', '\t'])('빈 값·공백만(%j)은 안 된다', (v) => {
    expect(checkName(v)).toMatchObject({ ok: false, error: '이름을 입력해 주세요.' });
  });
  it('20자까지 되고 21자는 안 된다', () => {
    expect(checkName('가'.repeat(20)).ok).toBe(true);
    expect(checkName('가'.repeat(21))).toMatchObject({ ok: false, error: '이름은 20자까지 쓸 수 있어요.' });
  });
  it('이모지는 한 글자로 센다 (DB char_length 와 같게)', () => {
    expect(checkName('🍜'.repeat(20)).ok).toBe(true);
  });
});

describe('sortByOrder', () => {
  it('순서값, 같으면 만든 시각, 그다음 id 순', () => {
    const items = [
      cat('c', null, 2),
      cat('b', null, 1, { created_at: '2026-11-07T00:00:00Z' }),
      cat('a', null, 1, { created_at: '2026-11-07T00:00:00Z' }),
      cat('z', null, 1),
    ];
    expect(sortByOrder(items).map((i) => i.id)).toEqual(['z', 'a', 'b', 'c']);
  });
});

describe('buildCategoryTree', () => {
  const list = [
    cat('food', null, 1),
    cat('home', null, 2),
    cat('eatout', 'food', 2),
    cat('grocery', 'food', 1),
    cat('rent', 'home', 1),
    cat('salary', null, 1, { type: 'income' }),
  ];

  it('유형별 대분류 > 소분류를 순서대로 묶는다', () => {
    const tree = buildCategoryTree(list, 'expense');
    expect(tree.map((n) => [n.category.id, n.children.map((c) => c.id)])).toEqual([
      ['food', ['grocery', 'eatout']],
      ['home', ['rent']],
    ]);
    expect(buildCategoryTree(list, 'income').map((n) => n.category.id)).toEqual(['salary']);
    expect(buildCategoryTree(list, 'saving')).toEqual([]);
  });

  it('숨긴 항목도 관리 화면에는 남는다', () => {
    const tree = buildCategoryTree([cat('food', null, 1, { is_hidden: true }), cat('x', 'food', 1, { is_hidden: true })], 'expense');
    expect(tree[0].children).toHaveLength(1);
  });
});

describe('selectableCategoryTree (내역 입력 선택지)', () => {
  it('숨긴 소분류, 숨긴 대분류(와 그 소분류), 고를 소분류가 없는 대분류는 빠진다', () => {
    const list = [
      cat('food', null, 1),
      cat('grocery', 'food', 1),
      cat('eatout', 'food', 2, { is_hidden: true }),
      cat('home', null, 2, { is_hidden: true }),
      cat('rent', 'home', 1),
      cat('pet', null, 3),
      cat('petfood', 'pet', 1, { is_hidden: true }),
    ];
    const tree = selectableCategoryTree(list, 'expense');
    expect(tree.map((n) => [n.category.id, n.children.map((c) => c.id)])).toEqual([['food', ['grocery']]]);
  });
});

describe('selectablePockets', () => {
  it('숨긴 주머니를 빼고 순서대로', () => {
    const list = [pocket('b', 2), pocket('a', 1), pocket('h', 0, { is_hidden: true })];
    expect(selectablePockets(list).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('nextSortOrder', () => {
  it('맨 뒤 순서값 + 1, 비었으면 1', () => {
    expect(nextSortOrder([{ sort_order: 3 }, { sort_order: 7 }])).toBe(8);
    expect(nextSortOrder([])).toBe(1);
  });
});

describe('moveItem', () => {
  const list = [cat('a', null, 1), cat('b', null, 2), cat('c', null, 3)];

  it('한 칸 아래로: 바뀐 두 항목만 돌려준다', () => {
    expect(moveItem(list, 'a', 1)).toEqual([
      { id: 'b', sort_order: 1 },
      { id: 'a', sort_order: 2 },
    ]);
  });
  it('한 칸 위로', () => {
    expect(moveItem(list, 'c', -1)).toEqual([
      { id: 'c', sort_order: 2 },
      { id: 'b', sort_order: 3 },
    ]);
  });
  it('맨 위에서 위로, 맨 아래에서 아래로, 없는 id는 아무것도 안 바꾼다', () => {
    expect(moveItem(list, 'a', -1)).toEqual([]);
    expect(moveItem(list, 'c', 1)).toEqual([]);
    expect(moveItem(list, 'zz', 1)).toEqual([]);
  });
  it('순서값이 겹치거나 비어 있어도 1부터 다시 매긴다', () => {
    const messy = [cat('a', null, 5), cat('b', null, 5, { created_at: '2026-11-07T00:00:00Z' }), cat('c', null, 9)];
    expect(moveItem(messy, 'c', -1)).toEqual([
      { id: 'a', sort_order: 1 },
      { id: 'c', sort_order: 2 },
      { id: 'b', sort_order: 3 },
    ]);
  });
});

describe('positionOf', () => {
  const list = [cat('a', null, 1), cat('b', null, 2)];
  it('맨 위·맨 아래 여부', () => {
    expect(positionOf(list, 'a')).toEqual({ isFirst: true, isLast: false });
    expect(positionOf(list, 'b')).toEqual({ isFirst: false, isLast: true });
    expect(positionOf([cat('a', null, 1)], 'a')).toEqual({ isFirst: true, isLast: true });
  });
});
