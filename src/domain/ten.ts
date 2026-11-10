/**
 * 도토리 열 알 (BANB-57, design.md 5.40~5.44) — 화면과 분리된 판·점수·시간·문구 계산.
 * 판은 순서 값(seed)에서 만든다: 서버(supabase/migrations/20261110200000_game_ten.sql ten_board)와 같은 계산이라
 * 두 사람·서버가 같은 판을 본다. 점수 = 터진 도토리 수 — 서버가 드래그 기록을 같은 판에 다시 놓아 확정한다(ten_replay).
 */
import type { Game } from '../data/types';

/** 판 가로 15 × 세로 8 */
export const COLS = 15;
export const ROWS = 8;
export const CELLS = COLS * ROWS;
/** 한 판 120초 */
export const DURATION_MS = 120_000;
/** 대전: 수락 → 공통 시작까지 (둘 다 왔어요 1.5초 + 3·2·1). 서버 ten_vs_lead 와 같다 */
export const VS_LEAD_MS = 5_000;
/** 대전: 마감 뒤 기록을 기다리는 시간 (서버 ten_vs_grace 와 같다) */
export const VS_GRACE_MS = 5_000;
/** 남은 10초 알림 */
export const LAST_SECONDS = 10;
/** 상대 점수 갱신 간격 */
export const SCORE_MS = 500;
/** 드래그 기록 최대 개수 (서버 game_ten_board_drags_rule 과 같다) */
export const MAX_DRAGS = 120;

/** 판: 칸 번호 = y × 15 + x, 값 1~9 (0 = 터진 빈칸) */
export type TenBoard = readonly number[];
/** 드래그 네모: 두 모서리 칸 [x1, y1, x2, y2] (서버로 보내는 모양 그대로) */
export type Drag = readonly [number, number, number, number];

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/* ───────────── 판 ───────────── */

const MOD = 2147483647;

/** 순서 값 → 판 120칸 (Lehmer: s = s × 48271 mod 2^31−1, 숫자 = 1 + s mod 9). 서버 ten_board 와 같다 */
export function tenBoard(seed: number): number[] {
  let s = ((((Math.trunc(seed) || 0) % (MOD - 1)) + (MOD - 1)) % (MOD - 1)) + 1;
  const b: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    s = (s * 48271) % MOD; // s < 2^31, × 48271 < 2^47 → 정확한 정수
    b.push(1 + (s % 9));
  }
  return b;
}

/** 1인 새 판 순서 값 (0 ~ 2^31−2) */
export const randomSeed = (rand: () => number = Math.random) => Math.floor(rand() * (MOD - 1));

export const cellIndex = (x: number, y: number) => y * COLS + x;

/** 두 칸 → 네모 (판 밖은 가장자리로) */
export function rectOf(ax: number, ay: number, bx: number, by: number): Rect {
  const cx = (v: number) => Math.max(0, Math.min(COLS - 1, v));
  const cy = (v: number) => Math.max(0, Math.min(ROWS - 1, v));
  return {
    x1: cx(Math.min(ax, bx)),
    y1: cy(Math.min(ay, by)),
    x2: cx(Math.max(ax, bx)),
    y2: cy(Math.max(ay, by)),
  };
}

export const dragOf = (r: Rect): Drag => [r.x1, r.y1, r.x2, r.y2];
export const rectOfDrag = (d: Drag): Rect => rectOf(d[0], d[1], d[2], d[3]);

/** 네모 안 숫자 합 (빈칸 = 0) · 남은 도토리 수 */
export function rectSum(board: TenBoard, r: Rect): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (let y = r.y1; y <= r.y2; y++)
    for (let x = r.x1; x <= r.x2; x++) {
      const v = board[cellIndex(x, y)];
      sum += v;
      if (v > 0) count += 1;
    }
  return { sum, count };
}

/** 네모를 놓는다: 합이 10이면 안의 도토리가 터져 빈칸이 된다(다시 채우지 않음). 아니면 그대로(벌점 없음) */
export function popRect(board: TenBoard, r: Rect): { board: TenBoard; popped: number[] } {
  const { sum } = rectSum(board, r);
  if (sum !== 10) return { board, popped: [] };
  const next = board.slice();
  const popped: number[] = [];
  for (let y = r.y1; y <= r.y2; y++)
    for (let x = r.x1; x <= r.x2; x++) {
      const i = cellIndex(x, y);
      if (next[i] > 0) popped.push(i);
      next[i] = 0;
    }
  return { board: next, popped };
}

/** 드래그 기록을 처음 판에 차례로 놓은 결과 (서버 ten_replay 와 같은 규칙) */
export function replay(seed: number, drags: readonly Drag[]): { board: TenBoard; score: number } {
  let board: TenBoard = tenBoard(seed);
  let score = 0;
  for (const d of drags) {
    const r = popRect(board, rectOfDrag(d));
    board = r.board;
    score += r.popped.length;
  }
  return { board, score };
}

/** 서버에 저장된 기록(jsonb)을 드래그 목록으로 (모양이 틀린 것은 버린다) */
export function parseDrags(value: unknown): Drag[] {
  if (!Array.isArray(value)) return [];
  const out: Drag[] = [];
  for (const d of value) {
    if (!Array.isArray(d) || d.length !== 4 || !d.every((n) => Number.isInteger(n) && n >= 0)) continue;
    const [x1, y1, x2, y2] = d as number[];
    if (x1 >= COLS || x2 >= COLS || y1 >= ROWS || y2 >= ROWS) continue;
    out.push([x1, y1, x2, y2]);
  }
  return out.slice(0, MAX_DRAGS);
}

/* ───────────── 화면 크기 · 시간 ───────────── */

/** 칸 크기: floor(min((폭 − 72) / 15, (높이 − 64) / 8)), 30~48 (design.md 5.41) */
export function tenCellSize(width: number, height: number): number {
  const s = Math.floor(Math.min((width - 72) / COLS, (height - 64) / ROWS));
  return Math.max(30, Math.min(48, s));
}

/** 가로인가 (화면 비율로 판정 — 방향 잠금이 안 되는 기기 대비, design.md 5.42) */
export const isLandscape = (width: number, height: number) => width > height;

/** 남은 시간 "1:24" (올림) */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 스크린 리더용 "1분 24초" */
export function spokenClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분${s > 0 ? ` ${s}초` : ''}` : `${s}초`;
}

/** 대전 공통 시각 (서버 마감 → 시작 = 마감 − 120초) */
export function vsTimes(game: Pick<Game, 'turn_deadline'>): { startMs: number; endMs: number } | null {
  if (!game.turn_deadline) return null;
  const endMs = Date.parse(game.turn_deadline);
  return { startMs: endMs - DURATION_MS, endMs };
}

/* ───────────── 문구 ───────────── */

export const points = (n: number) => `${Math.max(0, Math.round(n)).toLocaleString('ko-KR')}점`;

/** 받침 있는 "점" 뒤 → "이에요" */
export const pointsSentence = (n: number) => `${points(n)}이에요`;

/** 터졌을 때 알약 (design.md 5.41): 그 판 첫 터짐 · 한 번에 4개 이상만 문구, 그 밖엔 null("+N점"만) */
export function popMessage(count: number, first: boolean): string | null {
  if (first) return '열 알 모았어요!';
  if (count >= 4) return `도토리 ${count}개로 열 알 모았어요!`;
  return null;
}

export const LAST_SECONDS_MESSAGE = '남은 시간 10초예요';

/* ───────────── 1인 기록 · 결과 (design.md 5.43) ───────────── */

export interface TenBest {
  member_id: string;
  best_score: number;
}

interface MemberLike {
  id: string;
  display_name: string;
  left_at: string | null;
}

export function myTenBest(bests: readonly TenBest[], me: string): number | null {
  return bests.find((b) => b.member_id === me)?.best_score ?? null;
}

/** 다른 멤버 중 최고 기록 (기록 카드·결과의 멤버 비교 줄) */
export function topOtherTenBest(bests: readonly TenBest[], me: string, members: readonly MemberLike[]): { member: MemberLike; score: number } | null {
  let top: { member: MemberLike; score: number } | null = null;
  for (const m of members) {
    if (m.id === me || m.left_at !== null) continue;
    const b = bests.find((x) => x.member_id === m.id);
    if (b && (!top || b.best_score > top.score)) top = { member: m, score: b.best_score };
  }
  return top;
}

export type SoloIcon = 'trophy' | 'nut';
export interface SoloResult {
  icon: SoloIcon;
  /** 아이콘 원 primary-soft */
  highlight: boolean;
  title: string;
  line: string;
}

/** 1인 결과 카드 문구. prevBest = 이번 판 전 내 최고 기록 (없으면 null) */
export function soloResult(score: number, prevBest: number | null): SoloResult {
  if (score <= 0) return { icon: 'nut', highlight: false, title: '끝났어요', line: '다음엔 하나 만들어 봐요' };
  if (prevBest === null) return { icon: 'trophy', highlight: true, title: '첫 기록이에요!', line: '다음엔 더 모아 봐요' };
  if (score > prevBest)
    return { icon: 'trophy', highlight: true, title: '새 최고 기록이에요!', line: `지난 최고 ${points(prevBest)}보다 ${points(score - prevBest)} 더 얻었어요` };
  return { icon: 'nut', highlight: false, title: '끝났어요', line: `내 최고 기록은 ${pointsSentence(prevBest)}` };
}

/* ───────────── 대전 결과 (design.md 5.44 표) ───────────── */

export type TenVsIcon = 'trophy' | 'smile' | 'handshake' | 'flag' | 'clock';
export interface TenVsResult {
  icon: TenVsIcon;
  title: string;
  line: string;
  win: boolean;
  /** 전적에 들어가나 (중단 = 아니오) */
  counted: boolean;
  /** 내기 상자 아래 큰 글자 (내기가 없으면 화면이 숨긴다) */
  bet: string | null;
}

/**
 * 대전 결과 문구. scores = 서버가 센 점수 (모르면 null — 그만하기·중단)
 * 명세 문구 "○○님 32점, 나 35점 — 이겼어요!"는 제목("이겼어요!")과 한 줄로 나눠 쓴다
 */
export function tenVsResult(
  game: Pick<Game, 'status' | 'end_reason' | 'winner_id' | 'black_id' | 'white_id'>,
  me: string,
  nameOf: (id: string) => string,
  scores: { mine: number; opp: number } | null,
): TenVsResult {
  const oppId = game.black_id === me ? game.white_id : game.black_id;
  const opp = `${nameOf(oppId)}님`;
  if (game.status !== 'finished') {
    return { icon: 'clock', title: '판을 닫았어요', line: '둘 다 기록이 오지 않아서 판을 닫았어요', win: false, counted: false, bet: null };
  }
  const line = scores ? `${opp} ${points(scores.opp)}, 나 ${points(scores.mine)}` : '';
  if (game.end_reason === 'draw') {
    return {
      icon: 'handshake',
      title: '비겼어요!',
      line: scores ? `둘 다 ${pointsSentence(scores.mine)}` : '',
      win: false,
      counted: true,
      bet: '이번엔 둘 다 무사해요',
    };
  }
  const win = game.winner_id === me;
  const bet = win ? `${opp} 당첨이에요!` : '이번엔 내가 당첨이에요';
  if (game.end_reason === 'quit') {
    return win
      ? { icon: 'trophy', title: '이겼어요!', line: `${opp}이 그만했어요`, win, counted: true, bet }
      : { icon: 'flag', title: '그만했어요', line: '다음엔 끝까지 해 봐요', win, counted: true, bet };
  }
  return win
    ? { icon: 'trophy', title: '이겼어요!', line, win, counted: true, bet }
    : { icon: 'smile', title: '아쉽게 졌어요', line, win, counted: true, bet };
}

/** 알림·토스트처럼 한 줄만 쓸 때 (명세 문구 그대로): "준호님 32점, 나 35점 — 이겼어요!" */
export function tenVsOneLine(r: TenVsResult): string {
  return r.line ? `${r.line} — ${r.title}` : r.title;
}
