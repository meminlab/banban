import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import type { MonthSummaryData } from '../data/summary';
import type { Asset, AssetBalanceHistory, AssetKind } from '../data/types';
import { HomePage as HomePageInner } from './HomePage';

const fake = vi.hoisted(() => ({
  get: vi.fn<(ledgerId: string, month: string) => Promise<MonthSummaryData>>(),
}));
vi.mock('../data/summary', () => ({ getMonthSummaryData: (l: string, m: string) => fake.get(l, m) }));
vi.mock('../app/guards', () => ({ useLedgerId: () => 'ledger-1' }));

const assetDb = vi.hoisted(() => ({
  assets: [] as Asset[],
  history: [] as AssetBalanceHistory[],
  fail: 0,
  calls: 0,
  pending: false,
  /** listBalanceHistory 에 넘어온 창 시작(ms) */
  since: [] as number[],
}));
vi.mock('../data/asset', () => ({
  listAssets: async () => {
    assetDb.calls += 1;
    if (assetDb.pending) return new Promise(() => {});
    if (assetDb.fail > 0) {
      assetDb.fail -= 1;
      throw new Error('network');
    }
    return assetDb.assets;
  },
  // 서버처럼 창 시작 이후 + 자산마다 직전 1건만 돌려준다 (BANB-30)
  listBalanceHistory: async (_l: string, since: number) => {
    assetDb.since.push(since);
    const before = new Map<string, AssetBalanceHistory>();
    const after: AssetBalanceHistory[] = [];
    for (const h of assetDb.history) {
      if (Date.parse(h.changed_at) >= since) after.push(h);
      else before.set(h.asset_id, h); // 오래된 순이므로 마지막 것이 직전
    }
    return [...before.values(), ...after];
  },
}));

/** 홈은 링크(자산 탭·자산 추가)가 있어 라우터 안에서 그린다 */
function HomePage() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePageInner />} />
        <Route path="/assets" element={<p>자산 탭 화면</p>} />
        <Route path="/assets/new" element={<p>자산 추가 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const REFS = {
  members: [
    { id: 'mA', display_name: '김', joined_at: '2026-11-01T00:00:00Z', left_at: null },
    { id: 'mB', display_name: '반', joined_at: '2026-11-02T00:00:00Z', left_at: null },
  ],
  pockets: [
    { id: 'p1', name: '공동소비', scope: 'shared' as const, sort_order: 1 },
    { id: 'p2', name: '개인용돈', scope: 'personal' as const, sort_order: 2 },
  ],
  categories: [
    { id: 'food', parent_id: null, name: '식비', sort_order: 1 },
    { id: 'food.out', parent_id: 'food', name: '외식', sort_order: 1 },
  ],
};

function data(month: string): MonthSummaryData {
  return {
    ...REFS,
    transactions: [
      { type: 'income', amount: 1000000, occurred_on: `${month}-05`, category_id: 'i', pocket_id: null, spender_id: 'mA', is_fixed: false },
      { type: 'saving', amount: 500000, occurred_on: `${month}-06`, category_id: 's', pocket_id: null, spender_id: 'mA', is_fixed: false },
      { type: 'expense', amount: 750000, occurred_on: `${month}-07`, category_id: 'food.out', pocket_id: 'p1', spender_id: 'mB', is_fixed: true },
      { type: 'expense', amount: 250000, occurred_on: `${month}-08`, category_id: 'food.out', pocket_id: 'p2', spender_id: 'mA', is_fixed: false },
    ],
  };
}

function amountOf(label: string) {
  const card = screen.getByRole('region', { name: '이번 달 요약' });
  return within(card).getByText(label).nextElementSibling;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T03:00:00Z'));
  fake.get.mockReset();
  assetDb.assets = [];
  assetDb.history = [];
  assetDb.fail = 0;
  assetDb.calls = 0;
  assetDb.pending = false;
  assetDb.since = [];
});
afterEach(() => vi.useRealTimers());

describe('홈: 월 요약', () => {
  it('이번 달(KST) 수입·지출·저축·남은 돈과 나눠 보기를 보여 준다', async () => {
    fake.get.mockImplementation(async (_l, m) => data(m));
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeInTheDocument();
    await screen.findByRole('region', { name: '이번 달 요약' });
    expect(fake.get).toHaveBeenCalledWith('ledger-1', '2026-11');

    expect(amountOf('수입')).toHaveTextContent('1,000,000원');
    expect(amountOf('지출')).toHaveTextContent('1,000,000원');
    expect(amountOf('저축')).toHaveTextContent('500,000원');
    expect(amountOf('남은 돈')).toHaveTextContent('-500,000원');
    expect(amountOf('남은 돈')).toHaveClass('is-negative');

    const people = screen.getByRole('list', { name: '사람별' });
    expect(within(people).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '김250,000원25%',
      '반750,000원75%',
    ]);
    const scope = screen.getByRole('list', { name: '공동·개인' });
    expect(within(scope).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '공동750,000원75%',
      '개인250,000원25%',
    ]);
    expect(screen.getByRole('list', { name: '주머니별' })).toHaveTextContent('공동소비750,000원75%');
    expect(screen.getByRole('list', { name: '고정·변동' })).toHaveTextContent('고정750,000원75%변동250,000원25%');
    expect(screen.getByRole('list', { name: '카테고리 상위 5개' })).toHaveTextContent('식비1,000,000원100%');
  });

  it('남은 돈이 0 이상이면 빨간색이 아니다', async () => {
    fake.get.mockResolvedValue({ ...REFS, transactions: [] });
    render(<HomePage />);
    await screen.findByRole('region', { name: '이번 달 요약' });
    expect(amountOf('남은 돈')).toHaveTextContent('0원');
    expect(amountOf('남은 돈')).not.toHaveClass('is-negative');
  });

  it('내역이 없으면 모두 0원과 빈 상태 안내', async () => {
    fake.get.mockResolvedValue({ ...REFS, transactions: [] });
    render(<HomePage />);
    await screen.findByRole('region', { name: '이번 달 요약' });
    for (const label of ['수입', '지출', '저축', '남은 돈']) expect(amountOf(label)).toHaveTextContent(/^0원$/);
    expect(screen.getByText('이 달에 입력한 내역이 없어요.')).toBeInTheDocument();
    expect(screen.getByText('이 달 지출이 없어요.')).toBeInTheDocument();
  });

  it('이전 달 / 다음 달로 이동하면 그 달을 다시 불러온다 (연도 넘김)', async () => {
    fake.get.mockImplementation(async (_l, m) => data(m));
    const user = userEvent.setup();
    render(<HomePage />);
    await screen.findByRole('region', { name: '이번 달 요약' });

    await user.click(screen.getByRole('button', { name: '다음 달' }));
    await user.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.getByRole('heading', { name: '2027년 1월' })).toBeInTheDocument();
    await screen.findByRole('region', { name: '이번 달 요약' });
    expect(fake.get).toHaveBeenLastCalledWith('ledger-1', '2027-01');

    await user.click(screen.getByRole('button', { name: '이전 달' }));
    expect(screen.getByRole('heading', { name: '2026년 12월' })).toBeInTheDocument();
    expect(fake.get).toHaveBeenLastCalledWith('ledger-1', '2026-12');
  });

  it('불러오기 실패하면 안내하고 다시 시도할 수 있다', async () => {
    fake.get.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ...REFS, transactions: [] });
    const user = userEvent.setup();
    render(<HomePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('요약을 불러오지 못했어요');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('region', { name: '이번 달 요약' })).toBeInTheDocument();
    expect(fake.get).toHaveBeenCalledTimes(2);
  });

  it('불러오는 중 표시', () => {
    fake.get.mockReturnValue(new Promise(() => {}));
    render(<HomePage />);
    expect(screen.getByRole('status')).toHaveTextContent('불러오고 있어요');
  });
});

// ── 우리집 순자산 카드 (BANB-27, QA v4 HM). 기준 데이터 = QA v4 (오늘 2026-11-06 KST)
const kst = (t: string) => new Date(`${t}+09:00`).toISOString();
function seedV4() {
  let hid = 0;
  const assets: Asset[] = [];
  const history: AssetBalanceHistory[] = [];
  const mk = (id: string, kind: AssetKind, owner: string | null, hist: [string, number][], archived: string | null = null) => {
    for (const [at, balance] of hist) history.push({ id: ++hid, asset_id: id, ledger_id: 'ledger-1', balance, changed_by: 'mA', changed_at: kst(at) });
    assets.push({
      id,
      ledger_id: 'ledger-1',
      name: id,
      kind,
      owner_id: owner,
      balance: hist[hist.length - 1][1],
      memo: null,
      archived_at: archived ? kst(archived) : null,
      created_at: kst(hist[0][0]),
      updated_at: kst(hist[hist.length - 1][0]),
    });
  };
  mk('A통장', 'checking', 'mA', [
    ['2026-09-15T09:00:00', 3_000_000],
    ['2026-10-10T09:00:00', 2_000_000],
    ['2026-11-05T10:00:00', 2_500_000],
    ['2026-11-05T18:00:00', 2_700_000],
  ]);
  mk('B적금', 'installment_saving', 'mB', [
    ['2026-09-15T09:00:00', 5_000_000],
    ['2026-10-31T23:59:59', 6_000_000],
  ]);
  mk('우리집', 'real_estate', null, [['2026-09-15T09:00:00', 300_000_000]]);
  mk('주담대', 'loan', null, [
    ['2026-09-15T09:00:00', 200_000_000],
    ['2026-11-01T00:00:00', 199_000_000],
  ]);
  mk('A카드', 'card_payable', 'mA', [['2026-10-10T09:00:00', 1_000_000]]);
  mk('B차', 'vehicle', 'mB', [['2026-09-15T09:00:00', 20_000_000]], '2026-11-06T00:00:01');
  assetDb.assets = assets;
  assetDb.history = history;
}

const nwLink = () => screen.findByRole('link', { name: /^우리집 순자산/ });

describe('홈: 우리집 순자산 카드', () => {
  beforeEach(() => fake.get.mockImplementation(async (_l: string, m: string) => data(m)));

  it('HM-01 맨 위 카드: 108,700,000원 · 지난달보다 ▼18,300,000원 · 작은 추이', async () => {
    seedV4();
    render(<HomePage />);
    const card = await nwLink();
    expect(card).toHaveAccessibleName('우리집 순자산, 108,700,000원, 지난달보다 18,300,000원 줄었어요, 자산 탭으로 이동');
    expect(within(card).getByTestId('home-net-worth')).toHaveTextContent('108,700,000원');
    expect(card).toHaveTextContent('지난달보다 ▼ 18,300,000원');
    expect(card.querySelector('svg.mini-trend polyline')).not.toBeNull();
    expect(card.querySelectorAll('svg.mini-trend circle')).toHaveLength(1);
    // 카드가 이번 달 요약보다 위
    const summary = await screen.findByRole('region', { name: '이번 달 요약' });
    expect(card.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('BANB-30 이력은 12개월치만 받고, 6개월 추이를 못 그리는 달로 가면 그 달 기준으로 다시 받는다', async () => {
    seedV4();
    const user = userEvent.setup();
    render(<HomePage />);
    await nwLink();
    expect(assetDb.since).toEqual([Date.parse(kst('2025-12-01T00:00:00'))]);
    // 5월까지(추이 시작 12월)는 받은 범위로 계산
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole('button', { name: '이전 달' }));
    expect(await nwLink()).toHaveTextContent('5월 말 기준');
    expect(assetDb.calls).toBe(1);
    // 4월(추이 시작 11월)은 다시 받는다
    await user.click(screen.getByRole('button', { name: '이전 달' }));
    expect(await nwLink()).toHaveTextContent('4월 말 기준');
    expect(assetDb.since).toEqual([Date.parse(kst('2025-12-01T00:00:00')), Date.parse(kst('2025-05-01T00:00:00'))]);
    expect(assetDb.calls).toBe(2);
    // 이번 달로 돌아오면 넓게 받은 범위를 그대로 쓴다 — 값은 처음과 같다
    for (let i = 0; i < 7; i++) await user.click(screen.getByRole('button', { name: '다음 달' }));
    expect(within(await nwLink()).getByTestId('home-net-worth')).toHaveTextContent('108,700,000원');
    expect(assetDb.calls).toBe(2);
  });

  it('HM-02 카드를 누르면 자산 탭으로 간다', async () => {
    seedV4();
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await nwLink());
    expect(screen.getByText('자산 탭 화면')).toBeInTheDocument();
  });

  it('HM-03·04 월 이동: 카드는 그 달 월말 기준, 아래 요약은 그 달 내역', async () => {
    seedV4();
    const user = userEvent.setup();
    render(<HomePage />);
    await nwLink();
    await user.click(screen.getByRole('button', { name: '이전 달' }));
    let card = await nwLink();
    expect(card).toHaveTextContent('10월 말 기준');
    expect(within(card).getByTestId('home-net-worth')).toHaveTextContent('127,000,000원');
    expect(card).toHaveTextContent('9월 말보다 ▼ 1,000,000원');
    await screen.findByRole('region', { name: '이번 달 요약' });
    expect(fake.get).toHaveBeenLastCalledWith('ledger-1', '2026-10');

    await user.click(screen.getByRole('button', { name: '이전 달' }));
    card = await nwLink();
    expect(within(card).getByTestId('home-net-worth')).toHaveTextContent('128,000,000원');
    expect(card).toHaveTextContent('8월 말보다 –');
    expect(assetDb.calls).toBe(1); // 자산은 달마다 다시 읽지 않는다
  });

  it('HM-05 이력 시작 전 달(8월)은 "–"', async () => {
    seedV4();
    const user = userEvent.setup();
    render(<HomePage />);
    await nwLink();
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole('button', { name: '이전 달' }));
    const card = await nwLink();
    expect(within(card).getByTestId('home-net-worth')).toHaveTextContent(/^–$/);
    expect(card).toHaveAccessibleName(/8월 말 기준, 기록이 없어요/);
  });

  it('HM-06 미래 달(12월)은 현재 값', async () => {
    seedV4();
    const user = userEvent.setup();
    render(<HomePage />);
    await nwLink();
    await user.click(screen.getByRole('button', { name: '다음 달' }));
    const card = await nwLink();
    expect(card).toHaveTextContent('지금 기준');
    expect(within(card).getByTestId('home-net-worth')).toHaveTextContent('108,700,000원');
  });

  it('HM-07 자산이 없으면 "자산을 등록해 보세요" → 자산 추가 화면', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const link = await screen.findByRole('link', { name: /자산을 등록해 보세요/ });
    await user.click(link);
    expect(screen.getByText('자산 추가 화면')).toBeInTheDocument();
  });

  it('HM-08 순자산 음수는 빨간색 "−"', async () => {
    assetDb.assets = [
      {
        id: 'd',
        ledger_id: 'ledger-1',
        name: '빚',
        kind: 'loan',
        owner_id: null,
        balance: 9_999_999_999,
        memo: null,
        archived_at: null,
        created_at: kst('2026-11-02T09:00:00'),
        updated_at: kst('2026-11-02T09:00:00'),
      },
    ];
    assetDb.history = [{ id: 1, asset_id: 'd', ledger_id: 'ledger-1', balance: 9_999_999_999, changed_by: 'mA', changed_at: kst('2026-11-02T09:00:00') }];
    render(<HomePage />);
    const value = within(await nwLink()).getByTestId('home-net-worth');
    expect(value).toHaveTextContent('−9,999,999,999원');
    expect(value).toHaveClass('is-negative');
  });

  it('순자산을 못 불러와도 아래 요약은 보이고, 카드만 다시 불러올 수 있다', async () => {
    seedV4();
    assetDb.fail = 1;
    const user = userEvent.setup();
    render(<HomePage />);
    expect(await screen.findByText('순자산을 불러오지 못했어요.')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '이번 달 요약' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '순자산 다시 불러오기' }));
    expect(await nwLink()).toHaveTextContent('108,700,000원');
  });

  it('불러오는 중 안내', () => {
    assetDb.pending = true;
    render(<HomePage />);
    expect(screen.getByText('순자산을 불러오고 있어요')).toBeInTheDocument();
  });
});
