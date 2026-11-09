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
  uses: [] as { category_id: string; occurred_on: string; created_at: string }[],
  recent: [] as { type: string; category_id: string; pocket_id: string | null }[],
  addChild: vi.fn(),
  addParent: vi.fn(),
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
vi.mock('../data/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/catalog')>()),
  addChildCategory: (...args: unknown[]) => fake.addChild(...args),
  addParentCategory: (...args: unknown[]) => fake.addParent(...args),
}));

const c = (id: string, type: Category['type'], parent_id: string | null, name: string, sort_order = 1): Category => ({
  id,
  ledger_id: 'L',
  type,
  parent_id,
  name,
  sort_order,
  is_hidden: false,
  icon: null,
  created_at: '',
});
const CATEGORIES: Category[] = [
  { ...c('food', 'expense', null, '식비'), icon: 'utensils-crossed' },
  { ...c('food-self', 'expense', 'food', '식비', 0), icon: 'utensils-crossed' },
  { ...c('food-out', 'expense', 'food', '외식', 1), icon: 'utensils' },
  c('food-mart', 'expense', 'food', '장보기', 2),
  { ...c('cafe', 'expense', null, '카페·간식', 2), icon: 'coffee' },
  { ...c('cafe-self', 'expense', 'cafe', '카페·간식', 0), icon: 'coffee' },
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
  listCategoryUses: async () => fake.uses,
  listMyRecentEntries: async () => fake.recent,
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
  fake.uses = [];
  fake.recent = [];
  fake.addChild.mockReset();
  fake.addParent.mockReset();
  fake.create.mockReset().mockResolvedValue('new-id');
  fake.update.mockReset().mockResolvedValue('updated');
  fake.remove.mockReset().mockResolvedValue(undefined);
});

const amountOutput = () => screen.getByLabelText(/^금액 [0-9]/);
const amountText = () => amountOutput().querySelector('.tx-amount__num')?.textContent;
const reading = () => document.querySelector('.tx-reading');
/** 알약: aria-label "카테고리: 외식" */
const pill = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}: `) });
const categoryField = () => pill('카테고리');
const saveButton = () => screen.getByRole('button', { name: '저장' });

/** 앱 키패드로 금액 누르기 ("00" 은 한 키) */
async function typeAmount(user: ReturnType<typeof userEvent.setup>, keys: string[]) {
  const pad = screen.getByRole('group', { name: '금액 키패드' });
  for (const k of keys) await user.click(within(pad).getByRole('button', { name: k === '⌫' ? '지우기' : k }));
}
const digits = (s: string) => [...s];

/** 카테고리 알약 → 선택 시트 → 대분류(→ 소분류)로 고르기 */
async function pickCategory(user: ReturnType<typeof userEvent.setup>, parent: string, child?: string) {
  await user.click(categoryField());
  const sheet = await screen.findByRole('dialog', { name: /카테고리$/ });
  await user.click(within(sheet).getByRole('radio', { name: new RegExp(`^${parent}`) }));
  if (child) await user.click(within(sheet).getByRole('radio', { name: child }));
}

/** 칩 시트(주머니·사람)에서 고르기 */
async function pickChip(user: ReturnType<typeof userEvent.setup>, label: string, name: string) {
  await user.click(pill(label));
  const sheet = await screen.findByRole('dialog');
  await user.click(within(sheet).getByRole('radio', { name }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

/** 선택 시트의 칸 이름들 (추가 칸 제외) */
async function sheetOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(categoryField());
  const sheet = await screen.findByRole('dialog', { name: /카테고리$/ });
  const names = within(sheet).getAllByRole('radio').map((r) => r.querySelector('.cat-cell__name')?.textContent);
  await user.click(within(sheet).getByRole('button', { name: '닫기' }));
  return names;
}

async function openNewForm() {
  const user = userEvent.setup();
  renderAt('/ledger');
  await user.click(await screen.findByRole('link', { name: '내역 추가' }));
  await screen.findByRole('heading', { level: 1, name: '내역 입력' });
  return user;
}

describe('내역 입력 — 키패드 + 알약 (5.15 v1.4)', () => {
  it('헤더는 닫기 + 세그먼트(제목 숨김), 기본값: 지출·0원·오늘·사람 = 나, 첫 포커스는 금액', async () => {
    await openNewForm();
    expect(screen.getByRole('heading', { level: 1, name: '내역 입력' })).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '지출' })).toBeChecked();
    expect(amountText()).toBe('0');
    expect(amountOutput()).toHaveClass('is-zero');
    expect(amountOutput()).toHaveFocus();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); // 시스템 자판을 띄우는 입력칸 없음
    expect(screen.queryByText('얼마를 썼나요?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+/ })).not.toBeInTheDocument(); // 빠른 금액 칩 없음
    expect(pill('날짜')).toHaveAccessibleName('날짜: 오늘');
    expect(pill('사람')).toHaveAccessibleName('사람: 에이');
    expect(pill('카테고리')).toHaveAccessibleName('카테고리: 없음');
    expect(pill('카테고리')).toHaveClass('tx-pill--empty');
    expect(pill('메모')).toHaveTextContent('메모');
    expect(pill('주머니')).toBeInTheDocument();
  });

  it('키패드: 1 → 00 → 00 = 10,000원, ⌫ 한 자리, 길게 누르면 전부 지움', async () => {
    const user = await openNewForm();
    await typeAmount(user, ['1', '00', '00']);
    expect(amountText()).toBe('10,000');
    await typeAmount(user, ['⌫']);
    expect(amountText()).toBe('1,000');
    const back = screen.getByRole('button', { name: '지우기' });
    await user.pointer({ keys: '[TouchA>]', target: back });
    await new Promise((r) => setTimeout(r, 600));
    await user.pointer({ keys: '[/TouchA]', target: back });
    expect(amountText()).toBe('0');
  });

  it('최대 10자리: 넘치면 무시하고 "최대 금액이에요"', async () => {
    const user = await openNewForm();
    await pickCategory(user, '카페·간식');
    await pickChip(user, '주머니', '공동소비');
    await typeAmount(user, digits('99999999999'));
    expect(amountText()).toBe('9,999,999,999');
    expect(screen.getByText(/최대 금액이에요/)).toBeInTheDocument();
    expect(reading()).not.toBeNull();
  });

  it('PC 키보드 숫자·Backspace 도 같은 규칙', async () => {
    const user = await openNewForm();
    await user.keyboard('1000000');
    expect(amountText()).toBe('1,000,000');
    await user.keyboard('{Backspace}');
    expect(amountText()).toBe('100,000');
  });

  it('한글 읽기: 999,999원은 없음, 1,000,000원부터 보임, 지우다 내려가면 바로 숨김. aria-label 에는 항상', async () => {
    const user = await openNewForm();
    await pickCategory(user, '카페·간식');
    await pickChip(user, '주머니', '공동소비');
    await typeAmount(user, digits('999999'));
    expect(reading()).toBeNull();
    expect(amountOutput()).toHaveAccessibleName('금액 999,999원, 99만 원');
    await typeAmount(user, ['⌫', '⌫', '⌫', '⌫', '⌫', '⌫', '1', '00', '00', '00']);
    expect(amountText()).toBe('1,000,000');
    expect(reading()).toHaveTextContent('100만 원');
    await typeAmount(user, ['⌫']);
    expect(reading()).toBeNull();
  });

  it('금액 12,800원: 화면엔 읽기 없음, aria-label 에는 한글 읽기', async () => {
    const user = await openNewForm();
    await typeAmount(user, digits('12800'));
    expect(reading()).toBeNull();
    expect(amountOutput()).toHaveAccessibleName('금액 12,800원, 1만 원');
  });

  it('저장: 금액 0·카테고리 없음이면 비활성 + 빠진 항목 한 줄, 이때 읽기 줄은 숨김', async () => {
    const user = await openNewForm();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText('금액을 입력하고 카테고리·주머니를 골라 주세요')).toBeInTheDocument();
    await typeAmount(user, ['2', '00', '00', '00']);
    expect(screen.getByText('카테고리·주머니를 골라 주세요')).toBeInTheDocument();
    expect(reading()).toBeNull(); // 2,000,000원이지만 안내가 떠 있다
    await pickCategory(user, '식비', '외식');
    await pickChip(user, '주머니', '공동소비');
    expect(saveButton()).toBeEnabled();
    expect(reading()).toHaveTextContent('200만 원');
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('유형을 바꾸면 카테고리 선택지가 바뀌고, 지출이 아니면 주머니 알약·고정지출이 사라진다', async () => {
    const user = await openNewForm();
    expect(await sheetOptions(user)).toEqual(['식비', '카페·간식']);
    await pickCategory(user, '식비', '외식');
    await user.click(pill('날짜'));
    expect(within(await screen.findByRole('dialog', { name: '날짜' })).getByRole('checkbox', { name: /고정지출/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '완료' }));

    await user.click(screen.getByRole('radio', { name: '수입' }));
    expect(await sheetOptions(user)).toEqual(['급여']);
    expect(categoryField()).toHaveAccessibleName('카테고리: 없음');
    expect(screen.queryByRole('button', { name: /^주머니: / })).not.toBeInTheDocument();
    await user.click(pill('날짜'));
    expect(within(await screen.findByRole('dialog', { name: '날짜' })).queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '완료' }));

    await user.click(screen.getByRole('radio', { name: '저축' }));
    expect(await sheetOptions(user)).toEqual(['적금']);
  });

  it('저장하면 입력값으로 내역을 만들고, 돌아간 탭에서 "저장했어요 · 되돌리기"', async () => {
    const user = await openNewForm();
    await typeAmount(user, digits('12000'));
    await pickCategory(user, '식비', '장보기');
    await pickChip(user, '주머니', '개인용돈');
    await pickChip(user, '사람', '비');
    await user.click(pill('날짜'));
    await user.click(screen.getByRole('checkbox', { name: /고정지출/ }));
    await user.click(screen.getByRole('button', { name: '완료' }));
    expect(pill('날짜')).toHaveTextContent('오늘 · 고정');
    await user.click(pill('메모'));
    await user.type(within(await screen.findByRole('dialog', { name: '메모' })).getByRole('textbox'), '장보기');
    await user.click(screen.getByRole('button', { name: '완료' }));
    expect(pill('메모')).toHaveAccessibleName('메모: 장보기');
    await user.click(saveButton());

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
    expect(await screen.findByText('저장했어요')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '가계부' })).toBeInTheDocument();

    // 되돌리기 = 방금 만든 내역 삭제
    await user.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(fake.remove).toHaveBeenCalledWith('new-id');
    expect(await screen.findByText('되돌렸어요')).toBeInTheDocument();
  });

  it('수입은 주머니 없이, 고정지출 false 로 저장된다', async () => {
    const user = await openNewForm();
    await user.click(screen.getByRole('radio', { name: '수입' }));
    await typeAmount(user, ['3', '00', '00', '00']);
    await pickCategory(user, '급여');
    await user.click(saveButton());
    expect(fake.create).toHaveBeenCalledWith('L', expect.objectContaining({ type: 'income', amount: 3000000, pocket_id: null, is_fixed: false }));
  });

  it('기본값: 이 사람이 마지막에 쓴 카테고리·주머니 (유형별)', async () => {
    fake.recent = [
      { type: 'expense', category_id: 'cafe-self', pocket_id: 'p-mine' },
      { type: 'income', category_id: 'salary-1', pocket_id: null },
    ];
    const user = await openNewForm();
    expect(categoryField()).toHaveAccessibleName('카테고리: 카페·간식');
    expect(pill('주머니')).toHaveAccessibleName('주머니: 개인용돈');
    await user.click(screen.getByRole('radio', { name: '수입' }));
    expect(categoryField()).toHaveAccessibleName('카테고리: 급여');
    await user.click(screen.getByRole('radio', { name: '저축' }));
    expect(categoryField()).toHaveAccessibleName('카테고리: 없음');
    // 보통은 금액만 누르고 저장
    await user.click(screen.getByRole('radio', { name: '지출' }));
    await typeAmount(user, digits('4500'));
    await user.click(saveButton());
    expect(fake.create).toHaveBeenCalledWith('L', expect.objectContaining({ amount: 4500, category_id: 'cafe-self', pocket_id: 'p-mine', spender_id: 'm-me' }));
  });

  it('저장에 실패하면 입력값이 남아 있고, 다시 시도할 수 있다', async () => {
    fake.create.mockRejectedValueOnce(new Error('network'));
    const user = await openNewForm();
    await typeAmount(user, digits('5000'));
    await pickCategory(user, '식비', '외식');
    await pickChip(user, '주머니', '공동소비');
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요');
    expect(amountText()).toBe('5,000');
    expect(categoryField()).toHaveAccessibleName('카테고리: 외식');

    await user.click(screen.getByRole('button', { name: '다시 저장' }));
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('저장했어요')).toBeInTheDocument();
  });
});

describe('카테고리 선택 시트·추가 (BANB-24)', () => {
  it('대분류 격자 한 단계: 같은 이름만 있으면 바로 선택, 소분류가 있으면 맨 앞 대분류 이름 → 소분류 (BANB-36)', async () => {
    const user = await openNewForm();
    await user.click(categoryField());
    let sheet = await screen.findByRole('dialog', { name: '지출 카테고리' });
    expect(within(sheet).getByRole('button', { name: '추가' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /전체 보기/ })).not.toBeInTheDocument(); // 8개 이하

    // 카페·간식: 바로 선택(같은 이름 소분류로 저장)
    await user.click(within(sheet).getByRole('radio', { name: '카페·간식' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(categoryField()).toHaveAccessibleName('카테고리: 카페·간식');

    // 식비: 두 번째 단계 — 식비(대분류 자체) · 외식 · 장보기
    await user.click(categoryField());
    sheet = await screen.findByRole('dialog', { name: '지출 카테고리' });
    expect(within(sheet).getByRole('radio', { name: '카페·간식' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(sheet).getByRole('radio', { name: '식비, 소분류 고르기' }));
    const step = within(sheet).getByRole('radiogroup', { name: '식비' });
    expect(within(step).getAllByRole('radio').map((r) => r.querySelector('.cat-cell__name')?.textContent)).toEqual(['식비', '외식', '장보기']);
    expect(within(step).getByRole('radio', { name: '장보기' }).querySelector('svg')).not.toBeNull(); // 아이콘 없는 소분류는 대분류 아이콘
    // 뒤로 갔다가 다시
    await user.click(within(sheet).getByRole('button', { name: '대분류로 돌아가기' }));
    await user.click(within(sheet).getByRole('radio', { name: '식비, 소분류 고르기' }));
    await user.click(within(sheet).getByRole('radio', { name: '식비' }));
    expect(categoryField()).toHaveAccessibleName('카테고리: 식비');

    await pickCategory(user, '식비', '장보기');
    expect(categoryField()).toHaveAccessibleName('카테고리: 장보기');
    await user.click(categoryField());
    sheet = await screen.findByRole('dialog', { name: '지출 카테고리' });
    expect(within(sheet).getByRole('radio', { name: /^식비/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('자주 쓰는 8개 먼저(최근 3개월 내역 수 순), 나머지는 "전체 보기"', async () => {
    const extra = Array.from({ length: 8 }, (_, i) => [
      c(`x${i}`, 'expense', null, `항목${i + 1}`, 10 + i),
      c(`x${i}-self`, 'expense', `x${i}`, `항목${i + 1}`, 0),
    ]).flat();
    CATEGORIES.push(...extra);
    try {
      fake.uses = [
        { category_id: 'x7-self', occurred_on: '2026-11-01', created_at: '2026-11-01T00:00:00Z' },
        { category_id: 'x7-self', occurred_on: '2026-11-02', created_at: '2026-11-02T00:00:00Z' },
        { category_id: 'food-out', occurred_on: '2026-11-03', created_at: '2026-11-03T00:00:00Z' },
      ];
      const user = await openNewForm();
      await user.click(categoryField());
      const sheet = await screen.findByRole('dialog', { name: '지출 카테고리' });
      const frequent = within(sheet).getByRole('radiogroup', { name: '자주 쓰는 것' });
      const cellNames = (el: HTMLElement) => within(el).getAllByRole('radio').map((r) => r.querySelector('.cat-cell__name')?.textContent);
      expect(cellNames(frequent)).toEqual(['항목8', '식비', '카페·간식', '항목1', '항목2', '항목3', '항목4', '항목5']);
      expect(within(sheet).queryByRole('radiogroup', { name: '전체' })).not.toBeInTheDocument();
      const more = within(sheet).getByRole('button', { name: /전체 보기 \(2개 더\)/ });
      expect(more).toHaveAttribute('aria-expanded', 'false');
      await user.click(more);
      expect(more).toHaveAttribute('aria-expanded', 'true');
      expect(cellNames(within(sheet).getByRole('radiogroup', { name: '전체' }))).toEqual(['항목6', '항목7']);
      expect(within(sheet).getByRole('button', { name: '추가' })).toBeInTheDocument();
    } finally {
      CATEGORIES.splice(CATEGORIES.length - extra.length, extra.length);
    }
  });

  it('추가: 이름·대분류·아이콘을 골라 추가하면 선택 시트로 돌아와 그 카테고리가 선택돼 있고, 그대로 저장된다', async () => {
    fake.addChild.mockImplementation(async (i: { parentId: string; name: string; icon: string | null; sortOrder: number }) => ({
      ...c('new-1', 'expense', i.parentId, i.name, i.sortOrder),
      icon: i.icon,
    }));
    const user = await openNewForm();
    await typeAmount(user, digits('9000'));
    await user.click(categoryField());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '추가' }));
    const editor = await screen.findByRole('dialog', { name: '카테고리 추가' });
    const submit = within(editor).getByRole('button', { name: '추가하기' });
    expect(submit).toBeDisabled();
    expect(editor).toHaveTextContent('이름을 입력해 주세요.');

    await user.type(within(editor).getByLabelText('이름'), '야식');
    expect(within(editor).getByText('2/20')).toBeInTheDocument();
    expect(submit).toBeDisabled(); // 넣을 곳을 아직 안 골랐다
    await user.click(within(editor).getByRole('radio', { name: '식비' }));
    await user.click(within(editor).getByRole('radio', { name: '피자' }));
    await user.click(submit);

    expect(fake.addChild).toHaveBeenCalledWith({ ledgerId: 'L', type: 'expense', parentId: 'food', name: '야식', icon: 'pizza', sortOrder: 3 });
    const sheet = await screen.findByRole('dialog', { name: '지출 카테고리' });
    // 시트로 돌아오면 식비 칸이 선택돼 있고, 두 번째 단계에 새 소분류가 선택돼 있다
    await user.click(within(sheet).getByRole('radio', { name: '식비, 소분류 고르기', checked: true }));
    expect(within(sheet).getByRole('radio', { name: '야식' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(sheet).getByRole('button', { name: '닫기' }));
    expect(categoryField()).toHaveAccessibleName('카테고리: 야식');

    await pickChip(user, '주머니', '공동소비');
    await user.click(saveButton());
    expect(fake.create).toHaveBeenCalledWith('L', expect.objectContaining({ category_id: 'new-1', amount: 9000 }));
  });

  it('새 대분류로 추가할 수 있고, 실패하면 화면에 남아 다시 시도한다', async () => {
    fake.addParent.mockRejectedValueOnce(new Error('network')).mockImplementation(async (i: { name: string; icon: string | null }) => ({
      parent: { ...c('np', 'expense', null, i.name, 3), icon: i.icon },
      child: { ...c('np-c', 'expense', 'np', i.name, 1), icon: i.icon },
    }));
    const user = await openNewForm();
    await user.click(categoryField());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '추가' }));
    const editor = await screen.findByRole('dialog', { name: '카테고리 추가' });
    await user.type(within(editor).getByLabelText('이름'), '반려견');
    await user.click(within(editor).getByRole('radio', { name: '새 대분류' }));
    await user.click(within(editor).getByRole('radio', { name: '강아지' }));
    await user.click(within(editor).getByRole('button', { name: '추가하기' }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent('저장하지 못했어요');
    expect(within(editor).getByLabelText('이름')).toHaveValue('반려견');

    await user.click(within(editor).getByRole('button', { name: '추가하기' }));
    expect(fake.addParent).toHaveBeenLastCalledWith({ ledgerId: 'L', type: 'expense', name: '반려견', icon: 'dog', sortOrder: 3 });
    const sheet = await screen.findByRole('dialog', { name: '지출 카테고리' });
    // 같은 이름 하나뿐이라 대분류 칸 하나로 보이고 선택돼 있다
    expect(within(sheet).getByRole('radio', { name: '반려견' })).toHaveAttribute('aria-checked', 'true');
  });

  it('아이콘을 안 고르면 이름 첫 글자로 미리 보인다', async () => {
    const user = await openNewForm();
    await user.click(categoryField());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '추가' }));
    const editor = await screen.findByRole('dialog', { name: '카테고리 추가' });
    // 이름도 아이콘도 없으면 "?" 대신 Tag 아이콘 (디자인 결정)
    expect(editor.querySelector('.cat-editor__preview .cat-icon__letter')).toBeNull();
    expect(editor.querySelector('.cat-editor__preview svg')).not.toBeNull();
    await user.type(within(editor).getByLabelText('이름'), '술');
    expect(editor.querySelector('.cat-editor__preview .cat-icon__letter')).toHaveTextContent('술');
    await user.click(within(editor).getByRole('radio', { name: '와인' }));
    expect(editor.querySelector('.cat-editor__preview .cat-icon__letter')).toBeNull();
    // 다시 누르면 고르지 않은 상태로
    await user.click(within(editor).getByRole('radio', { name: '와인' }));
    expect(editor.querySelector('.cat-editor__preview .cat-icon__letter')).toHaveTextContent('술');
    // 소분류로 넣을 대분류를 고르면, 저장 후 시트에 보일 모양처럼 대분류 아이콘으로 미리 보인다
    await user.click(within(editor).getByRole('radio', { name: '식비' }));
    expect(editor.querySelector('.cat-editor__preview .cat-icon__letter')).toBeNull();
    expect(editor.querySelector('.cat-editor__preview svg')).not.toBeNull();
  });
});

describe('내역 수정·삭제', () => {
  async function openEntry() {
    const user = userEvent.setup();
    renderAt('/ledger');
    await user.click(await screen.findByRole('link', { name: /저녁/ }));
    await screen.findByRole('heading', { level: 1, name: '내역 수정' });
    return user;
  }

  it('목록에서 다른 멤버가 입력한 내역을 열면 제목 "내역 수정", 값과 "마지막 수정: 이름, 시각"이 보인다', async () => {
    await openEntry();
    expect(screen.getByRole('heading', { level: 1, name: '내역 수정' })).not.toHaveClass('sr-only');
    expect(amountText()).toBe('32,000');
    expect(categoryField()).toHaveAccessibleName('카테고리: 외식');
    expect(pill('주머니')).toHaveAccessibleName('주머니: 공동소비');
    expect(pill('사람')).toHaveAccessibleName('사람: 비');
    expect(pill('날짜')).toHaveAccessibleName('날짜: 11월 3일 (화)');
    expect(pill('메모')).toHaveAccessibleName('메모: 저녁');
    expect(screen.getByRole('radio', { name: '지출' })).toBeChecked();
    expect(screen.getByText(/마지막 수정: 비, 2026\. 11\. 3\. 19:00/)).toBeInTheDocument();
    expect(reading()).toBeNull();
  });

  it('기존 금액이 100만 원 이상이면 열자마자 읽기 줄이 보인다', async () => {
    fake.transactions = [{ ...B_ENTRY, amount: 1500000 }];
    await openEntry();
    expect(reading()).toHaveTextContent('150만 원');
  });

  it('다른 멤버의 내역도 수정할 수 있고, 되돌리기는 저장 전 값으로 다시 쓴다', async () => {
    fake.transactions = [{ ...B_ENTRY, amount: 1500000 }];
    const user = await openEntry();
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
    await typeAmount(user, digits('999999'));
    expect(reading()).toBeNull();
    await user.click(saveButton());
    expect(fake.update).toHaveBeenCalledWith('t1', expect.objectContaining({ amount: 999999, spender_id: 'm-b' }));
    expect(await screen.findByText('저장했어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(fake.update).toHaveBeenLastCalledWith('t1', {
      type: 'expense',
      amount: 1500000,
      occurred_on: '2026-11-03',
      category_id: 'food-out',
      pocket_id: 'p-shared',
      spender_id: 'm-b',
      is_fixed: false,
      memo: '저녁',
    });
    expect(await screen.findByText('되돌렸어요')).toBeInTheDocument();
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
    expect(await screen.findByText('삭제했어요')).toBeInTheDocument();
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
