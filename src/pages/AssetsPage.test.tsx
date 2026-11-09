import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../app/App';
import { AuthProvider } from '../app/auth';
import type { Asset, AssetBalanceHistory, AssetKind, Member } from '../data/types';

// ── 저장소 가짜: 메모리 DB (두 멤버가 같은 가계부를 공유). 이력은 DB 트리거처럼 잔액이 바뀔 때만 쌓는다
const db = vi.hoisted(() => ({
  assets: [] as Asset[],
  history: [] as AssetBalanceHistory[],
  members: [] as Member[],
  failNext: null as null | 'list' | 'create' | 'update' | 'archive' | 'restore',
  seq: 0,
  now: '2026-11-06T03:00:00Z',
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
  const record = (a: Asset) =>
    db.history.push({ id: ++db.seq, asset_id: a.id, ledger_id: a.ledger_id, balance: a.balance, changed_by: 'ma', changed_at: db.now });
  return {
    AssetNotFoundError,
    listAssets: async () => {
      fail('list');
      return db.assets.map((a) => ({ ...a }));
    },
    listBalanceHistory: async () => db.history.map((h) => ({ ...h })),
    getAsset: async (id: string) => {
      const a = db.assets.find((x) => x.id === id);
      return a ? { ...a } : null;
    },
    createAsset: async (ledgerId: string, input: Omit<Asset, 'id' | 'ledger_id' | 'created_at' | 'updated_at' | 'archived_at'>) => {
      fail('create');
      const a: Asset = { id: `n${++db.seq}`, ledger_id: ledgerId, ...input, archived_at: null, created_at: db.now, updated_at: db.now };
      db.assets.push(a);
      record(a);
      return a;
    },
    updateAsset: async (id: string, input: Partial<Asset>) => {
      fail('update');
      const a = db.assets.find((x) => x.id === id);
      if (!a) throw new AssetNotFoundError();
      const changed = input.balance !== undefined && input.balance !== a.balance;
      Object.assign(a, input, { updated_at: db.now });
      if (changed) record(a);
      return a;
    },
    archiveAsset: async (id: string) => {
      fail('archive');
      const a = db.assets.find((x) => x.id === id);
      if (!a) throw new AssetNotFoundError();
      a.archived_at ??= db.now;
    },
    restoreAsset: async (id: string) => {
      fail('restore');
      const a = db.assets.find((x) => x.id === id);
      if (!a) throw new AssetNotFoundError();
      a.archived_at = null;
    },
  };
});

const MA: Member = { id: 'ma', ledger_id: 'L', user_id: 'u-a', role: 'owner', display_name: '민지', joined_at: '2026-11-01T00:00:00Z', left_at: null };
const MB: Member = { id: 'mb', ledger_id: 'L', user_id: 'u-b', role: 'member', display_name: '준호', joined_at: '2026-11-02T00:00:00Z', left_at: null };

/** 자산 + 이력 1행(changed_at 시각) */
function seed(id: string, owner: string | null, balance: number, name: string, kind: AssetKind = 'checking', at = '2026-11-01T00:00:00Z') {
  const a: Asset = {
    id, ledger_id: 'L', name, kind, owner_id: owner, balance, memo: null, archived_at: null, created_at: at, updated_at: at,
  };
  db.assets.push(a);
  db.history.push({ id: ++db.seq, asset_id: id, ledger_id: 'L', balance, changed_by: owner ?? 'ma', changed_at: at });
  return a;
}

function renderAt(path = '/assets') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const card = (name: string) => screen.getByRole('region', { name });
const netWorth = (name = '순자산') => card(name).querySelector('.net-worth__value [aria-hidden="true"]')?.textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(db.now) });
  db.members = [MA, MB];
  db.assets = [];
  db.history = [];
  db.failNext = null;
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

it('자산이 없으면 빈 화면과 "자산 추가" 버튼, 월초 안내는 안 뜬다 (AS-18)', async () => {
  renderAt();
  expect(await screen.findByText('아직 등록한 자산이 없어요')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '자산 추가' })).toHaveAttribute('href', '/assets/new');
  expect(screen.queryByRole('button', { name: '11월 잔액 확인하기' })).not.toBeInTheDocument();
});

it('불러오기 실패 시 안내하고 다시 시도할 수 있다', async () => {
  db.failNext = 'list';
  const user = userEvent.setup();
  renderAt();
  expect(await screen.findByRole('alert')).toHaveTextContent('자산을 불러오지 못했어요');
  await user.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('아직 등록한 자산이 없어요')).toBeInTheDocument();
});

it('부채는 빼서 순자산, 자산·부채 구역이 나뉜다 (AS-02·03)', async () => {
  seed('1', 'ma', 2_700_000, 'A통장');
  seed('2', null, 300_000_000, '우리집', 'real_estate');
  seed('3', null, 199_000_000, '주담대', 'loan');
  renderAt();
  expect(await screen.findByText('A통장')).toBeInTheDocument();
  expect(netWorth()).toBe('103,700,000원');
  // 순자산 카드는 "순자산 / 금액 / 증감" 3줄 — 총자산·총부채는 목록 구역 머리 합계로 (5.23-3)
  expect(within(card('순자산')).queryByText('302,700,000원')).not.toBeInTheDocument();
  expect(within(card('순자산')).queryByText('총자산')).not.toBeInTheDocument();
  expect(within(card('순자산')).queryByText('총부채')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: /자산 2개/ }).querySelector('.card-head__total')).toHaveTextContent('302,700,000원');
  expect(screen.getByRole('region', { name: /부채 1개/ }).querySelector('.card-head__total')).toHaveTextContent('199,000,000원');
  // 부채 목록은 기호 없이 양수 (5.20)
  const debt = screen.getByRole('region', { name: /부채 1개/ });
  expect(within(debt).getByRole('link', { name: /주담대/ })).toHaveTextContent('199,000,000원');
  expect(within(debt).queryByText(/−/)).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: /자산 2개/ })).toBeInTheDocument();
});

it('순자산이 음수면 "−" + 빨간색 클래스 (AS-15·16)', async () => {
  seed('1', null, 9_999_999_999, '대출1', 'loan');
  seed('2', null, 9_999_999_999, '대출2', 'loan');
  seed('3', null, 9_999_999_999, '대출3', 'loan');
  renderAt();
  await screen.findByText('대출1');
  const value = card('순자산').querySelector('.net-worth__value') as HTMLElement;
  expect(value.querySelector('[aria-hidden="true"]')).toHaveTextContent('−29,999,999,997원');
  expect(value).toHaveClass('is-negative');
  expect(within(value).getByText('마이너스 29,999,999,997원')).toHaveClass('sr-only');
  // 총자산 0 → 비율 표시 안 함
  expect(within(card('자산 구성')).getByText('총자산이 0원이라 비율을 표시하지 않아요')).toBeInTheDocument();
});

it('전월 대비: 늘면 ▲, 줄면 ▼, 같으면 변동 없음, 지난달 이력이 없으면 "–" (5.21)', async () => {
  const delta = () => card('순자산').querySelector('.delta') as HTMLElement;
  seed('1', 'ma', 1_000_000, 'A통장', 'checking', '2026-10-10T00:00:00Z');
  const { unmount } = renderAt();
  await screen.findByText('A통장');
  expect(delta()).toHaveTextContent('지난달 말보다 변동 없음');
  unmount();

  seed('2', null, 500_000, '카드', 'card_payable', '2026-11-02T00:00:00Z');
  const r2 = renderAt();
  await screen.findByText('카드');
  expect(delta()).toHaveTextContent('지난달 말보다 ▼ 500,000원');
  expect(within(delta()).getByText('지난달 말보다 500,000원 줄었어요')).toHaveClass('sr-only');
  expect(delta()).toHaveClass('delta--down');
  r2.unmount();

  db.assets = [];
  db.history = [];
  seed('3', null, 10, '새 통장', 'checking', '2026-11-02T00:00:00Z');
  renderAt();
  await screen.findByText('새 통장');
  expect(delta()).toHaveTextContent('지난달 말보다 –');
});

it('자산 구성: 가장 큰 종류 % / 쌓인 막대 1개 / 한 줄, 부채 합계 행 없음 (AS-14, 5.23-5)', async () => {
  seed('1', 'ma', 2_700_000, 'A통장');
  seed('2', 'mb', 6_000_000, 'B적금', 'installment_saving');
  seed('3', null, 300_000_000, '우리집', 'real_estate');
  seed('4', null, 199_000_000, '주담대', 'loan');
  seed('5', 'ma', 1_000_000, 'A카드', 'card_payable');
  renderAt();
  await screen.findByText('A통장');
  const c = card('자산 구성');
  expect(within(c).getByText('부동산 97.2%')).toBeInTheDocument();
  expect(within(c).getByRole('img')).toHaveAccessibleName('자산 구성: 부동산 97.2%, 적금 1.9%, 입출금 0.9%');
  expect(c.querySelectorAll('.composition__seg')).toHaveLength(3);
  expect(within(c).getByText('부동산 · 적금 · 입출금')).toBeInTheDocument();
  // 종류별 금액·부채 합계 행 없음 (금액은 목록에서)
  expect(within(c).queryByRole('listitem')).not.toBeInTheDocument();
  expect(within(c).queryByText(/원$/)).not.toBeInTheDocument();
  expect(within(c).queryByText('대출')).not.toBeInTheDocument();
});

it('자산 구성: 종류가 4개를 넘으면 "외 N" (Q4)', async () => {
  seed('1', null, 50, '집', 'real_estate');
  seed('2', null, 20, '예금', 'deposit');
  seed('3', null, 10, '투자', 'investment');
  seed('4', null, 10, '차', 'vehicle');
  seed('5', null, 5, '현금', 'cash');
  seed('6', null, 5, '연금', 'pension');
  renderAt();
  await screen.findByText('집');
  expect(within(card('자산 구성')).getByText('부동산 · 예금 · 투자 · 자동차 외 2')).toBeInTheDocument();
});

it('사람별: 칩마다 그 소유자 기준, 사람별 합 + 공동 = 합친 (PV-01~05)', async () => {
  seed('1', 'ma', 2_700_000, 'A통장');
  seed('5', 'ma', 1_000_000, 'A카드', 'card_payable');
  seed('2', 'mb', 6_000_000, 'B적금', 'installment_saving');
  seed('3', null, 300_000_000, '우리집', 'real_estate');
  seed('4', null, 199_000_000, '주담대', 'loan');
  const user = userEvent.setup();
  renderAt();
  await screen.findByText('A통장');
  expect(netWorth()).toBe('108,700,000원');

  await user.click(screen.getByRole('radio', { name: '사람별' }));
  const chips = within(screen.getByRole('radiogroup', { name: '누구 것' })).getAllByRole('radio');
  expect(chips.map((c) => c.closest('label')?.textContent)).toEqual(['민지', '준호', '공동']);
  expect(netWorth('민지의 순자산')).toBe('1,700,000원');
  expect(screen.queryByText('B적금')).not.toBeInTheDocument();

  await user.click(screen.getByRole('radio', { name: '준호' }));
  expect(netWorth('준호의 순자산')).toBe('6,000,000원');
  await user.click(screen.getByRole('radio', { name: '공동' }));
  expect(netWorth('공동 순자산')).toBe('101,000,000원');
  expect(1_700_000 + 6_000_000 + 101_000_000).toBe(108_700_000);
});

it('사람별: 나간 멤버가 소유한 자산이 있으면 "이름 (나감)" 칩, 자산이 0개인 사람은 빈 화면(버튼 없음)', async () => {
  db.members = [MA, { ...MB, left_at: '2026-11-05T00:00:00Z' }];
  seed('1', 'mb', 700, '준호 적금');
  const user = userEvent.setup();
  renderAt();
  expect(await screen.findByText(/입출금 · 준호 \(나감\)/)).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: '사람별' }));
  const chips = within(screen.getByRole('radiogroup', { name: '누구 것' })).getAllByRole('radio');
  expect(chips.map((c) => c.closest('label')?.textContent)).toEqual(['민지', '공동', '준호 (나감)']);
  expect(screen.getByText('민지 이름으로 등록한 자산이 없어요')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '자산 추가' })).not.toBeInTheDocument();
});

it('30일 넘게 안 고친 항목만 "n일 전 수정" 배지, 나머지는 표시 없음 (AS-19, 5.23-6)', async () => {
  seed('1', null, 1, '30일', 'cash', '2026-10-07T03:00:00Z');
  seed('2', null, 2, '31일', 'cash', '2026-10-06T03:00:00Z');
  seed('3', null, 3, '오늘', 'cash', '2026-11-06T01:00:00Z');
  renderAt();
  expect(await screen.findByText('31일 전 수정')).toHaveClass('asset-item__ago--stale');
  expect(screen.queryByText('30일 전 수정')).not.toBeInTheDocument();
  expect(screen.queryByText('오늘 수정')).not.toBeInTheDocument();
});

it('월초 안내: 이번 달 잔액 기록이 없을 때만, 닫으면 이 기기에서 그 달엔 다시 안 뜬다 (AS-20, Q12)', async () => {
  seed('1', null, 1, '통장', 'checking', '2026-10-20T00:00:00Z');
  const user = userEvent.setup();
  const { unmount } = renderAt();
  // 한 줄 "11월 잔액 확인하기 ›" + 닫기, 아이콘·보조 문구 없음 (5.23-2)
  expect(await screen.findByRole('button', { name: '11월 잔액 확인하기' })).toBeInTheDocument();
  expect(screen.queryByText('11월에 아직 잔액을 고치지 않았어요')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '이번 달 잔액 확인 안내 닫기' }));
  expect(screen.queryByRole('button', { name: '11월 잔액 확인하기' })).not.toBeInTheDocument();
  unmount();
  renderAt();
  await screen.findByText('통장');
  expect(screen.queryByRole('button', { name: '11월 잔액 확인하기' })).not.toBeInTheDocument();
});

it('자산을 추가하면 목록과 순자산이 바뀐다 (기본 소유자 = 본인, 천 단위 쉼표)', async () => {
  const user = userEvent.setup();
  renderAt('/assets/new');
  expect(await screen.findByRole('heading', { name: '자산 추가' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '민지' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '입출금' })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: '현금' }));
  await user.type(screen.getByLabelText('이름'), '비상금');
  const balance = screen.getByLabelText('잔액');
  await user.type(balance, '1234567');
  expect(balance).toHaveValue('1,234,567');
  await user.click(screen.getByRole('button', { name: '저장' }));

  expect(await screen.findByText('비상금')).toBeInTheDocument();
  expect(screen.getByText('저장했어요')).toBeInTheDocument();
  expect(screen.getByText(/현금 · 민지/)).toBeInTheDocument();
  expect(netWorth()).toBe('1,234,567원');
  expect(db.assets[0]).toMatchObject({ name: '비상금', kind: 'cash', owner_id: 'ma', balance: 1234567, memo: null });
  expect(db.history).toHaveLength(1); // 생성 시 이력 1행 (AS-10)
});

it('부채를 고르면 금액 라벨이 "잔액 (갚을 돈)" (AS-01·03)', async () => {
  const user = userEvent.setup();
  renderAt('/assets/new');
  await screen.findByRole('heading', { name: '자산 추가' });
  const debtGroup = screen.getByRole('group', { name: '부채' });
  expect(within(debtGroup).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['대출', '카드값', '기타 부채']);
  expect(within(screen.getByRole('group', { name: '자산' })).getAllByRole('radio')).toHaveLength(9);
  await user.click(screen.getByRole('radio', { name: '대출' }));
  expect(screen.getByLabelText('잔액 (갚을 돈)')).toBeInTheDocument();
});

it.each([
  ['', '잔액을 입력해 주세요'],
  ['-500', '0 이상의 정수'],
  ['1.5', '0 이상의 정수'],
  ['10000000000', '9,999,999,999원까지'],
])('잔액 "%s" 은 저장되지 않는다 (AS-04)', async (input, message) => {
  const user = userEvent.setup();
  renderAt('/assets/new');
  await screen.findByRole('heading', { name: '자산 추가' });
  await user.click(screen.getByRole('radio', { name: '대출' }));
  await user.type(screen.getByLabelText('이름'), '대출');
  if (input) await user.type(screen.getByLabelText('잔액 (갚을 돈)'), input);
  await user.click(screen.getByRole('button', { name: '저장' }));
  expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
  expect(screen.getByLabelText('잔액 (갚을 돈)')).toHaveAttribute('aria-invalid', 'true');
  expect(db.assets).toHaveLength(0);
});

it('이름만 바꾸면 이력이 늘지 않고, 잔액을 바꾸면 늘어난다 (AS-08·09)', async () => {
  seed('1', 'mb', 300_000, '준호 적금', 'installment_saving');
  const user = userEvent.setup();
  renderAt('/assets/1');
  const name = await screen.findByLabelText('이름');
  await user.clear(name);
  await user.type(name, '준호 청년적금');
  await user.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('준호 청년적금')).toBeInTheDocument();
  expect(db.history).toHaveLength(1);

  await user.click(screen.getByRole('link', { name: /준호 청년적금/ }));
  const balance = await screen.findByLabelText('잔액');
  expect(balance).toHaveValue('300,000');
  await user.clear(balance);
  await user.type(balance, '450000');
  await user.click(screen.getByRole('radio', { name: '공동' }));
  await user.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('저장했어요')).toBeInTheDocument();
  expect(netWorth()).toBe('450,000원');
  expect(db.history).toHaveLength(2);
});

it('저장 실패 시 안내하고 다시 시도할 수 있다', async () => {
  seed('1', null, 100, '통장');
  db.failNext = 'update';
  const user = userEvent.setup();
  renderAt('/assets/1');
  await user.click(await screen.findByRole('button', { name: '저장' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요');
  await user.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('저장했어요')).toBeInTheDocument();
});

it('삭제 대신 보관: 확인 후 목록·합계에서 빠지고, 토스트에서 되돌릴 수 있다 (AS-11·13)', async () => {
  seed('1', 'ma', 100, '통장');
  seed('2', null, 20_000_000, '우리 차', 'vehicle');
  const user = userEvent.setup();
  renderAt();
  await user.click(await screen.findByRole('link', { name: /우리 차/ }));
  expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: '보관' }));
  const dialog = screen.getByRole('alertdialog', { name: "'우리 차'를 보관할까요?" });
  await user.click(within(dialog).getByRole('button', { name: '취소' }));
  expect(db.assets[1].archived_at).toBeNull();

  await user.click(screen.getByRole('button', { name: '보관' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '보관하기' }));
  expect(await screen.findByText("'우리 차'를 보관했어요")).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /우리 차/ })).not.toBeInTheDocument();
  expect(netWorth()).toBe('100원');
  expect(db.assets).toHaveLength(2); // 행은 남는다
  expect(screen.getByRole('link', { name: /보관한 자산/ })).toHaveTextContent('1개');

  await user.click(screen.getByRole('button', { name: '되돌리기' }));
  expect(await screen.findByText("'우리 차'를 되살렸어요")).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: /우리 차/ })).toBeInTheDocument();
  expect(netWorth()).toBe('20,000,100원');
});

it('보관한 자산 화면에서 되살리면 목록·합계에 다시 들어간다 (AS-12)', async () => {
  seed('1', 'mb', 14_000_000, '우리 차', 'vehicle');
  db.assets[0].archived_at = '2026-11-06T01:00:00Z';
  const user = userEvent.setup();
  renderAt('/assets/archived');
  const row = (await screen.findByText('우리 차')).closest('li')!;
  expect(row).toHaveTextContent('자동차 · 준호 · 11월 6일 보관');
  await user.click(within(row).getByRole('button', { name: '우리 차 되살리기' }));
  expect(await screen.findByText("'우리 차'를 되살렸어요")).toBeInTheDocument();
  expect(await screen.findByText('보관한 자산이 없어요')).toBeInTheDocument();
  expect(db.assets[0].archived_at).toBeNull();
});

it('보관된 자산 주소로 수정 화면을 열면 안내만 보인다', async () => {
  seed('1', null, 100, '통장');
  db.assets[0].archived_at = '2026-11-06T01:00:00Z';
  renderAt('/assets/1');
  expect(await screen.findByRole('alert')).toHaveTextContent('보관했거나 찾을 수 없는 자산이에요');
});

it('수정 화면 소유자: 나간 멤버는 새 자산 선택지에 없다', async () => {
  db.members = [MA, { ...MB, left_at: '2026-11-05T00:00:00Z' }];
  renderAt('/assets/new');
  await screen.findByRole('heading', { name: '자산 추가' });
  expect(screen.queryByRole('radio', { name: /준호/ })).not.toBeInTheDocument();
});

describe('추이 (BANB-26, 5.23-4)', () => {
  const trend = () => card('6개월 추이');
  const months = () => [...trend().querySelectorAll('.trend__month')].map((m) => m.textContent);
  /** 이력 한 행 더 (잔액 변경) */
  const change = (id: string, balance: number, at: string) => {
    db.history.push({ id: ++db.seq, asset_id: id, ledger_id: 'L', balance, changed_by: 'ma', changed_at: at });
    db.assets.find((a) => a.id === id)!.balance = balance;
  };

  it('점은 마지막 달 하나, x축은 처음·끝 달만, 캡션·달 고르기 없음 (TR-01·03)', async () => {
    seed('1', 'ma', 3_000_000, 'A통장', 'checking', '2026-09-15T00:00:00Z');
    change('1', 2_000_000, '2026-10-10T00:00:00Z');
    change('1', 2_700_000, '2026-11-05T00:00:00Z');
    seed('6', 'mb', 20_000_000, 'B차', 'vehicle', '2026-09-15T00:00:00Z');
    db.assets.find((a) => a.id === '6')!.archived_at = '2026-11-05T15:00:01Z'; // 11-06 KST 보관
    renderAt();
    await screen.findByText('A통장');

    expect(trend().querySelectorAll('.trend__dot')).toHaveLength(1);
    expect(months()).toEqual(['9월', '11월']);
    expect(within(trend()).queryByText('월말 순자산')).not.toBeInTheDocument();
    expect(within(trend()).queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(within(trend()).getByRole('img')).toHaveAccessibleName('최근 6개월 순자산, 9월 2,300만 원부터 11월 270만 원까지');
    // 달별 값은 화면낭독 표로 (보관한 B차는 10월에 포함)
    expect(within(trend()).getByRole('table')).toHaveTextContent('10월 말2,200만 원');
  });

  it('사람별 칩을 바꾸면 추이도 그 사람 것 (TR-04)', async () => {
    seed('1', 'ma', 3_000_000, 'A통장', 'checking', '2026-09-15T00:00:00Z');
    change('1', 2_700_000, '2026-11-05T00:00:00Z');
    seed('3', null, 100_000_000, '우리집', 'real_estate', '2026-10-15T00:00:00Z');
    const user = userEvent.setup();
    renderAt();
    await screen.findByText('A통장');
    expect(months()).toEqual(['9월', '11월']);
    await user.click(screen.getByRole('radio', { name: '사람별' }));
    await user.click(screen.getByRole('radio', { name: '공동' }));
    expect(months()).toEqual(['10월', '11월']);
    expect(within(trend()).getByRole('img')).toHaveAccessibleName('최근 6개월 순자산, 10월 1억 원부터 11월 1억 원까지');
  });

  it('이력이 이번 달뿐이면 점 1개·라벨 1개 + 안내 (TR-06)', async () => {
    seed('1', 'ma', 50_000, '새 통장', 'cash', '2026-11-03T00:00:00Z');
    renderAt();
    await screen.findByText('새 통장');
    expect(trend().querySelectorAll('.trend__dot')).toHaveLength(1);
    expect(months()).toEqual(['11월']);
    expect(within(trend()).getByText('다음 달부터 추이가 보여요')).toBeInTheDocument();
  });

  it('순자산이 0을 가로지르면 0 기준선 (TR-07)', async () => {
    seed('1', null, 5_000_000, '대출', 'loan', '2026-09-15T00:00:00Z');
    seed('2', 'ma', 8_000_000, '통장', 'checking', '2026-11-02T00:00:00Z');
    renderAt();
    await screen.findByText('통장');
    expect(trend().querySelector('.trend__zero')).toBeInTheDocument();
    expect(within(trend()).getByRole('table')).toHaveTextContent('9월 말마이너스 500만 원');
  });
});

