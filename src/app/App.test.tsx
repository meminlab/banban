import { act, render, screen } from '@testing-library/react';
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

beforeEach(() => {
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

  it.each(['/', '/ledger', '/assets', '/settings'])('%s 로 들어오면 가계부 시작 화면으로 간다', async (path) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: '가계부 시작하기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /가계부 만들기/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /초대코드 입력/ })).toBeDisabled();
    expect(await screen.findByText('김반반님, 반가워요')).toBeInTheDocument();
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
