/** BANB-29 화면 테마: 첫 그리기 스크립트 · 설정 행 · 테마 고르기(즉시 적용·저장·실패 되돌림) · 서버 값 맞추기 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import html from '../../index.html?raw';
import { DEVICE_THEME_KEY } from '../data/theme';
import { DARK_THEME_COLOR, type ThemeName } from '../domain/theme';
import { App } from './App';
import { AuthProvider } from './auth';

const fake = vi.hoisted(() => ({
  listener: null as ((u: unknown) => void) | null,
  user: { id: 'u1', email: 'a@example.com', name: 'A', avatarUrl: null } as unknown,
  /** 사람별 서버 테마 */
  server: {} as Record<string, string>,
  /** 서버 응답을 직접 풀어 주고 싶을 때 */
  holdGet: null as null | ((t: string) => void),
  saveCalls: [] as string[],
  saveFail: false,
  /** true 면 저장 응답을 test 가 하나씩 풀어 줄 때까지 붙잡는다 */
  gated: false,
  pending: [] as Array<() => void>,
}));

vi.mock('../data/auth', () => ({
  AUTH_CALLBACK_PATH: '/login',
  onAuthChange: (cb: (u: unknown) => void) => {
    fake.listener = cb;
    queueMicrotask(() => cb(fake.user));
    return () => {
      fake.listener = null;
    };
  },
  signInWithGoogle: async () => {},
  signOut: async () => fake.listener?.(null),
}));
vi.mock('../data/ledger', () => ({
  listMyLedgers: async () => [{ id: 'L', name: '우리집', memberCount: 2, joinedAt: '2026-11-01T00:00:00Z' }],
  getLastLedgerId: async () => 'L',
  rememberLedger: async () => {},
  getLedger: async () => ({ id: 'L', name: '우리집', member_limit: 2, created_by: 'u', created_at: '' }),
}));
vi.mock('../data/profile', () => ({ getProfile: async () => null }));
vi.mock('../data/theme', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/theme')>();
  return {
    ...real, // 기기 값(localStorage)은 진짜를 쓴다
    getMyTheme: vi.fn(
      (userId: string) =>
        new Promise((resolve) => {
          const value = fake.server[userId] ?? 'clean';
          if (fake.holdGet) fake.holdGet = (t) => resolve(t);
          else resolve(value);
        }),
    ),
    saveMyTheme: vi.fn(async (t: string) => {
      fake.saveCalls.push(t);
      if (fake.gated) await new Promise<void>((resolve) => fake.pending.push(resolve));
      if (fake.saveFail) throw new Error('network');
    }),
  };
});

const root = () => document.documentElement;
const darkMeta = () => document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');

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
  localStorage.clear();
  root().removeAttribute('data-theme');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('media', '(prefers-color-scheme: dark)');
  meta.setAttribute('content', '#161E1B');
  document.head.append(meta);
  fake.user = { id: 'u1', email: 'a@example.com', name: 'A', avatarUrl: null };
  fake.server = {};
  fake.holdGet = null;
  fake.saveCalls = [];
  fake.saveFail = false;
  fake.gated = false;
  fake.pending = [];
});

describe('index.html 첫 그리기 스크립트', () => {
  const script = html.match(/<script id="theme-boot">([\s\S]*?)<\/script>/)?.[1] ?? '';
  const boot = () => new Function(script)();

  it('기기 값·다크 색·키가 앱 코드와 같다', () => {
    expect(script).toContain(`'${DEVICE_THEME_KEY}'`);
    const map = script.match(/var dark = (\{[^}]+\})/)?.[1];
    expect(new Function(`return ${map}`)()).toEqual(DARK_THEME_COLOR);
    // 모듈 스크립트(앱)보다 먼저, head 안에서 실행된다
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf('type="module"'));
  });

  it.each(['clean', 'berry', 'cozy'] as ThemeName[])('기기 값 %s → data-theme·다크 theme-color', (t) => {
    localStorage.setItem(DEVICE_THEME_KEY, t);
    boot();
    expect(root().getAttribute('data-theme')).toBe(t);
    expect(darkMeta()?.getAttribute('content')).toBe(DARK_THEME_COLOR[t]);
  });

  it.each([null, 'neon', '', '{}', 'Cozy', 'toString', '__proto__'])('기기 값 %s → clean', (v) => {
    if (v !== null) localStorage.setItem(DEVICE_THEME_KEY, v);
    boot();
    expect(root().getAttribute('data-theme')).toBe('clean');
    expect(darkMeta()?.getAttribute('content')).toBe('#161E1B');
  });

  it('localStorage 를 못 써도 멈추지 않고 clean', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(boot).not.toThrow();
    expect(root().getAttribute('data-theme')).toBe('clean');
    spy.mockRestore();
  });
});

describe('설정 › 화면 테마', () => {
  it('설정의 "내 설정" 묶음에 현재 테마 이름이 보인다', async () => {
    localStorage.setItem(DEVICE_THEME_KEY, 'berry');
    fake.server.u1 = 'berry';
    renderAt('/settings');
    const nav = await screen.findByRole('navigation', { name: '내 설정' });
    const row = within(nav).getByRole('link', { name: /화면 테마/ });
    expect(row).toHaveAttribute('href', '/settings/theme');
    expect(row).toHaveTextContent('베리');
  });

  it('카드 3장 라디오 그룹, 현재 테마만 선택됨', async () => {
    renderAt('/settings/theme');
    const group = await screen.findByRole('radiogroup', { name: '화면 테마' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['클린기본깔끔한 흰 화면', '베리차분한 무채색 화면', '포근둘이 쓰는 따뜻한 화면']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('누르면 바로 앱 전체 적용 + 기기 저장 + 서버 저장 + 토스트', async () => {
    const user = userEvent.setup();
    renderAt('/settings/theme');
    await user.click(await screen.findByRole('radio', { name: /베리/ }));
    expect(root().getAttribute('data-theme')).toBe('berry');
    expect(darkMeta()?.getAttribute('content')).toBe('#1F1A22');
    expect(localStorage.getItem(DEVICE_THEME_KEY)).toBe('berry');
    expect(fake.saveCalls).toEqual(['berry']);
    expect(await screen.findByRole('status')).toHaveTextContent('테마를 바꿨어요');
    expect(screen.getByRole('radio', { name: /베리/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /클린/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('이미 고른 테마를 다시 누르면 아무 일도 없다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/theme');
    await user.click(await screen.findByRole('radio', { name: /클린/ }));
    expect(fake.saveCalls).toEqual([]);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('저장 실패 → 이전 테마로 되돌리고 오류 토스트, 기기 값도 이전 값', async () => {
    const user = userEvent.setup();
    localStorage.setItem(DEVICE_THEME_KEY, 'cozy');
    fake.server.u1 = 'cozy';
    renderAt('/settings/theme');
    await waitFor(() => expect(screen.getByRole('radio', { name: /포근/ })).toHaveAttribute('aria-checked', 'true'));
    fake.saveFail = true;
    await user.click(screen.getByRole('radio', { name: /베리/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('테마를 저장하지 못했어요. 다시 시도해 주세요');
    expect(root().getAttribute('data-theme')).toBe('cozy');
    expect(darkMeta()?.getAttribute('content')).toBe('#261C18');
    expect(localStorage.getItem(DEVICE_THEME_KEY)).toBe('cozy');
    expect(screen.getByRole('radio', { name: /포근/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('빠르게 연타해도 서버에는 고른 순서대로 저장되고 마지막 선택이 남는다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/theme');
    await screen.findByRole('radiogroup');
    await act(async () => {}); // 서버 값 받기 끝
    fake.gated = true; // 저장 응답을 하나씩 풀어 준다
    await user.click(screen.getByRole('radio', { name: /베리/ }));
    await user.click(screen.getByRole('radio', { name: /포근/ }));
    await user.click(screen.getByRole('radio', { name: /클린/ }));
    // 앞 저장이 끝나기 전에는 다음 저장을 보내지 않는다
    expect(fake.saveCalls).toEqual(['berry']);
    expect(root().getAttribute('data-theme')).toBe('clean');
    while (fake.pending.length) await act(async () => fake.pending.shift()!());
    await waitFor(() => expect(fake.saveCalls).toEqual(['berry', 'cozy', 'clean']));
    expect(await screen.findByRole('status')).toHaveTextContent('테마를 바꿨어요');
    expect(root().getAttribute('data-theme')).toBe('clean');
    expect(localStorage.getItem(DEVICE_THEME_KEY)).toBe('clean');
  });

  it('화살표 키로 옮기면 그 테마를 고른다', async () => {
    const user = userEvent.setup();
    renderAt('/settings/theme');
    const clean = await screen.findByRole('radio', { name: /클린/ });
    clean.focus();
    await user.keyboard('{ArrowDown}');
    expect(root().getAttribute('data-theme')).toBe('berry');
    expect(screen.getByRole('radio', { name: /베리/ })).toHaveFocus();
  });
});

describe('서버 값 맞추기', () => {
  it('로그인 후 서버 값이 오면 서버 값으로 바꾸고 기기 값도 갱신', async () => {
    localStorage.setItem(DEVICE_THEME_KEY, 'cozy');
    fake.server.u1 = 'berry';
    renderAt('/settings/theme');
    await waitFor(() => expect(root().getAttribute('data-theme')).toBe('berry'));
    expect(localStorage.getItem(DEVICE_THEME_KEY)).toBe('berry');
    expect(screen.getByRole('radio', { name: /베리/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('서버 값을 받기 전에 직접 고르면 늦게 온 서버 값이 덮지 않는다', async () => {
    const user = userEvent.setup();
    fake.holdGet = () => {};
    renderAt('/settings/theme');
    await user.click(await screen.findByRole('radio', { name: /포근/ }));
    await act(async () => fake.holdGet?.('berry'));
    expect(root().getAttribute('data-theme')).toBe('cozy');
    expect(localStorage.getItem(DEVICE_THEME_KEY)).toBe('cozy');
  });

  it('로그아웃해도 테마·기기 값은 남고, 다른 사람이 로그인하면 그 사람 값으로 바뀐다', async () => {
    fake.server = { u1: 'cozy', u2: 'clean' };
    renderAt('/settings/theme');
    await waitFor(() => expect(root().getAttribute('data-theme')).toBe('cozy'));
    await act(async () => fake.listener?.(null));
    await screen.findByRole('button', { name: /구글/ });
    expect(root().getAttribute('data-theme')).toBe('cozy');
    expect(localStorage.getItem(DEVICE_THEME_KEY)).toBe('cozy');
    await act(async () => fake.listener?.({ id: 'u2', email: 'b@example.com', name: 'B', avatarUrl: null }));
    await waitFor(() => expect(root().getAttribute('data-theme')).toBe('clean'));
    expect(localStorage.getItem(DEVICE_THEME_KEY)).toBe('clean');
  });
});
