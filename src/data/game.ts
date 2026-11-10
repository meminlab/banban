/**
 * 같이 놀기 (BANB-49): 판·수 조회, 쓰기(DB 함수), 실시간 구독.
 * 쓰기는 모두 DB 함수(security definer)로만 한다 — 차례·빈칸·판 상태·멤버 확인과 승부 판정은 서버가 한다.
 * 실시간은 Supabase Realtime: Postgres Changes(수·판 상태, 구독자 RLS 적용) + Presence(자리 비움).
 * 끊겼다 다시 이어지면(SUBSCRIBED) onResync 로 서버 값을 다시 받아 맞춘다.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import type { Drag, TenBest } from '../domain/ten';
import type { Game, GameEndReason, GameKind, GameMove, GameRule, GameStatus, StackBest, StackBoardRow, StackGarbage, TenBoardRow } from './types';

const GAME_COLUMNS =
  'id, ledger_id, kind, black_id, white_id, status, winner_id, end_reason, move_count, created_by, rematch_of, created_at, invite_expires_at, started_at, last_move_at, finished_at, rule, turn_deadline, draw_offer_by, draw_offer_count, bet, seed';
const MOVE_COLUMNS = 'game_id, ledger_id, seq, x, y, member_id, created_at';

export type GameErrorCode =
  | 'NOT_IN_LEDGER'
  | 'GAME_NOT_FOUND'
  | 'GAME_BAD_OPPONENT'
  | 'GAME_ALREADY_OPEN'
  | 'GAME_OPPONENT_BUSY'
  | 'GAME_BAD_REMATCH'
  | 'GAME_NOT_INVITEE'
  | 'GAME_NOT_INVITER'
  | 'GAME_NOT_PLAYER'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_NOT_YOUR_TURN'
  | 'GAME_BAD_CELL'
  | 'GAME_CELL_TAKEN'
  | 'GAME_FORBIDDEN_33'
  | 'GAME_NOT_TIMED_OUT'
  | 'GAME_DRAW_PENDING'
  | 'GAME_DRAW_TOO_SOON'
  | 'GAME_NOT_DRAW_TARGET'
  | 'STACK_BAD_SCORE'
  | 'GAME_BAD_KIND'
  | 'GAME_BAD_BET'
  | 'STACK_BAD_STATE'
  | 'STACK_BAD_CLEAR'
  | 'STACK_BAD_SEQ'
  | 'STACK_BAD_REASON'
  | 'TEN_BAD_SEED'
  | 'TEN_BAD_DRAGS';

const CODES: GameErrorCode[] = [
  'NOT_IN_LEDGER',
  'GAME_NOT_FOUND',
  'GAME_BAD_OPPONENT',
  'GAME_ALREADY_OPEN',
  'GAME_OPPONENT_BUSY',
  'GAME_BAD_REMATCH',
  'GAME_NOT_INVITEE',
  'GAME_NOT_INVITER',
  'GAME_NOT_PLAYER',
  'GAME_NOT_ACTIVE',
  'GAME_NOT_YOUR_TURN',
  'GAME_BAD_CELL',
  'GAME_CELL_TAKEN',
  'GAME_FORBIDDEN_33',
  'GAME_NOT_TIMED_OUT',
  'GAME_DRAW_PENDING',
  'GAME_DRAW_TOO_SOON',
  'GAME_NOT_DRAW_TARGET',
  'STACK_BAD_SCORE',
  'GAME_BAD_KIND',
  'GAME_BAD_BET',
  'STACK_BAD_STATE',
  'STACK_BAD_CLEAR',
  'STACK_BAD_SEQ',
  'STACK_BAD_REASON',
  'TEN_BAD_SEED',
  'TEN_BAD_DRAGS',
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
  rule?: GameRule;
  turn_deadline?: string | null;
  draw_offer_by?: string | null;
  draw_offer_count?: number | null;
  /** 서버 지금 시각 (화면 시계 보정) */
  server_now?: string;
  seq?: number;
  finished_at?: string | null;
  /** 반반 쌓기 대전: 상대가 마지막으로 보인(저장한) 시각 */
  opp_seen_at?: string | null;
  /** 반반 쌓기 대전 보내기: 서버가 정한 영수증 줄 수·빈칸 */
  lines?: number;
  hole?: number;
  /** 도토리 열 알 대전: 서버가 다시 센 내 점수 · (끝난 판이면) 상대 점수 */
  my_score?: number;
  opp_score?: number | null;
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

/**
 * 초대. 오목 = 흑이 초대받은 사람, rematchOf 를 주면 그 판의 흑백을 바꾼다("한 판 더").
 * 반반 쌓기 대전 = kind 'stack_vs' + 내기 문구(선택, 1~30자). 새 판 id
 */
export function inviteGame(
  ledgerId: string,
  opponentId: string,
  rematchOf?: string,
  opts: { kind?: GameKind; bet?: string | null } = {},
): Promise<string> {
  return rpc<string>('invite_game', {
    p_ledger_id: ledgerId,
    p_opponent: opponentId,
    p_kind: opts.kind ?? 'omok',
    p_rematch_of: rematchOf ?? null,
    p_bet: opts.bet ?? null,
  });
}

/** 초대 수락 / 거절. 10분이 지났으면 applied = false, status = 'expired' */
export function respondGame(gameId: string, accept: boolean): Promise<GameResult> {
  return rpc<GameResult>('respond_game', { p_game_id: gameId, p_accept: accept });
}

/** 초대 취소 (초대한 사람, 답하기 전). 이미 답했거나 만료됐으면 applied = false */
export function cancelGame(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('cancel_game', { p_game_id: gameId });
}

/** 한 수 두기 (x = 열, y = 행, 0~14) */
export function playMove(gameId: string, x: number, y: number): Promise<GameResult> {
  return rpc<GameResult>('play_move', { p_game_id: gameId, p_x: x, p_y: y });
}

export function resignGame(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('resign_game', { p_game_id: gameId });
}

/** 시간 초과 확정 (BANB-53): 서버가 마감이 지났을 때만 차례인 사람 패로 닫는다. 마감 전이면 GAME_NOT_TIMED_OUT */
export function claimTurnTimeout(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('claim_turn_timeout', { p_game_id: gameId });
}

/** 무승부 제안 (내 차례에만) */
export function offerDraw(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('offer_draw', { p_game_id: gameId });
}

/** 무승부 제안에 답하기 (제안받은 사람). 마감이 지났으면 applied = false + 시간 초과 */
export function respondDraw(gameId: string, accept: boolean): Promise<GameResult> {
  return rpc<GameResult>('respond_draw', { p_game_id: gameId, p_accept: accept });
}

/** 서버 지금 시각 (ms). 남은 시간을 서버 기준으로 그리기 위한 보정에 쓴다 */
export async function getServerNow(): Promise<number> {
  return Date.parse(await rpc<string>('game_server_now', {}));
}

/** 지난 초대(10분)·멈춘 판(24시간)·마감 지난 판(30초)을 서버에서 닫는다 (상대 화면에도 반영) */
export function sweepGames(ledgerId: string): Promise<number> {
  return rpc<number>('sweep_games', { p_ledger_id: ledgerId });
}

type Unsubscribe = () => void;

function watchStatus(
  channel: RealtimeChannel,
  onResync: () => void,
  onTrack?: () => void,
  onConnected?: (connected: boolean) => void,
) {
  channel.subscribe((status) => {
    // 처음 연결·다시 연결 모두 SUBSCRIBED → 그동안 놓친 변화를 서버 값으로 다시 맞춘다
    if (status === 'SUBSCRIBED') {
      onConnected?.(true);
      onTrack?.();
      onResync();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // supabase-js 가 알아서 다시 붙는다. 그동안 "연결하는 중" 표시
      onConnected?.(false);
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
  /** 실시간 연결 상태 (끊기면 false, 다시 붙으면 true) */
  onConnected?: (connected: boolean) => void;
}

interface Room {
  channel: RealtimeChannel;
  listeners: Set<RoomHandlers>;
  presence: string[];
  connected: boolean | null;
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
    if (room.connected !== null) handlers.onConnected?.(room.connected);
    handlers.onResync();
  } else {
    const sb = getSupabase();
    const channel = sb.channel(`game:${gameId}`, { config: { presence: { key: myMemberId } } });
    const created: Room = { channel, listeners: new Set([handlers]), presence: [], connected: null, closeTimer: null };
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
      (connected) => {
        // 끊김이 실제로 확인된 뒤에만 알린다 (처음 연결 전에는 "연결하는 중"을 띄우지 않는다)
        if (created.connected === connected) return;
        created.connected = connected;
        created.listeners.forEach((l) => l.onConnected?.(connected));
      },
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

/* ───────────────────────── 반반 쌓기 (BANB-52): 가계부 × 멤버 최고 기록 ───────────────────────── */

/** 이 가계부 멤버들의 최고 기록 (읽기 권한: 같은 가계부 현재 멤버만) */
export async function listStackBests(ledgerId: string): Promise<StackBest[]> {
  const { data, error } = await getSupabase()
    .from('game_stack_best')
    .select('member_id, best_amount, best_lines')
    .eq('ledger_id', ledgerId);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, best_amount: Number(r.best_amount) })) as StackBest[];
}

export interface StackScoreResult {
  /** 이번 판 전 내 최고 기록 (첫 기록이면 null) */
  previous_best: number | null;
  best_amount: number;
  is_new: boolean;
}

/** 판이 끝날 때 1번: 내 기록이 더 높을 때만 서버가 바꾼다 (본인 기록만) */
export async function recordStackScore(ledgerId: string, amount: number, lines: number): Promise<StackScoreResult> {
  const r = await rpc<StackScoreResult>('record_stack_score', { p_ledger_id: ledgerId, p_amount: amount, p_lines: lines });
  return { ...r, previous_best: r.previous_best == null ? null : Number(r.previous_best), best_amount: Number(r.best_amount) };
}

/* ───────────────────────── 반반 쌓기 대전 (BANB-55) ───────────────────────── */

/** 두 사람의 판 저장본 (돌아왔을 때 이어서 · 결과의 지운 줄 · 거의 동시) */
export async function listStackBoards(gameId: string): Promise<StackBoardRow[]> {
  const { data, error } = await getSupabase()
    .from('game_stack_board')
    .select('member_id, state, lines, seen_at, topped_out_at')
    .eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as StackBoardRow[];
}

/** 이 판에서 오간 방해 줄 묶음 (순번 순) */
export async function listStackGarbage(gameId: string): Promise<StackGarbage[]> {
  const { data, error } = await getSupabase()
    .from('game_stack_garbage')
    .select('game_id, ledger_id, from_member, seq, cleared, lines, hole, created_at')
    .eq('game_id', gameId)
    .order('seq');
  if (error) throw error;
  return (data ?? []) as StackGarbage[];
}

/** 판 저장 (2초마다·앱을 내릴 때). state = null 이면 "보임" 시각만. 끊김으로 닫혔으면 applied = false */
export function stackVsSave(gameId: string, state: unknown, lines: number): Promise<GameResult> {
  return rpc<GameResult>('stack_vs_save', { p_game_id: gameId, p_state: state ?? null, p_lines: lines });
}

/** 방해 줄 보내기 (한 번에 2줄 이상). seq = 내 보내기 순번(1부터). 같은 순번 다시 = 한 번만 */
export function stackVsSend(gameId: string, seq: number, cleared: number): Promise<GameResult> {
  return rpc<GameResult>('stack_vs_send', { p_game_id: gameId, p_seq: seq, p_cleared: cleared });
}

/** 끝내기: 맨 위에 닿음 / 그만하기 — 부른 사람이 진다. 이미 끝났으면 applied = false */
export function stackVsEnd(gameId: string, reason: 'topout' | 'quit'): Promise<GameResult> {
  return rpc<GameResult>('stack_vs_end', { p_game_id: gameId, p_reason: reason });
}

/** 끊김 확정: 서버가 30초 넘게 없는 사람이 있을 때만 닫는다. 아직이면 GAME_NOT_TIMED_OUT */
export function stackVsClaimDisconnect(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('stack_vs_claim_disconnect', { p_game_id: gameId });
}

export interface StackVsPreview {
  cells: string;
  lines: number;
  sent: number;
  danger: boolean;
}

interface StackVsHandlers {
  onGarbage: (row: StackGarbage) => void;
  onGame: (game: Game) => void;
  onPresence: (memberIds: string[]) => void;
  onPreview: (memberId: string, preview: StackVsPreview) => void;
  onEmoji: (memberId: string, index: number) => void;
  onResync: () => void;
  onConnected?: (connected: boolean) => void;
}

export interface StackVsRoom {
  stop: () => void;
  /** 내 판 미리보기 (저장하지 않는 broadcast) */
  sendPreview: (preview: StackVsPreview) => void;
  /** 이모지 반응 (저장하지 않는 broadcast) */
  sendEmoji: (index: number) => void;
  /** 앱을 내렸다/돌아왔다 — Presence 에서 빠지거나 다시 들어간다 (상대 화면 30초 세기) */
  setHere: (here: boolean) => void;
}

/**
 * 대전 한 판의 실시간 (채널 1개):
 *  - Postgres Changes: 방해 줄 INSERT(받는 사람 판에 올라감) · 판 UPDATE(시작·끝). 구독자 RLS 적용
 *  - Presence: 지금 대전 화면을 보고 있는 멤버 (앱을 내리면 빠진다 → 상대 화면 "연결이 잠깐 끊겼어요")
 *  - Broadcast: 판 미리보기(0.5초마다 바뀌었을 때만) · 이모지 반응. 저장하지 않고, 보낸 사람 자신에게는 오지 않는다
 */
export function subscribeStackVsRoom(gameId: string, myMemberId: string, handlers: StackVsHandlers): StackVsRoom {
  const sb = getSupabase();
  const channel = sb.channel(`stackvs:${gameId}`, { config: { presence: { key: myMemberId }, broadcast: { self: false } } });
  let here = true;
  let subscribed = false;
  let connected: boolean | null = null;
  channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_stack_garbage', filter: `game_id=eq.${gameId}` }, (p) =>
      handlers.onGarbage(p.new as StackGarbage),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game', filter: `id=eq.${gameId}` }, (p) =>
      handlers.onGame(p.new as Game),
    )
    .on('presence', { event: 'sync' }, () => handlers.onPresence(Object.keys(channel.presenceState())))
    .on('broadcast', { event: 'preview' }, ({ payload }) => {
      const p = payload as { m?: string } & Partial<StackVsPreview>;
      if (p.m && typeof p.cells === 'string')
        handlers.onPreview(p.m, { cells: p.cells, lines: Number(p.lines) || 0, sent: Number(p.sent) || 0, danger: p.danger === true });
    })
    .on('broadcast', { event: 'emoji' }, ({ payload }) => {
      const p = payload as { m?: string; e?: number };
      if (p.m && typeof p.e === 'number') handlers.onEmoji(p.m, p.e);
    });
  watchStatus(
    channel,
    handlers.onResync,
    () => {
      subscribed = true;
      if (here) void channel.track({ at: Date.now() });
    },
    (up) => {
      if (!up) subscribed = false;
      if (connected === up) return;
      connected = up;
      handlers.onConnected?.(up);
    },
  );
  const send = (event: string, payload: Record<string, unknown>) => {
    if (subscribed) void channel.send({ type: 'broadcast', event, payload: { m: myMemberId, ...payload } });
  };
  return {
    stop: () => void sb.removeChannel(channel),
    sendPreview: (p) => send('preview', { ...p }),
    sendEmoji: (e) => send('emoji', { e }),
    setHere: (h) => {
      if (h === here) return;
      here = h;
      if (!subscribed) return;
      if (h) void channel.track({ at: Date.now() });
      else void channel.untrack();
    },
  };
}

/* ───────────────────────── 도토리 열 알 (BANB-57) ───────────────────────── */

/** 1인 최고 기록 (가계부 × 멤버 1개, 같은 가계부 현재 멤버만 읽기) */
export async function listTenBests(ledgerId: string): Promise<TenBest[]> {
  const { data, error } = await getSupabase().from('game_ten_best').select('member_id, best_score').eq('ledger_id', ledgerId);
  if (error) throw error;
  return (data ?? []) as TenBest[];
}

export interface TenScoreResult {
  /** 서버가 순서 값 + 드래그 기록으로 다시 센 점수 (화면 점수 대신 이 값을 보여 준다) */
  score: number;
  previous_best: number | null;
  best_score: number | null;
  is_new: boolean;
}

/** 1인 판이 끝날 때 1번: 서버가 다시 세어 더 높을 때만 바꾼다 (0점은 저장 안 함) */
export function recordTenScore(ledgerId: string, seed: number, drags: readonly Drag[]): Promise<TenScoreResult> {
  return rpc<TenScoreResult>('record_ten_score', { p_ledger_id: ledgerId, p_seed: seed, p_drags: drags });
}

/** 대전 기록 (판이 끝나기 전에는 내 것만 읽힌다) */
export async function listTenBoards(gameId: string): Promise<TenBoardRow[]> {
  const { data, error } = await getSupabase().from('game_ten_board').select('member_id, drags, score, final, saved_at').eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as TenBoardRow[];
}

/**
 * 대전 기록 저장 (터진 네모 전부, 처음부터). final = 마감 뒤 마지막 1번.
 * 서버가 다시 센 점수(my_score)를 돌려준다. 마감 + 5초가 지났거나 끝난 판이면 applied = false + 지금 상태
 */
export function tenVsSave(gameId: string, drags: readonly Drag[], final: boolean): Promise<GameResult> {
  return rpc<GameResult>('ten_vs_save', { p_game_id: gameId, p_drags: drags, p_final: final });
}

/** 그만하기 = 내가 진다 */
export function tenVsQuit(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('ten_vs_quit', { p_game_id: gameId });
}

/** 결과 확정: 마감 + 5초가 지났을 때만 마지막으로 받은 점수로 닫는다. 아직이면 GAME_NOT_TIMED_OUT */
export function tenVsSettle(gameId: string): Promise<GameResult> {
  return rpc<GameResult>('ten_vs_settle', { p_game_id: gameId });
}

interface TenVsHandlers {
  onGame: (game: Game) => void;
  onPresence: (memberIds: string[]) => void;
  /** 상대 화면 점수 (참고용, 저장 안 함) */
  onScore: (memberId: string, score: number) => void;
  onEmoji: (memberId: string, index: number) => void;
  onResync: () => void;
  onConnected?: (connected: boolean) => void;
}

export interface TenVsRoom {
  stop: () => void;
  /** 내 화면 점수 (broadcast, 0.5초마다 바뀌었을 때만) */
  sendScore: (score: number) => void;
  sendEmoji: (index: number) => void;
}

/**
 * 도토리 열 알 대전 한 판의 실시간 (채널 1개):
 *  - Postgres Changes: 판 UPDATE(시작·끝). 구독자 RLS 적용
 *  - Presence: 지금 대전 화면을 보고 있는 멤버 (빠지면 상대 알약 "연결 끊김" — 판은 멈추지 않는다)
 *  - Broadcast: 화면 점수 · 이모지 반응. 저장하지 않고, 보낸 사람 자신에게는 오지 않는다
 */
export function subscribeTenVsRoom(gameId: string, myMemberId: string, handlers: TenVsHandlers): TenVsRoom {
  const sb = getSupabase();
  const channel = sb.channel(`tenvs:${gameId}`, { config: { presence: { key: myMemberId }, broadcast: { self: false } } });
  let subscribed = false;
  let connected: boolean | null = null;
  channel
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game', filter: `id=eq.${gameId}` }, (p) =>
      handlers.onGame(p.new as Game),
    )
    .on('presence', { event: 'sync' }, () => handlers.onPresence(Object.keys(channel.presenceState())))
    .on('broadcast', { event: 'score' }, ({ payload }) => {
      const p = payload as { m?: string; s?: number };
      if (p.m && typeof p.s === 'number') handlers.onScore(p.m, p.s);
    })
    .on('broadcast', { event: 'emoji' }, ({ payload }) => {
      const p = payload as { m?: string; e?: number };
      if (p.m && typeof p.e === 'number') handlers.onEmoji(p.m, p.e);
    });
  watchStatus(
    channel,
    handlers.onResync,
    () => {
      subscribed = true;
      void channel.track({ at: Date.now() });
    },
    (up) => {
      if (!up) subscribed = false;
      if (connected === up) return;
      connected = up;
      handlers.onConnected?.(up);
    },
  );
  const send = (event: string, payload: Record<string, unknown>) => {
    if (subscribed) void channel.send({ type: 'broadcast', event, payload: { m: myMemberId, ...payload } });
  };
  return {
    stop: () => void sb.removeChannel(channel),
    sendScore: (score) => send('score', { s: score }),
    sendEmoji: (e) => send('emoji', { e }),
  };
}
