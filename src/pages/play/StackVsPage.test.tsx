import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import type { GamesValue } from '../../app/games';
import type { Game, StackGarbage } from '../../data/types';
import { StackVsPage, vsCellSize } from './StackVsPage';

const NOW = new Date('2026-11-10T01:00:00Z');
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

let current: Game;
let garbageRows: StackGarbage[] = [];
type Handlers = {
  onGarbage: (row: StackGarbage) => void;
  onPresence: (ids: string[]) => void;
  onEmoji: (member: string, index: number) => void;
  onGame: (g: Game) => void;
};
let handlers: Handlers | null = null;
const room = { stop: vi.fn(), sendPreview: vi.fn(), sendEmoji: vi.fn(), setHere: vi.fn() };
const stackVsSave = vi.fn();
const stackVsEnd = vi.fn();

vi.mock('../../app/guards', () => ({ useLedgerId: () => 'ledger-1' }));
vi.mock('../../app/games', () => ({
  useGames: () => games,
  useMemberName: () => (id: string) => games.members.find((m) => m.id === id)?.display_name ?? '상대',
  useNow: () => NOW,
}));
vi.mock('../../data/game', () => ({
  GameError: class GameError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  getGame: async () => current,
  getServerNow: async () => NOW.getTime(),
  listStackBoards: async () => [],
  listStackGarbage: async () => garbageRows,
  listFinishedGames: async () => (current.status === 'finished' ? [current] : []),
  stackVsSave: (...a: unknown[]) => stackVsSave(...a),
  stackVsSend: async () => ({ status: 'active', applied: true, seq: 1, lines: 1, hole: 0 }),
  stackVsEnd: (...a: unknown[]) => stackVsEnd(...a),
  stackVsClaimDisconnect: async () => ({ status: 'active', applied: false }),
  sweepGames: async () => 0,
  subscribeStackVsRoom: (_id: string, _me: string, h: Handlers) => {
    handlers = h;
    return room;
  },
}));

function game(patch: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    ledger_id: 'ledger-1',
    kind: 'stack_vs',
    bet: null,
    seed: 12345,
    black_id: 'mB',
    white_id: 'mA',
    status: 'active',
    winner_id: null,
    end_reason: null,
    move_count: 0,
    created_by: 'mA',
    rematch_of: null,
    created_at: '2026-11-10T00:58:00Z',
    invite_expires_at: '2026-11-10T01:08:00Z',
    started_at: '2026-11-10T00:59:50Z',
    last_move_at: null,
    finished_at: null,
    rule: 'stack_vs',
    turn_deadline: null,
    draw_offer_by: null,
    draw_offer_count: null,
    ...patch,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/play', '/play/stack-vs/g1']} initialIndex={1}>
      <Routes>
        <Route path="/play" element={<p>미니게임 화면</p>} />
        <Route path="/play/stack-vs/:gameId" element={<StackVsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  garbageRows = [];
  handlers = null;
  stackVsSave.mockReset();
  stackVsSave.mockResolvedValue({ status: 'active', applied: true, server_now: NOW.toISOString(), opp_seen_at: NOW.toISOString() });
  stackVsEnd.mockReset();
  stackVsEnd.mockResolvedValue({ status: 'finished', applied: true, winner_id: 'mB', end_reason: 'quit' });
  room.sendPreview.mockReset();
  room.sendEmoji.mockReset();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('칸 크기 (design.md 5.37)', () => {
  it('360×760 → 35, 360×640 → 26, 430×932 → 36', () => {
    expect(vsCellSize(360, 760)).toBe(35);
    expect(vsCellSize(360, 640)).toBe(26);
    expect(vsCellSize(430, 932)).toBe(36);
  });
});

describe('반반 쌓기 대전 화면 (BANB-55)', () => {
  it('대전: 상대 칸 · 3초 세기 + "같은 조각이 같은 순서로 나와요" · 처음 바로 저장', async () => {
    current = game();
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: '반반 쌓기 대전' })).toBeInTheDocument();
    expect(screen.getByText('준호')).toBeInTheDocument();
    expect(screen.getByText('같은 조각이 같은 순서로 나와요')).toBeInTheDocument();
    expect(document.querySelector('.stack-count')).toHaveTextContent('3');
    expect(screen.getByRole('img', { name: '내 판, 지운 줄 0, 받을 영수증 0장' })).toBeInTheDocument();
    await waitFor(() => expect(stackVsSave).toHaveBeenCalled());
    const [id, snap, lines] = stackVsSave.mock.calls[0];
    expect(id).toBe('g1');
    expect(snap).toMatchObject({ v: 1, lines: 0, sendSeq: 0, received: 0 });
    expect(lines).toBe(0);
  });

  it('상대가 보낸 영수증: 받을 막대에 쌓이고 알약 "준호님이 영수증 2장을 보냈어요"', async () => {
    current = game();
    renderPage();
    await screen.findByRole('img', { name: /내 판/ });
    act(() => handlers!.onGarbage({ game_id: 'g1', ledger_id: 'ledger-1', from_member: 'mB', seq: 1, cleared: 3, lines: 2, hole: 4, created_at: NOW.toISOString() }));
    expect(screen.getByRole('img', { name: '내 판, 지운 줄 0, 받을 영수증 2장' })).toBeInTheDocument();
    expect(screen.getByText('준호님이 영수증 2장을 보냈어요', { selector: '.vs-pill' })).toBeInTheDocument();
    // 같은 순번이 다시 와도 한 번만
    act(() => handlers!.onGarbage({ game_id: 'g1', ledger_id: 'ledger-1', from_member: 'mB', seq: 1, cleared: 3, lines: 2, hole: 4, created_at: NOW.toISOString() }));
    expect(screen.getByRole('img', { name: '내 판, 지운 줄 0, 받을 영수증 2장' })).toBeInTheDocument();
  });

  it('그만하기 = 확인 창 → 패 (stack_vs_end quit)', async () => {
    current = game();
    renderPage();
    await screen.findByRole('img', { name: /내 판/ });
    fireEvent.click(screen.getByRole('button', { name: /그만하기/ }));
    const dialog = screen.getByRole('alertdialog', { name: '그만할까요?' });
    expect(dialog).toHaveTextContent('지금 그만하면 이번 판은 준호님이 이겨요. 전적에도 남아요.');
    fireEvent.click(within(dialog).getByRole('button', { name: '그만하기' }));
    await waitFor(() => expect(stackVsEnd).toHaveBeenCalledWith('g1', 'quit'));
    expect(await screen.findByRole('dialog', { name: '그만했어요' })).toHaveTextContent('다음엔 끝까지 해 봐요');
  });

  it('상대가 화면에서 빠지면 2초 뒤 내 판도 멈추고 "준호님 연결이 잠깐 끊겼어요" + 30초', async () => {
    current = game();
    renderPage();
    await screen.findByRole('img', { name: /내 판/ });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    act(() => handlers!.onPresence(['mA', 'mB']));
    act(() => handlers!.onPresence(['mA']));
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    const card = screen.getByRole('alert');
    expect(card).toHaveTextContent('준호님 연결이 잠깐 끊겼어요');
    expect(card).toHaveTextContent('30초 안에 돌아오면 이어서 해요');
    expect(card).toHaveTextContent('못 돌아오면 민지님이 이겨요');
  });

  it('이모지: 고르면 보내고 3초 동안 다시 못 보냄, 받은 이모지는 말풍선', async () => {
    current = game();
    renderPage();
    await screen.findByRole('img', { name: /내 판/ });
    fireEvent.click(screen.getByRole('button', { name: '반응 보내기' }));
    fireEvent.click(within(screen.getByRole('group', { name: '반응 고르기' })).getByRole('button', { name: '웃겨요' }));
    expect(room.sendEmoji).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: /잠시 뒤에 다시/ })).toHaveAttribute('aria-disabled', 'true');
    act(() => handlers!.onEmoji('mB', 5));
    expect(document.querySelector('.vs-bubble')).toHaveTextContent('❤️');
  });

  it('결과: 이김 + 내기 "준호님 당첨이에요!" + 지운 줄·보낸 영수증 + 전적', async () => {
    current = game({ status: 'finished', winner_id: 'mA', end_reason: 'topout', bet: '진 사람이 설거지', finished_at: NOW.toISOString() });
    renderPage();
    const sheet = await screen.findByRole('dialog', { name: '이겼어요!' });
    expect(sheet).toHaveTextContent('준호님 판이 먼저 꽉 찼어요');
    expect(sheet).toHaveTextContent('진 사람이 설거지');
    expect(sheet).toHaveTextContent('준호님 당첨이에요!');
    expect(sheet).toHaveTextContent('지운 줄0');
    expect(sheet).toHaveTextContent('보낸 영수증0');
    expect(await within(sheet).findByText(/1승 0패/)).toBeInTheDocument();
    // 끝난 판에서는 반응·그만하기를 숨긴다
    expect(screen.queryByRole('button', { name: '반응 보내기' })).not.toBeInTheDocument();
  });

  it('다른 가계부·오목 판은 볼 수 없어요', async () => {
    current = game({ kind: 'omok', rule: 'renju_lite', seed: null });
    renderPage();
    expect(await screen.findByText('이 판은 볼 수 없어요')).toBeInTheDocument();
  });
});
