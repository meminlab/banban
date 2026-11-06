import type { Asset, AssetBalanceHistory, AssetKind } from '../data/types';
import {
  composition,
  currentNetWorth,
  filterByOwner,
  monthEndBoundary,
  monthEndNetWorth,
  needsMonthlyCheck,
  netWorthChange,
  netWorthForMonth,
  type OwnerView,
} from './netWorth';

// ── QA 테스트 케이스 v4 기준 데이터 (오늘 = 2026-11-06 KST)
const NOW = new Date('2026-11-06T03:00:00Z'); // KST 11-06 12:00
const kst = (s: string) => new Date(`${s}+09:00`).toISOString();

let hid = 0;
const history: AssetBalanceHistory[] = [];
function mk(
  id: string,
  kind: AssetKind,
  owner: string | null,
  hist: [string, number][],
  archived: string | null = null,
): Asset {
  for (const [at, balance] of hist) {
    history.push({ id: ++hid, asset_id: id, ledger_id: 'L1', balance, changed_by: owner ?? 'ma', changed_at: kst(at) });
  }
  return {
    id,
    ledger_id: 'L1',
    name: id,
    kind,
    owner_id: owner,
    balance: hist[hist.length - 1][1],
    memo: null,
    archived_at: archived ? kst(archived) : null,
    created_at: kst(hist[0][0]),
    updated_at: kst(hist[hist.length - 1][0]),
  };
}

const V4: Asset[] = [
  mk('A통장', 'checking', 'ma', [
    ['2026-09-15T09:00:00', 3_000_000],
    ['2026-10-10T09:00:00', 2_000_000],
    ['2026-11-05T10:00:00', 2_500_000],
    ['2026-11-05T18:00:00', 2_700_000],
  ]),
  mk('B적금', 'installment_saving', 'mb', [
    ['2026-09-15T09:00:00', 5_000_000],
    ['2026-10-31T23:59:59', 6_000_000],
  ]),
  mk('우리집', 'real_estate', null, [['2026-09-15T09:00:00', 300_000_000]]),
  mk('주담대', 'loan', null, [
    ['2026-09-15T09:00:00', 200_000_000],
    ['2026-11-01T00:00:00', 199_000_000],
  ]),
  mk('A카드', 'card_payable', 'ma', [['2026-10-10T09:00:00', 1_000_000]]),
  mk('B차', 'vehicle', 'mb', [['2026-09-15T09:00:00', 20_000_000]], '2026-11-06T00:00:01'),
];

const view = (v: OwnerView) => filterByOwner(V4, v);

describe('QA v4 합친 보기', () => {
  it('9월 말 / 10월 말 / 11월 현재 (AS-02·06·07·11)', () => {
    expect(monthEndNetWorth(V4, history, '2026-09')).toEqual({ assets: 328_000_000, liabilities: 200_000_000, net: 128_000_000 });
    expect(monthEndNetWorth(V4, history, '2026-10')).toEqual({ assets: 328_000_000, liabilities: 201_000_000, net: 127_000_000 });
    expect(currentNetWorth(V4)).toEqual({ assets: 308_700_000, liabilities: 200_000_000, net: 108_700_000 });
  });

  it('전월 대비: 9월 "–"(8월 이력 없음), 10월 ▼1,000,000, 11월 ▼18,300,000', () => {
    expect(netWorthChange(V4, history, '2026-09', NOW)).toBeNull();
    expect(netWorthChange(V4, history, '2026-10', NOW)).toBe(-1_000_000);
    expect(netWorthChange(V4, history, '2026-11', NOW)).toBe(-18_300_000);
  });

  it('이력 시작 전 달은 null, 미래 달은 현재 값 (Q13)', () => {
    expect(netWorthForMonth(V4, history, '2026-08', NOW)).toBeNull();
    expect(netWorthForMonth(V4, history, '2026-12', NOW)?.net).toBe(108_700_000);
  });

  it('잔액을 고친 다음 달에도 지난달 월말 값이 남는다 (완료 기준, TR-02)', () => {
    const dec = new Date('2026-12-02T03:00:00Z');
    expect(netWorthForMonth(V4, history, '2026-11', dec)?.net).toBe(108_700_000);
  });
});

describe('QA v4 사람별 (PV-02~05)', () => {
  it.each([
    ['ma', 1_000_000, 1_700_000, 700_000],
    ['mb', 26_000_000, 6_000_000, -20_000_000],
    [null, 100_000_000, 101_000_000, 1_000_000],
  ] as const)('%s: 10월 말 %d → 현재 %d (전월 대비 %d)', (owner, oct, cur, delta) => {
    expect(monthEndNetWorth(view(owner), history, '2026-10')?.net).toBe(oct);
    expect(currentNetWorth(view(owner)).net).toBe(cur);
    expect(netWorthChange(view(owner), history, '2026-11', NOW)).toBe(delta);
  });

  it('A: 총자산 2,700,000 / 총부채 1,000,000', () => {
    expect(currentNetWorth(view('ma'))).toEqual({ assets: 2_700_000, liabilities: 1_000_000, net: 1_700_000 });
  });

  it('사람별 합 + 공동 = 합친 (완료 기준)', () => {
    const owners: OwnerView[] = ['ma', 'mb', null];
    for (const ym of ['2026-09', '2026-10']) {
      const parts = owners.reduce((s, o) => s + (monthEndNetWorth(view(o), history, ym)?.net ?? 0), 0);
      expect(parts).toBe(monthEndNetWorth(V4, history, ym)?.net);
    }
    expect(owners.reduce((s, o) => s + currentNetWorth(view(o)).net, 0)).toBe(currentNetWorth(V4).net);
  });
});

describe('보관·되살리기·종류/소유자 변경', () => {
  it('보관해도 지난 달 값은 그대로, 되살리면 현재에 다시 포함 (AS-11·12, Q10)', () => {
    const restored = V4.map((a) => (a.id === 'B차' ? { ...a, archived_at: null } : a));
    expect(currentNetWorth(restored).net).toBe(128_700_000);
    expect(monthEndNetWorth(restored, history, '2026-10')?.net).toBe(127_000_000);
  });

  it('보관 시각이 월말보다 앞이면 그 달 월말에서 빠진다', () => {
    const early = V4.map((a) => (a.id === 'B차' ? { ...a, archived_at: kst('2026-10-20T00:00:00') } : a));
    expect(monthEndNetWorth(early, history, '2026-10')?.net).toBe(107_000_000);
    expect(monthEndNetWorth(early, history, '2026-09')?.net).toBe(128_000_000);
  });

  it('소유자를 바꾸면 지난 달 사람별 값도 현재 소유자로 (PV-07, Q11)', () => {
    const moved = V4.map((a) => (a.id === 'A통장' ? { ...a, owner_id: null } : a));
    expect(monthEndNetWorth(filterByOwner(moved, 'ma'), history, '2026-10')?.net).toBe(-1_000_000);
    expect(monthEndNetWorth(filterByOwner(moved, null), history, '2026-10')?.net).toBe(102_000_000);
  });

  it('같은 시각 이력은 id 큰 쪽이 나중', () => {
    const a = mk('동시', 'cash', null, [['2026-10-05T10:00:00', 1], ['2026-10-05T10:00:00', 2]]);
    expect(monthEndNetWorth([a], history, '2026-10')?.net).toBe(2);
  });
});

describe('경계값', () => {
  it('월말 경계 = 다음 달 1일 00:00 KST (TR-08: 기기 시간대와 무관)', () => {
    expect(new Date(monthEndBoundary('2026-10')).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(new Date(monthEndBoundary('2026-12')).toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('부채 9,999,999,999 × 3, 자산 없음 → −29,999,999,997 (AS-16)', () => {
    const debts = [1, 2, 3].map((n) => mk(`d${n}`, 'loan', null, [['2026-11-01T09:00:00', 9_999_999_999]]));
    expect(currentNetWorth(debts).net).toBe(-29_999_999_997);
  });

  it('자산 9,999,999,999 × 5 → 49,999,999,995 (AS-17)', () => {
    const big = [1, 2, 3, 4, 5].map((n) => mk(`b${n}`, 'deposit', null, [['2026-11-01T09:00:00', 9_999_999_999]]));
    expect(currentNetWorth(big).assets).toBe(49_999_999_995);
  });

  it('부채 0원은 순자산에 영향 없음 (AS-05)', () => {
    const zero = mk('zero', 'other_liability', null, [['2026-11-01T09:00:00', 0]]);
    expect(currentNetWorth([...V4, zero]).net).toBe(108_700_000);
  });
});

describe('자산 구성 (AS-14·15)', () => {
  it('총자산 기준 비율, 부채는 종류별 합계만', () => {
    const c = composition(V4);
    expect(c.assets.map((r) => [r.kind, r.amount, r.percent])).toEqual([
      ['real_estate', 300_000_000, 97.2],
      ['installment_saving', 6_000_000, 1.9],
      ['checking', 2_700_000, 0.9],
    ]);
    expect(c.liabilities.map((r) => [r.kind, r.amount, r.percent])).toEqual([
      ['loan', 199_000_000, null],
      ['card_payable', 1_000_000, null],
    ]);
  });

  it('총자산 0이면 비율 없음', () => {
    const c = composition(filterByOwner(V4, null).filter((a) => a.kind === 'loan'));
    expect(c.totalAssets).toBe(0);
    expect(c.assets).toEqual([]);
    expect(c.liabilities[0].percent).toBeNull();
  });
});

describe('월초 안내 (AS-20·21, Q12)', () => {
  it('이번 달 사람이 남긴 잔액 기록이 있으면 안 뜬다', () => {
    expect(needsMonthlyCheck(history, NOW)).toBe(false);
  });
  it('다음 달 1일이 되면 다시 뜬다', () => {
    expect(needsMonthlyCheck(history, new Date('2026-11-30T15:00:00Z'))).toBe(true);
  });
  it('마이그레이션이 채운 기록(changed_by null)은 세지 않는다', () => {
    const migrated: AssetBalanceHistory[] = [
      { id: 1, asset_id: 'x', ledger_id: 'L', balance: 1, changed_by: null, changed_at: '2026-11-06T01:00:00Z' },
    ];
    expect(needsMonthlyCheck(migrated, NOW)).toBe(true);
  });
});
