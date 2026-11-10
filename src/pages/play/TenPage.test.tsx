import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { GamesValue } from '../../app/games';
import { TenPage } from './TenPage';

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
vi.mock('../../app/guards', () => ({ useLedgerId: () => 'ledger-1' }));
vi.mock('../../app/games', () => ({ useGames: () => games }));
let tenBests: { member_id: string; best_score: number }[] = [];
const recordTenScore = vi.fn(async (_l: string, _seed: number, drags: unknown[]) => ({
  score: drags.length * 2,
  previous_best: 3,
  best_score: Math.max(3, drags.length * 2),
  is_new: drags.length * 2 > 3,
}));
vi.mock('../../data/game', () => ({
  listTenBests: async () => tenBests,
  recordTenScore: (...args: unknown[]) => recordTenScore(...(args as [string, number, unknown[]])),
}));

/** randomSeed → 12345 (첫 줄 2 2 8 2 7 8 9 1 … — domain/ten.test.ts BOARD_12345) */
const SEED_RAND = 12345.5 / 2147483646;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/play/ten']}>
      <TenPage />
    </MemoryRouter>,
  );
}

describe('도토리 열 알 1인 (BANB-57, design.md 5.41~5.43)', () => {
  beforeEach(() => {
    tenBests = [{ member_id: 'mB', best_score: 33 }];
    recordTenScore.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('시작 화면: 그림 문구 · 기록 카드(멤버 비교) · 이렇게 해요 3줄 · 시작하기', async () => {
    setViewport(390, 844);
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '도토리 열 알' })).toBeInTheDocument();
    expect(screen.getByText('숫자 도토리를 네모로 묶어 합 10을 만들어요')).toBeInTheDocument();
    expect(await screen.findByText('아직 기록이 없어요')).toBeInTheDocument();
    expect(screen.getByText(/준호님 최고 기록/)).toHaveTextContent('준호님 최고 기록 33점이에요');
    expect(screen.getByText('손가락으로 끌어 네모를 그려요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /시작하기/ })).toBeInTheDocument();
  });

  it('세로에서 시작하면 "가로로 돌려 주세요"(회전 잠금 안내 + 나가기) → 나가기 = 시작 화면', async () => {
    setViewport(390, 844);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /시작하기/ }));
    expect(screen.getByRole('heading', { name: '가로로 돌려 주세요' })).toBeInTheDocument();
    expect(screen.getByText(/화면 회전 잠금/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(screen.getByRole('button', { name: /시작하기/ })).toBeInTheDocument();
  });

  it('가로: 3·2·1 → 끌어서 합 10이면 터지고 점수 +2 → 120초 뒤 서버에 순서 값 + 드래그 기록을 보내 결과 카드', async () => {
    setViewport(1024, 600); // 칸 = min((1024 − 72) / 15, (600 − 64) / 8) = 63 → 48
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(SEED_RAND);
    renderPage();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: /시작하기/ }));
    expect(document.querySelector('.ten-count')).toHaveTextContent('3');
    // 3·2·1 (1초마다 다음 타이머가 걸린다)
    for (let i = 0; i < 4; i++)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    expect(document.querySelector('.ten-count')).toBeNull();
    const board = screen.getByRole('img', { name: /점수 0점, 남은 시간 1분 5\d초/ });
    const s = 48;
    // (1,0) ~ (2,0) = 2 + 8 = 10
    fireEvent.pointerDown(board, { pointerId: 1, clientX: 1 * s + 5, clientY: 5 });
    fireEvent.pointerMove(board, { pointerId: 1, clientX: 2 * s + 5, clientY: 5 });
    expect(screen.getByText('10 ✓')).toBeInTheDocument();
    fireEvent.pointerUp(board, { pointerId: 1, clientX: 2 * s + 5, clientY: 5 });
    expect(screen.getByRole('img', { name: /점수 2점/ })).toBeInTheDocument();
    expect(screen.getAllByText('열 알 모았어요!').length).toBeGreaterThan(0);
    // 합 ≠ 10: 아무 일 없음
    fireEvent.pointerDown(board, { pointerId: 2, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(board, { pointerId: 2, clientX: 3 * s + 5, clientY: 5 });
    expect(screen.getByText('합 4')).toBeInTheDocument();
    fireEvent.pointerUp(board, { pointerId: 2, clientX: 3 * s + 5, clientY: 5 });
    expect(screen.getByRole('img', { name: /점수 2점/ })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(120_500);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(recordTenScore).toHaveBeenCalledWith('ledger-1', 12345, [[1, 0, 2, 0]]);
    expect(screen.getByRole('dialog', { name: /끝났어요|새 최고 기록이에요!|첫 기록이에요!/ })).toBeInTheDocument();
  });
});
