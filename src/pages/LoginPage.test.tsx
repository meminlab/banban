import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { captureEntryUrl, resetEntryUrl } from '../app/entryUrl';
import { LoginPage, OPEN_EXTERNAL_FALLBACK_MS } from './LoginPage';

const fake = vi.hoisted(() => ({ signIn: vi.fn(async () => {}), copy: vi.fn(async (_t: string) => true) }));

vi.mock('../app/auth', () => ({ useAuth: () => ({ status: 'signedOut' }) }));
vi.mock('../data/auth', () => ({ signInWithGoogle: () => fake.signIn() }));
vi.mock('../app/clipboard', () => ({ copyText: (t: string) => fake.copy(t) }));

const KAKAO_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36;KAKAOTALK 2410940';
const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const ENTRY = 'https://banban.example/join/AB12CD?ref=kakao';

let hrefSet: string | null;
const realLocation = window.location;

function setUA(ua: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetEntryUrl();
  captureEntryUrl(ENTRY);
  fake.signIn.mockClear();
  fake.copy.mockReset();
  fake.copy.mockResolvedValue(true);
  hrefSet = null;
  // location.href 대입을 가로채 실제 이동 대신 기록만 한다
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...realLocation,
      get href() {
        return hrefSet ?? realLocation.href;
      },
      set href(v: string) {
        hrefSet = v;
      },
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('카카오톡 인앱 브라우저', () => {
  beforeEach(() => setUA(KAKAO_UA));

  it('안내와 다른 브라우저로 열기·링크 복사 버튼을 보이고 구글 버튼은 숨긴다', () => {
    renderLogin();
    expect(screen.getByText('카카오톡 안에서는 구글 로그인이 안 돼요. 다른 브라우저로 열어 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다른 브라우저로 열기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '링크 복사' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '구글 계정으로 로그인' })).not.toBeInTheDocument();
  });

  it('다른 브라우저로 열기: 처음 연 전체 주소(경로·쿼리)를 카카오 외부 열기 스킴으로 넘긴다', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: '다른 브라우저로 열기' }));
    expect(hrefSet).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(ENTRY)}`);
  });

  it('열기 후에도 화면이 그대로면 "안 열리면 복사" 안내를 띄운다', async () => {
    vi.useFakeTimers();
    renderLogin();
    expect(screen.queryByText('안 열리면 링크를 복사해 크롬에 붙여 넣어 주세요')).not.toBeInTheDocument();
    act(() => screen.getByRole('button', { name: '다른 브라우저로 열기' }).click());
    act(() => vi.advanceTimersByTime(OPEN_EXTERNAL_FALLBACK_MS));
    expect(screen.getByText('안 열리면 링크를 복사해 크롬에 붙여 넣어 주세요')).toBeInTheDocument();
    // 다시 시도할 수 있게 버튼은 남아 있다
    expect(screen.getByRole('button', { name: '다른 브라우저로 열기' })).toBeInTheDocument();
  });

  it('다른 브라우저가 열려 화면이 가려지면 안내를 띄우지 않는다', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderLogin();
    act(() => screen.getByRole('button', { name: '다른 브라우저로 열기' }).click());
    act(() => vi.advanceTimersByTime(OPEN_EXTERNAL_FALLBACK_MS));
    expect(screen.queryByText('안 열리면 링크를 복사해 크롬에 붙여 넣어 주세요')).not.toBeInTheDocument();
  });

  it('링크 복사: 처음 연 주소를 복사하고 "복사했어요"를 보인다', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(fake.copy).toHaveBeenCalledWith(ENTRY);
    expect(await screen.findByText(/복사했어요/)).toBeInTheDocument();
  });

  it('복사에 실패하면 주소를 직접 보여 주고 길게 눌러 복사하도록 안내한다', async () => {
    fake.copy.mockResolvedValue(false);
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('복사하지 못했어요');
    expect(screen.getByText(ENTRY)).toBeInTheDocument();
  });
});

describe('일반 브라우저 (회귀)', () => {
  beforeEach(() => setUA(CHROME_UA));

  it('지금처럼 구글 로그인 버튼만 보이고 카카오 안내는 없다', async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(screen.queryByText(/카카오톡 안에서는/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다른 브라우저로 열기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '구글 계정으로 로그인' }));
    expect(fake.signIn).toHaveBeenCalledTimes(1);
  });
});
