import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../app/App';
import { AuthProvider } from '../app/auth';
import type { Category, Member, Pocket, Transaction } from '../data/types';
import { todayKST } from '../domain/transactionForm';

// ── 저장소 모듈 가짜
const fake = vi.hoisted(() => ({
  transactions: [] as unknown[],
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
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
  id,
  ledger_id: 'L',
  type,
  parent_id,
  name,
  sort_order,
  is_hidden: false,
  created_at: '',
});
const CATEGORIES: Category[] = [
  c('food', 'expense', null, '식비'),
  c('food-out', 'expense', 'food', '외식', 1),
  c('food-mart', 'expense', 'food', '장보기', 2),
  c('salary', 'income', null, '급여'),
  c('salary-1', 'income', 'salary', '급여'),
  c('fund', 'saving', null, '적금'),
  c('fund-1', 'saving', 'fund', '적금'),
];
const POCKETS: Pocket[] = [
  { id: 'p-shared', ledger_id: 'L', name: '공동소비', scope: 'shared', sort_order: 1, is_hidden: false, created_at: '' },
  { id: 'p-mine', ledger_id: 'L', name: '개인용돈', scope: 'personal', sort_order: 2, is_hidden: false, created_at: '' },
];
const MEMBERS: Member[] = [
  { id: 'm-me', ledger_id: 'L', user_id: 'u-me', role: 'owner', display_name: '에이', joined_at: '2026-11-01', left_at: null },
  { id: 'm-b', ledger_id: 'L', user_id: 'u-b', role: 'member', display_name: '비', joined_at: '2026-11-02', left_at: null },
];
const B_ENTRY: Transaction = {
  id: 't1',
  ledger_id: 'L',
  type: 'expense',
  amount: 32000,
  occurred_on: '2026-11-03',
  category_id: 'food-out',
  pocket_id: 'p-shared',
  spender_id: 'm-b',
  is_fixed: false,
  memo: '저녁',
  source: 'manual',
  created_by: 'm-b',
  updated_by: 'm-b',
  created_at: '2026-11-03T10:00:00Z',
  updated_at: '2026-11-03T10:00:00Z',
};

vi.mock('../data/transaction', () => ({
  getTransactionFormOptions: async () => ({ categories: CATEGORIES, pockets: POCKETS, members: MEMBERS }),
  listMonthTransactions: async () => fake.transactions,
  getTransaction: async (id: string) => fake.transactions.find((t) => (t as Transaction).id === id) ?? null,
  createTransaction: (...args: unknown[]) => fake.create(...args),
  updateTransaction: (...args: unknown[]) => fake.update(...args),
  deleteTransaction: (...args: unknown[]) => fake.remove(...args),
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

beforeEach(() => {
  fake.transactions = [B_ENTRY];
  fake.create.mockReset().mockResolvedValue('new-id');
  fake.update.mockReset().mockResolvedValue('updated');
  fake.remove.mockReset().mockResolvedValue(undefined);
});

const amountInput = () => screen.getByLabelText('금액');

async function openNewForm() {
  const user = userEvent.setup();
  renderAt('/ledger');
  await user.click(await screen.findByRole('link', { name: '내역 입력' }));
  await screen.findByRole('heading', { level: 1, name: '내역 입력' });
  return user;
}

describe('내역 입력', () => {
  it('가계부 탭의 입력 버튼 → 입력 화면. 기본값: 지출, 오늘 날짜, 사용한 사람 = 나', async () => {
    await openNewForm();
    expect(screen.getByRole('radio', { name: '지출' })).toBeChecked();
    expect(screen.getByLabelText('날짜')).toHaveValue(todayKST());
    expect(screen.getByRole('radio', { name: '에이 (나)' })).toBeChecked();
    expect(amountInput()).toHaveFocus();
    expect(amountInput()).toHaveAttribute('inputmode', 'numeric');
  });

  it('금액은 천 단위로 표시된다', async () => {
    const user = await openNewForm();
    await user.type(amountInput(), '1234567');
    expect(amountInput()).toHaveValue('1,234,567');
  });

  it('필수값이 없으면 저장하지 않고 칸별로 안내한다', async () => {
    const user = await openNewForm();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByRole('alert')).toHaveTextContent('입력값을 확인해 주세요');
    expect(screen.getByText('금액을 입력해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('카테고리를 골라 주세요.')).toBeInTheDocument();
    expect(screen.getByText('주머니를 골라 주세요.')).toBeInTheDocument();
    expect(amountInput()).toHaveAttribute('aria-invalid', 'true');
    expect(fake.create).not.toHaveBeenCalled();
  });

  it.each([
    ['0', '금액은 1원 이상이어야 해요.'],
    ['-500', '금액은 1원 이상의 정수(원 단위)로 입력해 주세요.'],
    ['12.5', '금액은 1원 이상의 정수(원 단위)로 입력해 주세요.'],
    ['10000000000', '금액은 9,999,999,999원까지 입력할 수 있어요.'],
  ])('금액 %s 는 저장되지 않고 안내가 나온다', async (amount, message) => {
    const user = await openNewForm();
    await user.type(amountInput(), amount);
    await user.selectOptions(screen.getByLabelText('카테고리'), 'food-out');
    await user.click(screen.getByRole('radio', { name: '공동소비' }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('유형을 바꾸면 카테고리 선택지가 바뀌고, 지출이 아니면 주머니·고정지출이 사라진다', async () => {
    const user = await openNewForm();
    const options = () => within(screen.getByLabelText('카테고리')).getAllByRole('option').map((o) => o.textContent);
    expect(options()).toEqual(['카테고리 선택', '식비 › 외식', '식비 › 장보기']);
    await user.selectOptions(screen.getByLabelText('카테고리'), 'food-out');
    expect(screen.getByRole('group', { name: '주머니' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '고정지출' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '수입' }));
    expect(options()).toEqual(['카테고리 선택', '급여']);
    expect(screen.getByLabelText('카테고리')).toHaveValue('');
    expect(screen.queryByRole('group', { name: '주머니' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '고정지출' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '저축' }));
    expect(options()).toEqual(['카테고리 선택', '적금']);
  });

  it('저장하면 입력값으로 내역을 만들고 가계부 탭에서 "저장했어요"를 보여 준다', async () => {
    const user = await openNewForm();
    await user.type(amountInput(), '12000');
    await user.selectOptions(screen.getByLabelText('카테고리'), 'food-mart');
    await user.click(screen.getByRole('radio', { name: '개인용돈' }));
    await user.click(screen.getByRole('radio', { name: '비' }));
    await user.click(screen.getByRole('checkbox', { name: '고정지출' }));
    await user.type(screen.getByLabelText(/메모/), '장보기');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(fake.create).toHaveBeenCalledWith('L', {
      type: 'expense',
      amount: 12000,
      occurred_on: todayKST(),
      category_id: 'food-mart',
      pocket_id: 'p-mine',
      spender_id: 'm-b',
      is_fixed: true,
      memo: '장보기',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('저장했어요');
    expect(screen.getByRole('heading', { level: 1, name: '가계부' })).toBeInTheDocument();
  });

  it('수입은 주머니 없이, 고정지출 false 로 저장된다', async () => {
    const user = await openNewForm();
    await user.click(screen.getByRole('radio', { name: '수입' }));
    await user.type(amountInput(), '3000000');
    await user.selectOptions(screen.getByLabelText('카테고리'), 'salary-1');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(fake.create).toHaveBeenCalledWith('L', expect.objectContaining({ type: 'income', pocket_id: null, is_fixed: false }));
  });

  it('저장에 실패하면 입력값이 남아 있고, 다시 시도할 수 있다', async () => {
    fake.create.mockRejectedValueOnce(new Error('network'));
    const user = await openNewForm();
    await user.type(amountInput(), '5000');
    await user.selectOptions(screen.getByLabelText('카테고리'), 'food-out');
    await user.click(screen.getByRole('radio', { name: '공동소비' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요');
    expect(amountInput()).toHaveValue('5,000');
    expect(screen.getByLabelText('카테고리')).toHaveValue('food-out');

    await user.click(screen.getByRole('button', { name: '다시 저장' }));
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('status')).toHaveTextContent('저장했어요');
  });
});

describe('내역 수정·삭제', () => {
  async function openEntry() {
    const user = userEvent.setup();
    renderAt('/ledger');
    await user.click(await screen.findByRole('link', { name: /식비 › 외식/ }));
    await screen.findByRole('heading', { level: 1, name: '내역 수정' });
    return user;
  }

  it('목록에서 다른 멤버가 입력한 내역을 열면 값과 "마지막 수정: 이름, 시각"이 보인다', async () => {
    await openEntry();
    expect(amountInput()).toHaveValue('32,000');
    expect(screen.getByLabelText('카테고리')).toHaveValue('food-out');
    expect(screen.getByRole('radio', { name: '공동소비' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '비' })).toBeChecked();
    expect(screen.getByText(/마지막 수정: 비, 2026\. 11\. 3\. 19:00/)).toBeInTheDocument();
  });

  it('다른 멤버의 내역도 수정할 수 있다', async () => {
    const user = await openEntry();
    await user.clear(amountInput());
    await user.type(amountInput(), '35000');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(fake.update).toHaveBeenCalledWith('t1', expect.objectContaining({ amount: 35000, spender_id: 'm-b' }));
    expect(await screen.findByRole('status')).toHaveTextContent('저장했어요');
  });

  it('상대가 이미 삭제한 내역을 저장하면 "삭제된 내역입니다" 안내 후 화면을 닫는다 (새로 만들지 않음)', async () => {
    fake.update.mockResolvedValueOnce('deleted');
    const user = await openEntry();
    await user.click(screen.getByRole('button', { name: '저장' }));
    const dialog = await screen.findByRole('alertdialog', { name: '삭제된 내역입니다' });
    expect(fake.create).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '확인' }));
    expect(await screen.findByRole('heading', { level: 1, name: '가계부' })).toBeInTheDocument();
  });

  it('삭제는 확인 창을 거친다: 취소하면 남고, 삭제하면 지워진다', async () => {
    const user = await openEntry();
    await user.click(screen.getByRole('button', { name: '삭제' }));
    let dialog = screen.getByRole('alertdialog', { name: '이 내역을 삭제할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '삭제' }));
    dialog = screen.getByRole('alertdialog', { name: '이 내역을 삭제할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(fake.remove).toHaveBeenCalledWith('t1');
    expect(await screen.findByRole('status')).toHaveTextContent('삭제했어요');
  });

  it('삭제에 실패하면 안내하고 다시 시도할 수 있다', async () => {
    fake.remove.mockRejectedValueOnce(new Error('network'));
    const user = await openEntry();
    await user.click(screen.getByRole('button', { name: '삭제' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('삭제하지 못했어요');
    expect(screen.getByRole('button', { name: '삭제' })).toBeEnabled();
  });

  it('이미 삭제된 내역 주소로 들어오면 "삭제된 내역입니다"', async () => {
    renderAt('/ledger/missing');
    expect(await screen.findByRole('alert')).toHaveTextContent('삭제된 내역입니다');
  });
});

describe('가계부 탭 목록', () => {
  it('내역이 없으면 빈 화면 안내', async () => {
    fake.transactions = [];
    renderAt('/ledger');
    expect(await screen.findByText('이 달에 입력한 내역이 없어요')).toBeInTheDocument();
  });
});
