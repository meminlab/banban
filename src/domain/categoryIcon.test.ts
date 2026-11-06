import { categoryGlyph, firstLetter, ICON_GROUPS, ICON_OPTIONS, iconLabel, isKnownIcon } from './categoryIcon';
import { CATEGORY_ICON_COMPONENTS } from '../components/CategoryIcon';
import sql from '../../supabase/migrations/20261106170000_category_icon.sql?raw';

describe('아이콘 목록 (design.md 5.17)', () => {
  it('70개, 겹치지 않고, 묶음 순서대로 (앞 8묶음 48개 + 기본 카테고리 22개)', () => {
    expect(ICON_OPTIONS).toHaveLength(70);
    expect(new Set(ICON_OPTIONS.map((o) => o.key)).size).toBe(70);
    expect(ICON_GROUPS.slice(0, 8).every((g) => g.icons.length === 6)).toBe(true);
    expect(ICON_GROUPS[8].icons).toHaveLength(22);
    expect(ICON_OPTIONS[0].key).toBe('utensils');
    expect(ICON_OPTIONS[69].key).toBe('ellipsis');
  });

  it('모든 아이콘에 한글 이름과 그릴 컴포넌트가 있다 (화면낭독 이름도 겹치지 않음)', () => {
    for (const o of ICON_OPTIONS) {
      expect(o.label).not.toBe('');
      expect(CATEGORY_ICON_COMPONENTS[o.key], o.key).toBeDefined();
    }
    expect(Object.keys(CATEGORY_ICON_COMPONENTS)).toHaveLength(70);
    expect(new Set(ICON_OPTIONS.map((o) => o.label)).size).toBe(70);
  });

  it('DB 기본 매핑(마이그레이션)의 아이콘은 모두 목록 안에 있다: 대분류 27 + 다른 이름 소분류 24', () => {
    const parents = [...sql.matchAll(/\('(expense|income|saving)', '([^']+)', '([a-z0-9-]+)'\)/g)];
    const children = [...sql.matchAll(/\('(expense|income|saving)', '([^']+)', '([^']+)', '([a-z0-9-]+)'\)/g)];
    expect(parents).toHaveLength(27);
    expect(children).toHaveLength(24);
    for (const m of parents) expect(isKnownIcon(m[3]), m[0]).toBe(true);
    for (const m of children) expect(isKnownIcon(m[4]), m[0]).toBe(true);
  });

  it('isKnownIcon / iconLabel', () => {
    expect(isKnownIcon('dog')).toBe(true);
    expect(isKnownIcon('rocket')).toBe(false);
    expect(isKnownIcon(null)).toBe(false);
    expect(isKnownIcon(undefined)).toBe(false);
    expect(iconLabel('dog')).toBe('강아지');
  });
});

describe('firstLetter', () => {
  it.each([
    ['강아지 미용', '강'],
    ['  술', '술'],
    ['netflix', 'N'],
    ['👨‍👩‍👧 가족', '👨‍👩‍👧'],
    ['', '?'],
    ['   ', '?'],
  ])('%j → %j', (name, letter) => {
    expect(firstLetter(name)).toBe(letter);
  });
});

describe('categoryGlyph: 자기 아이콘 → 대분류 아이콘 → 첫 글자', () => {
  it('자기 아이콘이 목록 안이면 그것', () => {
    expect(categoryGlyph({ name: '외식', icon: 'utensils' }, { icon: 'utensils-crossed' })).toEqual({ kind: 'icon', key: 'utensils' });
  });
  it('없으면 대분류 아이콘', () => {
    expect(categoryGlyph({ name: '술', icon: null }, { icon: 'utensils-crossed' })).toEqual({ kind: 'icon', key: 'utensils-crossed' });
  });
  it('모르는 이름이면 없는 것과 같다', () => {
    expect(categoryGlyph({ name: '술', icon: 'rocket' }, { icon: 'wine' })).toEqual({ kind: 'icon', key: 'wine' });
    expect(categoryGlyph({ name: '술', icon: 'Wine' }, { icon: 'nope' })).toEqual({ kind: 'letter', letter: '술' });
  });
  it('대분류도 없으면 이름 첫 글자', () => {
    expect(categoryGlyph({ name: '우리 가족 경조사', icon: null })).toEqual({ kind: 'letter', letter: '우' });
    expect(categoryGlyph({ name: '우리 가족 경조사', icon: null }, { icon: null })).toEqual({ kind: 'letter', letter: '우' });
  });
});
