import type { Category } from '../data/types';
import { buildPickerModel, checkCategoryDraft } from './categoryPicker';
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
  cat('mart', 'expense', 'food', '장보기', 1),
  cat('out', 'expense', 'food', '외식', 2),
  cat('home', 'expense', null, '주거', 2),
  cat('rent', 'expense', 'home', '월세', 1),
  cat('gift', 'expense', null, '경조사·선물', 3),
  cat('gift-c', 'expense', 'gift', '경조사·선물', 1),
  cat('edu', 'expense', null, '교육', 4),
  cat('edu-c', 'expense', 'edu', '교육', 1),
  cat('pet', 'expense', null, '반려동물', 5, true),
  cat('pet-c', 'expense', 'pet', '반려동물', 1),
  cat('salary', 'income', null, '급여', 1),
  cat('salary-c', 'income', 'salary', '급여', 1),
];

describe('buildPickerModel', () => {
  const groups = categoryGroups(CATS, 'expense');

  it('소분류가 따로 있는 대분류는 구역, 같은 이름 하나뿐인 것은 "그 밖의 분류"로 (숨긴 것은 빠짐)', () => {
    const m = buildPickerModel(groups, []);
    expect(m.sections.map((s) => [s.parent.name, s.children.map((c) => c.name)])).toEqual([
      ['식비', ['장보기', '외식']],
      ['주거', ['월세']],
    ]);
    expect(m.others.map((c) => c.id)).toEqual(['gift-c', 'edu-c']);
    expect(m.recent).toEqual([]);
  });

  it('최근 쓴 것: 겹치지 않게 4개까지, 지금 종류에서 고를 수 있는 것만', () => {
    const m = buildPickerModel(groups, ['out', 'out', 'salary-c', 'pet-c', 'rent', 'nope', 'edu-c', 'mart', 'gift-c']);
    expect(m.recent.map((c) => c.id)).toEqual(['out', 'rent', 'edu-c', 'mart']);
  });

  it('숨긴 카테고리라도 수정 중인 내역의 것(keepId)은 고를 수 있다', () => {
    const m = buildPickerModel(categoryGroups(CATS, 'expense', 'pet-c'), ['pet-c']);
    expect(m.others.map((c) => c.id)).toContain('pet-c');
    expect(m.recent.map((c) => c.id)).toEqual(['pet-c']);
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
