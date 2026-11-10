/**
 * 반반 쌓기 대전 (BANB-55, design.md 5.36~5.39) — 화면과 분리된 대전 규칙·표시 계산.
 * 각자 판의 낙하는 domain/stack.ts 를 그대로 쓰고, 여기서는 대전에만 있는 것을 다룬다:
 * 같은 조각 순서(서버 순서 값 → 같은 난수열), 방해 줄 장수, 시간 속도, 판 저장본·미리보기 글자열, 결과 문구, 이모지 반응.
 * 방해 줄 장수·빈칸 자리·끝 판정 순서는 서버(supabase/migrations/20261110100000_game_stack_vs.sql)가 정한다.
 */
import type { Game } from '../data/types';
import {
  COLS,
  PIECES,
  PIECE_KINDS,
  ROWS,
  cellsOf,
  emptyBoard,
  newGame,
  type Active,
  type Board,
  type BoardCell,
  type CellKind,
  type GarbageBatch,
  type Material,
  type PieceKind,
  type StackState,
} from './stack';
import { hasFinalConsonant } from './togetherCard';

/** 이 시간 동안 저장이 없으면 끊긴 것 (서버 stack_vs_away_limit 와 같다) */
export const AWAY_SECONDS = 30;
/** 판 저장 간격 (끊겼다 돌아오면 이 저장본으로 이어서) */
export const SAVE_MS = 2000;
/** 상대 판 미리보기 갱신 간격 */
export const PREVIEW_MS = 500;
/** 이모지 반응: 보낸 뒤 쉬는 시간 · 받은 이모지 보이는 시간 · 고르기 알약이 저절로 닫히는 시간 */
export const EMOJI_COOLDOWN_MS = 3000;
export const EMOJI_SHOW_MS = 2000;
export const EMOJI_PICKER_MS = 3000;
/** 3분부터 30초마다 속도 한 단계 */
export const SPEED_START_MS = 180_000;
export const SPEED_STEP_MS = 30_000;
/** 내기 문구 최대 글자 수 (서버 game_bet_rule 과 같다) */
export const BET_MAX = 30;
/** "거의 동시" — 두 사람이 맨 위에 닿은 시각 차이가 이 안이면 결과에 "아슬아슬했어요" */
export const CLOSE_CALL_MS = 1500;

/* ───────────── 같은 조각 순서: 서버 순서 값으로 만든 난수열 ───────────── */

export interface SeededRng {
  (): number;
  /** 지금 상태 (저장본에 넣어 두면 같은 자리부터 이어서 뽑는다) */
  state(): number;
}

/** mulberry32. 같은 seed 면 두 기기에서 같은 수열 → pickPiece 가 같은 조각 순서를 낸다 */
export function seededRng(seed: number): SeededRng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  next.state = () => a;
  return next;
}

/** 대전 새 판: 순서 값으로 첫 조각 둘을 뽑는다 */
export function newVsGame(seed: number): { state: StackState; rng: SeededRng } {
  const rng = seededRng(seed);
  return { state: newGame(rng), rng };
}

/* ───────────── 방해 줄 · 속도 ───────────── */

/** 한 번에 지운 줄 → 보내는 영수증 줄: 1줄 0 · 2줄 1 · 3줄 2 · 4줄 이상 3 (서버 stack_vs_lines 와 같다) */
export function garbageLines(cleared: number): number {
  if (cleared < 2) return 0;
  if (cleared === 2) return 1;
  if (cleared === 3) return 2;
  return 3;
}

/** 지난 시간 → 속도 (3분 전 1, 3:00 → 2, 3:30 → 3 …) */
export function vsLevel(elapsedMs: number): number {
  if (elapsedMs < SPEED_START_MS) return 1;
  return 2 + Math.floor((elapsedMs - SPEED_START_MS) / SPEED_STEP_MS);
}

/** 속도가 오를 때 알약: 처음 1번 "3분이 지났어요. 조금씩 빨라져요", 그 뒤 "속도 5예요" */
export function vsLevelMessage(level: number): string {
  if (level <= 2) return '3분이 지났어요. 조금씩 빨라져요';
  return `속도 ${level}${hasFinalConsonant(String(level)) ? '이에요' : '예요'}`;
}

/** 지난 시간 "2:41" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const sentMessage = (lines: number) => `영수증 ${lines}장을 보냈어요!`;
export const receivedMessage = (name: string, lines: number) => `${name}님이 영수증 ${lines}장을 보냈어요`;

/** 서버가 보낸 방해 줄 묶음 (game_stack_garbage 행) */
export interface GarbageRow {
  from_member: string;
  seq: number;
  lines: number;
  hole: number;
}

/**
 * 상대가 보낸 묶음 중 아직 받지 않은 것(순번 received 다음부터, 빠짐없이 이어진 것만).
 * gap = 중간 순번이 비었음 → 서버에서 다시 받아야 한다
 */
export function newBatches(rows: readonly GarbageRow[], from: string, received: number): { batches: GarbageRow[]; gap: boolean } {
  const mine = rows.filter((r) => r.from_member === from && r.seq > received).sort((a, b) => a.seq - b.seq);
  const batches: GarbageRow[] = [];
  let expect = received + 1;
  for (const r of mine) {
    if (r.seq < expect) continue; // 같은 순번 두 번
    if (r.seq !== expect) return { batches, gap: true };
    batches.push(r);
    expect += 1;
  }
  return { batches, gap: false };
}

/** 받을 영수증 장수 (막대 숫자) */
export const pendingLines = (garbage: readonly GarbageBatch[]) => garbage.reduce((n, g) => n + g.lines, 0);

/* ───────────── 판 저장본 (서버 2초마다) ───────────── */

const KIND_CODE: Record<CellKind, string> = { coin1: 'a', coin2: 'b', bill: 'c', bent: 'd', wallet: 'e', piggy: 'f', receipt: 'r' };
const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])) as Record<string, CellKind>;

/** 대전 진행 값 (판 밖) */
export interface VsProgress {
  /** 멈춘 시간을 뺀 대전 시간 */
  elapsedMs: number;
  /** 보낸 영수증 장수 */
  sent: number;
  /** 내가 보낸 묶음 순번 (서버 stack_vs_send 의 p_seq) */
  sendSeq: number;
  /** 상대 묶음을 몇 번째까지 받았나 (판에 올렸거나 받을 막대에 있음) */
  received: number;
}

export interface VsSnapshot extends VsProgress {
  v: 1;
  board: string[];
  active: Active | null;
  next: PieceKind;
  recent: PieceKind[];
  lines: number;
  level: number;
  nextId: number;
  garbage: GarbageBatch[];
  clearing: { rows: number[]; leftMs: number } | null;
  over: boolean;
  /** 난수열 상태 */
  rng: number;
}

function encodeRow(row: readonly (BoardCell | null)[]): string {
  return row.map((c) => (c ? `${KIND_CODE[c.kind]}${c.deco ? '!' : ''}${c.id}` : '')).join('.');
}

function decodeRow(text: string): (BoardCell | null)[] {
  const cells = text.split('.');
  return Array.from({ length: COLS }, (_, x) => {
    const m = /^([a-fr])(!?)(\d+)$/.exec(cells[x] ?? '');
    return m ? { kind: CODE_KIND[m[1]], deco: m[2] === '!', id: Number(m[3]) } : null;
  });
}

export function toSnapshot(s: StackState, p: VsProgress, rngState: number): VsSnapshot {
  return {
    v: 1,
    board: s.board.map(encodeRow),
    active: s.active,
    next: s.next,
    recent: s.recent,
    lines: s.lines,
    level: s.level,
    nextId: s.nextId,
    garbage: s.garbage,
    clearing: s.clearing,
    over: s.over,
    rng: rngState >>> 0,
    ...p,
  };
}

const isKind = (k: unknown): k is PieceKind => typeof k === 'string' && (PIECE_KINDS as string[]).includes(k);

/** 저장본 → 판. 모양이 맞지 않으면 null (새로 시작하지 않고 화면이 오류로 다룬다) */
export function fromSnapshot(raw: unknown): { state: StackState; progress: VsProgress; rng: SeededRng } | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<VsSnapshot>;
  if (v.v !== 1 || !Array.isArray(v.board) || v.board.length !== ROWS || !isKind(v.next) || typeof v.rng !== 'number') return null;
  const board: Board = v.board.map((r) => decodeRow(String(r)));
  const active = v.active && isKind(v.active.kind) ? v.active : null;
  const rng = seededRng(v.rng);
  const num = (n: unknown, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
  const state: StackState = {
    board,
    active,
    next: v.next,
    recent: Array.isArray(v.recent) ? v.recent.filter(isKind) : [],
    score: 0,
    lines: num(v.lines),
    level: Math.max(1, num(v.level, 1)),
    fallMs: 0,
    lockMs: null,
    clearing: v.clearing && Array.isArray(v.clearing.rows) ? { rows: v.clearing.rows, leftMs: 0 } : null,
    over: v.over === true,
    nextId: num(v.nextId, 1),
    garbage: Array.isArray(v.garbage) ? v.garbage.filter((g) => g && num(g.lines) > 0) : [],
    events: [],
  };
  return {
    state,
    progress: { elapsedMs: num(v.elapsedMs), sent: num(v.sent), sendSeq: num(v.sendSeq), received: num(v.received) },
    rng,
  };
}

/* ───────────── 상대 판 미리보기 (Realtime broadcast, 0.5초마다 바뀌었을 때만) ───────────── */

const MATERIAL_CODE: Record<Material | 'receipt', string> = { coin: 'c', bill: 'b', wallet: 'w', piggy: 'p', receipt: 'r' };
export type PreviewCell = Material | 'receipt' | null;

/** 판 + 떨어지는 조각을 112글자로 ('.' = 빈칸, c·b·w·p = 재질, r = 영수증) */
export function encodePreview(s: Pick<StackState, 'board' | 'active'>): string {
  const g = s.board.map((row) => row.map((c) => (c ? MATERIAL_CODE[c.kind === 'receipt' ? 'receipt' : PIECES[c.kind].material] : '.')));
  if (s.active) for (const [x, y] of cellsOf(s.active)) if (g[y]?.[x] !== undefined) g[y][x] = MATERIAL_CODE[PIECES[s.active.kind].material];
  return g.map((r) => r.join('')).join('');
}

const PREVIEW_DECODE: Record<string, PreviewCell> = { c: 'coin', b: 'bill', w: 'wallet', p: 'piggy', r: 'receipt' };

export function decodePreview(text: string): PreviewCell[][] {
  return Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => PREVIEW_DECODE[text[y * COLS + x]] ?? null));
}

/** 판(놓인 칸)이 위 3줄 안까지 찼나 — 상대 칸 테두리 강조 "곧 끝날 수 있음" */
export function isDanger(board: Board): boolean {
  return board.slice(0, 3).some((row) => row.some((c) => c !== null));
}

export interface PreviewMessage {
  cells: string;
  lines: number;
  sent: number;
  danger: boolean;
}

export function emptyPreview(): PreviewMessage {
  return { cells: encodePreview({ board: emptyBoard(), active: null }), lines: 0, sent: 0, danger: false };
}

/* ───────────── 이모지 반응 ───────────── */

export const EMOJIS = [
  { emoji: '👍', label: '좋아요', spoken: '엄지척을' },
  { emoji: '😂', label: '웃겨요', spoken: '웃는 얼굴을' },
  { emoji: '😱', label: '놀랐어요', spoken: '놀란 얼굴을' },
  { emoji: '😤', label: '분해요', spoken: '분한 얼굴을' },
  { emoji: '🙏', label: '부탁해요', spoken: '부탁해요를' },
  { emoji: '❤️', label: '사랑해요', spoken: '하트를' },
] as const;

/** 3초에 1번 (보내는 쪽 버튼·받는 쪽 표시 모두 같은 규칙 — 받는 쪽도 3초 안에 또 오면 무시해 도배를 막는다) */
export const emojiAllowed = (lastAt: number | null, now: number) => lastAt === null || now - lastAt >= EMOJI_COOLDOWN_MS;

export const emojiAnnounce = (name: string, index: number) => `${name}님이 ${EMOJIS[index]?.spoken ?? '반응을'} 보냈어요`;

/* ───────────── 내기 ───────────── */

/** 글자 수 (서버 char_length 와 같게 코드 포인트로 센다) */
export const betLength = (text: string) => Array.from(text).length;

/** 입력 중: 30자를 넘으면 더 써지지 않는다 */
export const clampBet = (text: string) => Array.from(text).slice(0, BET_MAX).join('');

/** 보낼 값: 앞뒤 공백 제거, 비면 없음 */
export function normalizeBet(text: string): string | null {
  const t = text.trim();
  return t ? clampBet(t) : null;
}

/** 결과 내기 상자 큰 글씨: 진 사람 = 당첨. 내기가 없거나 승부가 없으면 null */
export function betWinnerText(game: Pick<Game, 'bet' | 'winner_id' | 'black_id' | 'white_id'>, me: string, nameOf: (id: string) => string): string | null {
  if (!game.bet || !game.winner_id) return null;
  if (game.winner_id === me) {
    const loser = game.black_id === me ? game.white_id : game.black_id;
    return `${nameOf(loser)}님 당첨이에요!`;
  }
  return '이번엔 내가 당첨이에요';
}

/* ───────────── 결과 (design.md 5.39 표) ───────────── */

export type VsResultIcon = 'trophy' | 'smile' | 'flag' | 'wifi-off' | 'clock';
export interface VsResultCopy {
  icon: VsResultIcon;
  title: string;
  line: string;
  win: boolean;
  /** 전적에 들어가나 (중단 = 아니오) */
  counted: boolean;
}

export function vsResultCopy(
  game: Pick<Game, 'status' | 'end_reason' | 'winner_id' | 'black_id' | 'white_id'>,
  me: string,
  nameOf: (id: string) => string,
  closeCall = false,
): VsResultCopy {
  const opp = `${nameOf(game.black_id === me ? game.white_id : game.black_id)}님`;
  if (game.status !== 'finished' || !game.winner_id) {
    return { icon: 'clock', title: '판을 닫았어요', line: '둘 다 연결이 끊겨서 판을 닫았어요. 새로 한 판 할까요?', win: false, counted: false };
  }
  const win = game.winner_id === me;
  const close = closeCall ? ' · 아슬아슬했어요' : '';
  switch (game.end_reason) {
    case 'quit':
      return win
        ? { icon: 'trophy', title: '이겼어요!', line: `${opp}이 그만했어요`, win, counted: true }
        : { icon: 'flag', title: '그만했어요', line: '다음엔 끝까지 해 봐요', win, counted: true };
    case 'disconnect':
      return win
        ? { icon: 'trophy', title: '이겼어요!', line: `${opp} 연결이 끊겨서 판이 끝났어요`, win, counted: true }
        : { icon: 'wifi-off', title: '연결이 끊겨서 졌어요', line: '30초 안에 돌아오지 못했어요', win, counted: true };
    default:
      return win
        ? { icon: 'trophy', title: '이겼어요!', line: `${opp} 판이 먼저 꽉 찼어요${close}`, win, counted: true }
        : { icon: 'smile', title: '아쉽게 졌어요', line: `한 판 더 할까요?${close}`, win, counted: true };
  }
}

/** 두 사람이 거의 동시에 맨 위에 닿았나 (판 저장본의 topped_out_at) */
export function isCloseCall(toppedOut: readonly (string | null | undefined)[]): boolean {
  const ts = toppedOut.filter((t): t is string => !!t).map((t) => Date.parse(t));
  return ts.length === 2 && Math.abs(ts[0] - ts[1]) <= CLOSE_CALL_MS;
}

/* ───────────── 끊김 30초 ───────────── */

/**
 * 상대를 기다리는 남은 초 (서버 시각 기준). 상대가 마지막으로 보인 시각(저장)부터 30초.
 * 모르면(아직 저장 없음) 기다리기 시작한 시각부터
 */
export function awayRemainingSeconds(oppSeenMs: number | null, waitStartMs: number, serverNowMs: number): number {
  const base = oppSeenMs ?? waitStartMs;
  return Math.max(0, Math.ceil((base + AWAY_SECONDS * 1000 - serverNowMs) / 1000));
}
