/**
 * 반반 쌓기 1인 모드 (BANB-52, design.md 5.33~5.35) — 화면과 분리된 순수 게임 규칙.
 * 판 8칸 × 14줄, 조각 6종(1·2·3·3·4·5칸). 한 줄을 채우면 "저금"되어 사라지고 모은 돈이 오른다.
 * 시간은 화면이 step(state, ms)로 흘려 준다(테스트에서 시간을 직접 넣을 수 있게).
 */

import type { StackBest } from '../data/types';
import { hasFinalConsonant } from './togetherCard';

export const COLS = 8;
export const ROWS = 14;

export type PieceKind = 'coin1' | 'coin2' | 'bill' | 'bent' | 'wallet' | 'piggy';
/** 그리기 재질 (design.md 1.8 piece-* 색) */
export type Material = 'coin' | 'bill' | 'wallet' | 'piggy';
export type Cell = readonly [x: number, y: number];

export interface PieceDef {
  kind: PieceKind;
  name: string;
  material: Material;
  /** 돌리기 0 모양 (x, y) — 왼쪽 위 기준 */
  cells: readonly Cell[];
  /** 무늬(똑딱이·동전 구멍)를 그릴 칸 순번 (돌리기 0의 cells 순서) */
  deco?: number;
  /** 나올 확률 가중치 (design.md 5.33 제안값, 합 100) */
  weight: number;
}

export const PIECES: Record<PieceKind, PieceDef> = {
  coin1: { kind: 'coin1', name: '동전', material: 'coin', cells: [[0, 0]], weight: 10 },
  coin2: { kind: 'coin2', name: '동전 둘', material: 'coin', cells: [[0, 0], [1, 0]], weight: 20 },
  bill: { kind: 'bill', name: '지폐', material: 'bill', cells: [[0, 0], [1, 0], [2, 0]], weight: 20 },
  bent: { kind: 'bent', name: '꺾인 동전', material: 'coin', cells: [[0, 0], [0, 1], [1, 1]], weight: 20 },
  wallet: { kind: 'wallet', name: '지갑', material: 'wallet', cells: [[0, 0], [1, 0], [0, 1], [1, 1]], deco: 1, weight: 15 },
  piggy: { kind: 'piggy', name: '저금통', material: 'piggy', cells: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]], deco: 1, weight: 15 },
};

export const PIECE_KINDS = Object.keys(PIECES) as PieceKind[];

/** 한 번에 지운 줄 수 → 모은 돈 (1줄 1,000 · 2줄 3,000 · 3줄 6,000) */
export const CLEAR_AMOUNT = [0, 1000, 3000, 6000] as const;
/** 속도 1의 한 칸 떨어지는 시간 */
export const BASE_FALL_MS = 800;
export const MIN_FALL_MS = 120;
export const FALL_FACTOR = 0.85;
/** 몇 줄마다 속도 +1 */
export const LINES_PER_LEVEL = 10;
/** 바닥(또는 조각)에 닿은 뒤 고정까지 옮기거나 돌릴 수 있는 시간 */
export const LOCK_MS = 400;
/** 좌우 버튼을 길게 누를 때 반복 간격 */
export const REPEAT_MS = 150;

/** 판 칸: 비었으면 null. id 가 같은 칸끼리 한 조각으로 이어 그린다 */
export interface BoardCell {
  id: number;
  kind: PieceKind;
  /** 무늬 칸 */
  deco: boolean;
}
export type Board = (BoardCell | null)[][]; // [y][x]

export interface Active {
  kind: PieceKind;
  rot: number; // 0~3
  x: number;
  y: number;
  id: number;
}

export type StackEvent =
  | { type: 'clear'; rows: number[]; count: number; amount: number }
  | { type: 'level'; level: number }
  | { type: 'over' };

export interface StackState {
  board: Board;
  active: Active | null;
  next: PieceKind;
  /** 최근에 나온 조각 2개 (같은 조각 3번 연속 막기) */
  recent: PieceKind[];
  score: number;
  lines: number;
  level: number;
  /** 다음 칸까지 쌓인 시간 */
  fallMs: number;
  /** 바닥에 닿은 뒤 흐른 시간 (닿지 않았으면 null) */
  lockMs: number | null;
  /** 줄을 지우는 중 (빛남·사라짐 연출 시간). 끝나면 줄을 없애고 다음 조각 */
  clearing: { rows: number[]; leftMs: number } | null;
  over: boolean;
  nextId: number;
  /** 마지막 동작에서 일어난 일 (화면이 알림·진동에 쓴다) */
  events: StackEvent[];
}

export type Rng = () => number;

// ───────────────────────── 조각 모양

/** 시계 방향 90° × rot, 왼쪽 위(0,0) 기준으로 다시 맞춘 칸들 (순서는 돌리기 0의 cells 순서 그대로) */
export function shapeOf(kind: PieceKind, rot: number): Cell[] {
  let cells: Cell[] = PIECES[kind].cells.map(([x, y]) => [x, y] as const);
  const r = ((rot % 4) + 4) % 4;
  for (let k = 0; k < r; k++) cells = cells.map(([x, y]) => [-y, x] as const);
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my] as const);
}

export function sizeOf(cells: readonly Cell[]): { w: number; h: number } {
  return { w: Math.max(...cells.map((c) => c[0])) + 1, h: Math.max(...cells.map((c) => c[1])) + 1 };
}

/** 돌린 모양이 몇 가지인지 (같은 모양이 되면 1·2가지) */
export function distinctRotations(kind: PieceKind): number {
  const keys = new Set([0, 1, 2, 3].map((r) => key(shapeOf(kind, r))));
  return keys.size;
}
const key = (cells: readonly Cell[]) =>
  [...cells]
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(' ');

/** 판 위의 칸 위치 */
export function cellsOf(a: Active): Cell[] {
  return shapeOf(a.kind, a.rot).map(([x, y]) => [a.x + x, a.y + y] as const);
}

// ───────────────────────── 판

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<BoardCell | null>(COLS).fill(null));
}

/** 판 밖이거나 이미 찬 칸이 있으면 false */
export function fits(board: Board, a: Active): boolean {
  return cellsOf(a).every(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS && board[y][x] === null);
}

/** 바로 내리기 했을 때 멈출 위치 (떨어질 자리 표시에도 쓴다) */
export function dropPosition(board: Board, a: Active): Active {
  let p = a;
  while (fits(board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
  return p;
}

/** 꽉 찬 줄 번호 (위 → 아래) */
export function fullRows(board: Board): number[] {
  return board.flatMap((row, y) => (row.every((c) => c !== null) ? [y] : []));
}

/**
 * 줄을 지우고 위 칸들을 내린다. 지운 줄 위·아래로 갈린 같은 조각은 서로 다른 조각으로 다시 번호를 매긴다
 * (design.md 5.33 "남은 칸끼리만 이어짐" — 사이 줄이 지워져 붙게 된 칸이 한 덩어리로 그려지지 않게)
 */
export function removeRows(board: Board, rows: readonly number[], nextId: number): { board: Board; nextId: number } {
  if (rows.length === 0) return { board, nextId };
  const gone = new Set(rows);
  const remap = new Map<string, number>();
  let id = nextId;
  const kept: (BoardCell | null)[][] = [];
  board.forEach((row, y) => {
    if (gone.has(y)) return;
    const below = rows.filter((r) => r > y).length;
    kept.push(
      row.map((c) => {
        if (!c) return null;
        const k = `${c.id}:${below}`;
        if (!remap.has(k)) remap.set(k, id++);
        return { ...c, id: remap.get(k)! };
      }),
    );
  });
  const fresh = Array.from({ length: rows.length }, () => Array<BoardCell | null>(COLS).fill(null));
  return { board: [...fresh, ...kept], nextId: id };
}

// ───────────────────────── 점수·속도

export function amountFor(count: number): number {
  return CLEAR_AMOUNT[Math.min(Math.max(count, 0), CLEAR_AMOUNT.length - 1)];
}

export function levelFor(lines: number): number {
  return 1 + Math.floor(lines / LINES_PER_LEVEL);
}

/** 한 칸 떨어지는 시간 (ms) */
export function fallInterval(level: number): number {
  return Math.max(MIN_FALL_MS, Math.round(BASE_FALL_MS * FALL_FACTOR ** (level - 1)));
}

// ───────────────────────── 조각 뽑기

/** 가중치대로 뽑되, 같은 조각이 3번 연속 나오지 않게 한다 */
export function pickPiece(recent: readonly PieceKind[], rng: Rng): PieceKind {
  const banned = recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2] ? recent[recent.length - 1] : null;
  const pool = PIECE_KINDS.filter((k) => k !== banned);
  const total = pool.reduce((s, k) => s + PIECES[k].weight, 0);
  let r = rng() * total;
  for (const k of pool) {
    r -= PIECES[k].weight;
    if (r < 0) return k;
  }
  return pool[pool.length - 1];
}

/** 나올 자리: 맨 위 가운데 */
export function spawnAt(kind: PieceKind, id: number): Active {
  const { w } = sizeOf(shapeOf(kind, 0));
  return { kind, rot: 0, x: Math.floor((COLS - w) / 2), y: 0, id };
}

// ───────────────────────── 진행

export function newGame(rng: Rng): StackState {
  const first = pickPiece([], rng);
  const second = pickPiece([first], rng);
  return {
    board: emptyBoard(),
    active: spawnAt(first, 1),
    next: second,
    recent: [first, second],
    score: 0,
    lines: 0,
    level: 1,
    fallMs: 0,
    lockMs: null,
    clearing: null,
    over: false,
    nextId: 2,
    events: [],
  };
}

/** 다음 조각을 꺼낸다. 나올 자리가 막혀 있으면 끝 */
function spawnNext(s: StackState, rng: Rng, events: StackEvent[]): StackState {
  const active = spawnAt(s.next, s.nextId);
  const next = pickPiece(s.recent, rng);
  const recent = [...s.recent, next].slice(-2);
  if (!fits(s.board, active)) {
    return { ...s, active: null, over: true, events: [...events, { type: 'over' }] };
  }
  return { ...s, active, next, recent, nextId: s.nextId + 1, fallMs: 0, lockMs: null, events };
}

/** 지금 조각을 판에 고정 → 꽉 찬 줄이 있으면 지우는 중으로, 없으면 다음 조각 */
function lock(s: StackState, rng: Rng, clearMs: number): StackState {
  if (!s.active) return s;
  const a = s.active;
  const board = s.board.map((row) => row.slice());
  const deco = PIECES[a.kind].deco;
  cellsOf(a).forEach(([x, y], i) => {
    board[y][x] = { id: a.id, kind: a.kind, deco: deco === i };
  });
  const rows = fullRows(board);
  const locked: StackState = { ...s, board, active: null, fallMs: 0, lockMs: null };
  if (rows.length === 0) return spawnNext(locked, rng, s.events);

  const amount = amountFor(rows.length);
  const lines = s.lines + rows.length;
  const level = levelFor(lines);
  const events: StackEvent[] = [...s.events, { type: 'clear', rows, count: rows.length, amount }];
  if (level > s.level) events.push({ type: 'level', level });
  const scored: StackState = { ...locked, score: s.score + amount, lines, level, events };
  if (clearMs <= 0) return finishClear({ ...scored, clearing: { rows, leftMs: 0 } }, rng);
  return { ...scored, clearing: { rows, leftMs: clearMs } };
}

function finishClear(s: StackState, rng: Rng): StackState {
  if (!s.clearing) return s;
  const { board, nextId } = removeRows(s.board, s.clearing.rows, s.nextId);
  return spawnNext({ ...s, board, nextId, clearing: null }, rng, s.events);
}

export interface StepOptions {
  rng: Rng;
  /** 줄 지우는 연출 시간 (줄인 움직임이면 0) */
  clearMs: number;
}

/**
 * 시간을 ms 만큼 흘린다: 떨어지기 → 닿으면 0.4초 뒤 고정 → 줄 지우기 연출 → 다음 조각.
 * events 는 이번 호출에서 일어난 일만 담는다.
 */
export function step(state: StackState, ms: number, opt: StepOptions): StackState {
  let s: StackState = { ...state, events: [] };
  let left = ms;
  // 한 번에 많이 흘러도(느린 기기) 한 칸씩 처리한다
  for (let guard = 0; left > 0 && !s.over && guard < 64; guard++) {
    if (s.clearing) {
      const used = Math.min(left, s.clearing.leftMs);
      left -= used;
      const remain = s.clearing.leftMs - used;
      s = remain > 0 ? { ...s, clearing: { ...s.clearing, leftMs: remain } } : finishClear(s, opt.rng);
      continue;
    }
    if (!s.active) break;
    const down = { ...s.active, y: s.active.y + 1 };
    if (fits(s.board, down)) {
      const interval = fallInterval(s.level);
      const need = interval - s.fallMs;
      if (left < need) {
        s = { ...s, fallMs: s.fallMs + left, lockMs: null };
        left = 0;
      } else {
        left -= need;
        s = { ...s, active: down, fallMs: 0, lockMs: null };
      }
    } else {
      const lockMs = s.lockMs ?? 0;
      const need = LOCK_MS - lockMs;
      if (left < need) {
        s = { ...s, lockMs: lockMs + left };
        left = 0;
      } else {
        left -= need;
        s = lock(s, opt.rng, opt.clearMs);
      }
    }
  }
  return s;
}

export type StackAction = 'left' | 'right' | 'rotate' | 'soft' | 'hard';

/** 회전 후 자리 맞춤: 돌린 모양의 가운데가 원래 가운데에 오게, 막히면 좌우 1칸까지 밀어 본다 */
export function rotated(board: Board, a: Active): Active | null {
  const before = sizeOf(shapeOf(a.kind, a.rot));
  const rot = (a.rot + 1) % 4;
  const after = sizeOf(shapeOf(a.kind, rot));
  const x = a.x + Math.floor((before.w - after.w) / 2);
  const y = Math.max(0, a.y + Math.floor((before.h - after.h) / 2));
  for (const dx of [0, -1, 1]) {
    const c = { ...a, rot, x: x + dx, y };
    if (fits(board, c)) return c;
  }
  return null;
}

/** 조작 하나. 못 움직이면 상태 그대로(같은 객체) */
export function act(state: StackState, action: StackAction, opt: StepOptions): StackState {
  const a = state.active;
  if (!a || state.over || state.clearing) return state;
  const s: StackState = { ...state, events: [] };
  switch (action) {
    case 'left':
    case 'right': {
      const m = { ...a, x: a.x + (action === 'left' ? -1 : 1) };
      return fits(s.board, m) ? { ...s, active: m } : state;
    }
    case 'rotate': {
      const r = rotated(s.board, a);
      return r ? { ...s, active: r } : state;
    }
    case 'soft': {
      const m = { ...a, y: a.y + 1 };
      return fits(s.board, m) ? { ...s, active: m, fallMs: 0, lockMs: null } : state;
    }
    case 'hard':
      return lock({ ...s, active: dropPosition(s.board, a) }, opt.rng, opt.clearMs);
  }
}

// ───────────────────────── 문구 (해요체, design.md 5.34)

export function clearMessage(count: number): string {
  if (count >= 3) return '세 줄 한꺼번에! 대단해요';
  if (count === 2) return '두 줄 한 번에 저금했어요!';
  return '한 줄 저금했어요!';
}

export const levelMessage = (level: number) => `속도 ${level}${hasFinalConsonant(String(level)) ? '이에요' : '예요'}. 조금 빨라져요`;

// ───────────────────────── 기록 (design.md 5.34 기록 카드 · 5.35 끝)


export interface MemberLike {
  id: string;
  display_name: string;
  left_at: string | null;
}

/** 비교 줄에 쓸 멤버: 나를 뺀 지금 멤버 중 기록이 가장 높은 1명. 아무도 기록이 없으면 null(줄 숨김) */
export function topOtherBest(
  bests: readonly StackBest[],
  me: string,
  members: readonly MemberLike[],
): { member: MemberLike; amount: number } | null {
  let top: { member: MemberLike; amount: number } | null = null;
  for (const m of members) {
    if (m.id === me || m.left_at !== null) continue;
    const b = bests.find((x) => x.member_id === m.id);
    if (b && (!top || b.best_amount > top.amount)) top = { member: m, amount: b.best_amount };
  }
  return top;
}

export function myBest(bests: readonly StackBest[], me: string): number | null {
  return bests.find((b) => b.member_id === me)?.best_amount ?? null;
}

export type EndIcon = 'piggy' | 'trophy' | 'flag';

export interface EndView {
  icon: EndIcon;
  /** 원을 primary-soft 로 (새 최고 기록) */
  highlight: boolean;
  title: string;
  /** 멤버 비교 줄: 'beat' = "○○님 기록 N원을 넘었어요", 'show' = "○○님 최고 기록 N원이에요", null = 숨김 */
  compare: 'beat' | 'show' | null;
  /** 기록을 못 넘었으면 "내 최고 기록 N원" 줄 */
  showMyBest: boolean;
  /** 0원이면 "한 줄만 채워도 1,000원이에요" */
  zeroNote: boolean;
  /** 서버에 기록을 보낼지 (0원 판은 기록하지 않는다) */
  save: boolean;
}

/**
 * 끝 시트 (design.md 5.35 표). prevBest = 이번 판 전 내 최고 기록(없으면 null), other = 비교할 멤버 최고 기록.
 * 우선순위: 새 최고 기록 > 첫 기록 > 그만하기 > 기본. 새 기록·첫 기록은 그만하기로 끝나도 축하 문구를 보인다.
 */
export function endView(amount: number, prevBest: number | null, quit: boolean, other: number | null): EndView {
  const first = prevBest === null && amount > 0;
  const beatMine = prevBest !== null && amount > prevBest;
  const compare = other === null ? null : beatMine && amount > other ? 'beat' : 'show';
  const base = { compare, showMyBest: prevBest !== null && !beatMine, zeroNote: amount === 0, save: amount > 0 } as const;
  if (beatMine) return { ...base, icon: 'trophy', highlight: true, title: '새 최고 기록이에요!' };
  if (first) return { ...base, icon: 'piggy', highlight: false, title: '첫 기록이에요!' };
  if (quit) return { ...base, icon: 'flag', highlight: false, title: '여기까지 할게요' };
  return { ...base, icon: 'piggy', highlight: false, title: '아쉽지만 여기까지예요' };
}
