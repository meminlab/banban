import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../app/App';
import { AuthProvider } from '../app/auth';
import type { Asset, Member } from '../data/types';

// ── 저장소 가짜: 메모리 DB (두 멤버가 같은 가계부를 공유)
const db = vi.hoisted(() => ({
  assets: [] as Asset[],
  members: [] as Member[],
  failNext: null as null | 'list' | 'create' | 'update' | 'delete',
  seq: 0,
}));

vi.mock('../data/auth', () => ({
  AUTH_CALLBACK_PATH: '/login',
  onAuthChange: (cb: (u: unknown) => void) => {
    queueMicrotask(() => cb({ id: 'u-a', email: 'a@example.com', name: '민지', avatarUrl: null }));
    return () => {};
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
vi.mock('../data/member', () => ({ listMembers: async () => db.members }));
vi.mock('../data/asset', () => {
  class AssetNotFoundError extends Error {}
  const fail = (op: typeof db.failNext) => {
    if (db.failNext === op) {
      db.failNext = null;
      throw new Error('network');
    }
  };
  return {
    AssetNotFoundError,
    listAssets: async () => {
      fail('list');
      return db.assets.map((a) => ({ ...a }));
    },
    createAsset: async (ledgerId: string, input: Omit<Asset, 'id' | 'ledger_id' | 'created_at' | 'updated_at'>) => {
      fail('create');
      const a: Asset = { id: `n${++db.seq}`, ledger_id: ledgerId, ...input, created_at: '2026-11-06T01:00:00Z', updated_at: '2026-11-06T01:00:00Z' };
      db.assets.push(a);
      return a;
    },
    updateAsset: async (id: string, input: Partial<Asset>) => {
      fail('update');
      const a = db.assets.find((x) => x.id === id);
      if (!a) throw new AssetNotFoundError();
      Object.assign(a, input, { updated_at: '2026-11-06T02:00:00Z' });
      return a;
    },
    deleteAsset: async (id: string) => {
      fail('delete');
      db.assets = db.assets.filter((x) => x.id !== id);
    },
  };
});

const MA: Member = { id: 'ma', ledger_id: 'L', user_id: 'u-a', role: 'owner', display_name: '민지', joined_at: '2026-11-01T00:00:00Z', left_at: null };
const MB: Member = { id: 'mb', ledger_id: 'L', user_id: 'u-b', role: 'member', display_name: '준호', joined_at: '2026-11-02T00:00:00Z', left_at: null };
const asset = (id: string, owner: string | null, balance: number, name: string): Asset => ({
  id, ledger_id: 'L', name, kind: 'checking', owner_id: owner, balance, memo: null,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
});

function renderAssets() {
  return render(
    <MemoryRouter initialEntries={['/assets']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const totalText = () => screen.getByText('전체 자산').nextElementSibling?.textContent;
const ownerTotals = () =>
  within(screen.getByRole('list', { name: '소유자별 합계' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

beforeEach(() => {
  db.members = [MA, MB];
  db.assets = [];
  db.failNext = null;
});

it('자산이 없으면 빈 화면 안내와 0원 합계가 보인다', async () => {
  renderAssets();
  expect(await screen.findByText('아직 등록한 자산이 없어요')).toBeInTheDocument();
  expect(totalText()).toBe('0원');
  expect(ownerTotals()).toEqual(['민지0원', '준호0원', '공동0원']);
});

it('불러오기 실패 시 안내하고 다시 시도할 수 있다', async () => {
  db.failNext = 'list';
  const user = userEvent.setup();
  renderAssets();
  expect(await screen.findByRole('alert')).toHaveTextContent('자산을 불러오지 못했어요');
  await user.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('아직 등록한 자산이 없어요')).toBeInTheDocument();
});

it('다른 멤버가 등록한 자산도 목록과 합계에 보인다', async () => {
  db.assets = [asset('1', 'mb', 300_000, '준호 적금'), asset('2', null, 1_000_000, '생활비 통장')];
  renderAssets();
  expect(await screen.findByText('준호 적금')).toBeInTheDocument();
  expect(totalText()).toBe('1,300,000원');
  expect(ownerTotals()).toEqual(['민지0원', '준호300,000원', '공동1,000,000원']);
});

it('자산을 추가하면 목록과 합계가 바뀐다 (기본 소유자 = 본인, 천 단위 쉼표)', async () => {
  const user = userEvent.setup();
  renderAssets();
  await user.click(await screen.findByRole('button', { name: '+ 자산 추가' }));
  const dialog = screen.getByRole('dialog', { name: '자산 추가' });
  expect(within(dialog).getByRole('radio', { name: '민지' })).toBeChecked();

  await user.type(within(dialog).getByLabelText('이름'), '비상금');
  await user.click(within(dialog).getByRole('radio', { name: '현금' }));
  const balance = within(dialog).getByLabelText('잔액');
  await user.type(balance, '1234567');
  expect(balance).toHaveValue('1,234,567');
  await user.click(within(dialog).getByRole('button', { name: '저장' }));

  expect(await screen.findByText('비상금')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('저장했어요');
  expect(screen.getByText(/현금 · 민지/)).toBeInTheDocument();
  expect(totalText()).toBe('1,234,567원');
  expect(db.assets[0]).toMatchObject({ name: '비상금', kind: 'cash', owner_id: 'ma', balance: 1234567, memo: null });
});

it.each([
  ['', '잔액을 입력해 주세요'],
  ['-500', '0 이상의 정수'],
  ['1.5', '0 이상의 정수'],
])('잔액 "%s" 은 저장되지 않는다', async (input, message) => {
  const user = userEvent.setup();
  renderAssets();
  await user.click(await screen.findByRole('button', { name: '+ 자산 추가' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('이름'), '통장');
  if (input) await user.type(within(dialog).getByLabelText('잔액'), input);
  await user.click(within(dialog).getByRole('button', { name: '저장' }));
  expect(within(dialog).getByText(new RegExp(message))).toBeInTheDocument();
  expect(within(dialog).getByLabelText('잔액')).toHaveAttribute('aria-invalid', 'true');
  expect(db.assets).toHaveLength(0);
});

it('이름이 공백뿐이면 저장되지 않는다', async () => {
  const user = userEvent.setup();
  renderAssets();
  await user.click(await screen.findByRole('button', { name: '+ 자산 추가' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('이름'), '   ');
  await user.type(within(dialog).getByLabelText('잔액'), '100');
  await user.click(within(dialog).getByRole('button', { name: '저장' }));
  expect(within(dialog).getByText('이름을 입력해 주세요')).toBeInTheDocument();
  expect(db.assets).toHaveLength(0);
});

it('다른 멤버의 자산을 수정하면 합계가 바뀐다', async () => {
  db.assets = [asset('1', 'mb', 300_000, '준호 적금')];
  const user = userEvent.setup();
  renderAssets();
  await user.click(await screen.findByRole('button', { name: /준호 적금/ }));
  const dialog = screen.getByRole('dialog', { name: '자산 수정' });
  const balance = within(dialog).getByLabelText('잔액');
  expect(balance).toHaveValue('300,000');
  await user.clear(balance);
  await user.type(balance, '450000');
  await user.click(within(dialog).getByRole('radio', { name: '공동' }));
  await user.click(within(dialog).getByRole('button', { name: '저장' }));

  expect(await screen.findByText('저장했어요')).toBeInTheDocument();
  expect(totalText()).toBe('450,000원');
  expect(ownerTotals()).toEqual(['민지0원', '준호0원', '공동450,000원']);
});

it('저장 실패 시 시트에서 안내하고 다시 시도할 수 있다', async () => {
  db.assets = [asset('1', null, 100, '통장')];
  db.failNext = 'update';
  const user = userEvent.setup();
  renderAssets();
  await user.click(await screen.findByRole('button', { name: /통장/ }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: '저장' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('저장하지 못했어요');
  await user.click(within(dialog).getByRole('button', { name: '저장' }));
  expect(await screen.findByText('저장했어요')).toBeInTheDocument();
});

it('다른 멤버가 이미 삭제한 자산을 저장하면 안내하고 닫는다 (새로 만들지 않음)', async () => {
  db.assets = [asset('1', null, 100, '통장')];
  const user = userEvent.setup();
  renderAssets();
  await user.click(await screen.findByRole('button', { name: /통장/ }));
  db.assets = []; // 그 사이 상대가 삭제
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장' }));
  expect(await screen.findByText('다른 멤버가 삭제한 자산이에요')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await screen.findByText('아직 등록한 자산이 없어요')).toBeInTheDocument();
  expect(db.assets).toHaveLength(0);
});

it('삭제는 확인 후 진행되고 합계가 바뀐다', async () => {
  db.assets = [asset('1', 'ma', 100, '통장'), asset('2', null, 50, '현금')];
  const user = userEvent.setup();
  renderAssets();
  await user.click(await screen.findByRole('button', { name: /통장/ }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: '삭제' }));
  await user.click(within(dialog).getByRole('button', { name: '취소' }));
  expect(db.assets).toHaveLength(2);

  await user.click(within(dialog).getByRole('button', { name: '삭제' }));
  await user.click(within(within(dialog).getByRole('group', { name: '삭제 확인' })).getByRole('button', { name: '삭제' }));
  expect(await screen.findByText('삭제했어요')).toBeInTheDocument();
  expect(screen.queryByText('통장')).not.toBeInTheDocument();
  expect(totalText()).toBe('50원');
});

it('나간 멤버의 자산은 남고 이름 옆에 (나감)이 보인다', async () => {
  db.members = [MA, { ...MB, left_at: '2026-11-05T00:00:00Z' }];
  db.assets = [asset('1', 'mb', 700, '준호 적금')];
  const user = userEvent.setup();
  renderAssets();
  expect(await screen.findByText(/입출금 · 준호 \(나감\)/)).toBeInTheDocument();
  expect(ownerTotals()).toEqual(['민지0원', '공동0원', '준호 (나감)700원']);

  // 추가할 때 소유자 선택지에는 나간 멤버가 없다
  await user.click(screen.getByRole('button', { name: '+ 자산 추가' }));
  expect(within(screen.getByRole('dialog')).queryByRole('radio', { name: /준호/ })).not.toBeInTheDocument();
});
