import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../../app/App';
import { AuthProvider } from '../../app/auth';
import type { Category, Pocket } from '../../data/types';

// ── 저장소 가짜: 메모리 목록을 직접 바꿔서, 다시 불러오면 바뀐 값이 보이게 한다
const fake = vi.hoisted(() => ({
  categories: [] as Category[],
  pockets: [] as Pocket[],
  failNext: false,
  loadFail: false,
  seq: 0,
  // 가계부별 내 이름 (BANB-45). L 이 지금 가계부, L2 는 다른 가계부
  myNames: {} as Record<string, string>,
  renameFail: false,
}));

vi.mock('../../data/auth', () => ({
  AUTH_CALLBACK_PATH: '/login',
  onAuthChange: (cb: (u: unknown) => void) => {
    queueMicrotask(() => cb({ id: 'u1', email: 'a@example.com', name: 'A', avatarUrl: null }));
    return () => {};
  },
  signInWithGoogle: async () => {},
  signOut: async () => {},
}));
vi.mock('../../data/ledger', () => ({
  listMyLedgers: async () => [{ id: 'L', name: '우리집', memberCount: 2, joinedAt: '2026-11-01T00:00:00Z' }],
  getLastLedgerId: async () => 'L',
  rememberLedger: async () => {},
  // 설정 메뉴가 가계부 이름을 보여 준다 (BANB-5)
  getLedger: async () => ({ id: 'L', name: '우리집', member_limit: 2, created_by: 'u', created_at: '' }),
}));
vi.mock('../../data/profile', () => ({ getProfile: async () => null }));
vi.mock('../../data/member', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/member')>()),
  getMyMemberName: vi.fn(async (ledgerId: string) => fake.myNames[ledgerId] ?? null),
  renameMyMember: vi.fn(async (ledgerId: string, _userId: string, name: string) => {
    if (fake.renameFail) throw new Error('FAILED');
    fake.myNames[ledgerId] = name;
  }),
}));

vi.mock('../../data/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data/catalog')>();
  const maybeFail = () => {
    if (fake.failNext) {
      fake.failNext = false;
      throw new real.CatalogError('FAILED');
    }
  };
  const now = () => `2026-11-06T00:00:${String(++fake.seq).padStart(2, '0')}Z`;
  return {
    ...real,
    listCategories: vi.fn(async () => {
      if (fake.loadFail) throw new real.CatalogError('FAILED');
      return structuredClone(fake.categories);
    }),
    listPockets: vi.fn(async () => {
      if (fake.loadFail) throw new real.CatalogError('FAILED');
      return structuredClone(fake.pockets);
    }),
    addParentCategory: vi.fn(async (i: { ledgerId: string; type: Category['type']; name: string; sortOrder: number; icon?: string | null }) => {
      maybeFail();
      const id = `new-${fake.seq + 1}`;
      fake.categories.push({ id, ledger_id: i.ledgerId, type: i.type, parent_id: null, name: i.name, sort_order: i.sortOrder, is_hidden: false, icon: i.icon ?? null, created_at: now() });
      fake.categories.push({ id: `${id}-c`, ledger_id: i.ledgerId, type: i.type, parent_id: id, name: i.name, sort_order: 1, is_hidden: false, icon: i.icon ?? null, created_at: now() });
    }),
    addChildCategory: vi.fn(async (i: { ledgerId: string; type: Category['type']; parentId: string; name: string; sortOrder: number; icon?: string | null }) => {
      maybeFail();
      fake.categories.push({ id: `new-${fake.seq + 1}`, ledger_id: i.ledgerId, type: i.type, parent_id: i.parentId, name: i.name, sort_order: i.sortOrder, is_hidden: false, icon: i.icon ?? null, created_at: now() });
    }),
    updateCategory: vi.fn(async (id: string, patch: Partial<Category>) => {
      maybeFail();
      Object.assign(fake.categories.find((c) => c.id === id)!, patch);
    }),
    addPocket: vi.fn(async (i: { ledgerId: string; name: string; scope: Pocket['scope']; sortOrder: number }) => {
      maybeFail();
      fake.pockets.push({ id: `p-${fake.seq + 1}`, ledger_id: i.ledgerId, name: i.name, scope: i.scope, sort_order: i.sortOrder, is_hidden: false, created_at: now() });
    }),
    updatePocket: vi.fn(async (id: string, patch: Partial<Pocket>) => {
      maybeFail();
      Object.assign(fake.pockets.find((p) => p.id === id)!, patch);
    }),
    saveOrder: vi.fn(async (table: 'category' | 'pocket', updates: { id: string; sort_order: number }[]) => {
      maybeFail();
      const list: { id: string; sort_order: number }[] = table === 'category' ? fake.categories : fake.pockets;
      for (const u of updates) list.find((x) => x.id === u.id)!.sort_order = u.sort_order;
    }),
  };
});

const catalog = await import('../../data/catalog');

function c(id: string, type: Category['type'], parent: string | null, name: string, sort: number, hidden = false): Category {
  return { id, ledger_id: 'L', type, parent_id: parent, name, sort_order: sort, is_hidden: hidden, icon: null, created_at: '2026-11-05T00:00:00Z' };
}
function p(id: string, name: string, scope: Pocket['scope'], sort: number): Pocket {
  return { id, ledger_id: 'L', name, scope, sort_order: sort, is_hidden: false, created_at: '2026-11-05T00:00:00Z' };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.failNext = false;
  fake.loadFail = false;
  fake.renameFail = false;
  fake.myNames = { L: '에이', L2: '에이' };
  fake.categories = [
    c('food', 'expense', null, '식비', 1),
    c('grocery', 'expense', 'food', '장보기', 1),
    c('eatout', 'expense', 'food', '외식', 2),
    c('ins', 'expense', null, '보험', 2),
    c('ins-c', 'expense', 'ins', '보험', 1),
    c('salary', 'income', null, '급여', 1),
    c('salary-c', 'income', 'salary', '급여', 1),
  ];
  fake.pockets = [p('p1', '공동소비', 'shared', 1), p('p2', '개인용돈', 'personal', 2), p('p3', '여행', 'shared', 3)];
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

const rowNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.manage-row__name')).map((e) => e.textContent);

describe('설정 메뉴', () => {
  it('묶음 제목·개수 없이 줄 이름만 보이고, 계정 줄은 메일 + 로그아웃 (design.md 5.23)', async () => {
    renderAt('/settings');
    const links = await screen.findAllByRole('link');
    expect(links.map((a) => a.querySelector('.menu-list__label')?.textContent)).toEqual([
      '가계부 이름',
      '내 이름',
      '멤버·초대',
      '카테고리',
      '주머니',
      '화면 테마',
    ]);
    expect(await screen.findByRole('link', { name: /가계부 이름/ })).toHaveTextContent('우리집');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+(개|명)/)).not.toBeInTheDocument();
    expect(screen.queryByText('구글 계정')).not.toBeInTheDocument();
    const account = screen.getByRole('region', { name: '계정' });
    expect(within(account).getByText('a@example.com')).toBeInTheDocument();
    expect(within(account).getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });

  it('각 줄을 누르면 지금과 같은 화면으로 간다', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(await screen.findByRole('link', { name: /카테고리/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '카테고리 관리' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '뒤로' }));
    await user.click(await screen.findByRole('link', { name: /주머니/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '주머니 관리' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '뒤로' }));
    await user.click(await screen.findByRole('link', { name: /화면 테마/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '화면 테마' })).toBeInTheDocument();
  });

  it('가계부 이름·멤버·초대 줄은 지금과 같은 주소로 간다', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('link', { name: /가계부 이름/ })).toHaveAttribute('href', '/settings/name');
    expect(screen.getByRole('link', { name: /멤버·초대/ })).toHaveAttribute('href', '/settings/members');
  });
});

describe('내 이름 (BANB-45)', () => {
  it('설정 첫 묶음에 지금 이름을 값으로 보여 주고 /settings/my-name 으로 간다', async () => {
    renderAt('/settings');
    const row = await screen.findByRole('link', { name: /내 이름/ });
    expect(row).toHaveAttribute('href', '/settings/my-name');
    await waitFor(() => expect(row).toHaveTextContent('에이'));
  });

  it('바꾸면 지금 가계부의 내 이름만 바뀌고 설정 줄에 새 이름이 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(await screen.findByRole('link', { name: /내 이름/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '내 이름' })).toBeInTheDocument();
    const input = await screen.findByLabelText('내 이름');
    expect(input).toHaveValue('에이');
    const save = screen.getByRole('button', { name: '저장' });
    expect(save).toBeDisabled(); // 바뀐 게 없으면 꺼짐
    await user.clear(input);
    await user.type(input, '  남편  ');
    await user.click(save);
    expect(await screen.findByRole('status')).toHaveTextContent('저장했어요.');
    expect(input).toHaveValue('남편');
    expect(fake.myNames).toEqual({ L: '남편', L2: '에이' });
    const { renameMyMember } = await import('../../data/member');
    expect(renameMyMember).toHaveBeenCalledWith('L', 'u1', '남편');
    await user.click(screen.getByRole('button', { name: '뒤로' }));
    await waitFor(() => expect(screen.getByRole('link', { name: /내 이름/ })).toHaveTextContent('남편'));
  });

  it('빈 값·21자 이상이면 저장 버튼이 꺼지고 안내가 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/my-name');
    const input = await screen.findByLabelText('내 이름');
    const save = screen.getByRole('button', { name: '저장' });
    await user.clear(input);
    expect(save).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('이름을 입력해 주세요.');
    await user.type(input, '   ');
    expect(save).toBeDisabled();
    await user.clear(input);
    await user.type(input, '가'.repeat(21));
    expect(save).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('이름은 20자까지 쓸 수 있어요.');
    await user.type(input, '{Backspace}');
    expect(save).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('저장에 실패하면 이전 이름을 유지하고 오류를 알린다', async () => {
    const user = userEvent.setup();
    fake.renameFail = true;
    renderAt('/settings/my-name');
    const input = await screen.findByLabelText('내 이름');
    await user.clear(input);
    await user.type(input, '남편');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요');
    expect(fake.myNames.L).toBe('에이');
    expect(screen.queryByText('저장했어요.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled(); // 다시 시도 가능
  });
});

describe('카테고리 관리', () => {
  it('유형 탭별로 대분류 > 소분류를 순서대로 보여 준다 (같은 이름 소분류는 따로 보이지 않음, BANB-36)', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/settings/categories');
    expect(await screen.findByRole('tab', { name: '지출', selected: true })).toBeInTheDocument();
    expect(rowNames(container)).toEqual(['식비', '장보기', '외식', '보험']);

    await user.click(screen.getByRole('tab', { name: '수입' }));
    expect(rowNames(container)).toEqual(['급여']);
    await user.click(screen.getByRole('tab', { name: '저축' }));
    expect(screen.getByText(/아직 저축 카테고리가 없어요/)).toBeInTheDocument();
  });

  it('소분류를 추가하면 목록 맨 뒤에 보이고 저장 완료를 알린다', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: '식비에 소분류 추가' }));
    const dialog = screen.getByRole('dialog', { name: '카테고리 추가' });
    // 연 곳의 대분류가 미리 선택돼 있다
    expect(within(dialog).getByRole('radio', { name: '식비' })).toBeChecked();
    await user.type(within(dialog).getByLabelText('이름'), '  배달 ');
    await user.click(within(dialog).getByRole('radio', { name: '자전거' }));
    await user.click(within(dialog).getByRole('button', { name: '추가하기' }));

    expect(catalog.addChildCategory).toHaveBeenCalledWith({
      ledgerId: 'L',
      type: 'expense',
      parentId: 'food',
      name: '배달',
      icon: 'bike',
      sortOrder: 3,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('추가했어요');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowNames(container).slice(0, 4)).toEqual(['식비', '장보기', '외식', '배달']);
  });

  it('대분류를 추가할 수 있다 (같은 이름 소분류 함께)', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: '+ 지출 대분류 추가' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: '새 대분류' })).toBeChecked();
    expect(dialog).toHaveTextContent('같은 이름의 소분류도 함께');
    await user.type(within(dialog).getByLabelText('이름'), '술');
    // 아이콘을 안 고르면 null (첫 글자로 보임)
    await user.click(within(dialog).getByRole('button', { name: '추가하기' }));
    expect(catalog.addParentCategory).toHaveBeenCalledWith({ ledgerId: 'L', type: 'expense', name: '술', icon: null, sortOrder: 3 });
    await screen.findByText('추가했어요');
    expect(rowNames(container).slice(-1)).toEqual(['술']);
  });

  it.each([
    ['   ', '이름을 입력해 주세요.'],
    ['가'.repeat(21), '이름은 20자까지 쓸 수 있어요.'],
  ])('이름 %j 은 저장하지 않고 안내한다', async (name, message) => {
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: '식비에 소분류 추가' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('이름'), name);
    // 저장 버튼이 꺼지고 이유를 한 줄 보여 준다
    expect(within(dialog).getByRole('button', { name: '추가하기' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(message);
    expect(within(dialog).getByLabelText('이름')).toHaveAttribute('aria-invalid', 'true');
    expect(catalog.addChildCategory).not.toHaveBeenCalled();
  });

  it('같은 대분류에 같은 이름이 있으면 추가하지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: '식비에 소분류 추가' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('이름'), '외식');
    expect(within(dialog).getByRole('button', { name: '추가하기' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('같은 대분류에 같은 이름이 이미 있어요.');
    // 다른 대분류를 고르면 저장할 수 있다
    await user.click(within(within(dialog).getByRole('group', { name: '어디에 넣을까요' })).getByRole('radio', { name: '보험' }));
    expect(within(dialog).getByRole('button', { name: '추가하기' })).toBeEnabled();
  });

  it('이름·아이콘을 바꿀 수 있다 (기본 카테고리도)', async () => {
    fake.categories.find((x) => x.id === 'eatout')!.icon = 'utensils';
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: /^외식/ }));
    const dialog = screen.getByRole('dialog', { name: '카테고리 수정' });
    const input = within(dialog).getByLabelText('이름');
    expect(input).toHaveValue('외식');
    expect(within(dialog).getByRole('radio', { name: '포크와 나이프' })).toHaveAttribute('aria-checked', 'true');
    // 수정에서는 대분류를 바꾸지 않는다
    expect(within(dialog).queryByRole('radio', { name: '새 대분류' })).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '바깥밥');
    await user.click(within(dialog).getByRole('radio', { name: '피자' }));
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(catalog.updateCategory).toHaveBeenCalledWith('eatout', { name: '바깥밥', icon: 'pizza' });
    expect(await screen.findByRole('button', { name: /^바깥밥/ })).toBeInTheDocument();
  });

  it('같은 이름 소분류뿐인 대분류의 아이콘을 바꾸면 그 소분류도 같이 바뀐다 (QA 결함 1)', async () => {
    fake.categories.find((x) => x.id === 'ins')!.icon = 'shield-check';
    fake.categories.find((x) => x.id === 'ins-c')!.icon = 'shield-check';
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click((await screen.findAllByRole('button', { name: /^보험/ }))[0]);
    const dialog = screen.getByRole('dialog', { name: '대분류 수정' });
    await user.click(within(dialog).getByRole('radio', { name: '하트' }));
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(catalog.updateCategory).toHaveBeenCalledWith('ins', { name: '보험', icon: 'heart' });
    expect(catalog.updateCategory).toHaveBeenCalledWith('ins-c', { icon: 'heart' });
    expect(catalog.updateCategory).toHaveBeenCalledTimes(2);
  });

  it('대분류 이름만 바꾸면 같은 이름 소분류도 이름만 함께 바뀐다 (BANB-36)', async () => {
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click((await screen.findAllByRole('button', { name: /^보험/ }))[0]);
    const dialog = screen.getByRole('dialog', { name: '대분류 수정' });
    await user.type(within(dialog).getByLabelText('이름'), '료');
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(catalog.updateCategory).toHaveBeenCalledTimes(2);
    expect(vi.mocked(catalog.updateCategory).mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ name: '보험료' }),
      { name: '보험료' },
    ]);
  });

  it('순서를 바꿀 수 있고, 맨 위에서는 위로 버튼이 꺼진다', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: /^장보기/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '↑ 위로' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: '↓ 아래로' }));
    expect(catalog.saveOrder).toHaveBeenCalledWith('category', [
      { id: 'eatout', sort_order: 1 },
      { id: 'grocery', sort_order: 2 },
    ]);
    expect(await screen.findByText('순서를 바꿨어요')).toBeInTheDocument();
    expect(rowNames(container).slice(0, 3)).toEqual(['식비', '외식', '장보기']);
    // 시트는 열린 채로 남아, 바뀐 위치 기준으로 버튼 상태가 갱신된다
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '↓ 아래로' })).toBeDisabled();
  });

  it('숨기면 "숨김" 표시가 붙고, 다시 보이게 할 수 있다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: /^외식/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('숨겨도 지난 내역에는 이름이 그대로 보여요');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '숨기기' }));
    expect(catalog.updateCategory).toHaveBeenCalledWith('eatout', { is_hidden: true });
    const row = await screen.findByRole('button', { name: /^외식,\s*숨김$/ });

    await user.click(row);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '다시 보이기' }));
    expect(catalog.updateCategory).toHaveBeenLastCalledWith('eatout', { is_hidden: false });
    expect(await screen.findByRole('button', { name: '외식' })).toBeInTheDocument();
  });

  it('삭제 버튼과 "대분류로 바꾸기"는 없다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: /^외식/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /삭제|대분류/ })).not.toBeInTheDocument();
  });

  it('저장에 실패하면 시트 안에 안내하고 다시 시도할 수 있다', async () => {
    fake.failNext = true;
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: /^외식/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '숨기기' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('저장하지 못했어요');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '숨기기' }));
    expect(await screen.findByText('숨겼어요')).toBeInTheDocument();
  });

  it('불러오기에 실패하면 안내하고 다시 시도할 수 있다', async () => {
    fake.loadFail = true;
    const user = userEvent.setup();
    renderAt('/settings/categories');
    expect(await screen.findByRole('alert')).toHaveTextContent('카테고리를 불러오지 못했어요');
    fake.loadFail = false;
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('tab', { name: '지출' })).toBeInTheDocument();
  });

  it('Esc로 시트를 닫는다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/categories');
    await user.click(await screen.findByRole('button', { name: /^외식/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('주머니 관리', () => {
  it('주머니를 순서대로, 공동/개인 구분과 함께 보여 준다', async () => {
    renderAt('/settings/pockets');
    const rows = await screen.findAllByRole('button', { name: /,\s*(공동|개인)$/ });
    expect(rows.map((r) => r.textContent)).toEqual(['공동소비, 공동›', '개인용돈, 개인›', '여행, 공동›']);
  });

  it('구분을 골라 주머니를 추가한다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/pockets');
    await user.click(await screen.findByRole('button', { name: '+ 주머니 추가' }));
    const dialog = screen.getByRole('dialog', { name: '주머니 추가' });
    await user.type(within(dialog).getByLabelText('이름'), '취미');
    await user.click(within(dialog).getByRole('radio', { name: '개인' }));
    await user.click(within(dialog).getByRole('button', { name: '추가' }));
    expect(catalog.addPocket).toHaveBeenCalledWith({ ledgerId: 'L', name: '취미', scope: 'personal', sortOrder: 4 });
    expect(await screen.findByRole('button', { name: /^취미,\s*개인$/ })).toBeInTheDocument();
  });

  it('공동/개인을 바꾸면 바로 저장되고 지난 내역도 바뀐 구분으로 집계된다고 안내한다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/pockets');
    await user.click(await screen.findByRole('button', { name: /^개인용돈/ }));
    const dialog = screen.getByRole('dialog', { name: '주머니' });
    expect(dialog).toHaveTextContent('지난 내역도 바뀐 구분으로 집계돼요');
    expect(within(dialog).getByRole('radio', { name: '개인' })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: '공동' }));
    expect(catalog.updatePocket).toHaveBeenCalledWith('p2', { scope: 'shared' });
    expect(await screen.findByRole('button', { name: /^개인용돈,\s*공동$/ })).toBeInTheDocument();
  });

  it('이름 변경·순서 변경·숨김', async () => {
    const user = userEvent.setup();
    renderAt('/settings/pockets');
    await user.click(await screen.findByRole('button', { name: /^여행/ }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '↓ 아래로' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: '↑ 위로' }));
    expect(catalog.saveOrder).toHaveBeenCalledWith('pocket', [
      { id: 'p3', sort_order: 2 },
      { id: 'p2', sort_order: 3 },
    ]);
    await screen.findByText('순서를 바꿨어요');

    dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('이름');
    await user.clear(input);
    await user.type(input, '여행비');
    await user.click(within(dialog).getByRole('button', { name: '이름 저장' }));
    expect(catalog.updatePocket).toHaveBeenCalledWith('p3', { name: '여행비' });

    await user.click(await screen.findByRole('button', { name: /^여행비/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '숨기기' }));
    expect(catalog.updatePocket).toHaveBeenLastCalledWith('p3', { is_hidden: true });
    expect(await screen.findByRole('button', { name: /^여행비,\s*공동,\s*숨김$/ })).toBeInTheDocument();
  });

  it('주머니가 하나도 없으면 빈 화면 안내', async () => {
    fake.pockets = [];
    renderAt('/settings/pockets');
    expect(await screen.findByText(/아직 주머니가 없어요/)).toBeInTheDocument();
  });
});
