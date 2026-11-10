import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import type { GamesValue } from '../../app/games';
import { StackPage, cellSize } from './StackPage';

const games: GamesValue = {
  open: [],
  members: [
    { id: 'mA', ledger_id: 'ledger-1', user_id: 'u1', role: 'owner', display_name: '민지', joined_at: '2026-11-01', left_at: null },
    { id: 'mB', ledger_id: 'ledger-1', user_id: 'u2', role: 'member', display_name: '준호', joined_at: '2026-11-02', left_at: null },
  ],
  me: 'mA',
  ready: true,
  failed: false,
  refresh: () => undefined,
  upsert: () => undefined,
};
let bests: { member_id: string; best_amount: number; best_lines: number }[] = [];
const recordStackScore = vi.fn();
vi.mock('../../app/guards', () => ({ useLedgerId: () => 'ledger-1' }));
vi.mock('../../app/games', () => ({ useGames: () => games }));
vi.mock('../../data/game', () => ({
  listStackBests: async () => bests,
  recordStackScore: (...args: unknown[]) => recordStackScore(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/play', '/play/stack']} initialIndex={1}>
      <Routes>
        <Route path="/play" element={<p>미니게임 화면</p>} />
        <Route path="/play/stack" element={<StackPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 3초 세기를 지나 플레이 상태로 */
async function startPlaying() {
  fireEvent.click(screen.getByRole('button', { name: /시작하기/ }));
  expect(document.querySelector('.stack-count')).toHaveTextContent('3');
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
  expect(document.querySelector('.stack-count')).toBeNull();
}

const press = (name: string, times = 1) => {
  for (let i = 0; i < times; i++) fireEvent.pointerDown(screen.getByRole('button', { name }));
  fireEvent.pointerUp(screen.getByRole('button', { name }));
};

beforeEach(() => {
  bests = [];
  recordStackScore.mockReset();
  // 줄인 움직임 → 줄 지우기 연출 없이 바로 (테스트에서 시간 흐름 없이 확인)
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('칸 크기 (design.md 5.34)', () => {
  it('360×760 → 36, 360×640 → 27, 430×932 → 36, 아주 작으면 24', () => {
    expect(cellSize(360, 760)).toBe(36);
    expect(cellSize(360, 640)).toBe(27);
    expect(cellSize(430, 932)).toBe(36);
    expect(cellSize(320, 480)).toBe(24);
  });
});

describe('반반 쌓기 시작 화면', () => {
  it('내 최고 기록 + 멤버 최고 기록 1줄 + 이렇게 해요', async () => {
    bests = [
      { member_id: 'mA', best_amount: 280, best_lines: 25 },
      { member_id: 'mB', best_amount: 320, best_lines: 30 },
    ];
    renderPage();
    expect(await screen.findByText('280점')).toBeInTheDocument();
    expect(screen.getByText(/준호님 최고 기록/)).toHaveTextContent('준호님 최고 기록 320점이에요');
    expect(screen.getByText(/좌우로 밀거나/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /시작하기/ })).toBeInTheDocument();
  });

  it('기록이 없으면 "아직 기록이 없어요", 멤버도 없으면 비교 줄 숨김', async () => {
    renderPage();
    expect(await screen.findByText('아직 기록이 없어요')).toBeInTheDocument();
    expect(screen.queryByText(/최고 기록 .*이에요/)).not.toBeInTheDocument();
  });
});

describe('반반 쌓기 플레이', () => {
  it('3초 세기 → 버튼 4개 → 일시정지 시트(밖을 눌러도 안 닫힘) → 이어서 하기', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    renderPage();
    await startPlaying();
    const controls = screen.getByRole('group', { name: '조작' });
    expect(within(controls).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['왼쪽으로', '돌리기', '오른쪽으로', '바로 내리기']);
    expect(screen.getByRole('img', { name: '점수 0점, 지운 줄 0' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    const sheet = screen.getByRole('dialog', { name: '잠깐 쉬는 중이에요' });
    expect(sheet).toHaveTextContent('이어서 하면 3초 뒤에 다시 떨어져요');
    fireEvent.click(sheet.parentElement!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /이어서 하기/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.stack-count')).toHaveTextContent('3');
  });

  it('앱을 나가면 자동 일시정지 ("앱을 나가서 잠시 멈췄어요")', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    renderPage();
    await startPlaying();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByRole('dialog', { name: '앱을 나가서 잠시 멈췄어요' })).toBeInTheDocument();
  });

  it('한 줄을 채우면 10점 + "한 줄 지웠어요!", 그만하기 → 첫 기록 저장', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // 늘 0 → 조각 순서: 동전, 동전, 동전 둘, 동전, 동전, 동전 둘 … (같은 조각 3연속 막기)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    recordStackScore.mockResolvedValue({ previous_best: null, best_amount: 10, is_new: true });
    renderPage();
    await startPlaying();

    // 맨 아래 줄 8칸: x0 동전 · x1 동전 · x2~3 동전 둘 · x4 동전 · x5 동전 · x6~7 동전 둘
    press('왼쪽으로', 3);
    press('바로 내리기');
    press('왼쪽으로', 2);
    press('바로 내리기');
    press('왼쪽으로', 1);
    press('바로 내리기');
    press('오른쪽으로', 1);
    press('바로 내리기');
    press('오른쪽으로', 2);
    press('바로 내리기');
    press('오른쪽으로', 3);
    press('바로 내리기');

    expect(screen.getByText('한 줄 지웠어요!')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '점수 10점, 지운 줄 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    });
    const end = screen.getByRole('dialog', { name: '첫 기록이에요!' });
    expect(end).toHaveTextContent('10점');
    expect(end).toHaveTextContent('지운 줄 1 · 속도 1');
    expect(recordStackScore).toHaveBeenCalledTimes(1);
    expect(recordStackScore).toHaveBeenCalledWith('ledger-1', 10, 1);
  });

  it('0점으로 그만두면 기록하지 않고 "한 줄만 채워도 10점이에요"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    bests = [{ member_id: 'mB', best_amount: 320, best_lines: 30 }];
    renderPage();
    await act(async () => undefined);
    await startPlaying();
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    const end = screen.getByRole('dialog', { name: '여기까지 할게요' });
    expect(end).toHaveTextContent('한 줄만 채워도 10점이에요');
    expect(end).toHaveTextContent('준호님 최고 기록 320점이에요');
    expect(recordStackScore).not.toHaveBeenCalled();
  });

  it('기록 저장 실패면 토스트 "기록을 저장하지 못했어요", 시트는 그대로', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    recordStackScore.mockRejectedValue(new Error('network'));
    renderPage();
    await startPlaying();
    press('왼쪽으로', 3);
    press('바로 내리기');
    press('왼쪽으로', 2);
    press('바로 내리기');
    press('왼쪽으로', 1);
    press('바로 내리기');
    press('오른쪽으로', 1);
    press('바로 내리기');
    press('오른쪽으로', 2);
    press('바로 내리기');
    press('오른쪽으로', 3);
    press('바로 내리기');
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('기록을 저장하지 못했어요');
    expect(screen.getByRole('dialog', { name: '첫 기록이에요!' })).toBeInTheDocument();
  });
});
