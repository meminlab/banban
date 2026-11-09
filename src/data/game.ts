/**
 * 같이 놀기 (BANB-49): 판·수 조회, 쓰기(DB 함수), 실시간 구독.
 * 쓰기는 모두 DB 함수(security definer)로만 한다 — 차례·빈칸·판 상태·멤버 확인과 승부 판정은 서버가 한다.
 * 실시간은 Supabase Realtime: Postgres Changes(수·판 상태, 구독자 RLS 적용) + Presence(자리 비움).
 * 끊겼다 다시 이어지면(SUBSCRIBED) onResync 로 서버 값을 다시 받아 맞춘다.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import type { Game, GameEndReason, GameMove, GameStatus } from './types';

const GAME_COLUMNS =
  'id, ledger_id, kind, black_id, white_id, status, winner_id, end_reason, move_count, created_by, rematch_of, created_at, invite_expires_at, started_at, last_move_at, finished_at';
const MOVE_COLUMNS = 'game_id, ledger_id, seq, x, y, member_id, created_at';

export type GameErrorCode =
  | 'NOT_IN_LEDGER'
  | 'GAME_NOT_FOUND'
  | 'GAME_BAD_OPPONENT'
  | 'GAME_ALREADY_OPEN'
  | 'GAME_OPPONENT_BUSY'
  | 'GAME_BAD_REMATCH'
  | 'GAME_NOT_INVITEE'
  | 'GAME_NOT_PLAYER'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_NOT_YOUR_TURN'
  | 'GAME_BAD_CELL'
  | 'GAME_CELL_TAKEN';

const CODES: GameErrorCode[] = [
  'NOT_IN_LEDGER',
  'GAME_NOT_FOUND',
  'GAME_BAD_OPPONENT',
  'GAME_ALREADY_OPEN',
  'GAME_OPPONENT_BUSY',
  'GAME_BAD_REMATCH',
  'GAME_NOT_INVITEE',
  'GAME_NOT_PLAYER',
  'GAME_NOT_ACTIVE',
  'GAME_NOT_YOUR_TURN',
  'GAME_BAD_CELL',
  'GAME_CELL_TAKEN',
];

/** 서버가 거부한 요청 (code 로 문구를 고른다). 네트워크 오류는 그대로 던진다 */
export class GameError extends Error {
  constructor(readonly code: GameErrorCode) {
    super(code);
    this.name = 'GameError';
  }
}

function rethrow(error: { message?: string }): never {
  const code = CODES.find((c) => error.message?.includes(c));
  if (code) throw new GameError(code);
  throw error;
}

/** 서버 함수 결과: applied = false 면 요청은 반영되지 않았고 status 가 지금 상태(만료·중단·이미 끝남 등) */
export interface GameResult {
  id: string;
  status: GameStatus;
  move_count: number;
  winner_id: string | null;
  end_reason: GameEndReason | null;
  applied: boolean;
  seq?: number;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) rethrow(error);
  return data as T;
}

/** 진행 중인 판(초대·대국) — 홈 카드·초대 배너·상대 고르기 */
export async function listOpenGames(ledgerId: string): Promise<Game[]> {
  const { data, error } = await getSupabase()
    .from('game')
    .select(GAME_COLUMNS)
    .eq('ledger_id', ledgerId)
    .in('status', ['invited', 'active'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Game[];
}

/** 끝난 판 (전적 계산). 최근 1000판까지 */
export async function listFinishedGames(ledgerId: string): Promise<Game[]> {
  const { data, error } = await getSupabase()
    .from('game')
    .select(GAME_COLUMNS)
    .eq('ledger_id', ledgerId)
    .eq('status', 'finished')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as Game[];
}

/** 판 하나 (다른 가계부 판이거나 없으면 null) */
export async function getGame(id: string): Promise<Game | null> {
  const { data, error } = await getSupabase().from('game').select(GAME_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Game | null) ?? null;
}

export async function listMoves(gameId: string): Promise<GameMove[]> {
  const { data, error } = await getSupabase().from('game_move').select(MOVE_COLUMNS).eq('game_id', gameId).order('seq');
  if (error) throw error;
  return (data ?? []) as GameMove[];
}

/** 오목 초대 (흑 = 초대받은 사람). rematchOf 를 주면 그 판의 흑백을 바꾼다("한 판 더"). 새 판 id */
export function inviteGame(ledgerId: string, opponentId: string, rematchOf?: string): Promise<string> {
  return rpc<string>('invite_game', {
    p_ledger_id: ledgerId,
    p_opponent: opponentId,
    p_kind: 'omok',
    p_rematch_of: rematchOf ?? null,
  });
}

/** 초대 수락 / 거절. 10분이 지났으면 applied = false, status = 'expired' */
export function respondGame(gameId: string, accept: boolean): Promise<GameResult> {
  return rpc<GameResult>('respond_game', { p_game_id: gameId, p_accept: accept });
}

/** 한 수 두기 (x = 열, y = 행, 0~14) */
export function playMove(gameId: string, x: number, y: number): Promise<GameResult> {
  return rpc<GameResult>('play_move', { p_game_id: gameId, p_x: x, p_y: y });
}

export function resignGame(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('resign_game', { p_game_id: gameId });
}

/** 지난 초대(10분)·멈춘 판(24시간)을 서버에서 닫는다 (상대 화면에도 반영) */
export function sweepGames(ledgerId: string): Promise<number> {
  return rpc<number>('sweep_games', { p_ledger_id: ledgerId });
}

type Unsubscribe = () => void;

function watchStatus(channel: RealtimeChannel, onResync: () => void, onTrack?: () => void) {
  channel.subscribe((status) => {
    // 처음 연결·다시 연결 모두 SUBSCRIBED → 그동안 놓친 변화를 서버 값으로 다시 맞춘다
    if (status === 'SUBSCRIBED') {
      onTrack?.();
      onResync();
    }
  });
}

/** 가계부의 판 변화 (초대 받음·수락·끝남) — 초대 배너·홈 카드 */
export function subscribeLedgerGames(
  ledgerId: string,
  handlers: { onGame: (game: Game) => void; onResync: () => void },
): Unsubscribe {
  const sb = getSupabase();
  const channel = sb
    .channel(`games:${ledgerId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game', filter: `ledger_id=eq.${ledgerId}` }, (p) => {
      if (p.new && 'id' in p.new) handlers.onGame(p.new as Game);
    });
  watchStatus(channel, handlers.onResync);
  return () => {
    void sb.removeChannel(channel);
  };
}

interface RoomHandlers {
  onMove: (move: GameMove) => void;
  onGame: (game: Game) => void;
  onPresence: (memberIds: string[]) => void;
  onResync: () => void;
}

interface Room {
  channel: RealtimeChannel;
  listeners: Set<RoomHandlers>;
  presence: string[];
  closeTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * 판마다 채널 1개를 같이 쓴다. Presence 는 채널 이름(판 id)으로 모이므로 이름을 바꿀 수 없고,
 * 채널 제거는 비동기라 화면이 곧바로 다시 그려질 때(React StrictMode 등) 닫히는 채널을 다시 받지 않게
 * 마지막 구독이 끝나면 잠깐 뒤에 닫는다
 */
const rooms = new Map<string, Room>();

/**
 * 한 판의 실시간: 새 수, 판 상태, 지금 이 판 화면을 보고 있는 멤버(Presence).
 * 같은 판 화면을 보는 사람끼리만 같은 이름의 채널에 모인다
 */
export function subscribeGameRoom(gameId: string, myMemberId: string, handlers: RoomHandlers): Unsubscribe {
  const key = `${gameId}:${myMemberId}`;
  let room = rooms.get(key);
  if (room) {
    if (room.closeTimer) clearTimeout(room.closeTimer);
    room.closeTimer = null;
    room.listeners.add(handlers);
    handlers.onPresence(room.presence);
    handlers.onResync();
  } else {
    const sb = getSupabase();
    const channel = sb.channel(`game:${gameId}`, { config: { presence: { key: myMemberId } } });
    const created: Room = { channel, listeners: new Set([handlers]), presence: [], closeTimer: null };
    room = created;
    rooms.set(key, created);
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_move', filter: `game_id=eq.${gameId}` }, (p) =>
        created.listeners.forEach((l) => l.onMove(p.new as GameMove)),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game', filter: `id=eq.${gameId}` }, (p) =>
        created.listeners.forEach((l) => l.onGame(p.new as Game)),
      )
      .on('presence', { event: 'sync' }, () => {
        created.presence = Object.keys(channel.presenceState());
        created.listeners.forEach((l) => l.onPresence(created.presence));
      });
    watchStatus(
      channel,
      () => created.listeners.forEach((l) => l.onResync()),
      () => void channel.track({ at: Date.now() }),
    );
  }
  const current = room;
  return () => {
    current.listeners.delete(handlers);
    if (current.listeners.size > 0) return;
    current.closeTimer = setTimeout(() => {
      rooms.delete(key);
      void getSupabase().removeChannel(current.channel);
    }, 1000);
  };
}
