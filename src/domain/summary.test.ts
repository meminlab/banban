import { computeMonthSummary, type SummaryRefs, type SummaryTransaction } from './summary';

const refs: SummaryRefs = {
  members: [
    { id: 'mB', display_name: '반', joined_at: '2026-11-02T00:00:00Z', left_at: null },
    { id: 'mA', display_name: '김', joined_at: '2026-11-01T00:00:00Z', left_at: null },
    { id: 'mC', display_name: '이', joined_at: '2026-11-03T00:00:00Z', left_at: '2026-11-04T00:00:00Z' },
    { id: 'mD', display_name: '박', joined_at: '2026-11-03T00:00:00Z', left_at: '2026-11-04T00:00:00Z' },
  ],
  pockets: [
    { id: 'pShared', name: '공동소비', scope: 'shared', sort_order: 1 },
    { id: 'pAllow', name: '개인용돈', scope: 'personal', sort_order: 2 },
    { id: 'pTrip', name: '여행', scope: 'shared', sort_order: 3 }, // 숨김이어도 집계
  ],
  categories: [
    { id: 'food', parent_id: null, name: '식비', sort_order: 1 },
    { id: 'food.mart', parent_id: 'food', name: '장보기', sort_order: 1 },
    { id: 'food.out', parent_id: 'food', name: '외식', sort_order: 2 },
    { id: 'house', parent_id: null, name: '주거', sort_order: 2 },
    { id: 'house.rent', parent_id: 'house', name: '월세', sort_order: 1 },
    { id: 'tel', parent_id: null, name: '통신', sort_order: 3 },
    { id: 'tel.phone', parent_id: 'tel', name: '휴대폰', sort_order: 1 },
    { id: 'move', parent_id: null, name: '교통', sort_order: 4 },
    { id: 'move.bus', parent_id: 'move', name: '대중교통', sort_order: 1 },
    { id: 'life', parent_id: null, name: '생활', sort_order: 5 },
    { id: 'life.goods', parent_id: 'life', name: '생필품', sort_order: 1 },
    { id: 'shop', parent_id: null, name: '쇼핑', sort_order: 6 },
    { id: 'shop.cloth', parent_id: 'shop', name: '의류', sort_order: 1 },
  ],
};


function exp(
  amount: number,
  o: Partial<SummaryTransaction> & Pick<SummaryTransaction, 'category_id' | 'pocket_id' | 'spender_id'>,
): SummaryTransaction {

  return { type: 'expense', amount, occurred_on: '2026-11-15', is_fixed: false, ...o };
}
function other(type: 'income' | 'saving', amount: number, occurred_on = '2026-11-10'): SummaryTransaction {
  return { type, amount, occurred_on, category_id: 'x', pocket_id: null, spender_id: 'mA', is_fixed: false };
}

const TX: SummaryTransaction[] = [
  other('income', 3000000),
  other('income', 500000, '2026-11-30'),
  other('saving', 1000000),
  exp(1200000, { category_id: 'house.rent', pocket_id: 'pShared', spender_id: 'mA', is_fixed: true }),
  exp(80000, { category_id: 'food.mart', pocket_id: 'pShared', spender_id: 'mB', occurred_on: '2026-11-01' }),
  exp(40000, { category_id: 'food.out', pocket_id: 'pAllow', spender_id: 'mB' }),
  exp(65000, { category_id: 'tel.phone', pocket_id: 'pAllow', spender_id: 'mA', is_fixed: true }),
  exp(30000, { category_id: 'move.bus', pocket_id: 'pAllow', spender_id: 'mA' }),
  exp(20000, { category_id: 'life.goods', pocket_id: 'pShared', spender_id: 'mB' }),
  exp(10000, { category_id: 'shop.cloth', pocket_id: 'pTrip', spender_id: 'mC' }), // 나간 멤버, 숨긴 주머니
  // 다른 달 (KST 날짜 기준) — 포함되면 안 됨
  exp(999, { category_id: 'food.out', pocket_id: 'pShared', spender_id: 'mA', occurred_on: '2026-10-31' }),
  exp(999, { category_id: 'food.out', pocket_id: 'pShared', spender_id: 'mA', occurred_on: '2026-12-01' }),
  other('income', 999, '2026-12-01'),
];

function sum(rows: { amount: number }[]) {
  return rows.reduce((s, r) => s + r.amount, 0);
}

describe('computeMonthSummary', () => {
  const s = computeMonthSummary('2026-11', TX, refs);

  it('수입 / 지출 / 저축 / 남은 돈 (다른 달 제외)', () => {
    expect(s.income).toBe(3500000);
    expect(s.expense).toBe(1445000);
    expect(s.saving).toBe(1000000);
    expect(s.remaining).toBe(3500000 - 1445000 - 1000000);
    expect(s.count).toBe(10);
  });

  it('남은 돈은 음수가 될 수 있다', () => {
    const neg = computeMonthSummary('2026-11', [other('income', 100), other('saving', 300)], refs);
    expect(neg.remaining).toBe(-200);
  });

  it('나눠 보기 각 묶음의 합 = 지출 합계', () => {
    for (const rows of Object.values(s.expenseBy).slice(0, 4)) {
      expect(sum(rows)).toBe(s.expense);
    }
  });

  it('사람별: 참여 순, 현재 멤버 전원, 지출 있는 나간 멤버만 (나감) 표시', () => {
    expect(s.expenseBy.spender.map((r) => [r.label, r.amount])).toEqual([
      ['김', 1295000],
      ['반', 140000],
      ['이 (나감)', 10000],
    ]);
    expect(s.expenseBy.spender[0].ratio).toBeCloseTo(1295000 / 1445000);
  });

  it('주머니별: 금액 큰 순, 숨긴 주머니 포함', () => {
    expect(s.expenseBy.pocket.map((r) => [r.label, r.amount])).toEqual([
      ['공동소비', 1300000],
      ['개인용돈', 135000],
      ['여행', 10000],
    ]);
  });

  it('공동·개인: 주머니의 현재 scope 기준', () => {
    expect(s.expenseBy.scope.map((r) => [r.label, r.amount])).toEqual([
      ['공동', 1310000],
      ['개인', 135000],
    ]);
    // scope를 바꾸면 지난 내역도 다시 집계
    const changed = computeMonthSummary('2026-11', TX, {
      ...refs,
      pockets: refs.pockets.map((p) => (p.id === 'pTrip' ? { ...p, scope: 'personal' as const } : p)),
    });
    expect(changed.expenseBy.scope.map((r) => r.amount)).toEqual([1300000, 145000]);
  });

  it('고정·변동', () => {
    expect(s.expenseBy.fixed.map((r) => [r.label, r.amount])).toEqual([
      ['고정', 1265000],
      ['변동', 180000],
    ]);
  });

  it('카테고리 대분류 상위 5개 (소분류 합산, 금액 큰 순)', () => {
    expect(s.expenseBy.topCategories.map((r) => [r.label, r.amount])).toEqual([
      ['주거', 1200000],
      ['식비', 120000],
      ['통신', 65000],
      ['교통', 30000],
      ['생활', 20000],
    ]);
  });

  it('내역이 없으면 모두 0원, 비율 0', () => {
    const empty = computeMonthSummary('2026-11', [], refs);
    expect([empty.income, empty.expense, empty.saving, empty.remaining, empty.count]).toEqual([0, 0, 0, 0, 0]);
    expect(empty.expenseBy.spender.map((r) => [r.label, r.amount, r.ratio])).toEqual([
      ['김', 0, 0],
      ['반', 0, 0],
    ]);
    expect(empty.expenseBy.pocket).toEqual([]);
    expect(empty.expenseBy.topCategories).toEqual([]);
    expect(empty.expenseBy.fixed.map((r) => r.amount)).toEqual([0, 0]);
  });

  it('최대 금액 내역이 여러 건이어도 정확히 더한다', () => {
    const big = Array.from({ length: 100 }, () =>
      exp(9999999999, { category_id: 'food.out', pocket_id: 'pShared', spender_id: 'mA' }),
    );
    expect(computeMonthSummary('2026-11', big, refs).expense).toBe(999999999900);
  });

  it('참조를 못 찾으면 "알 수 없음"으로 묶되 합계는 유지', () => {
    const odd = computeMonthSummary(
      '2026-11',
      [exp(5000, { category_id: 'gone', pocket_id: 'gone', spender_id: 'gone' })],
      refs,
    );
    expect(odd.expense).toBe(5000);
    expect(odd.expenseBy.spender.at(-1)).toMatchObject({ label: '알 수 없음', amount: 5000 });
    expect(odd.expenseBy.pocket).toMatchObject([{ label: '알 수 없음', amount: 5000 }]);
    expect(odd.expenseBy.scope.at(-1)).toMatchObject({ label: '알 수 없음', amount: 5000 });
    expect(odd.expenseBy.topCategories).toMatchObject([{ label: '알 수 없음', amount: 5000 }]);
  });
});
