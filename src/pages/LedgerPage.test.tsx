import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../app/App';
import { AuthProvider } from '../app/auth';
import type { Category, Member, Pocket, Transaction } from '../data/types';

const fake = vi.hoisted(() => ({
  transactions: [] as unknown[],
  list: vi.fn(),
}));

vi.mock('../data/auth', () => ({
  AUTH_CALLBACK_PATH: '/login',
  onAuthChange: (cb: (u: unknown) => void) => {
    queueMicrotask(() => cb({ id: 'u-me', email: 'me@example.com', name: '나', avatarUrl: null }));
    return () => undefined;
  },
  signInWithGoogle: async () => {},
  signOut: async () => {},
}));
vi.mock('../data/ledger', () => ({
  listMyLedgers: async () => [{ id: 'L', name: '우리집', memberCount: 2, joinedAt: '2026-11-01T00:00:00Z' }],
  getLastLedgerId: async () => 'L',
  rememberLedger: async () => {},
}));
vi.mock('../data/profile', () => ({ getProfile: async () => null }));

const c = (id: string, type: Category['type'], parent_id: string | null, name: string, sort_order = 1): Category => ({
  id, ledger_id: 'L', type, parent_id, name, sort_order, is_hidden: false, icon: null, created_at: '',
});
const CATEGORIES: Category[] = [
  c('food', 'expense', null, '식비', 1),
  c('food-out', 'expense', 'food', '외식', 1),
  c('food-mart', 'expense', 'food', '장보기', 2),
  c('home', 'expense', null, '주거', 2),
  c('home-rent', 'expense', 'home', '월세'),
  c('salary', 'income', null, '급여'),
  c('salary-1', 'income', 'salary', '급여'),
  { ...c('old', 'expense', null, '옛분류', 3), is_hidden: true },
  c('old-1', 'expense', 'old', '옛소분류'),
];
const POCKETS: Pocket[] = [
  { id: 'p-shared', ledger_id: 'L', name: '공동소비', scope: 'shared', sort_order: 1, is_hidden: false, created_at: '' },
  { id: 'p-mine', ledger_id: 'L', name: '개인용돈', scope: 'personal', sort_order: 2, is_hidden: false, created_at: '' },
  { id: 'p-old', ledger_id: 'L', name: '옛주머니', scope: 'shared', sort_order: 3, is_hidden: true, created_at: '' },
];
const MEMBERS: Member[] = [
  { id: 'm-me', ledger_id: 'L', user_id: 'u-me', role: 'owner', display_name: '에이', joined_at: '2026-11-01', left_at: null },
  { id: 'm-b', ledger_id: 'L', user_id: 'u-b', role: 'member', display_name: '비', joined_at: '2026-11-02', left_at: null },
  { id: 'm-c', ledger_id: 'L', user_id: 'u-c', role: 'member', display_name: '씨', joined_at: '2026-11-03', left_at: '2026-11-04' },
];

let seq = 0;
function t(o: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, ledger_id: 'L', type: 'expense', amount: 1000, occurred_on: '2026-11-03', category_id: 'food-out',
    pocket_id: 'p-shared', spender_id: 'm-me', is_fixed: false, memo: null, source: 'manual', created_by: 'm-me',
    updated_by: 'm-me', created_at: `2026-11-01T00:00:${String(seq).padStart(2, '0')}Z`, updated_at: '2026-11-01T00:00:00Z', ...o,
  };
}

vi.mock('../data/transaction', () => ({
  listRecentCategoryIds: async () => [],
  getTransactionFormOptions: async () => ({ categories: CATEGORIES, pockets: POCKETS, members: MEMBERS }),
  listMonthTransactions: (ledgerId: string, month: string) => fake.list(ledgerId, month),
  getTransaction: async (id: string) => fake.transactions.find((x) => (x as Transaction).id === id) ?? null,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const listItems = () => screen.queryAllByRole('link').filter((a) => a.classList.contains('tx-row'));
/** 행 글자 (아이콘 원의 첫 글자 대체 표시는 장식이라 뺀다) */
const rowText = (a: Element) => a.textContent!.slice(a.querySelector('.cat-icon')?.textContent?.length ?? 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T03:00:00Z')); // 2026-11-06 12:00 KST
  seq = 0;
  fake.transactions = [
    t({ occurred_on: '2026-11-03', amount: 32000, category_id: 'food-out', spender_id: 'm-b', memo: '저녁' }),
    t({ occurred_on: '2026-11-03', amount: 50000, category_id: 'food-mart', pocket_id: 'p-mine', spender_id: 'm-me' }),
    t({ occurred_on: '2026-11-05', amount: 700000, category_id: 'home-rent', spender_id: 'm-c', is_fixed: true }),
    t({ occurred_on: '2026-11-05', type: 'income', amount: 3000000, category_id: 'salary-1', pocket_id: null, spender_id: 'm-me' }),
    t({ occurred_on: '2026-10-31', amount: 12000, category_id: 'food-out', memo: '말일 23시' }),
  ];
  fake.list.mockReset().mockImplementation(async (_l: string, month: string) =>
    fake.transactions.filter((x) => (x as Transaction).occurred_on.startsWith(month)),
  );
});
afterEach(() => vi.useRealTimers());

describe('가계부 탭: 목록', () => {
  it('이번 달(KST) 내역을 날짜 카드로: 제목(메모·소분류) / "대분류 · 사람", 배지 없음, 그날 지출 합', async () => {
    renderAt('/ledger');
    expect(await screen.findByRole('heading', { name: '11월 5일 (목)' })).toBeInTheDocument();
    expect(fake.list).toHaveBeenCalledWith('L', '2026-11');
    // 월 이동 줄: 올해는 "11월" (화면낭독은 연도까지)
    expect(screen.getByRole('heading', { level: 2, name: '2026년 11월' })).toHaveTextContent(/^11월$/);
    // 보기 전환·필터 = 아이콘 버튼 2개, 이달 3칸 합계 없음
    expect(screen.getByRole('button', { name: '달력으로 보기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '필터' }).querySelector('.filter-button__dot')).toBeNull();
    expect(screen.queryByText(/필터 결과/)).not.toBeInTheDocument();

    const nov5 = screen.getByRole('region', { name: '11월 5일 (목)' });
    const rent = within(nov5).getByRole('link', { name: /월세/ });
    expect(rowText(rent)).toBe('월세주거 · 씨 (나감)−700,000원'); // 주머니·고정·유형 배지 없음
    expect(rowText(within(nov5).getByRole('link', { name: /급여/ }))).toBe('급여에이+3,000,000원');
    expect(nov5).toHaveTextContent('−700,000'); // 그날 지출 합 (수입 제외)

    const nov3 = screen.getByRole('region', { name: '11월 3일 (화)' });
    expect(within(nov3).getAllByRole('link').map(rowText)).toEqual([
      '장보기식비 · 에이−50,000원',
      '저녁식비 · 비−32,000원',
    ]);
    expect(nov3).toHaveTextContent('−82,000');
    // 날짜 순서: 최근이 위
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['11월 5일 (목)', '11월 3일 (화)']);
  });

  it('다른 해는 월 이동 줄에 연도까지', async () => {
    renderAt('/ledger?month=2025-12');
    await screen.findByText('이 달에 입력한 내역이 없어요');
    expect(screen.getByRole('heading', { level: 2, name: '2025년 12월' })).toHaveTextContent('2025년 12월');
  });

  it('말일 내역은 그 달에만 보인다 (월 이동)', async () => {
    const user = userEvent.setup();
    renderAt('/ledger');
    await screen.findByRole('heading', { name: '11월 5일 (목)' });
    expect(screen.queryByText(/말일 23시/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '이전 달' }));
    expect(await screen.findByRole('heading', { name: '10월 31일 (토)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '2026년 10월' })).toBeInTheDocument();
    expect(fake.list).toHaveBeenLastCalledWith('L', '2026-10');
    expect(listItems()).toHaveLength(1);
    expect(screen.getByText(/말일 23시/)).toBeInTheDocument();
  });

  it('내역이 없는 달은 빈 화면 안내', async () => {
    const user = userEvent.setup();
    renderAt('/ledger');
    await screen.findByRole('heading', { name: '11월 5일 (목)' });
    await user.click(screen.getByRole('button', { name: '다음 달' }));
    expect(await screen.findByText('이 달에 입력한 내역이 없어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '달력으로 보기' }));
    expect(screen.getByText('이 달에 입력한 내역이 없어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '목록으로 보기' })).toBeInTheDocument();
  });

  it('불러오기 실패 → 다시 시도', async () => {
    fake.list.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderAt('/ledger');
    expect(await screen.findByRole('alert')).toHaveTextContent('내역을 불러오지 못했어요');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { name: '11월 5일 (목)' })).toBeInTheDocument();
  });
});

describe('가계부 탭: 필터', () => {
  it('사람 + 카테고리 + 유형 조합 → 조건에 맞는 내역만, 초기화', async () => {
    const user = userEvent.setup();
    renderAt('/ledger');
    await screen.findByRole('heading', { name: '11월 5일 (목)' });

    await user.click(screen.getByRole('button', { name: '필터' }));
    const sheet = screen.getByRole('dialog', { name: '필터' });
    // 나간 멤버는 이 달 내역이 있으면 "(나감)"으로 보인다
    expect(within(sheet).getByRole('group', { name: '사람' })).toHaveTextContent('에이비씨 (나감)');

    await user.click(within(sheet).getByRole('checkbox', { name: '에이' }));
    expect(within(sheet).getByRole('button', { name: '2건 보기' })).toBeInTheDocument(); // 에이: 장보기, 급여
    await user.click(within(sheet).getByRole('checkbox', { name: '식비' }));
    expect(within(sheet).getByRole('button', { name: '1건 보기' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('checkbox', { name: '비' }));
    await user.click(within(sheet).getByRole('checkbox', { name: '지출' }));
    await user.click(within(sheet).getByRole('button', { name: '2건 보기' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(listItems().map(rowText)).toEqual([
      '장보기식비 · 에이−50,000원',
      '저녁식비 · 비−32,000원',
    ]);
    // 필터 결과 한 줄 = 지금 목록과 같은 건수·지출 합, 필터 아이콘에 점
    expect(screen.getByText('필터 결과 2건 · 지출 82,000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '필터 (4개 적용 중)' }).querySelector('.filter-button__dot')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '지우기' }));
    expect(listItems()).toHaveLength(4);
    expect(screen.queryByText(/필터 결과/)).not.toBeInTheDocument();
  });

  it('주머니 필터: 주머니 없는 수입은 빠진다. 맞는 게 없으면 안내', async () => {
    const user = userEvent.setup();
    renderAt('/ledger?pocket=p-shared');
    await screen.findByRole('heading', { name: '11월 5일 (목)' });
    expect(listItems()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '필터 (1개 적용 중)' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: '수입' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '0건 보기' }));
    expect(screen.getByText('조건에 맞는 내역이 없어요')).toBeInTheDocument();
  });
});

describe('가계부 탭: 필터 유지 (BANB-20)', () => {
  it('11월에 고른 나간 멤버는 그 멤버 내역이 없는 10월에서도 선택된 칩으로 보이고, 끄면 내역이 다시 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/ledger');
    await screen.findByRole('heading', { name: '11월 5일 (목)' });
    await user.click(screen.getByRole('button', { name: '필터' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: '씨 (나감)' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '1건 보기' }));

    await user.click(screen.getByRole('button', { name: '이전 달' }));
    await screen.findByText('조건에 맞는 내역이 없어요');
    expect(screen.getByText('필터 결과 0건 · 지출 0')).toBeInTheDocument(); // 달을 옮겨도 필터 유지

    await user.click(screen.getByRole('button', { name: '필터 (1개 적용 중)' }));
    const chip = within(screen.getByRole('dialog')).getByRole('checkbox', { name: '씨 (나감)' });
    expect(chip).toBeChecked();
    await user.click(chip);
    // 끄면 10월에 안 쓰인 나간 멤버 칩은 다음부터 안 보인다 (선택 안 된 나감 항목은 그 달에 쓰였을 때만)
    expect(within(screen.getByRole('dialog')).queryByRole('checkbox', { name: '씨 (나감)' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '1건 보기' }));
    expect(listItems()).toHaveLength(1);
  });

  it('숨긴 카테고리·주머니도 고른 상태면 그 달에 안 쓰였어도 칩으로 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/ledger?category=old&pocket=p-old');
    await screen.findByText('조건에 맞는 내역이 없어요');
    await user.click(screen.getByRole('button', { name: '필터 (2개 적용 중)' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('checkbox', { name: '옛분류' })).toBeChecked();
    expect(within(sheet).getByRole('checkbox', { name: '옛주머니' })).toBeChecked();
    await user.click(within(sheet).getByRole('checkbox', { name: '옛분류' }));
    await user.click(within(sheet).getByRole('checkbox', { name: '옛주머니' }));
    await user.click(within(sheet).getByRole('button', { name: '4건 보기' }));
    expect(listItems()).toHaveLength(4);
  });

  it('주소에 남은 알 수 없는 값(삭제된 카테고리·주머니 등)은 무시한다', async () => {
    renderAt('/ledger?category=gone&pocket=gone&spender=gone');
    await screen.findByRole('heading', { name: '11월 5일 (목)' });
    expect(listItems()).toHaveLength(4);
    expect(screen.getByRole('button', { name: '필터' })).toBeInTheDocument();
    expect(screen.queryByText(/필터 결과/)).not.toBeInTheDocument();
  });
});

describe('가계부 탭: 달력', () => {
  it('날짜별 지출·수입 합계, 기본 선택은 오늘, 날짜를 누르면 그날 내역', async () => {
    const user = userEvent.setup();
    renderAt('/ledger');
    await screen.findByRole('heading', { name: '11월 5일 (목)' });
    await user.click(screen.getByRole('button', { name: '달력으로 보기' }));

    const cal = screen.getByRole('table', { name: '2026년 11월 달력' });
    const nov5 = within(cal).getByRole('button', { name: '11월 5일 (목), 지출 700,000원, 수입 3,000,000원' });
    expect(nov5).toHaveTextContent('5−70만+300만');
    expect(within(cal).getByRole('button', { name: '11월 3일 (화), 지출 82,000원' })).toHaveTextContent('3−8.2만');

    // 오늘(6일) 선택됨, 내역 없음
    expect(within(cal).getByRole('button', { name: '11월 6일 (금), 내역 없음' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('이 날은 내역이 없어요.')).toBeInTheDocument();

    await user.click(nov5);
    expect(nov5).toHaveAttribute('aria-pressed', 'true');
    const detail = screen.getByRole('region', { name: '11월 5일 (목)' });
    expect(within(detail).getAllByRole('link')).toHaveLength(2);
  });

  it('저축이 있는 날은 회색 점 + 범례, 칸 이름에 저축 금액 (5.14)', async () => {
    fake.transactions.push(t({ occurred_on: '2026-11-04', type: 'saving', amount: 500000, category_id: 'fund', pocket_id: null }));
    renderAt('/ledger?view=calendar');
    const cal = await screen.findByRole('table', { name: '2026년 11월 달력' });
    const nov4 = within(cal).getByRole('button', { name: '11월 4일 (수), 저축 500,000원' });
    expect(nov4.querySelector('.calendar__saving')).not.toBeNull();
    expect(within(cal).getByRole('button', { name: /11월 3일/ }).querySelector('.calendar__saving')).toBeNull();
    expect(screen.getByText(/저축$/, { selector: '.calendar__legend' })).toBeInTheDocument();
  });

  it('필터는 달력 합계에도 적용된다', async () => {
    renderAt('/ledger?view=calendar&spender=m-me');
    const cal = await screen.findByRole('table', { name: '2026년 11월 달력' });
    expect(within(cal).getByRole('button', { name: '11월 5일 (목), 수입 3,000,000원' })).toBeInTheDocument();
    expect(within(cal).getByRole('button', { name: '11월 3일 (화), 지출 50,000원' })).toBeInTheDocument();
  });

  it('지난 달은 날짜를 고르기 전까지 안내', async () => {
    renderAt('/ledger?view=calendar&month=2026-10');
    await screen.findByRole('table', { name: '2026년 10월 달력' });
    expect(screen.getByText('날짜를 누르면 그날 내역이 보여요.')).toBeInTheDocument();
  });
});

describe('가계부 탭 → 수정 화면', () => {
  it('내역을 누르면 수정 화면, 닫으면 보던 달·보기·필터로 돌아온다', async () => {
    const user = userEvent.setup();
    renderAt('/ledger?month=2026-10&view=calendar&day=2026-10-31&type=expense');
    const link = await screen.findByRole('link', { name: /말일 23시/ });
    await user.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: '내역 수정' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '닫기' }));
    const cal = await screen.findByRole('table', { name: '2026년 10월 달력' });
    expect(within(cal).getByRole('button', { name: /10월 31일/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('필터 결과 1건 · 지출 12,000')).toBeInTheDocument();
  });
});
