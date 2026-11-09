import type { Category } from '../data/types';
import {
  buildPickerModel,
  checkCategoryDraft,
  frequentRange,
  groupHas,
  secondStepOptions,
  selectsDirectly,
  toPickerGroups,
  type CategoryUse,
  type PickerGroup,
} from './categoryPicker';
import { categoryGroups } from './transactionForm';

const cat = (id: string, type: Category['type'], parent_id: string | null, name: string, sort_order = 1, is_hidden = false): Category => ({
  id,
  ledger_id: 'L',
  type,
  parent_id,
  name,
  sort_order,
  is_hidden,
  icon: null,
  created_at: '',
});

const CATS: Category[] = [
  cat('food', 'expense', null, '식비', 1),
  cat('food-c', 'expense', 'food', '식비', 0),
  cat('mart', 'expense', 'food', '장보기', 1),
  cat('out', 'expense', 'food', '외식', 2),
  cat('cafe', 'expense', null, '카페·간식', 2),
  cat('cafe-c', 'expense', 'cafe', '카페·간식', 0),
  cat('home', 'expense', null, '주거', 3),
  cat('rent', 'expense', 'home', '월세', 1), // 옛 대분류: 같은 이름 소분류 없음
  cat('gift', 'expense', null, '경조사·선물', 4),
  cat('gift-c', 'expense', 'gift', '경조사·선물', 0),
  cat('edu', 'expense', null, '교육·육아', 5),
  cat('edu-c', 'expense', 'edu', '교육·육아', 0),
  cat('etc', 'expense', null, '기타', 6),
  cat('etc-c', 'expense', 'etc', '기타', 0),
  cat('pet', 'expense', null, '반려동물', 7, true),
  cat('pet-c', 'expense', 'pet', '반려동물', 0),
  cat('a', 'expense', null, 'A', 8),
  cat('a-c', 'expense', 'a', 'A', 0),
  cat('b', 'expense', null, 'B', 9),
  cat('b-c', 'expense', 'b', 'B', 0),
  cat('c', 'expense', null, 'C', 10),
  cat('c-c', 'expense', 'c', 'C', 0),
  cat('salary', 'income', null, '급여', 1),
  cat('salary-c', 'income', 'salary', '급여', 0),
];

const use = (category_id: string, occurred_on: string, created_at = `${occurred_on}T09:00:00Z`): CategoryUse => ({
  category_id,
  occurred_on,
  created_at,
});
const names = (gs: PickerGroup[]) => gs.map((g) => g.parent.name);

describe('toPickerGroups: 대분류 자체(같은 이름 소분류)와 보이는 소분류 나누기', () => {
  const groups = toPickerGroups(categoryGroups(CATS, 'expense'));
  const byName = (n: string) => groups.find((g) => g.parent.name === n)!;

  it('같은 이름 소분류만 있으면 한 번에 선택', () => {
    expect(byName('카페·간식')).toMatchObject({ self: { id: 'cafe-c' }, subs: [] });
    expect(selectsDirectly(byName('카페·간식'))).toBe(true);
  });

  it('보이는 소분류가 있으면 두 번째 단계: 맨 앞 대분류 이름 → 소분류', () => {
    expect(selectsDirectly(byName('식비'))).toBe(false);
    expect(secondStepOptions(byName('식비')).map((c) => c.id)).toEqual(['food-c', 'mart', 'out']);
  });

  it('같은 이름 소분류가 없는 옛 대분류는 소분류만', () => {
    expect(secondStepOptions(byName('주거')).map((c) => c.id)).toEqual(['rent']);
  });

  it('숨긴 소분류는 두 번째 단계에서 빠지고, 다 숨기면 한 번에 선택', () => {
    const hidden = CATS.map((c) => (c.id === 'mart' || c.id === 'out' ? { ...c, is_hidden: true } : c));
    const g = toPickerGroups(categoryGroups(hidden, 'expense')).find((x) => x.parent.id === 'food')!;
    expect(selectsDirectly(g)).toBe(true);
  });

  it('같은 이름 소분류를 숨겼으면 대분류 이름 선택지가 없다', () => {
    const hidden = CATS.map((c) => (c.id === 'food-c' ? { ...c, is_hidden: true } : c));
    const g = toPickerGroups(categoryGroups(hidden, 'expense')).find((x) => x.parent.id === 'food')!;
    expect(g.self).toBeNull();
    expect(secondStepOptions(g).map((c) => c.id)).toEqual(['mart', 'out']);
  });
});

describe('buildPickerModel: 자주 쓰는 8개 먼저', () => {
  const groups = categoryGroups(CATS, 'expense');

  it('내역이 없으면 기본 순서 8개 + 나머지 (숨긴 대분류 제외)', () => {
    const m = buildPickerModel(groups, CATS, []);
    expect(names(m.frequent)).toEqual(['식비', '카페·간식', '주거', '경조사·선물', '교육·육아', '기타', 'A', 'B']);
    expect(names(m.rest)).toEqual(['C']);
  });

  it('내역 수 많은 순, 소분류 내역은 대분류로 합산, 모자란 자리는 기본 순서로 채움', () => {
    const m = buildPickerModel(groups, CATS, [
      use('c-c', '2026-11-01'),
      use('c-c', '2026-11-02'),
      use('mart', '2026-10-01'),
      use('out', '2026-10-02'),
      use('food-c', '2026-10-03'),
      use('etc-c', '2026-11-03'),
    ]);
    expect(names(m.frequent)).toEqual(['식비', 'C', '기타', '카페·간식', '주거', '경조사·선물', '교육·육아', 'A']);
    expect(names(m.rest)).toEqual(['B']);
  });

  it('같은 수면 최근 내역 날짜 → 같은 날이면 입력 시각이 늦은 것 먼저', () => {
    const m = buildPickerModel(groups, CATS, [
      use('a-c', '2026-11-01'),
      use('b-c', '2026-11-05'),
      use('c-c', '2026-11-05', '2026-11-05T12:00:00Z'),
      use('gift-c', '2026-11-05', '2026-11-05T08:00:00Z'),
    ]);
    expect(names(m.frequent).slice(0, 4)).toEqual(['C', 'B', '경조사·선물', 'A']);
  });

  it('숨긴 대분류·다른 종류 내역은 세지 않는다', () => {
    const m = buildPickerModel(groups, CATS, [use('pet-c', '2026-11-01'), use('salary-c', '2026-11-01'), use('nope', '2026-11-01')]);
    expect(names(m.frequent)[0]).toBe('식비');
    expect([...m.frequent, ...m.rest].some((g) => g.parent.id === 'pet')).toBe(false);
  });

  it('8개 넘게 쓰였으면 상위 8개만, 나머지는 기본 순서', () => {
    const uses = ['food-c', 'cafe-c', 'rent', 'gift-c', 'edu-c', 'etc-c', 'a-c', 'b-c', 'c-c'].flatMap((id, i) =>
      Array.from({ length: 10 - i }, () => use(id, '2026-11-01')),
    );
    const m = buildPickerModel(groups, CATS, uses.reverse());
    expect(names(m.frequent)).toEqual(['식비', '카페·간식', '주거', '경조사·선물', '교육·육아', '기타', 'A', 'B']);
    expect(names(m.rest)).toEqual(['C']);
  });

  it('숨긴 카테고리라도 수정 중인 내역의 것(keepId)은 고를 수 있다', () => {
    const m = buildPickerModel(categoryGroups(CATS, 'expense', 'pet-c'), CATS, []);
    expect([...m.frequent, ...m.rest].find((g) => g.parent.id === 'pet')?.self?.id).toBe('pet-c');
  });

  it('groupHas: 대분류 자체·소분류 모두 그 대분류 칸이 선택된 것으로', () => {
    const food = toPickerGroups(groups).find((g) => g.parent.id === 'food')!;
    expect(groupHas(food, 'food-c')).toBe(true);
    expect(groupHas(food, 'out')).toBe(true);
    expect(groupHas(food, 'cafe-c')).toBe(false);
  });
});

describe('frequentRange: 오늘(KST)부터 3개월 전 같은 날 ~ 오늘', () => {
  it('보통 날', () => expect(frequentRange('2026-11-09')).toEqual({ from: '2026-08-09', to: '2026-11-09' }));
  it('해 넘김', () => expect(frequentRange('2026-02-15')).toEqual({ from: '2025-11-15', to: '2026-02-15' }));
  it('그 달에 같은 날이 없으면 그 달 마지막 날', () => {
    expect(frequentRange('2026-05-31')).toEqual({ from: '2026-02-28', to: '2026-05-31' });
    expect(frequentRange('2028-05-30')).toEqual({ from: '2028-02-29', to: '2028-05-30' });
  });
});

describe('checkCategoryDraft', () => {
  const base = { type: 'expense' as const, categories: CATS };

  it('이름 1~20자 (앞뒤 공백 제거)', () => {
    expect(checkCategoryDraft({ ...base, name: '  ', parent: { kind: 'existing', id: 'food' } })).toEqual({ ok: false, reason: '이름을 입력해 주세요.' });
    expect(checkCategoryDraft({ ...base, name: '가'.repeat(21), parent: { kind: 'existing', id: 'food' } })).toEqual({
      ok: false,
      reason: '이름은 20자까지 쓸 수 있어요.',
    });
    expect(checkCategoryDraft({ ...base, name: ' 야식 ', parent: { kind: 'existing', id: 'food' } })).toEqual({ ok: true, name: '야식' });
  });

  it('넣을 곳을 안 고르면 안 된다', () => {
    expect(checkCategoryDraft({ ...base, name: '야식', parent: null })).toEqual({ ok: false, reason: '넣을 대분류를 골라 주세요.' });
  });

  it('같은 대분류에 같은 이름이면 안 된다 (다른 대분류면 된다)', () => {
    expect(checkCategoryDraft({ ...base, name: '외식', parent: { kind: 'existing', id: 'food' } })).toEqual({
      ok: false,
      reason: '같은 대분류에 같은 이름이 이미 있어요.',
    });
    expect(checkCategoryDraft({ ...base, name: '외식', parent: { kind: 'existing', id: 'home' } }).ok).toBe(true);
  });

  it('새 대분류: 같은 종류의 대분류 이름과 겹치면 안 된다 (숨긴 것 포함, 다른 종류는 상관없음)', () => {
    expect(checkCategoryDraft({ ...base, name: '반려동물', parent: { kind: 'new' } })).toEqual({
      ok: false,
      reason: '같은 이름의 대분류가 이미 있어요.',
    });
    expect(checkCategoryDraft({ ...base, name: '급여', parent: { kind: 'new' } }).ok).toBe(true);
  });

  it('수정: 자기 이름 그대로는 되고, 형제와 겹치면 안 된다', () => {
    const out = CATS.find((c) => c.id === 'out')!;
    expect(checkCategoryDraft({ ...base, name: '외식', editing: out }).ok).toBe(true);
    expect(checkCategoryDraft({ ...base, name: '장보기', editing: out })).toEqual({ ok: false, reason: '같은 대분류에 같은 이름이 이미 있어요.' });
    const food = CATS.find((c) => c.id === 'food')!;
    expect(checkCategoryDraft({ ...base, name: '주거', editing: food })).toEqual({ ok: false, reason: '같은 이름의 대분류가 이미 있어요.' });
  });
});
