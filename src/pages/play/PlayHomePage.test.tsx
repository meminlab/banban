import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { GamesValue } from '../../app/games';
import { PlayHomePage } from './PlayHomePage';

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
vi.mock('../../app/games', () => ({
  useGames: () => games,
  useMemberName: () => (id: string) => games.members.find((m) => m.id === id)?.display_name ?? '상대',
  useNow: () => new Date('2026-11-09T08:00:00Z'),
}));
vi.mock('../../components/PlayInvite', () => ({ PlayInviteBanner: () => null, playErrorMessage: () => '' }));
let bests: { member_id: string; best_amount: number; best_lines: number }[] = [];
vi.mock('../../data/game', () => ({
  listFinishedGames: async () => [],
  listStackBests: async () => bests,
  inviteGame: async () => 'g1',
}));

describe('미니게임 화면 (BANB-52, design.md 5.32)', () => {
  beforeEach(() => {
    bests = [];
    localStorage.clear();
    games.members = games.members.slice(0, 2);
  });

  function renderPage() {
    render(
      <MemoryRouter>
        <PlayHomePage />
      </MemoryRouter>,
    );
  }

  it('제목 "미니게임", 둘이 같이: 오목 / 혼자서: 반반 쌓기(누르면 반반 쌓기 화면)', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '미니게임' })).toBeInTheDocument();
    // 순서: 둘이 같이(오목) → 누구랑 둘까요? → 초대하기 → 혼자서(반반 쌓기) → 진동 (상대 고르기가 반반 쌓기에 딸려 보이지 않게)
    const order = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(order).toEqual(['둘이 같이', '누구랑 둘까요?', '혼자서']);
    const duo = screen.getByRole('region', { name: '둘이 같이' });
    const solo = screen.getByRole('region', { name: '혼자서' });
    const send = screen.getByRole('button', { name: /준호님 초대하기/ });
    expect(send.compareDocumentPosition(solo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(solo.compareDocumentPosition(screen.getByRole('switch', { name: /진동/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(duo).getByText('다섯 개를 먼저 이으면 이겨요')).toBeInTheDocument();
    const stack = within(solo).getByRole('link', { name: /반반 쌓기/ });
    expect(stack).toHaveAttribute('href', '/play/stack');
    expect(stack).toHaveTextContent('동전을 쌓아 한 줄씩 저금해요');
    expect(screen.queryByText('곧 만나요')).not.toBeInTheDocument();
    // 따로 있던 전적 카드는 없다. 기존 흐름(상대 고르기·초대)은 그대로
    expect(screen.queryByRole('heading', { name: '전적' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /준호님 초대하기/ })).toBeEnabled();
  });

  it('반반 쌓기 행 보조 줄 = 내 최고 기록', async () => {
    bests = [
      { member_id: 'mA', best_amount: 28000, best_lines: 25 },
      { member_id: 'mB', best_amount: 32000, best_lines: 30 },
    ];
    renderPage();
    expect(await screen.findByText('28,000원')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /반반 쌓기/ })).toHaveTextContent('내 최고 28,000원');
  });

  it('진동 스위치: 기본 꺼짐, 켜면 이 기기에 저장', async () => {
    renderPage();
    const sw = screen.getByRole('switch', { name: /진동/ });
    expect(sw).not.toBeChecked();
    sw.click();
    expect(sw).toBeChecked();
    expect(localStorage.getItem('banban.game.vibrate')).toBe('1');
  });

  it('혼자 쓰는 가계부: 오목만 비활성 + "같이 쓰는 멤버가 있어야 해요", 반반 쌓기는 할 수 있다', () => {
    games.members = games.members.slice(0, 1);
    renderPage();
    expect(screen.getByText('같이 쓰는 멤버가 있어야 해요')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /반반 쌓기/ })).toBeInTheDocument();
  });
});
