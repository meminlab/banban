import type { Category, Member, Pocket } from '../data/types';
import {
  EMPTY_FILTER,
  activeFilterCount,
  buildLedgerQuery,
  calendarWeeks,
  categoryFilterGroups,
  compactWon,
  dailyTotals,
  filterTransactions,
  knownFilter,
  formatDayLabel,
  groupByDate,
  parseLedgerQuery,
  pocketFilterOptions,
  spenderFilterOptions,
  toggleFilter,
  type LedgerFilter,
} from './ledgerView';
import { monthRange } from './month';
import { todayKST } from './transactionForm';

const cat = (id: string, type: Category['type'], parent_id: string | null, name: string, extra: Partial<Category> = {}): Category => ({
  id,
  ledger_id: 'L',
  type,
  parent_id,
  name,
  sort_order: 1,
  is_hidden: false,
  icon: null,
  created_at: '',
  ...extra,
});
const CATEGORIES = [
  cat('food', 'expense', null, '식비', { sort_order: 1 }),
  cat('food.out', 'expense', 'food', '외식'),
  cat('food.mart', 'expense', 'food', '장보기'),
  cat('home', 'expense', null, '주거', { sort_order: 2 }),
  cat('home.rent', 'expense', 'home', '월세'),
  cat('pet', 'expense', null, '반려동물', { sort_order: 3, is_hidden: true }),
  cat('pet.1', 'expense', 'pet', '반려동물'),
  cat('old', 'expense', null, '옛날', { sort_order: 4, is_hidden: true }),
  cat('pay', 'income', null, '급여'),
  cat('pay.1', 'income', 'pay', '급여'),
  cat('fund', 'saving', null, '적금'),
  cat('fund.1', 'saving', 'fund', '적금'),
];

type Tx = {
  id: string;
  type: 'expense' | 'income' | 'saving';
  amount: number;
  occurred_on: string;
  category_id: string;
  pocket_id: string | null;
  spender_id: string;
  created_at: string;
};
const tx = (id: string, o: Partial<Tx>): Tx => ({
  id,
  type: 'expense',
  amount: 1000,
  occurred_on: '2026-11-05',
  category_id: 'food.out',
  pocket_id: 'p-shared',
  spender_id: 'mA',
  created_at: `2026-11-05T00:00:0${id.length}Z`,
  ...o,
});

const TXS: Tx[] = [
  tx('1', { spender_id: 'mA', category_id: 'food.out', pocket_id: 'p-shared' }),
  tx('2', { spender_id: 'mB', category_id: 'food.mart', pocket_id: 'p-mine' }),
  tx('3', { spender_id: 'mB', category_id: 'home.rent', pocket_id: 'p-shared' }),
  tx('4', { type: 'income', spender_id: 'mA', category_id: 'pay.1', pocket_id: null }),
  tx('5', { type: 'saving', spender_id: 'mB', category_id: 'fund.1', pocket_id: null }),
];
const ids = (list: Tx[]) => list.map((t) => t.id);
const f = (o: Partial<LedgerFilter>): LedgerFilter => ({ ...EMPTY_FILTER, ...o });

describe('필터', () => {
  it('필터가 없으면 전부', () => {
    expect(ids(filterTransactions(TXS, EMPTY_FILTER, CATEGORIES))).toEqual(['1', '2', '3', '4', '5']);
  });

  it('한 항목 안에서 여러 개는 "또는"', () => {
    expect(ids(filterTransactions(TXS, f({ types: ['income', 'saving'] }), CATEGORIES))).toEqual(['4', '5']);
  });

  it('카테고리는 대분류로 고르고 그 아래 소분류가 모두 포함된다', () => {
    expect(ids(filterTransactions(TXS, f({ categories: ['food'] }), CATEGORIES))).toEqual(['1', '2']);
  });

  it('항목끼리는 "그리고": 사람 + 카테고리 + 주머니 + 유형 조합', () => {
    expect(ids(filterTransactions(TXS, f({ spenders: ['mB'], categories: ['food', 'home'] }), CATEGORIES))).toEqual(['2', '3']);
    expect(
      ids(filterTransactions(TXS, f({ spenders: ['mB'], categories: ['food', 'home'], pockets: ['p-shared'] }), CATEGORIES)),
    ).toEqual(['3']);
    expect(ids(filterTransactions(TXS, f({ types: ['income'], spenders: ['mB'] }), CATEGORIES))).toEqual([]);
  });

  it('주머니를 고르면 주머니 없는 내역(수입·저축)은 빠진다', () => {
    expect(ids(filterTransactions(TXS, f({ pockets: ['p-shared', 'p-mine'] }), CATEGORIES))).toEqual(['1', '2', '3']);
  });

  it('토글·개수', () => {
    let filter = toggleFilter(EMPTY_FILTER, 'spenders', 'mA');
    filter = toggleFilter(filter, 'types', 'expense');
    expect(activeFilterCount(filter)).toBe(2);
    filter = toggleFilter(filter, 'spenders', 'mA');
    expect(filter).toEqual(f({ types: ['expense'] }));
  });
});

describe('필터 선택지', () => {
  const m = (id: string, name: string, joined_at: string, left_at: string | null = null): Member => ({
    id,
    ledger_id: 'L',
    user_id: `u-${id}`,
    role: 'member',
    display_name: name,
    joined_at,
    left_at,
  });

  it('사람: 현재 멤버 참여 순, 나간 멤버는 이 달 내역에 있을 때만 "이름 (나감)"', () => {
    const members = [m('mB', '반', '2026-11-02'), m('mA', '김', '2026-11-01'), m('mC', '최', '2026-11-03', '2026-11-04'), m('mD', '박', '2026-11-03', '2026-11-04')];
    expect(spenderFilterOptions(members, new Set(['mC']))).toEqual([
      { id: 'mA', label: '김' },
      { id: 'mB', label: '반' },
      { id: 'mC', label: '최 (나감)' },
    ]);
  });

  it('사람: 이미 고른 나간 멤버는 이 달 내역에 없어도 보인다 (BANB-20)', () => {
    const members = [m('mA', '김', '2026-11-01'), m('mC', '최', '2026-11-03', '2026-11-04')];
    expect(spenderFilterOptions(members, new Set(), ['mC']).map((o) => o.label)).toEqual(['김', '최 (나감)']);
    expect(spenderFilterOptions(members, new Set(), []).map((o) => o.label)).toEqual(['김']);
  });

  it('주머니: 숨긴 주머니는 이 달에 쓰였을 때만', () => {
    const p = (id: string, name: string, sort_order: number, is_hidden = false): Pocket => ({
      id, ledger_id: 'L', name, scope: 'shared', sort_order, is_hidden, created_at: '',
    });
    const pockets = [p('b', '여행', 2), p('a', '공동소비', 1), p('h1', '숨김1', 3, true), p('h2', '숨김2', 4, true)];
    expect(pocketFilterOptions(pockets, new Set(['h2'])).map((o) => o.label)).toEqual(['공동소비', '여행', '숨김2']);
    // 이미 고른 숨긴 주머니는 이 달에 안 쓰였어도 보인다 (BANB-20)
    expect(pocketFilterOptions(pockets, new Set(), ['h1']).map((o) => o.label)).toEqual(['공동소비', '여행', '숨김1']);
  });

  it('카테고리: 유형별 대분류, 숨긴 대분류는 그 아래 소분류가 이 달에 쓰였을 때만', () => {
    const groups = categoryFilterGroups(CATEGORIES, new Set(['pet.1']));
    expect(groups.map((g) => [g.type, g.options.map((o) => o.label)])).toEqual([
      ['expense', ['식비', '주거', '반려동물']],
      ['income', ['급여']],
      ['saving', ['적금']],
    ]);
  });
  it('카테고리: 이미 고른 숨긴 대분류는 이 달에 안 쓰였어도 보인다 (BANB-20)', () => {
    const expense = categoryFilterGroups(CATEGORIES, new Set(), ['old'])[0];
    expect(expense.options.map((o) => o.label)).toEqual(['식비', '주거', '옛날']);
  });
});

describe('알 수 없는 필터 값 무시 (BANB-20)', () => {
  const options = {
    members: [{ id: 'm1' }],
    pockets: [{ id: 'p1' }],
    categories: [
      { id: 'food', parent_id: null },
      { id: 'food-out', parent_id: 'food' },
    ],
  };
  it('가계부에 없는 id·대분류가 아닌 카테고리는 뺀다', () => {
    const f = { types: ['expense' as const], spenders: ['m1', 'gone'], categories: ['food', 'food-out', 'gone'], pockets: ['gone'] };
    expect(knownFilter(f, options)).toEqual({ types: ['expense'], spenders: ['m1'], categories: ['food'], pockets: [] });
  });
  it('모두 알 수 있으면 같은 객체를 그대로 돌려준다', () => {
    const f = { types: [], spenders: ['m1'], categories: ['food'], pockets: ['p1'] };
    expect(knownFilter(f, options)).toBe(f);
  });
});

describe('날짜별 묶기·합계', () => {
  it('날짜별 지출·수입·저축 합계 (그 달 내역만)', () => {
    const list = [
      tx('a', { amount: 1200, occurred_on: '2026-11-01' }),
      tx('b', { amount: 800, occurred_on: '2026-11-01' }),
      tx('c', { type: 'income', amount: 5000, occurred_on: '2026-11-01' }),
      tx('d', { type: 'saving', amount: 300, occurred_on: '2026-11-30' }),
      tx('e', { amount: 999, occurred_on: '2026-10-31' }),
    ];
    const totals = dailyTotals(list, '2026-11');
    expect(totals.get('2026-11-01')).toEqual({ expense: 2000, income: 5000, saving: 0, count: 3 });
    expect(totals.get('2026-11-30')).toEqual({ expense: 0, income: 0, saving: 300, count: 1 });
    expect(totals.has('2026-10-31')).toBe(false);
  });

  it('99억짜리 여러 건도 정확히 합한다', () => {
    const list = [tx('a', { amount: 9_999_999_999 }), tx('b', { amount: 9_999_999_999 }), tx('c', { amount: 9_999_999_999 })];
    expect(dailyTotals(list, '2026-11').get('2026-11-05')?.expense).toBe(29_999_999_997);
  });

  it('최근 날짜가 위, 같은 날은 나중에 입력한 것이 위', () => {
    const list = [
      tx('a', { occurred_on: '2026-11-01', created_at: '2026-11-01T01:00:00Z' }),
      tx('b', { occurred_on: '2026-11-03', created_at: '2026-11-01T02:00:00Z' }),
      tx('c', { occurred_on: '2026-11-01', created_at: '2026-11-01T03:00:00Z' }),
    ];
    expect(groupByDate(list).map((g) => [g.date, ids(g.items)])).toEqual([
      ['2026-11-03', ['b']],
      ['2026-11-01', ['c', 'a']],
    ]);
  });
});

describe('월 경계 (KST)', () => {
  it('말일 23시 KST에 입력한 내역은 그 달 말일로 저장되고, 그 달 조회 범위·달력에 들어간다', () => {
    // 2026-10-31 23:30 KST = 2026-10-31 14:30 UTC
    const date = todayKST(new Date('2026-10-31T14:30:00Z'));
    expect(date).toBe('2026-10-31');
    const { start, end } = monthRange('2026-10');
    expect(date >= start && date < end).toBe(true);
    expect(dailyTotals([tx('a', { occurred_on: date })], '2026-10').get('2026-10-31')?.count).toBe(1);
    expect(dailyTotals([tx('a', { occurred_on: date })], '2026-11').size).toBe(0);
    expect(calendarWeeks('2026-10').flat()).toContain('2026-10-31');
  });

  it('다음 날 0시 KST(UTC 15:00)부터는 다음 달 1일', () => {
    expect(todayKST(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01');
  });
});

describe('달력', () => {
  it('2026년 11월: 1일이 일요일, 30일, 5주', () => {
    const weeks = calendarWeeks('2026-11');
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe('2026-11-01');
    expect(weeks[4].slice(0, 2)).toEqual(['2026-11-29', '2026-11-30']);
    expect(weeks[4].slice(2)).toEqual([null, null, null, null, null]);
  });

  it('윤년 2월 29일, 1일 앞 빈칸', () => {
    const weeks = calendarWeeks('2028-02'); // 2028-02-01 화요일
    expect(weeks[0].slice(0, 3)).toEqual([null, null, '2028-02-01']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(29);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('날짜 표시', () => {
    expect(formatDayLabel('2026-11-06')).toBe('11월 6일 (금)');
  });

  it.each([
    [0, '0'],
    [9_500, '9,500'],
    [10_000, '1만'],
    [12_500, '1.2만'],
    [19_999, '1.9만'],
    [1_240_000, '124만'],
    [12_345_678, '1234만'],
    [99_999_999, '9999만'],
    [100_000_000, '1억'],
    [150_000_000, '1.5억'],
    [2_500_000_000, '25억'],
    [29_999_999_997, '299억'],
  ])('짧은 금액 %d → %s (내림)', (n, s) => {
    expect(compactWon(n)).toBe(s);
  });
});

describe('주소 쿼리', () => {
  const now = new Date('2026-11-06T03:00:00Z');

  it('기본값: 이번 달(KST)·목록·필터 없음, 기본값은 주소에 안 남긴다', () => {
    const q = parseLedgerQuery(new URLSearchParams(''), now);
    expect(q).toEqual({ month: '2026-11', view: 'list', day: null, filter: EMPTY_FILTER });
    expect(buildLedgerQuery(q, now)).toBe('');
  });

  it('왕복: 달·보기·날짜·필터', () => {
    const q = {
      month: '2026-10',
      view: 'calendar' as const,
      day: '2026-10-31',
      filter: f({ types: ['expense'], spenders: ['m-1', 'm-2'], categories: ['c-1'], pockets: ['p-1'] }),
    };
    expect(parseLedgerQuery(new URLSearchParams(buildLedgerQuery(q, now)), now)).toEqual(q);
  });

  it('잘못된 값은 버린다', () => {
    const q = parseLedgerQuery(new URLSearchParams('month=2026-13&view=x&day=2026-11-31&type=expense,bogus&spender=a,a,<b>'), now);
    expect(q).toEqual({ month: '2026-11', view: 'list', day: null, filter: f({ types: ['expense'], spenders: ['a'] }) });
    expect(parseLedgerQuery(new URLSearchParams('month=2026-10&day=2026-11-01'), now).day).toBeNull();
  });
});
