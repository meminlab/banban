import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { MonthSummaryData } from '../data/summary';
import { HomePage } from './HomePage';

const fake = vi.hoisted(() => ({
  get: vi.fn<(ledgerId: string, month: string) => Promise<MonthSummaryData>>(),
}));
vi.mock('../data/summary', () => ({ getMonthSummaryData: (l: string, m: string) => fake.get(l, m) }));
vi.mock('../app/guards', () => ({ useLedgerId: () => 'ledger-1' }));

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
