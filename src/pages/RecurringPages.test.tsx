import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../app/App';
import { AuthProvider } from '../app/auth';
import type { Category, Member, Pocket, RecurringTransaction } from '../data/types';
import { todayKST } from '../domain/transactionForm';

// ── 저장소 모듈 가짜 (BANB-44 설정 › 정기 내역 목록·추가·수정·일시정지·삭제)
const fake = vi.hoisted(() => ({
  list: [] as RecurringTransaction[],
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

const c = (id: string, type: Category['type'], parent_id: string | null, name: string, icon: string | null = null): Category => ({
  id, ledger_id: 'L', type, parent_id, name, sort_order: 1, is_hidden: false, icon, created_at: '',
});
const CATEGORIES: Category[] = [
  c('home', 'expense', null, '주거', 'house'),
  c('home-fee', 'expense', 'home', '관리비'),
  c('salary', 'income', null, '급여'),
  c('salary-1', 'income', 'salary', '급여'),
];
const POCKETS: Pocket[] = [{ id: 'p1', ledger_id: 'L', name: '생활비', scope: 'shared', sort_order: 1, is_hidden: false, created_at: '' }];
const MEMBERS: Member[] = [
  { id: 'm-me', ledger_id: 'L', user_id: 'u-me', role: 'owner', display_name: '에이', joined_at: '2026-11-01', left_at: null },
  { id: 'm-b', ledger_id: 'L', user_id: 'u-b', role: 'member', display_name: '비', joined_at: '2026-11-02', left_at: null },
];
vi.mock('../data/transaction', () => ({
  listCategoryUses: async () => [],
  listMyRecentEntries: async () => [{ type: 'expense', category_id: 'home-fee', pocket_id: 'p1' }],
  getTransactionFormOptions: async () => ({ categories: CATEGORIES, pockets: POCKETS, members: MEMBERS }),
}));
vi.mock('../data/recurring', () => {
  class RecurringNotFoundError extends Error {}
  return {
    RecurringNotFoundError,
    listRecurring: async () => fake.list,
    getRecurring: async (id: string) => fake.list.find((r) => r.id === id) ?? null,
    createRecurring: (...args: unknown[]) => fake.create(...args),
    updateRecurring: (...args: unknown[]) => fake.update(...args),
    deleteRecurring: (...args: unknown[]) => fake.remove(...args),
  };
});

const rec = (id: string, extra: Partial<RecurringTransaction> = {}): RecurringTransaction => ({
  id, ledger_id: 'L', type: 'expense', amount: 250000, category_id: 'home-fee', pocket_id: 'p1', spender_id: 'm-me',
  memo: null, cycle: 'monthly', day_of_month: 25, month: null, weekday: null, start_on: '2026-01-01', end_on: null,
  is_paused: false, created_by: 'm-me', updated_by: 'm-me', created_at: `2026-01-01T00:00:0${id.length}Z`, updated_at: '', ...extra,
});

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
  fake.list = [];
  fake.create.mockReset().mockResolvedValue('new-id');
  fake.update.mockReset().mockResolvedValue(undefined);
  fake.remove.mockReset().mockResolvedValue(undefined);
});

describe('설정 › 정기 내역 목록', () => {
  it('빈 화면: 안내 + 추가 버튼', async () => {
    renderAt('/settings/recurring');
    expect(await screen.findByText('매달 나가는 돈을 등록해 두세요')).toBeInTheDocument();
    expect(screen.getByText('그날이 되면 기록할지 먼저 물어봐요')).toBeInTheDocument();
    // 헤더 ＋ 와 빈 화면 주 버튼
    expect(screen.getAllByRole('link', { name: '정기 내역 추가' })).toHaveLength(2);
  });

  it('행: 이름(없으면 소분류) / "주기 · 주머니 · 사람" / 금액, 일시정지 배지. 끝난 것은 뒤', async () => {
    fake.list = [
      rec('ended', { memo: '끝난 것', end_on: '2026-02-01' }),
      rec('fee'),
      rec('pay', { type: 'income', pocket_id: null, category_id: 'salary-1', memo: '월급', amount: 3500000, day_of_month: 31, spender_id: 'm-b' }),
      rec('gym', { memo: '헬스', cycle: 'weekly', day_of_month: null, weekday: 5, amount: 20000, is_paused: true }),
    ];
    renderAt('/settings/recurring');
    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toContain('관리비매월 25일 · 생활비 · 에이−250,000원');
    expect(rows).toContain('급월급매월 말일 · 비+3,500,000원'); // 아이콘 없는 카테고리는 첫 글자 원
    expect(rows).toContain('헬스매주 금요일 · 생활비 · 에이−20,000원일시정지');
    expect(rows[rows.length - 1]).toContain('끝난 것');
    expect(screen.getByText('그날이 되면 기록할지 물어봐요. 자동으로 저장하지는 않아요.')).toBeInTheDocument();
  });
});

describe('정기 내역 추가·수정', () => {
  it('추가: 내역 입력 화면 + 반복 알약(매월 오늘 일자) → 반복 시트에서 매주 금요일 → 이름 → 저장', async () => {
    const user = userEvent.setup();
    const today = todayKST();
    renderAt('/settings/recurring/new');
    expect(await screen.findByText('정기 내역 추가', { selector: '.tx-entry__mode' })).toBeInTheDocument();
    // 날짜 알약 대신 반복 알약, 메모 알약은 "이름"
    expect(screen.queryByRole('button', { name: /^날짜: / })).toBeNull();
    const repeat = screen.getByRole('button', { name: /^반복: 매월 / });
    expect(repeat).toHaveTextContent(Number(today.slice(8)) === 31 ? '매월 말일' : `매월 ${Number(today.slice(8))}일`);

    const pad = screen.getByRole('group', { name: '금액 키패드' });
    for (const k of ['2', '0', '00', '0']) await user.click(within(pad).getByRole('button', { name: k }));

    await user.click(repeat);
    const sheet = screen.getByRole('dialog', { name: '반복' });
    await user.click(within(sheet).getByText('매주'));
    await user.click(within(sheet).getByRole('radio', { name: '금요일' }));
    await user.click(within(sheet).getByRole('button', { name: '매주 금요일로 할게요' }));
    expect(screen.getByRole('button', { name: '반복: 매주 금요일' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^이름: / }));
    await user.type(screen.getByLabelText('메모'), '헬스');
    await user.click(screen.getByRole('button', { name: '완료' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(fake.create).toHaveBeenCalledTimes(1);
    const [ledgerId, input] = fake.create.mock.calls[0];
    expect(ledgerId).toBe('L');
    expect(input).toMatchObject({
      type: 'expense',
      amount: 20000,
      category_id: 'home-fee',
      pocket_id: 'p1',
      spender_id: 'm-me',
      memo: '헬스',
      cycle: 'weekly',
      weekday: 5,
      day_of_month: null,
      month: null,
      end_on: null,
      is_paused: false,
    });
    // 시작 = 오늘 이후 첫 금요일
    expect(input.start_on >= today).toBe(true);
    expect(new Date(`${input.start_on}T00:00:00Z`).getUTCDay()).toBe(5);
    expect(input).not.toHaveProperty('occurred_on');
    expect(input).not.toHaveProperty('is_fixed');
    // 목록으로 돌아와 토스트
    expect(await screen.findByText('정기 내역을 저장했어요')).toBeInTheDocument();
  });

  it('반복 시트: 매월 29·30일은 짧은 달 안내, 말일은 31', async () => {
    const user = userEvent.setup();
    renderAt('/settings/recurring/new');
    await user.click(await screen.findByRole('button', { name: /^반복: / }));
    const sheet = screen.getByRole('dialog', { name: '반복' });
    await user.click(within(sheet).getByRole('radio', { name: '30' }));
    expect(within(sheet).getByText('짧은 달은 말일에 기록해요')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('radio', { name: '말일' }));
    expect(within(sheet).queryByText('짧은 달은 말일에 기록해요')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: '매월 말일로 할게요' }));
    expect(screen.getByRole('button', { name: '반복: 매월 말일' })).toBeInTheDocument();
  });

  it('수정: 값이 채워져 있고 일시정지 켜서 저장', async () => {
    const user = userEvent.setup();
    fake.list = [rec('fee', { memo: '관리비' })];
    renderAt('/settings/recurring/fee');
    expect(await screen.findByRole('heading', { name: '정기 내역 수정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '반복: 매월 25일' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이름: 관리비' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /일시정지/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(fake.update).toHaveBeenCalledWith('fee', expect.objectContaining({ is_paused: true, amount: 250000, day_of_month: 25, start_on: '2026-01-01' }));
  });

  it('삭제: "이미 기록한 내역은 그대로 남아요" 확인 후 삭제', async () => {
    const user = userEvent.setup();
    fake.list = [rec('fee')];
    renderAt('/settings/recurring/fee');
    await user.click(await screen.findByRole('button', { name: '삭제' }));
    const dialog = screen.getByRole('alertdialog', { name: '이 정기 내역을 삭제할까요?' });
    expect(dialog).toHaveTextContent('이미 기록한 내역은 그대로 남아요.');
    await user.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(fake.remove).toHaveBeenCalledWith('fee');
    expect(await screen.findByText('정기 내역을 삭제했어요')).toBeInTheDocument();
  });

  it('없는 정기 내역 주소: "삭제된 정기 내역이에요"', async () => {
    renderAt('/settings/recurring/nope');
    expect(await screen.findByText('삭제된 정기 내역이에요.')).toBeInTheDocument();
  });
});
