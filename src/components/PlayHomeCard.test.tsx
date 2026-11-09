import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { GamesValue } from '../app/games';
import type { Game } from '../data/types';
import { PlayHomeCard } from './PlayInvite';

const NOW = new Date('2026-11-09T08:00:00Z');
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
vi.mock('../app/guards', () => ({ useLedgerId: () => 'ledger-1' }));
vi.mock('../app/games', () => ({
  useGames: () => games,
  useMemberName: () => (id: string) => games.members.find((m) => m.id === id)?.display_name ?? '상대',
  useNow: () => NOW,
}));

function game(patch: Partial<Game>): Game {
  return {
    id: 'g1',
    ledger_id: 'ledger-1',
    kind: 'omok',
    black_id: 'mB',
    white_id: 'mA',
    status: 'invited',
    winner_id: null,
    end_reason: null,
    move_count: 0,
    created_by: 'mA',
    rematch_of: null,
    created_at: '2026-11-09T07:55:00Z',
    invite_expires_at: '2026-11-09T08:05:00Z',
    started_at: null,
    last_move_at: null,
    finished_at: null,
    rule: 'free',
    turn_deadline: null,
    draw_offer_by: null,
    draw_offer_count: null,
    ...patch,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <PlayHomeCard />
    </MemoryRouter>,
  );
}

describe('홈 "같이 놀기" (design.md 5.32 줄이기)', () => {
  beforeEach(() => {
    games.open = [];
    games.members = games.members.slice(0, 2);
  });

  it('평소엔 한 줄: "같이 놀기 · 오목 · 반반 쌓기" → 미니게임 화면', () => {
    renderCard();
    const link = screen.getByRole('link', { name: '같이 놀기: 오목, 반반 쌓기' });
    expect(link).toHaveAttribute('href', '/play');
    expect(screen.getByTestId('play-card')).toHaveClass('play-row--home');
    expect(screen.queryByText(/오목 한 판 어때요/)).not.toBeInTheDocument();
    // 닫기 X 없음
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('초대 보냄이면 3줄 카드', () => {
    games.open = [game({})];
    renderCard();
    expect(screen.getByText('준호님 답을 기다리고 있어요')).toBeInTheDocument();
    expect(screen.getByTestId('play-card')).toHaveClass('play-card');
  });

  it('초대 받음이면 3줄 카드 + 버튼 2개', () => {
    games.open = [game({ created_by: 'mB', black_id: 'mA', white_id: 'mB' })];
    renderCard();
    expect(screen.getByText('준호님이 오목 한 판 하자고 해요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '좋아요' })).toBeInTheDocument();
  });

  it('대국 중이면 3줄 카드', () => {
    games.open = [game({ status: 'active', started_at: '2026-11-09T07:56:00Z', move_count: 4 })];
    renderCard();
    expect(screen.getByText('진행 중인 오목이 있어요 · 이어 두기')).toBeInTheDocument();
  });

  it('혼자 쓰는 가계부면 숨김', () => {
    games.members = games.members.slice(0, 1);
    renderCard();
    expect(screen.queryByTestId('play-card')).not.toBeInTheDocument();
  });
});
