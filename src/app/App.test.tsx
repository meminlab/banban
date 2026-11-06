import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { AuthUser } from '../data/auth';
import { App } from './App';
import { AuthProvider } from './auth';

// ── 저장소 모듈 가짜 (화면은 src/data 만 쓰므로 여기만 바꾸면 된다)
const fake = vi.hoisted(() => ({
  listener: null as ((u: unknown) => void) | null,
  initialUser: null as unknown,
  ledgerId: null as string | null,
  ledgerError: false,
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  ledgerName: '우리집',
  memberLimit: 2,
  members: [] as Array<Record<string, unknown>>,
  invite: null as Record<string, unknown> | null,
  createLedger: vi.fn(async (_name: string, _displayName: string) => 'ledger-new'),
  joinLedger: vi.fn(async (_code: string, _displayName: string) => 'ledger-joined'),
  leaveLedger: vi.fn(async () => {}),
  renameLedger: vi.fn(async (_id: string, _name: string) => {}),
  issueInvite: vi.fn(async () => ({}) as Record<string, unknown>),
}));

vi.mock('../data/auth', () => ({
  AUTH_CALLBACK_PATH: '/login',
  onAuthChange: (cb: (u: unknown) => void) => {
    fake.listener = cb;
    queueMicrotask(() => cb(fake.initialUser)); // 저장된 세션 복원 흉내
    return () => {
      fake.listener = null;
    };
  },
  signInWithGoogle: () => fake.signIn(),
  signOut: () => fake.signOut(),
}));
vi.mock('../data/ledger', () => ({
  getMyLedgerId: async () => {
    if (fake.ledgerError) throw new Error('network');
    return fake.ledgerId;
  },
  getLedger: async (id: string) => ({ id, name: fake.ledgerName, member_limit: fake.memberLimit, created_by: 'u1', created_at: '' }),
  renameLedger: (id: string, name: string) => fake.renameLedger(id, name),
  createLedger: async (name: string, displayName: string) => {
    const id = await fake.createLedger(name, displayName);
    fake.ledgerId = id;
    return id;
  },
  joinLedger: async (code: string, displayName: string) => {
    const id = await fake.joinLedger(code, displayName);
    fake.ledgerId = id;
    return id;
  },
  leaveLedger: async () => {
    await fake.leaveLedger();
    fake.ledgerId = null;
  },
  listMembers: async () => fake.members,
  getCurrentInvite: async () => fake.invite,
  issueInvite: async () => {
    const next = await fake.issueInvite();
    fake.invite = next;
    return next;
  },
}));
vi.mock('../data/summary', () => ({
  getMonthSummaryData: async () => ({ transactions: [], members: [], pockets: [], categories: [] }),
}));
vi.mock('../data/profile', () => ({
  getProfile: async (id: string) => ({ id, display_name: '김반반', avatar_url: null, updated_at: '' }),
}));

const USER: AuthUser = { id: 'u1', email: 'banban@example.com', name: '구글이름', avatarUrl: null };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const FUTURE = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString();
const member = (id: string, user_id: string, display_name: string, extra: Record<string, unknown> = {}) => ({
  id, ledger_id: 'ledger-1', user_id, display_name, role: 'member', joined_at: '', left_at: null, ...extra,
});
const invite = (code: string, extra: Record<string, unknown> = {}) => ({
  id: `inv-${code}`, ledger_id: 'ledger-1', code, expires_at: FUTURE, is_revoked: false, created_by: 'm1', created_at: '', ...extra,
});
/** RPC 오류 흉내 (supabase PostgrestError 형태) */
const rpcError = (message: string, details: string | null = null) => Object.assign(new Error(message), { details });

beforeEach(() => {
  localStorage.clear();
  fake.ledgerName = '우리집';
  fake.memberLimit = 2;
  fake.members = [member('m1', 'u1', '김반반', { role: 'owner' })];
  fake.invite = null;
  fake.createLedger.mockClear();
  fake.joinLedger.mockReset();
  fake.joinLedger.mockImplementation(async () => 'ledger-joined');
  fake.leaveLedger.mockReset();
  fake.renameLedger.mockReset();
  fake.issueInvite.mockReset();
  fake.initialUser = USER;
  fake.ledgerId = 'ledger-1';
  fake.ledgerError = false;
  fake.signIn.mockClear();
  fake.signOut.mockReset();
  fake.signOut.mockImplementation(async () => {
    fake.listener?.(null);
  });
});

describe('로그인하지 않은 상태', () => {
  beforeEach(() => {
    fake.initialUser = null;
  });

  it.each(['/', '/ledger', '/assets', '/settings', '/start'])('%s 로 바로 들어오면 로그인 화면으로 간다', async (path) => {
    renderAt(path);
    expect(await screen.findByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument();
  });

  it('구글 로그인 버튼을 누르면 구글 로그인을 시작한다', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(await screen.findByRole('button', { name: '구글 계정으로 로그인' }));
    expect(fake.signIn).toHaveBeenCalledTimes(1);
  });

  it('구글 로그인을 시작하지 못하면 안내하고 다시 누를 수 있다', async () => {
    fake.signIn.mockRejectedValueOnce(new Error('provider disabled'));
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(await screen.findByRole('button', { name: '구글 계정으로 로그인' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인하지 못했어요');
    expect(screen.getByRole('button', { name: '구글 계정으로 로그인' })).toBeEnabled();
  });

  it('구글에서 오류로 돌아오면 안내한다', async () => {
    renderAt('/login?error=access_denied&error_description=denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인하지 못했어요');
  });
});

describe('로그인했고 가계부가 있는 상태', () => {
  it('하단 탭 3개가 순서대로 보인다', async () => {
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: '주요 메뉴' });
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['홈', '가계부', '자산']);
  });

  it('탭을 누르면 화면이 바뀌고 현재 탭이 표시된다', async () => {
    const user = userEvent.setup();
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '가계부' }));
    expect(screen.getByRole('heading', { level: 1, name: '가계부' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '가계부' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: '자산' }));
    expect(screen.getByRole('heading', { level: 1, name: '자산' })).toBeInTheDocument();
  });

  it('오른쪽 위 설정 버튼으로 설정 화면에 가고, 뒤로 버튼으로 돌아온다', async () => {
    const user = userEvent.setup();
    renderAt('/assets');
    await user.click(await screen.findByRole('link', { name: '설정' }));
    expect(await screen.findByRole('heading', { level: 1, name: '설정' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '뒤로' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });

  it('없는 주소는 홈으로 보낸다', async () => {
    renderAt('/nope');
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });

  it('로그인 화면으로 들어오면 홈으로 보낸다 (구글 로그인 후 돌아온 경우)', async () => {
    renderAt('/login?code=abc');
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });

  it('시작 화면으로 들어오면 홈으로 보낸다', async () => {
    renderAt('/start');
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });

  it('설정에 저장된 프로필(이름)과 이메일이 보이고, 로그아웃하면 로그인 화면으로 간다', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    expect(await screen.findByText('김반반')).toBeInTheDocument();
    expect(screen.getByText('banban@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(fake.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument();
  });

  it('로그아웃에 실패하면 안내하고 화면에 남는다', async () => {
    fake.signOut.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('로그아웃하지 못했어요');
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled();
  });
});

describe('로그인했고 가계부가 없는 상태', () => {
  beforeEach(() => {
    fake.ledgerId = null;
  });

  it.each(['/', '/ledger', '/assets', '/settings', '/settings/members'])('%s 로 들어오면 가계부 시작 화면으로 간다', async (path) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: '가계부 시작하기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /가계부 만들기/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /초대코드 입력/ })).toBeEnabled();
    expect(await screen.findByText('김반반님, 반가워요')).toBeInTheDocument();
  });

  it('가계부 이름을 넣어 만들면 홈으로 간다 (내 이름은 프로필 이름)', async () => {
    const user = userEvent.setup();
    renderAt('/start');
    await screen.findByText('김반반님, 반가워요');
    await user.click(screen.getByRole('button', { name: /가계부 만들기/ }));
    await user.type(screen.getByLabelText('가계부 이름'), '  반반네  ');
    await user.click(screen.getByRole('button', { name: '만들기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
    expect(fake.createLedger).toHaveBeenCalledWith('  반반네  ', '김반반');
  });

  it('이모지 15개 이름으로도 만들 수 있다', async () => {
    const user = userEvent.setup();
    renderAt('/start');
    await user.click(await screen.findByRole('button', { name: /가계부 만들기/ }));
    await user.type(screen.getByLabelText('가계부 이름'), '😀'.repeat(15));
    await user.click(screen.getByRole('button', { name: '만들기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
    expect(fake.createLedger).toHaveBeenCalledWith('😀'.repeat(15), '김반반');
  });

  it('가계부 이름이 비었거나 공백뿐이면 만들지 않고 안내한다', async () => {
    const user = userEvent.setup();
    renderAt('/start');
    await user.click(await screen.findByRole('button', { name: /가계부 만들기/ }));
    await user.type(screen.getByLabelText('가계부 이름'), '   ');
    await user.click(screen.getByRole('button', { name: '만들기' }));
    expect(screen.getByRole('alert')).toHaveTextContent('가계부 이름을 입력해 주세요');
    expect(fake.createLedger).not.toHaveBeenCalled();
  });

  it('가계부를 만들지 못하면 안내하고 다시 시도할 수 있다', async () => {
    fake.createLedger.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderAt('/start');
    await user.click(await screen.findByRole('button', { name: /가계부 만들기/ }));
    await user.type(screen.getByLabelText('가계부 이름'), '우리집');
    await user.click(screen.getByRole('button', { name: '만들기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('가계부를 만들지 못했어요');
    expect(screen.getByRole('button', { name: '만들기' })).toBeEnabled();
  });

  it('초대코드로 참여하면 홈으로 간다 (소문자·하이픈 입력도 정리)', async () => {
    const user = userEvent.setup();
    renderAt('/start');
    await user.click(await screen.findByRole('button', { name: /초대코드 입력/ }));
    await user.type(screen.getByLabelText('초대 코드 8자리'), 'abcd-2345');
    await user.click(screen.getByRole('button', { name: '참여하기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
    expect(fake.joinLedger).toHaveBeenCalledWith('ABCD2345', '김반반');
  });

  it.each([
    ['MEMBER_LIMIT_REACHED', '2', '현재 최대 2명까지 참여할 수 있어요'],
    ['MEMBER_LIMIT_REACHED', '3', '현재 최대 3명까지 참여할 수 있어요'],
    ['INVITE_EXPIRED', null, '초대 코드가 만료됐어요'],
    ['INVITE_NOT_FOUND', null, '쓸 수 없는 초대 코드예요'],
    ['ALREADY_IN_LEDGER', null, '이미 다른 가계부에 참여하고 있어요'],
  ])('참여가 막히면(%s) 안내하고 시작 화면에 남는다', async (code, details, text) => {
    fake.joinLedger.mockRejectedValueOnce(rpcError(code, details));
    const user = userEvent.setup();
    renderAt('/start');
    await user.click(await screen.findByRole('button', { name: /초대코드 입력/ }));
    await user.type(screen.getByLabelText('초대 코드 8자리'), 'ABCD2345');
    await user.click(screen.getByRole('button', { name: '참여하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('heading', { level: 1, name: '가계부 시작하기' })).toBeInTheDocument();
  });

  it('초대 코드 형식이 틀리면 보내지 않고 안내한다', async () => {
    const user = userEvent.setup();
    renderAt('/start');
    await user.click(await screen.findByRole('button', { name: /초대코드 입력/ }));
    await user.type(screen.getByLabelText('초대 코드 8자리'), 'ABC');
    await user.click(screen.getByRole('button', { name: '참여하기' }));
    expect(screen.getByRole('alert')).toHaveTextContent('8자리');
    expect(fake.joinLedger).not.toHaveBeenCalled();
  });

  it('시작 화면에서 로그아웃할 수 있다', async () => {
    const user = userEvent.setup();
    renderAt('/start');
    await user.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument();
  });
});

describe('가계부를 불러오지 못한 상태', () => {
  it('오류를 보여 주고 다시 시도할 수 있다', async () => {
    fake.ledgerError = true;
    const user = userEvent.setup();
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('가계부를 불러오지 못했어요');

    fake.ledgerError = false;
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });
});

describe('로그인 상태 변화', () => {
  it('다른 곳에서 세션이 끊기면(만료 등) 로그인 화면으로 간다', async () => {
    renderAt('/ledger');
    expect(await screen.findByRole('heading', { level: 1, name: '가계부' })).toBeInTheDocument();
    act(() => fake.listener?.(null));
    expect(await screen.findByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument();
  });
});

describe('초대 링크 (/join/코드)', () => {
  beforeEach(() => {
    fake.ledgerId = null;
  });

  it('로그인 전이면 로그인 화면으로 가고, 로그인 후 참여 화면으로 이어진다', async () => {
    fake.initialUser = null;
    const user = userEvent.setup();
    renderAt('/join/abcd2345');
    expect(await screen.findByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument();

    act(() => fake.listener?.(USER)); // 구글 로그인 후 돌아옴
    expect(await screen.findByRole('heading', { name: '초대받은 가계부에 참여할까요?' })).toBeInTheDocument();
    expect(screen.getByText('ABCD2345')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '참여하기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
    expect(fake.joinLedger).toHaveBeenCalledWith('ABCD2345', '김반반');
    expect(localStorage.length).toBe(0); // 기억해 둔 코드는 지운다
  });

  it('3번째 사람은 상한 안내를 받고 참여되지 않는다', async () => {
    fake.joinLedger.mockRejectedValueOnce(rpcError('MEMBER_LIMIT_REACHED', '2'));
    const user = userEvent.setup();
    renderAt('/join/ABCD2345');
    await user.click(await screen.findByRole('button', { name: '참여하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('현재 최대 2명까지 참여할 수 있어요.');
    expect(screen.queryByRole('button', { name: '참여하기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '처음 화면으로' }));
    expect(await screen.findByRole('heading', { level: 1, name: '가계부 시작하기' })).toBeInTheDocument();
  });

  it('이미 다른 가계부에 참여한 사람은 안내 후 내 가계부로 갈 수 있다', async () => {
    fake.ledgerId = 'ledger-mine';
    fake.joinLedger.mockRejectedValueOnce(rpcError('ALREADY_IN_LEDGER'));
    const user = userEvent.setup();
    renderAt('/join/ABCD2345');
    await user.click(await screen.findByRole('button', { name: '참여하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 다른 가계부에 참여하고 있어요');
    await user.click(screen.getByRole('button', { name: '내 가계부로 가기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });

  it('네트워크 오류면 다시 시도할 수 있다', async () => {
    fake.joinLedger.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderAt('/join/ABCD2345');
    await user.click(await screen.findByRole('button', { name: '참여하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('참여하지 못했어요');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });

  it('형식이 틀린 코드는 무효 코드 안내만 보여 준다', async () => {
    renderAt('/join/XYZ');
    expect(await screen.findByRole('alert')).toHaveTextContent('쓸 수 없는 초대 코드예요');
    expect(screen.queryByRole('button', { name: '참여하기' })).not.toBeInTheDocument();
  });
});

describe('설정 > 가계부 이름', () => {
  it('설정에 현재 이름이 보이고, 바꿔 저장할 수 있다', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    const link = await screen.findByRole('link', { name: /가계부 이름/ });
    expect(await screen.findByText('우리집')).toBeInTheDocument();
    await user.click(link);
    const input = await screen.findByLabelText('가계부 이름');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled(); // 안 바꾸면 저장 안 됨
    await user.clear(input);
    await user.type(input, '반반네');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('status')).toHaveTextContent('저장했어요');
    expect(fake.renameLedger).toHaveBeenCalledWith('ledger-1', '반반네');
  });

  it('20자를 넘거나 비우면 저장하지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/name');
    const input = await screen.findByLabelText('가계부 이름');
    await user.clear(input);
    await user.type(input, '  ');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByRole('alert')).toHaveTextContent('가계부 이름을 입력해 주세요');
    expect(fake.renameLedger).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute('maxLength'); // 글자 수는 검사 함수로 판정 (이모지·앞뒤 공백)
  });

  it('이모지 15개 이름도 입력·저장된다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/name');
    const input = await screen.findByLabelText('가계부 이름');
    await user.clear(input);
    await user.type(input, '😀'.repeat(15));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('status')).toHaveTextContent('저장했어요');
    expect(fake.renameLedger).toHaveBeenCalledWith('ledger-1', '😀'.repeat(15));
  });

  it('앞뒤 공백 + 20자도 입력되고, 공백을 뺀 20자로 저장된다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/name');
    const input = await screen.findByLabelText('가계부 이름');
    await user.clear(input);
    await user.type(input, `  ${'가'.repeat(20)}  `);
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('status')).toHaveTextContent('저장했어요');
    expect(fake.renameLedger).toHaveBeenCalledWith('ledger-1', '가'.repeat(20));
  });

  it('21자는 저장하지 않고 안내한다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/name');
    const input = await screen.findByLabelText('가계부 이름');
    await user.clear(input);
    await user.type(input, '😀'.repeat(21));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByRole('alert')).toHaveTextContent('20자까지');
    expect(fake.renameLedger).not.toHaveBeenCalled();
  });

  it('저장에 실패하면 안내한다', async () => {
    fake.renameLedger.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderAt('/settings/name');
    const input = await screen.findByLabelText('가계부 이름');
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요');
  });
});

describe('설정 > 멤버·초대', () => {
  it('멤버 목록: 인원/상한, 나, 대표, 나간 사람 "(나감)"', async () => {
    fake.members = [
      member('m1', 'u1', '김반반', { role: 'owner' }),
      member('m0', 'u0', '예전사람', { left_at: '2026-11-01T00:00:00Z' }),
      member('m2', 'u2', '이반반'),
    ];
    renderAt('/settings/members');
    expect(await screen.findByRole('heading', { level: 2, name: /^멤버/ })).toHaveTextContent('2/2명');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['김반반나대표', '이반반', '예전사람 (나감)']);
    expect(screen.getByRole('note')).toHaveTextContent('현재 최대 2명까지 참여할 수 있어서');
  });

  it('초대 코드를 만들고 링크·코드를 복사할 수 있다', async () => {
    fake.issueInvite.mockImplementationOnce(async () => invite('ABCD2345'));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderAt('/settings/members');
    expect(await screen.findByText('아직 만든 초대 코드가 없어요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '초대 코드 만들기' }));

    expect(await screen.findByText('ABCD2345')).toBeInTheDocument();
    const link = `${window.location.origin}/join/ABCD2345`;
    expect(screen.getByText(link)).toBeInTheDocument();
    expect(screen.getByText(/까지 쓸 수 있어요/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(writeText).toHaveBeenLastCalledWith(link);
    expect(await screen.findByRole('status')).toHaveTextContent('링크를 복사했어요');
    await user.click(screen.getByRole('button', { name: '코드 복사' }));
    expect(writeText).toHaveBeenLastCalledWith('ABCD2345');
    expect(await screen.findByRole('status')).toHaveTextContent('코드를 복사했어요');
  });

  it('새로 발급은 확인 후 진행하고 새 코드로 바뀐다', async () => {
    fake.invite = invite('OLDC0DE2');
    fake.issueInvite.mockImplementationOnce(async () => invite('NEWC0DE3'));
    const user = userEvent.setup();
    renderAt('/settings/members');
    expect(await screen.findByText('OLDC0DE2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '새로 발급' }));
    expect(screen.getByText('새로 발급하면 지금 코드와 링크는 더 이상 쓸 수 없어요.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: '새로 발급 확인' })).getByRole('button', { name: '새로 발급' }));
    expect(await screen.findByText('NEWC0DE3')).toBeInTheDocument();
    expect(screen.queryByText('OLDC0DE2')).not.toBeInTheDocument();
  });

  it('만료된 초대는 보여 주지 않고 새로 만들게 한다', async () => {
    fake.invite = invite('OLDC0DE2', { expires_at: '2020-01-01T00:00:00Z' });
    renderAt('/settings/members');
    expect(await screen.findByText('초대 코드가 만료됐어요. 새로 만들어 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('OLDC0DE2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '초대 코드 만들기' })).toBeInTheDocument();
  });

  it('초대 코드를 만들지 못하면 안내한다', async () => {
    fake.issueInvite.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderAt('/settings/members');
    await user.click(await screen.findByRole('button', { name: '초대 코드 만들기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('초대 코드를 만들지 못했어요');
  });

  it('나가기는 확인 후 진행하고 시작 화면으로 간다 (마지막 멤버면 보관 안내)', async () => {
    const user = userEvent.setup();
    renderAt('/settings/members');
    await user.click(await screen.findByRole('button', { name: '가계부 나가기' }));
    expect(screen.getByText(/마지막 멤버라서 나가면 가계부가 보관되고/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: '나가기 확인' })).getByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '가계부 시작하기' })).toBeInTheDocument();
    expect(fake.leaveLedger).toHaveBeenCalledTimes(1);
  });

  it('나가기에 실패하면 안내하고 화면에 남는다', async () => {
    fake.members = [member('m1', 'u1', '김반반', { role: 'owner' }), member('m2', 'u2', '이반반')];
    fake.leaveLedger.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderAt('/settings/members');
    await user.click(await screen.findByRole('button', { name: '가계부 나가기' }));
    expect(screen.queryByText(/마지막 멤버라서/)).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: '나가기 확인' })).getByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('나가지 못했어요');
    expect(screen.getByRole('heading', { level: 1, name: '멤버·초대' })).toBeInTheDocument();
  });
});
