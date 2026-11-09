import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

vi.mock('../app/guards', () => ({ useLedgerId: () => 'ledger-1' }));
vi.mock('../app/auth', () => ({ useCurrentUser: () => ({ id: 'u1' }) }));
vi.mock('../app/useProfile', () => ({ useMyProfile: () => ({ email: 'me@example.com' }) }));
vi.mock('../app/useSignOut', () => ({ useSignOut: () => ({ run: () => undefined, busy: false, error: false }) }));
vi.mock('../app/theme', () => ({ useTheme: () => ({ theme: 'clean' }) }));
vi.mock('../data/ledger', () => ({
  getLedger: async (id: string) => ({ id, name: '우리집', member_limit: 2, created_by: 'u1', created_at: '', together_since: null }),
  setTogetherSince: async () => undefined,
}));
vi.mock('../data/member', () => ({ getMyMemberName: async () => '김' }));

describe('설정 › 미니게임 (BANB-51 → BANB-52 묶음 ②)', () => {
  it('묶음 ②(가계부 관리 · 화면 테마 · 미니게임)에 "미니게임" 줄이 있고, 누르면 미니게임 화면(/play)으로 간다', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/play" element={<p>게임 고르기 화면</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const myNav = screen.getByRole('navigation', { name: '내 설정' });
    const row = screen.getByRole('link', { name: '미니게임' });
    expect(myNav).toContainElement(row);
    expect(screen.getByRole('navigation', { name: '지금 보는 가계부 설정' })).not.toContainElement(row);
    expect(row).toHaveAttribute('href', '/play');
    await userEvent.click(row);
    expect(screen.getByText('게임 고르기 화면')).toBeInTheDocument();
  });
});
