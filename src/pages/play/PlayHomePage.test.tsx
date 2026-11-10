import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const inviteGame = vi.fn(async () => 'g1');
vi.mock('../../data/game', () => ({
  listFinishedGames: async () => [],
  listStackBests: async () => bests,
  inviteGame: (...args: unknown[]) => inviteGame(...(args as [])),
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

  it('제목 "미니게임", 둘이 같이: 오목 · 반반 쌓기 대전 / 혼자서: 반반 쌓기(누르면 반반 쌓기 화면)', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '미니게임' })).toBeInTheDocument();
    const order = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(order).toEqual(['둘이 같이', '혼자서']);
    const duo = screen.getByRole('region', { name: '둘이 같이' });
    const solo = screen.getByRole('region', { name: '혼자서' });
    expect(solo.compareDocumentPosition(screen.getByRole('switch', { name: /진동/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(duo).getByRole('button', { name: /오목/ })).toHaveTextContent('다섯 개를 먼저 이으면 이겨요');
    expect(within(duo).getByRole('button', { name: /반반 쌓기 대전/ })).toHaveTextContent('줄을 지워 영수증을 보내요');
    const stack = within(solo).getByRole('link', { name: /반반 쌓기/ });
    expect(stack).toHaveAttribute('href', '/play/stack');
    expect(stack).toHaveTextContent('동전을 쌓아 한 줄씩 지워요');
    expect(screen.queryByText('곧 만나요')).not.toBeInTheDocument();
    // 상대 고르기는 행을 눌렀을 때 시트로 (화면 안 라디오 없음)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '전적' })).not.toBeInTheDocument();
  });

  it('오목 행 → "누구랑 둘까요?" 시트, 상대 1명이면 미리 골라 둠 → 초대 (내기 없음)', async () => {
    inviteGame.mockClear();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /오목/ }));
    const sheet = screen.getByRole('dialog', { name: '누구랑 둘까요?' });
    expect(within(sheet).queryByLabelText(/내기 걸기/)).not.toBeInTheDocument();
    expect(within(sheet).getByText(/초대받은 사람이 흑으로 먼저 둬요/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /준호님 초대하기/ }));
    await waitFor(() => expect(inviteGame).toHaveBeenCalledWith('ledger-1', 'mB', undefined, { kind: 'omok', bet: null }));
  });

  it('반반 쌓기 대전 행 → "누구랑 할까요?" 시트 + 내기 걸기(30자까지, 글자 수) → 초대', async () => {
    inviteGame.mockClear();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /반반 쌓기 대전/ }));
    const sheet = screen.getByRole('dialog', { name: '누구랑 할까요?' });
    expect(await within(sheet).findByText('처음 하는 대전이에요')).toBeInTheDocument();
    expect(within(sheet).getByText(/줄을 지우면 상대 판에 영수증이 올라가요/)).toBeInTheDocument();
    const bet = within(sheet).getByLabelText(/내기 걸기/);
    expect(bet).toHaveAttribute('placeholder', '예: 진 사람이 설거지');
    fireEvent.change(bet, { target: { value: '가'.repeat(40) } });
    expect(bet).toHaveValue('가'.repeat(30));
    expect(within(sheet).getByText('30/30')).toBeInTheDocument();
    fireEvent.change(bet, { target: { value: '  진 사람이 설거지 ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: /준호님 초대하기/ }));
    await waitFor(() => expect(inviteGame).toHaveBeenCalledWith('ledger-1', 'mB', undefined, { kind: 'stack_vs', bet: '진 사람이 설거지' }));
  });

  it('반반 쌓기 행 보조 줄 = 내 최고 기록', async () => {
    bests = [
      { member_id: 'mA', best_amount: 280, best_lines: 25 },
      { member_id: 'mB', best_amount: 320, best_lines: 30 },
    ];
    renderPage();
    expect(await screen.findByText('280점')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /반반 쌓기/ })).toHaveTextContent('내 최고 280점');
  });

  it('진동 스위치: 기본 꺼짐, 켜면 이 기기에 저장', async () => {
    renderPage();
    const sw = screen.getByRole('switch', { name: /진동/ });
    expect(sw).not.toBeChecked();
    sw.click();
    expect(sw).toBeChecked();
    expect(localStorage.getItem('banban.game.vibrate')).toBe('1');
  });

  it('혼자 쓰는 가계부: 둘이 하는 게임만 비활성 + "같이 쓰는 멤버가 있어야 해요", 반반 쌓기는 할 수 있다', () => {
    games.members = games.members.slice(0, 1);
    renderPage();
    expect(screen.getAllByText('같이 쓰는 멤버가 있어야 해요')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /오목/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /반반 쌓기 대전/ })).toBeDisabled();
    expect(screen.getByRole('link', { name: /반반 쌓기/ })).toBeInTheDocument();
  });
});
