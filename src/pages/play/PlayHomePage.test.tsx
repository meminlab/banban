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
vi.mock('../../data/game', () => ({ listFinishedGames: async () => [], inviteGame: async () => 'g1' }));

describe('게임 고르기 (BANB-51)', () => {
  it('게임 목록에 오목과 반반 쌓기("곧 만나요", 누를 수 없음)가 있다', () => {
    render(
      <MemoryRouter>
        <PlayHomePage />
      </MemoryRouter>,
    );
    const list = within(screen.getByRole('region', { name: '게임' })).getAllByRole('listitem');
    expect(list.map((li) => li.textContent)).toEqual(['오목다섯 개를 먼저 이으면 이겨요', '반반 쌓기곧 만나요']);
    expect(list[0]).not.toHaveAttribute('aria-disabled');
    expect(list[1]).toHaveAttribute('aria-disabled', 'true');
    expect(within(list[1]).queryByRole('link')).toBeNull();
    expect(within(list[1]).queryByRole('button')).toBeNull();
    // 기존 흐름(상대 고르기·초대)은 그대로
    expect(screen.getByRole('button', { name: /준호님 초대하기/ })).toBeEnabled();
  });
});
