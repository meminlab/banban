import type { Category, Member, Pocket } from '../data/types';
import {
  AMOUNT_MAX,
  KEYPAD_MAX_DIGITS,
  KOREAN_READING_MIN,
  amountAriaLabel,
  amountFromDigits,
  categoryGroups,
  datePillLabel,
  keyFromKeyboard,
  koreanReading,
  lastUsedDefaults,
  missingForSave,
  missingMessage,
  pressKey,
  type KeypadKey,
  formatAmountInput,
  formatDateTimeKST,
  memberLabel,
  parseAmount,
  pocketOptions,
  spenderOptions,
  todayKST,
  validateDraft,
  type TransactionDraft,
} from './transactionForm';

const cat = (id: string, type: Category['type'], parent_id: string | null, name: string, sort_order: number, is_hidden = false): Category => ({
  id,
  ledger_id: 'L',
  type,
  parent_id,
  name,
  sort_order,
  icon: null,
  is_hidden,
  created_at: '',
});
const pocket = (id: string, name: string, sort_order: number, is_hidden = false): Pocket => ({
  id,
  ledger_id: 'L',
  name,
  scope: 'shared',
  sort_order,
  is_hidden,
  created_at: '',
});
const member = (id: string, name: string, joined_at: string, left_at: string | null = null): Member => ({
  id,
  ledger_id: 'L',
  user_id: `u-${id}`,
  role: 'member',
  display_name: name,
  joined_at,
  left_at,
});

describe('parseAmount', () => {
  it.each([
    ['1', 1],
    ['12,000', 12000],
    [' 3500 ', 3500],
    ['0012', 12],
    ['9,999,999,999', AMOUNT_MAX],
  ])('%s → %d', (input, value) => {
    expect(parseAmount(input)).toEqual({ ok: true, value });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['0', 'tooSmall'],
    ['000', 'tooSmall'],
    ['-500', 'notInteger'],
    ['12.5', 'notInteger'],
    ['12.0', 'notInteger'],
    ['1e3', 'notInteger'],
    ['abc', 'notInteger'],
    ['10,000,000,000', 'tooLarge'],
    ['99999999999999999999', 'tooLarge'],
  ])('%j → %s 오류', (input, error) => {
    expect(parseAmount(input)).toEqual({ ok: false, error });
  });
});

describe('formatAmountInput', () => {
  it('숫자는 천 단위 쉼표로 맞춘다', () => {
    expect(formatAmountInput('1234567')).toBe('1,234,567');
    expect(formatAmountInput('1,2345')).toBe('12,345');
    expect(formatAmountInput('0050')).toBe('50');
    expect(formatAmountInput('')).toBe('');
  });
  it('숫자가 아닌 입력(음수·소수)은 그대로 둬서 검사에서 안내한다', () => {
    expect(formatAmountInput('-500')).toBe('-500');
    expect(formatAmountInput('12.5')).toBe('12.5');
  });
});

describe('날짜·시각 (한국 시간)', () => {
  it('오늘은 한국 날짜 기준 (UTC 15:00 = 다음날 00:00 KST)', () => {
    expect(todayKST(new Date('2026-11-05T14:59:00Z'))).toBe('2026-11-05');
    expect(todayKST(new Date('2026-11-05T15:00:00Z'))).toBe('2026-11-06');
  });
  it('수정 시각을 한국 시간으로 표시한다', () => {
    expect(formatDateTimeKST('2026-11-06T05:03:00Z')).toBe('2026. 11. 6. 14:03');
    expect(formatDateTimeKST('2026-11-05T15:00:00Z')).toBe('2026. 11. 6. 00:00');
  });
});

describe('선택지', () => {
  const categories = [
    cat('food', 'expense', null, '식비', 1),
    cat('food-mart', 'expense', 'food', '장보기', 2),
    cat('food-out', 'expense', 'food', '외식', 1),
    cat('food-old', 'expense', 'food', '옛날', 3, true),
    cat('etc', 'expense', null, '기타', 2),
    cat('etc-etc', 'expense', 'etc', '기타', 1),
    cat('gone', 'expense', null, '숨긴 대분류', 3, true),
    cat('gone-1', 'expense', 'gone', '하위', 1),
    cat('salary', 'income', null, '급여', 1),
    cat('salary-1', 'income', 'salary', '급여', 1),
  ];

  it('유형별 대분류 > 소분류, 순서대로, 숨김 제외', () => {
    const groups = categoryGroups(categories, 'expense');
    expect(groups.map((g) => [g.parent.name, g.children.map((c) => c.name)])).toEqual([
      ['식비', ['외식', '장보기']],
      ['기타', ['기타']],
    ]);
    expect(categoryGroups(categories, 'income').map((g) => g.parent.id)).toEqual(['salary']);
    expect(categoryGroups(categories, 'saving')).toEqual([]);
  });

  it('수정 중인 내역이 쓰는 숨김 항목은 남긴다', () => {
    expect(categoryGroups(categories, 'expense', 'food-old')[0].children.map((c) => c.id)).toContain('food-old');
    expect(categoryGroups(categories, 'expense', 'gone-1').map((g) => g.parent.id)).toContain('gone');
  });

  it('주머니: 숨김 제외(고른 것은 유지), 순서대로', () => {
    const pockets = [pocket('b', '여행', 2), pocket('a', '공동소비', 1), pocket('h', '숨김', 3, true)];
    expect(pocketOptions(pockets).map((p) => p.id)).toEqual(['a', 'b']);
    expect(pocketOptions(pockets, 'h').map((p) => p.id)).toEqual(['a', 'b', 'h']);
  });

  it('사용한 사람: 현재 멤버(참여 순), 나간 사람은 고른 경우만', () => {
    const members = [member('b', '비', '2026-11-02'), member('a', '에이', '2026-11-01'), member('x', '엑스', '2026-10-01', '2026-10-20')];
    expect(spenderOptions(members).map((m) => m.id)).toEqual(['a', 'b']);
    expect(spenderOptions(members, 'x').map((m) => m.id)).toEqual(['x', 'a', 'b']);
    expect(memberLabel(members[2])).toBe('엑스 (나감)');
    expect(memberLabel(undefined)).toBe('알 수 없음');
  });
});

describe('validateDraft', () => {
  const valid = { categoryIds: new Set(['c1']), pocketIds: new Set(['p1']), spenderIds: new Set(['m1']) };
  const base: TransactionDraft = {
    type: 'expense',
    amount: '12,000',
    occurredOn: '2026-11-06',
    categoryId: 'c1',
    pocketId: 'p1',
    spenderId: 'm1',
    isFixed: true,
    memo: '  점심  ',
  };

  it('지출: 저장할 값으로 바꾼다 (메모 앞뒤 공백 제거)', () => {
    expect(validateDraft(base, valid)).toEqual({
      ok: true,
      values: {
        type: 'expense',
        amount: 12000,
        occurred_on: '2026-11-06',
        category_id: 'c1',
        pocket_id: 'p1',
        spender_id: 'm1',
        is_fixed: true,
        memo: '점심',
      },
    });
  });

  it('지출이 아니면 주머니·고정지출은 저장하지 않는다', () => {
    const r = validateDraft({ ...base, type: 'income', pocketId: '', memo: '' }, valid);
    expect(r).toMatchObject({ ok: true, values: { type: 'income', pocket_id: null, is_fixed: false, memo: null } });
  });

  it('미래 날짜도 허용한다', () => {
    expect(validateDraft({ ...base, occurredOn: '2030-01-01' }, valid).ok).toBe(true);
  });

  it('필수값이 없으면 칸별 안내', () => {
    const r = validateDraft({ ...base, amount: '', occurredOn: '', categoryId: '', pocketId: '', spenderId: '' }, valid);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['amount', 'categoryId', 'occurredOn', 'pocketId', 'spenderId']);
  });

  it.each(['0', '-1000', '10.5', '10,000,000,000'])('금액 %s 는 저장 안 됨', (amount) => {
    const r = validateDraft({ ...base, amount }, valid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.amount).toBeTruthy();
  });

  it('선택지에 없는 카테고리(다른 유형)·주머니·사람은 거절', () => {
    const r = validateDraft({ ...base, categoryId: 'other', pocketId: 'other', spenderId: 'other' }, valid);
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(['categoryId', 'pocketId', 'spenderId']);
  });

  it('잘못된 날짜는 거절', () => {
    const r = validateDraft({ ...base, occurredOn: '2026-02-30' }, valid);
    expect(r.ok ? null : r.errors.occurredOn).toBeTruthy();
  });

  it('메모는 100자까지', () => {
    expect(validateDraft({ ...base, memo: '가'.repeat(100) }, valid).ok).toBe(true);
    const r = validateDraft({ ...base, memo: '가'.repeat(101) }, valid);
    expect(r.ok ? null : r.errors.memo).toBeTruthy();
  });
});

describe('키패드 입력 (5.15 v1.4)', () => {
  const type = (keys: KeypadKey[], start = '') => keys.reduce((d, k) => pressKey(d, k).digits, start);

  it('숫자·00 키로 금액을 만든다: 1 → 00 → 00 = 10000', () => {
    expect(type(['1', '00', '00'])).toBe('10000');
    expect(amountFromDigits('10000')).toBe(10000);
  });

  it('0원에서 0·00은 앞자리 0을 넣지 않는다', () => {
    expect(type(['0', '00', '0'])).toBe('');
    expect(amountFromDigits('')).toBe(0);
  });

  it('⌫는 한 자리, 길게 누름(clear)은 전부 지운다', () => {
    expect(pressKey('12800', 'back')).toEqual({ digits: '1280', overflow: false });
    expect(pressKey('', 'back')).toEqual({ digits: '', overflow: false });
    expect(pressKey('12800', 'clear')).toEqual({ digits: '', overflow: false });
  });

  it('최대 10자리(9,999,999,999): 넘치면 입력을 무시하고 overflow', () => {
    expect(KEYPAD_MAX_DIGITS).toBe(10);
    expect(pressKey('999999999', '9')).toEqual({ digits: '9999999999', overflow: false });
    expect(amountFromDigits('9999999999')).toBe(AMOUNT_MAX);
    expect(pressKey('9999999999', '1')).toEqual({ digits: '9999999999', overflow: true });
    expect(pressKey('999999999', '00')).toEqual({ digits: '999999999', overflow: true });
  });

  it('실제 자판: 숫자와 Backspace만 받는다', () => {
    expect(keyFromKeyboard('7')).toBe('7');
    expect(keyFromKeyboard('Backspace')).toBe('back');
    expect(keyFromKeyboard('a')).toBeNull();
    expect(keyFromKeyboard('Enter')).toBeNull();
  });
});

describe('한글 읽기 — 100만 원 경계', () => {
  it('999,999원은 숨김(null), 1,000,000원부터 보임', () => {
    expect(KOREAN_READING_MIN).toBe(1_000_000);
    expect(koreanReading(999_999)).toBeNull();
    expect(koreanReading(1_000_000)).toBe('100만 원');
    expect(koreanReading(2_890_000)).toBe('289만 원');
    expect(koreanReading(9_999_999_999)).toBe('99억 9,999만 원');
  });

  it('금액 aria-label 에는 금액과 상관없이 한글 읽기를 넣는다 (정확한 금액도 함께)', () => {
    expect(amountAriaLabel(0)).toBe('금액 0원');
    expect(amountAriaLabel(9_500)).toBe('금액 9,500원');
    expect(amountAriaLabel(12_800)).toBe('금액 12,800원, 1만 원');
    expect(amountAriaLabel(999_999)).toBe('금액 999,999원, 99만 원');
    expect(amountAriaLabel(2_890_000)).toBe('금액 2,890,000원, 289만 원');
  });
});

describe('저장 비활성 안내', () => {
  const base = { type: 'expense' as const, amount: '12800', categoryId: 'c', pocketId: 'p' };

  it('다 있으면 빠진 것 없음', () => {
    expect(missingForSave(base)).toEqual([]);
    expect(missingMessage([])).toBeNull();
  });

  it('금액 0, 카테고리 없음, (지출) 주머니 없음을 화면 순서로 알린다', () => {
    expect(missingMessage(missingForSave({ ...base, amount: '' }))).toBe('금액을 입력해 주세요');
    expect(missingMessage(missingForSave({ ...base, categoryId: '' }))).toBe('카테고리를 골라 주세요');
    expect(missingMessage(missingForSave({ ...base, amount: '', categoryId: '' }))).toBe('금액을 입력하고 카테고리를 골라 주세요');
    expect(missingMessage(missingForSave({ ...base, categoryId: '', pocketId: '' }))).toBe('카테고리·주머니를 골라 주세요');
  });

  it('수입·저축은 주머니가 없어도 된다', () => {
    expect(missingForSave({ ...base, type: 'income', pocketId: '' })).toEqual([]);
  });
});

describe('기본값: 이 사람이 마지막에 쓴 값', () => {
  const available = {
    categoryIds: (t: string) => new Set(t === 'expense' ? ['eat', 'cafe'] : t === 'income' ? ['salary'] : []),
    pocketIds: new Set(['p1', 'p2']),
  };

  it('유형별 마지막 카테고리, 지출의 마지막 주머니', () => {
    const recent = [
      { type: 'income' as const, category_id: 'salary', pocket_id: null },
      { type: 'expense' as const, category_id: 'cafe', pocket_id: 'p2' },
      { type: 'expense' as const, category_id: 'eat', pocket_id: 'p1' },
    ];
    expect(lastUsedDefaults(recent, available)).toEqual({ categoryByType: { income: 'salary', expense: 'cafe' }, pocketId: 'p2' });
  });

  it('처음이면 비어 있고, 지금 고를 수 없는 값(숨김·삭제)도 비운다', () => {
    expect(lastUsedDefaults([], available)).toEqual({ categoryByType: {}, pocketId: '' });
    expect(lastUsedDefaults([{ type: 'expense', category_id: 'gone', pocket_id: 'p9' }], available)).toEqual({
      categoryByType: {},
      pocketId: '',
    });
  });
});

describe('날짜 알약', () => {
  it('오늘 / 올해 / 다른 해', () => {
    expect(datePillLabel('2026-11-09', '2026-11-09')).toBe('오늘');
    expect(datePillLabel('2026-11-06', '2026-11-09')).toBe('11월 6일 (금)');
    expect(datePillLabel('2025-12-31', '2026-11-09')).toBe('2025년 12월 31일 (수)');
  });
});
