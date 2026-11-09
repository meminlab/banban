/**
 * 같이 놀기 — 오목 (BANB-49). 화면과 분리된 규칙·표시 계산.
 * 승부 판정·차례·빈칸 검사는 서버(supabase/migrations/20261109230000_game_omok.sql)가 한다.
 * 여기 함수는 화면 표시용(판 그리기, 이긴 줄 강조, 남은 시간, 전적, 문구)이고 서버와 같은 규칙을 따른다.
 */
import type { Game, GameMove, GameStatus } from '../data/types';

export const BOARD_SIZE = 15;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
/** 초대 유효 시간 (서버 invite_expires_at = 만든 시각 + 10분) */
export const INVITE_MINUTES = 10;
/** 이 시간 동안 수가 없으면 판을 "중단"으로 닫는다 (free 판만. renju_lite 는 30초 마감) */
export const ABANDON_HOURS = 24;
/** renju_lite 한 수 시간 (서버 turn_deadline = 대국 시작·둔 시각 + 30초) */
export const TURN_SECONDS = 30;
/** 이 초 이하로 남으면 차례 줄 강조 + "남은 시간 N초예요" */
export const TURN_WARN_SECONDS = 10;

export type Stone = 'black' | 'white';
/** 판: index = y * 15 + x (행 우선) */
export type Board = (Stone | null)[];

export const cellIndex = (x: number, y: number) => y * BOARD_SIZE + x;
export const inBoard = (x: number, y: number) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;

/** 순번의 돌 색: 홀수 = 흑(선공) */
export const stoneOfSeq = (seq: number): Stone => (seq % 2 === 1 ? 'black' : 'white');

export function buildBoard(moves: readonly Pick<GameMove, 'seq' | 'x' | 'y'>[]): Board {
  const board: Board = new Array(CELL_COUNT).fill(null);
  for (const m of moves) if (inBoard(m.x, m.y)) board[cellIndex(m.x, m.y)] = stoneOfSeq(m.seq);
  return board;
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/**
 * (x, y)의 돌을 지나는 5개 이상 이어진 줄(장목 포함). 없으면 null.
 * 이긴 줄 강조용 — 서버 omok_has_five 와 같은 규칙
 */
export function winningLine(board: Board, x: number, y: number): [number, number][] | null {
  const stone = inBoard(x, y) ? board[cellIndex(x, y)] : null;
  if (!stone) return null;
  for (const [dx, dy] of DIRS) {
    const line: [number, number][] = [[x, y]];
    for (const sign of [1, -1]) {
      let k = 1;
      for (;;) {
        const nx = x + sign * k * dx;
        const ny = y + sign * k * dy;
        if (!inBoard(nx, ny) || board[cellIndex(nx, ny)] !== stone) break;
        if (sign === 1) line.push([nx, ny]);
        else line.unshift([nx, ny]);
        k += 1;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

/**
 * 받은 수를 순번대로 합친다(같은 순번은 한 번만). gap = 중간 순번이 비었음 → 서버에서 다시 받아야 한다
 */
export function mergeMoves(known: readonly GameMove[], incoming: readonly GameMove[]): { moves: GameMove[]; gap: boolean } {
  const bySeq = new Map<number, GameMove>();
  for (const m of known) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  const moves = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const gap = moves.some((m, i) => m.seq !== i + 1);
  return { moves, gap };
}

type GameTimes = Pick<Game, 'status' | 'invite_expires_at' | 'started_at' | 'last_move_at'> & { rule?: Game['rule'] };

/**
 * 지금 시각 기준 상태: 서버가 아직 닫지 않은 지난 초대(10분)·멈춘 판(free 24시간)도 닫힌 것으로 본다.
 * 서버는 다음 쓰기나 sweep_games 때 같은 규칙으로 닫는다.
 * renju_lite 의 30초 마감은 여기서 보지 않는다 — 기기 시계가 아닌 서버 시각으로 판정해야 해서 판 화면이 claim_turn_timeout 을 부른다
 */
export function effectiveStatus(game: GameTimes, now: Date): GameStatus {
  if (game.status === 'invited' && Date.parse(game.invite_expires_at) <= now.getTime()) return 'expired';
  if (game.status === 'active' && game.rule !== 'renju_lite') {
    const base = game.last_move_at ?? game.started_at;
    if (base && Date.parse(base) + ABANDON_HOURS * 3600_000 <= now.getTime()) return 'abandoned';
  }
  return game.status;
}

export const isOpenStatus = (s: GameStatus) => s === 'invited' || s === 'active';

/* ───────────── 한 수 30초 (BANB-53) ───────────── */

/** 서버 시각 - 기기 시각 (ms). 요청을 보낸 때와 받은 때의 가운데를 서버 시각을 잰 때로 본다 */
export function clockOffset(serverMs: number, sentAtMs: number, receivedAtMs: number): number {
  return serverMs - (sentAtMs + receivedAtMs) / 2;
}

/** 지금 차례의 남은 ms (서버 기준 지금 serverNowMs). 마감이 없는 판·대국 중이 아니면 null. 음수 = 지남 */
export function turnRemainingMs(game: Pick<Game, 'status' | 'turn_deadline'>, serverNowMs: number): number | null {
  if (game.status !== 'active' || !game.turn_deadline) return null;
  return Date.parse(game.turn_deadline) - serverNowMs;
}

/** 화면에 보일 남은 초 (올림, 0 이상) */
export const remainingSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/** "남은 시간 8초예요" */
export const remainingText = (seconds: number) => `남은 시간 ${seconds}초예요`;

/* ───────────── 33 금지 (BANB-53, renju_lite) ───────────── */

/**
 * (x, y)에 stone 을 두면 그 돌을 지나는 5개 이상 연속(장목 포함)이 되나. (x, y)는 빈칸으로 본다
 */
export function makesFive(board: Board, x: number, y: number, stone: Stone): boolean {
  for (const [dx, dy] of DIRS) {
    let len = 1;
    for (const sign of [1, -1]) {
      let k = 1;
      while (inBoard(x + sign * k * dx, y + sign * k * dy) && board[cellIndex(x + sign * k * dx, y + sign * k * dy)] === stone) {
        len += 1;
        k += 1;
      }
    }
    if (len >= 5) return true;
  }
  return false;
}

/**
 * (x, y)에 stone 을 두면 33인가 — 서버 omok_is_double_three 와 같은 규칙.
 * 그 수를 지나는 4방향마다
 *   - 4: 빈칸 하나를 더 두면 그 수를 지나는 5개 이상 연속 → 3으로 세지 않는다 (44·43 허용)
 *   - 열린 3: 빈칸 e 하나를 더 두면 그 수와 e 를 포함한 정확히 4개 연속 + 양끝이 판 안 빈칸 (한 칸 띈 X·XX 포함)
 * 열린 3인 방향이 2개 이상이면 true. 그 빈칸이 다시 금지수인지는 보지 않는다(단순화)
 */
export function doubleThreeAt(board: Board, x: number, y: number, stone: Stone): boolean {
  // 1 = 내 돌(새 돌 포함), 2 = 상대 돌, 0 = 빈칸, -1 = 판 밖
  const at = (cx: number, cy: number): number => {
    if (!inBoard(cx, cy)) return -1;
    if (cx === x && cy === y) return 1;
    const v = board[cellIndex(cx, cy)];
    return v === null ? 0 : v === stone ? 1 : 2;
  };
  let threes = 0;
  for (const [dx, dy] of DIRS) {
    let four = false;
    let open = false;
    for (let k = -4; k <= 4; k += 1) {
      if (k === 0 || at(x + k * dx, y + k * dy) !== 0) continue;
      const mine = (d: number) => d === k || at(x + d * dx, y + d * dy) === 1;
      let s = 0;
      while (mine(s - 1)) s -= 1;
      let t = 0;
      while (mine(t + 1)) t += 1;
      const len = t - s + 1;
      if (len >= 5) four = true;
      else if (len === 4 && k >= s && k <= t && at(x + (s - 1) * dx, y + (s - 1) * dy) === 0 && at(x + (t + 1) * dx, y + (t + 1) * dy) === 0)
        open = true;
    }
    if (open && !four) threes += 1;
  }
  return threes >= 2;
}

/** 금지수: 빈칸이고, 5목이 되지 않고(승리가 먼저), 33 */
export function isForbidden(board: Board, x: number, y: number, stone: Stone): boolean {
  return inBoard(x, y) && board[cellIndex(x, y)] === null && !makesFive(board, x, y, stone) && doubleThreeAt(board, x, y, stone);
}

/** 판 전체의 금지 자리 (index = cellIndex) */
export function forbiddenCells(board: Board, stone: Stone): Set<number> {
  const out = new Set<number>();
  for (let y = 0; y < BOARD_SIZE; y += 1)
    for (let x = 0; x < BOARD_SIZE; x += 1) if (isForbidden(board, x, y, stone)) out.add(cellIndex(x, y));
  return out;
}

/* ───────────── 무승부 제안 (BANB-53) ───────────── */

/** 내가 지금 무승부를 제안할 수 있나: 대국 중·내 차례·답을 기다리는 제안 없음·지난 제안 뒤 수가 늘었음(상대가 한 수 둠) */
export function canOfferDraw(
  game: Pick<Game, 'status' | 'move_count' | 'black_id' | 'white_id' | 'draw_offer_by' | 'draw_offer_count'>,
  me: string,
): boolean {
  if (turnMemberId(game) !== me || game.draw_offer_by) return false;
  return game.draw_offer_count == null || game.move_count > game.draw_offer_count;
}

/** 초대가 만료될 때까지 남은 ms (0 이상) */
export function inviteRemainingMs(game: Pick<Game, 'invite_expires_at'>, now: Date): number {
  return Math.max(0, Date.parse(game.invite_expires_at) - now.getTime());
}

/** "9:41" — 초대 남은 시간 (분:초) */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Players = Pick<Game, 'black_id' | 'white_id'>;

export const isPlayer = (game: Players, memberId: string) => game.black_id === memberId || game.white_id === memberId;
export const opponentOf = (game: Players, memberId: string) => (game.black_id === memberId ? game.white_id : game.black_id);
export const colorOf = (game: Players, memberId: string): Stone => (game.black_id === memberId ? 'black' : 'white');

/** 지금 둘 사람 (member id). 대국 중이 아니면 null */
export function turnMemberId(game: Players & Pick<Game, 'status' | 'move_count'>): string | null {
  if (game.status !== 'active') return null;
  return game.move_count % 2 === 0 ? game.black_id : game.white_id;
}

/** 초대받은 사람 = 두 사람 중 초대한 사람이 아닌 쪽 */
export const inviteeOf = (game: Players & Pick<Game, 'created_by'>) => opponentOf(game, game.created_by);

export interface HeadToHead {
  win: number;
  loss: number;
  draw: number;
}

/** 나와 상대 둘 사이 전적 (끝난 판만. 중단·거절·만료는 세지 않는다) */
export function headToHead(games: readonly Game[], me: string, opponent: string): HeadToHead {
  const r: HeadToHead = { win: 0, loss: 0, draw: 0 };
  for (const g of games) {
    if (g.status !== 'finished' || !isPlayer(g, me) || !isPlayer(g, opponent) || me === opponent) continue;
    if (g.winner_id === null) r.draw += 1;
    else if (g.winner_id === me) r.win += 1;
    else r.loss += 1;
  }
  return r;
}

/** "3승 2패 1무" / 기록 없으면 "아직 둔 판이 없어요" */
export function formatHeadToHead(r: HeadToHead): string {
  if (r.win + r.loss + r.draw === 0) return '아직 둔 판이 없어요';
  return `${r.win}승 ${r.loss}패 ${r.draw}무`;
}

export type MyOpenGame =
  | { kind: 'invited-me'; game: Game } // 나를 초대한 판 (수락/거절)
  | { kind: 'waiting'; game: Game } // 내가 초대하고 기다리는 판
  | { kind: 'playing'; game: Game }; // 대국 중

/**
 * 나와 관련된 진행 중인 판 (서버 규칙상 한 사람당 1개). 홈 카드·배너가 보여 줄 것.
 * 지난 초대·멈춘 판은 빼고, 혹시 여럿이면 가장 최근 것
 */
export function myOpenGame(games: readonly Game[], me: string, now: Date): MyOpenGame | null {
  const open = games
    .filter((g) => isPlayer(g, me) && isOpenStatus(effectiveStatus(g, now)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const g = open[0];
  if (!g) return null;
  if (g.status === 'active') return { kind: 'playing', game: g };
  return g.created_by === me ? { kind: 'waiting', game: g } : { kind: 'invited-me', game: g };
}

/** 이 사람이 다른 판을 하고 있나 (상대 고르기에서 "다른 판 중" 표시) */
export function isBusy(games: readonly Game[], memberId: string, now: Date): boolean {
  return games.some((g) => isPlayer(g, memberId) && isOpenStatus(effectiveStatus(g, now)));
}

/** 이름 뒤 조사 없이 쓰는 호칭 */
const nim = (name: string) => `${name}님`;

/** 초대 알림 문구 */
export const inviteMessage = (inviterName: string) => `${nim(inviterName)}이 오목 한 판 하자고 해요`;

/** 초대 남은 시간 (분 단위, 홈 카드): "9분 남았어요" / 1분 미만 "곧 사라져요" */
export function minutesLeftText(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? '곧 사라져요' : `${m}분 남았어요`;
}

/** 지금 차례 문구 (차례 줄·홈 카드) */
export function turnText(game: Game, me: string, nameOf: (memberId: string) => string): string {
  return turnMemberId(game) === me ? '내 차례예요' : `${nim(nameOf(opponentOf(game, me)))} 차례예요`;
}

/** 대기실 (design.md 5.28) — invited / declined / canceled / expired 일 때 */
export type RoomCopy = { title: string; desc: string };
export function roomCopy(status: GameStatus, game: Game, me: string, nameOf: (memberId: string) => string): RoomCopy {
  const opp = nim(nameOf(opponentOf(game, me)));
  const iInvited = game.created_by === me;
  switch (status) {
    case 'expired':
      return { title: '초대가 만료됐어요', desc: '10분 동안 답이 없었어요. 다음에 다시 불러 볼까요?' };
    case 'declined':
      return iInvited
        ? { title: `${opp}이 다음에 하재요`, desc: '나중에 다시 초대해 보세요' }
        : { title: '다음에 하기로 했어요', desc: `${opp}에게 나중에 다시 하자고 해 보세요` };
    case 'canceled':
      return iInvited
        ? { title: '초대를 취소했어요', desc: '언제든 다시 초대할 수 있어요' }
        : { title: `${opp}이 초대를 취소했어요`, desc: '다음에 같이 해요' };
    default:
      return iInvited
        ? { title: `${opp} 답을 기다리고 있어요`, desc: `${opp} 휴대폰에 초대를 보냈어요` }
        : { title: inviteMessage(nameOf(game.created_by)), desc: '10분 안에 답해 주세요' };
  }
}

export type ResultIcon = 'trophy' | 'smile' | 'flag' | 'handshake' | 'clock';
export interface ResultCopy {
  icon: ResultIcon;
  title: string;
  line: string;
  /** 이김 (아이콘 원을 포인트 색으로) */
  win: boolean;
  /** 전적 줄을 보일까 (중단된 판은 전적에 안 들어감) */
  counted: boolean;
}

/** 결과 시트 문구 (design.md 5.31) — finished / abandoned */
export function resultCopy(game: Game, me: string, nameOf: (memberId: string) => string): ResultCopy {
  const opp = nim(nameOf(opponentOf(game, me)));
  if (game.status === 'abandoned') {
    return {
      icon: 'clock',
      title: '판을 닫았어요',
      line: `${ABANDON_HOURS}시간 동안 아무도 두지 않았어요. 새로 한 판 할까요?`,
      win: false,
      counted: false,
    };
  }
  if (game.end_reason === 'draw') return { icon: 'handshake', title: '비겼어요', line: '판이 꽉 찼어요. 막상막하네요', win: false, counted: true };
  if (game.end_reason === 'draw_agreed') return { icon: 'handshake', title: '무승부로 끝냈어요', line: '서로 비기기로 했어요. 한 판 더 할까요?', win: false, counted: true };
  const won = game.winner_id === me;
  if (game.end_reason === 'turn_timeout') {
    return won
      ? { icon: 'trophy', title: '이겼어요!', line: `시간이 다 됐어요. 이번 판은 내가 이겼어요`, win: true, counted: true }
      : { icon: 'clock', title: '시간이 다 됐어요', line: `이번 판은 ${opp}이 이겼어요`, win: false, counted: true };
  }
  if (game.end_reason === 'resign') {
    return won
      ? { icon: 'trophy', title: '이겼어요!', line: `${opp}이 기권했어요`, win: true, counted: true }
      : { icon: 'flag', title: '기권했어요', line: '한 판 더 할까요?', win: false, counted: true };
  }
  return won
    ? { icon: 'trophy', title: '이겼어요!', line: '다섯 개를 이었어요', win: true, counted: true }
    : { icon: 'smile', title: '아쉽게 졌어요', line: '한 판 더 할까요?', win: false, counted: true };
}

/** 대국 화면 한 줄 (홈 카드·같이 놀기 화면의 "두던 판") */
export function gameHeadline(game: Game, me: string, now: Date, nameOf: (memberId: string) => string): string {
  const status = effectiveStatus(game, now);
  if (status === 'active') return turnText(game, me, nameOf);
  if (status === 'finished' || status === 'abandoned') return resultCopy({ ...game, status }, me, nameOf).title;
  return roomCopy(status, game, me, nameOf).title;
}

/** 이름 첫 글자 (아바타) */
export const initialOf = (name: string) => Array.from(name.trim())[0] ?? '?';

/** 확대 창 크기 (9줄) */
export const ZOOM_LINES = 9;
/** 확대 창 왼쪽 위 (x, y): 중심 칸이 가운데 오게, 판 밖으로 나가지 않게 */
export function zoomOrigin(center: [number, number]): [number, number] {
  const clamp = (v: number) => Math.min(BOARD_SIZE - ZOOM_LINES, Math.max(0, v - Math.floor(ZOOM_LINES / 2)));
  return [clamp(center[0]), clamp(center[1])];
}
/** 확대 창을 dx, dy 칸만큼 옮긴다 (판 밖으로 안 나감) */
export function moveZoom(origin: [number, number], dx: number, dy: number): [number, number] {
  const clamp = (v: number) => Math.min(BOARD_SIZE - ZOOM_LINES, Math.max(0, v));
  return [clamp(origin[0] + dx), clamp(origin[1] + dy)];
}

/** 칸 읽기용 이름: "8행 8열" (1부터, 행 = 위에서부터) */
export const cellLabel = (x: number, y: number) => `${y + 1}행 ${x + 1}열`;
