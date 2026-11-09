import type { Asset, AssetBalanceHistory, AssetKind } from '../data/types';
import {
  composition,
  compositionSummary,
  currentNetWorth,
  filterByOwner,
  homeNetWorth,
  monthEndBoundary,
  monthEndNetWorth,
  needsMonthlyCheck,
  netWorthChange,
  netWorthForMonth,
  netWorthTrend,
  trendRatio,
  trendScale,
  trendSegments,
  trendWindowStart,
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

describe('자산 구성 요약 (5.23-5, Q4)', () => {
  const row = (kind: AssetKind, amount: number, percent: number | null) => ({ kind, amount, count: 1, percent });
  const comp = (rows: ReturnType<typeof row>[]) => ({
    totalAssets: rows.reduce((s, r) => s + r.amount, 0),
    totalLiabilities: 0,
    assets: rows,
    liabilities: [],
  });

  it('가장 큰 종류 + 4개까지 한 줄 + 외 N, aria-label에 % 전부', () => {
    const s = compositionSummary(
      comp([
        row('real_estate', 760, 76),
        row('deposit', 60, 6),
        row('investment', 60, 6),
        row('vehicle', 40, 4),
        row('checking', 40, 4),
        row('pension', 30, 3),
        row('cash', 10, 1),
      ]),
    )!;
    expect(s.top?.kind).toBe('real_estate');
    expect(s.line).toBe('부동산 · 예금 · 투자 · 자동차 외 3');
    expect(s.ariaLabel).toBe('자산 구성: 부동산 76%, 예금 6%, 투자 6%, 자동차 4%, 입출금 4%, 연금 3%, 현금 1%');
  });

  it('종류가 4개 이하이면 "외" 없음, 1개면 100%', () => {
    const four = compositionSummary(
      comp([row('real_estate', 4, 40), row('deposit', 3, 30), row('investment', 2, 20), row('cash', 1, 10)]),
    )!;
    expect(four.line).toBe('부동산 · 예금 · 투자 · 현금');
    const one = compositionSummary(comp([row('cash', 5, 100)]))!;
    expect(one.line).toBe('현금');
    expect(one.top?.percent).toBe(100);
  });

  it('5개면 "외 1" (전체 − 표시)', () => {
    const s = compositionSummary(
      comp([row('real_estate', 5, 50), row('deposit', 2, 20), row('investment', 1, 10), row('cash', 1, 10), row('pension', 1, 10)]),
    )!;
    expect(s.line).toBe('부동산 · 예금 · 투자 · 현금 외 1');
  });

  it('비율은 composition() 값 그대로 (1:1:1 → 33.3%)', () => {
    const t = '2026-11-01T09:00:00';
    const c = composition([mk('s1', 'cash', null, [[t, 1]]), mk('s2', 'deposit', null, [[t, 1]]), mk('s3', 'pension', null, [[t, 1]])]);
    const s = compositionSummary(c)!;
    expect(s.top?.percent).toBe(33.3);
    expect(s.ariaLabel).toBe('자산 구성: 현금 33.3%, 예금 33.3%, 연금 33.3%');
  });

  it('총자산 0이면 요약 없음', () => {
    expect(compositionSummary(composition([]))).toBeNull();
    expect(compositionSummary(comp([row('cash', 0, null)]))).toBeNull();
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

describe('월별 추이 (BANB-26, QA v4 TR)', () => {
  const nets = (assets: Asset[], now = NOW) => netWorthTrend(assets, history, now).map((p) => [p.ym, p.net]);

  it('TR-01 합친: 6~11월 중 9·10·11월만 값, 6~8월은 null', () => {
    expect(nets(V4)).toEqual([
      ['2026-06', null],
      ['2026-07', null],
      ['2026-08', null],
      ['2026-09', 128_000_000],
      ['2026-10', 127_000_000],
      ['2026-11', 108_700_000],
    ]);
  });

  it('TR-02 잔액을 고친 다음 달: 11월 = 11월 말 값, 12월 = 현재 값 (완료 기준)', () => {
    const dec = new Date('2026-12-02T03:00:00Z');
    const changed = V4.map((a) => (a.id === '우리집' ? { ...a, balance: 310_000_000 } : a)); // 12월에 고친 현재 값
    history.push({ id: 9_001, asset_id: '우리집', ledger_id: 'L1', balance: 310_000_000, changed_by: 'ma', changed_at: kst('2026-12-01T10:00:00') });
    try {
      const t = netWorthTrend(changed, history, dec);
      expect(t.map((p) => p.ym)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
      expect(t[4].net).toBe(108_700_000);
      expect(t[5].net).toBe(118_700_000);
    } finally {
      history.pop();
    }
  });

  it('TR-03 보관한 B차는 9·10월 값에 포함, 11월에는 빠진다 (완료 기준)', () => {
    const car = V4.filter((a) => a.id === 'B차');
    expect(netWorthTrend(car, history, NOW).map((p) => p.net)).toEqual([null, null, null, 20_000_000, 20_000_000, 0]);
  });

  it('TR-04 사람별: 칩마다 값이 바뀌고, 각 달 세 값의 합 = 합친', () => {
    const at = (o: OwnerView) => netWorthTrend(view(o), history, NOW).slice(3).map((p) => p.net);
    expect(at('ma')).toEqual([3_000_000, 1_000_000, 1_700_000]);
    expect(at('mb')).toEqual([25_000_000, 26_000_000, 6_000_000]);
    expect(at(null)).toEqual([100_000_000, 100_000_000, 101_000_000]);
    const all = netWorthTrend(V4, history, NOW).slice(3).map((p) => p.net);
    expect([0, 1, 2].map((i) => at('ma')[i]! + at('mb')[i]! + at(null)[i]!)).toEqual(all);
  });

  it('TR-05 이력이 7개월 이상이어도 최근 6개월만', () => {
    const t = netWorthTrend(V4, history, new Date('2027-05-10T03:00:00Z'));
    expect(t.map((p) => p.ym)).toEqual(['2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
    expect(t.every((p) => p.net === 108_700_000)).toBe(true);
  });

  it('TR-06 이번 달에만 이력: 마지막 1개만 값', () => {
    const fresh = mk('신규', 'cash', null, [['2026-11-03T09:00:00', 50_000]]);
    expect(netWorthTrend([fresh], history, NOW).map((p) => p.net)).toEqual([null, null, null, null, null, 50_000]);
  });

  it('TR-08 10-31 23:59:59 KST 수정은 10월 값 (B적금 6,000,000)', () => {
    expect(netWorthTrend(view('mb'), history, NOW)[4].net).toBe(26_000_000);
  });

  it('보관 후 되살리면 보관해 있던 달에도 다시 들어간다 (Q10)', () => {
    const early = V4.map((a) => (a.id === 'B차' ? { ...a, archived_at: kst('2026-10-20T00:00:00') } : a));
    expect(netWorthTrend(early, history, NOW)[4].net).toBe(107_000_000);
    const restored = early.map((a) => (a.id === 'B차' ? { ...a, archived_at: null } : a));
    expect(netWorthTrend(restored, history, NOW)[4].net).toBe(127_000_000);
  });

  it('종류를 자산 → 부채로 바꾸면 지난 달도 부채로 계산 (Q11)', () => {
    const flipped = V4.map((a) => (a.id === 'B차' ? { ...a, kind: 'other_liability' as const } : a));
    expect(netWorthTrend(flipped, history, NOW)[3].net).toBe(88_000_000);
  });
});

describe('추이 그래프 세로 범위 (design.md 5.19)', () => {
  it('0부터 시작하지 않고 최소~최대에 15% 여유', () => {
    const s = trendScale([null, 100, 200])!;
    expect(s).toEqual({ min: 85, max: 215, crossesZero: false });
    expect(trendRatio(215, s)).toBe(0);
    expect(trendRatio(85, s)).toBe(1);
  });

  it('TR-07 음수가 섞이면 0 기준선, 모두 음수면 기준선 없음', () => {
    expect(trendScale([-100, 100])?.crossesZero).toBe(true);
    expect(trendScale([-300, -100])?.crossesZero).toBe(false);
    const s = trendScale([-100, 100])!;
    expect(trendRatio(0, s)).toBeCloseTo(0.5);
  });

  it('값이 하나뿐이거나 모두 같아도 깨지지 않는다', () => {
    const one = trendScale([null, null, 50_000])!;
    expect(one.max).toBeGreaterThan(one.min);
    expect(trendRatio(50_000, one)).toBeCloseTo(0.5);
    const zero = trendScale([0, 0])!;
    expect(zero.max).toBeGreaterThan(zero.min);
    expect(trendScale([null, null])).toBeNull();
  });

  it('선은 이어진 달끼리만 잇는다', () => {
    const p = (net: number | null) => ({ ym: '2026-01', net });
    expect(trendSegments([p(null), p(1), p(2), p(null), p(3), p(4)])).toEqual([[1, 2], [4, 5]]);
    expect(trendSegments([p(null), p(1)])).toEqual([[1]]);
  });
});

describe('홈 우리집 순자산 카드 (BANB-27, QA v4 HM)', () => {
  const nets = (t: { net: number | null }[]) => t.map((p) => p.net);

  it('HM-01 이번 달: 현재 값 108,700,000 · ▼18,300,000 · 6개월 작은 추이', () => {
    const h = homeNetWorth(V4, history, '2026-11', NOW);
    expect(h).toMatchObject({ kind: 'value', basis: 'now', net: 108_700_000, change: -18_300_000 });
    if (h.kind !== 'value') throw new Error();
    expect(h.trend.map((p) => p.ym)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(nets(h.trend)).toEqual([null, null, null, 128_000_000, 127_000_000, 108_700_000]);
  });

  it('HM-03 10월: 10월 말 값 127,000,000 · ▼1,000,000, 작은 추이는 10월에서 끝난다', () => {
    const h = homeNetWorth(V4, history, '2026-10', NOW);
    expect(h).toMatchObject({ kind: 'value', basis: 'month_end', net: 127_000_000, change: -1_000_000 });
    if (h.kind !== 'value') throw new Error();
    expect(h.trend[5].ym).toBe('2026-10');
    expect(nets(h.trend)).toEqual([null, null, null, null, 128_000_000, 127_000_000]);
  });

  it('HM-04 9월: 128,000,000 · 전월 대비 "–"(null)', () => {
    expect(homeNetWorth(V4, history, '2026-09', NOW)).toMatchObject({ basis: 'month_end', net: 128_000_000, change: null });
  });

  it('HM-05 이력 시작 전 달(8월): 값·전월 대비 모두 "–"(null) (Q13)', () => {
    const h = homeNetWorth(V4, history, '2026-08', NOW);
    expect(h).toMatchObject({ kind: 'value', basis: 'month_end', net: null, change: null });
  });

  it('HM-06 미래 달(12월): 현재 값 108,700,000 (Q13), 11월 말과 같아 변동 없음', () => {
    const h = homeNetWorth(V4, history, '2026-12', NOW);
    expect(h).toMatchObject({ kind: 'value', basis: 'future', net: 108_700_000, change: 0 });
    if (h.kind !== 'value') throw new Error();
    expect(nets(h.trend)).toEqual([null, null, 128_000_000, 127_000_000, 108_700_000, 108_700_000]);
  });

  it('HM-10 같은 달이면 자산 탭 합친 보기 값과 같다', () => {
    const h = homeNetWorth(V4, history, '2026-11', NOW);
    expect(h.kind === 'value' && h.net).toBe(currentNetWorth(V4).net);
    expect(h.kind === 'value' && h.change).toBe(netWorthChange(V4, history, '2026-11', NOW));
  });

  it('HM-07 자산·부채가 하나도 없으면 empty (어느 달이든)', () => {
    expect(homeNetWorth([], [], '2026-11', NOW)).toEqual({ kind: 'empty' });
    expect(homeNetWorth([], [], '2026-10', NOW)).toEqual({ kind: 'empty' });
    expect(homeNetWorth([], [], '2026-12', NOW)).toEqual({ kind: 'empty' });
  });

  it('모두 보관: 이번 달은 empty, 지난 달은 그 달 이력이 있으면 값', () => {
    const car = V4.filter((a) => a.id === 'B차');
    expect(homeNetWorth(car, history, '2026-11', NOW)).toEqual({ kind: 'empty' });
    expect(homeNetWorth(car, history, '2026-10', NOW)).toMatchObject({ kind: 'value', net: 20_000_000 });
    expect(homeNetWorth(car, history, '2026-08', NOW)).toEqual({ kind: 'empty' });
  });

  it('HM-08 순자산 음수', () => {
    const debt = [mk('빚', 'loan', null, [['2026-11-02T09:00:00', 9_999_999_999]])];
    expect(homeNetWorth(debt, history, '2026-11', NOW)).toMatchObject({ kind: 'value', net: -9_999_999_999 });
  });
});

// ── BANB-30 추이에 필요한 범위만 받은 이력으로도 값이 같다

/** 서버 함수 asset_balance_history_window 와 같은 규칙: since 이후 전부 + 자산마다 since 직전 마지막 1건 */
function historyWindow(all: readonly AssetBalanceHistory[], since: number): AssetBalanceHistory[] {
  const before = new Map<string, AssetBalanceHistory>();
  const after: AssetBalanceHistory[] = [];
  for (const h of all) {
    const t = Date.parse(h.changed_at);
    if (t >= since) {
      after.push(h);
      continue;
    }
    const prev = before.get(h.asset_id);
    const pt = prev ? Date.parse(prev.changed_at) : -Infinity;
    if (!prev || t > pt || (t === pt && h.id > prev.id)) before.set(h.asset_id, h);
  }
  return [...before.values(), ...after];
}

describe('잔액 이력 범위 조회 (BANB-30)', () => {
  it('창 시작 = 5개월 전 1일 00:00 KST', () => {
    expect(trendWindowStart('2026-11')).toBe(Date.parse(kst('2026-06-01T00:00:00')));
    expect(trendWindowStart('2026-03')).toBe(Date.parse(kst('2025-10-01T00:00:00')));
    expect(trendWindowStart('2026-11', 12)).toBe(Date.parse(kst('2025-12-01T00:00:00')));
  });

  // 자산 1개에 이력 1,500건 + 6개월 넘게 안 바뀐 자산 + 창 이전에 끝난 부채 + 창 안에서 보관한 자산
  let id = 0;
  const all: AssetBalanceHistory[] = [];
  const row = (asset: string, at: string, balance: number, by: string | null = 'ma') =>
    all.push({ id: ++id, asset_id: asset, ledger_id: 'L9', balance, changed_by: by, changed_at: kst(at) });
  const base = Date.parse(kst('2025-02-01T09:00:00'));
  for (let i = 0; i < 1500; i++) {
    // 10시간 간격 → 2025-02-01 ~ 2026-10-19
    const at = new Date(base + i * 10 * 3600_000 + 9 * 3600_000).toISOString().slice(0, 19);
    row('활발통장', at, 1_000_000 + ((i * 7919) % 50_000) * 100);
  }
  row('오래된집', '2024-03-01T09:00:00', 400_000_000, null);
  row('오래된집', '2024-03-01T09:00:00', 410_000_000); // 같은 시각이면 id 큰 쪽이 나중
  row('옛대출', '2025-01-10T09:00:00', 50_000_000);
  row('옛대출', '2025-04-10T09:00:00', 30_000_000);
  row('보관차', '2025-03-01T09:00:00', 15_000_000, 'mb');
  row('활발통장', '2026-11-03T09:00:00', 2_222_000); // 이번 달 사람이 남긴 기록

  const asset = (aid: string, kind: AssetKind, owner: string | null, archived: string | null = null): Asset => {
    const last = all.filter((h) => h.asset_id === aid).at(-1)!;
    return {
      id: aid,
      ledger_id: 'L9',
      name: aid,
      kind,
      owner_id: owner,
      balance: last.balance,
      memo: null,
      archived_at: archived ? kst(archived) : null,
      created_at: all.find((h) => h.asset_id === aid)!.changed_at,
      updated_at: last.changed_at,
    };
  };
  const assets = [
    asset('활발통장', 'checking', 'ma'),
    asset('오래된집', 'real_estate', null),
    asset('옛대출', 'loan', null),
    asset('보관차', 'vehicle', 'mb', '2026-08-15T12:00:00'),
  ];

  it('테스트 데이터: 자산 1개 이력 1,000건 초과, 잘라 받으면 훨씬 적다', () => {
    expect(all.filter((h) => h.asset_id === '활발통장').length).toBeGreaterThan(1000);
    expect(historyWindow(all, trendWindowStart('2026-11')).length).toBeLessThan(all.length / 2);
  });

  it.each(['2026-11', '2026-10', '2026-08', '2026-05', '2025-09', '2027-02'] as const)(
    '%s 기준 6개월 추이·순자산·전월 대비가 전체 이력으로 계산한 값과 같다 (합친·사람별·공동)',
    (end) => {
      const part = historyWindow(all, trendWindowStart(end));
      for (const v of ['all', 'ma', 'mb', null] as OwnerView[]) {
        const a = filterByOwner(assets, v);
        expect(netWorthTrend(a, part, NOW, 6, end)).toEqual(netWorthTrend(a, all, NOW, 6, end));
        expect(netWorthChange(a, part, end, NOW)).toEqual(netWorthChange(a, all, end, NOW));
      }
      expect(homeNetWorth(assets, part, end, NOW)).toEqual(homeNetWorth(assets, all, end, NOW));
    },
  );

  it('6개월 넘게 안 바뀐 자산·부채가 추이의 모든 달에 들어간다', () => {
    const part = historyWindow(all, trendWindowStart('2026-11'));
    expect(part.filter((h) => h.asset_id === '오래된집')).toHaveLength(1);
    const house = netWorthTrend([assets[1]], part, NOW).map((p) => p.net);
    expect(house).toEqual([410_000_000, 410_000_000, 410_000_000, 410_000_000, 410_000_000, 410_000_000]);
    const loan = netWorthTrend([assets[2]], part, NOW).map((p) => p.net);
    expect(loan).toEqual([-30_000_000, -30_000_000, -30_000_000, -30_000_000, -30_000_000, -30_000_000]);
    // 8월 중 보관한 차: 6·7월에만 들어간다
    const car = netWorthTrend([assets[3]], part, NOW).map((p) => p.net);
    expect(car).toEqual([15_000_000, 15_000_000, null, null, null, 0]);
  });

  it('월초 안내 판단도 같다', () => {
    const part = historyWindow(all, trendWindowStart('2026-11'));
    expect(needsMonthlyCheck(part, NOW)).toBe(needsMonthlyCheck(all, NOW));
    expect(needsMonthlyCheck(part, NOW)).toBe(false);
  });
});
