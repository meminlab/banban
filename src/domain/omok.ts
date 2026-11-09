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
/** 이 시간 동안 수가 없으면 판을 "중단"으로 닫는다 */
export const ABANDON_HOURS = 24;

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

type GameTimes = Pick<Game, 'status' | 'invite_expires_at' | 'started_at' | 'last_move_at'>;

/**
 * 지금 시각 기준 상태: 서버가 아직 닫지 않은 지난 초대(10분)·멈춘 판(24시간)도 닫힌 것으로 본다.
 * 서버는 다음 쓰기나 sweep_games 때 같은 규칙으로 닫는다
 */
export function effectiveStatus(game: GameTimes, now: Date): GameStatus {
  if (game.status === 'invited' && Date.parse(game.invite_expires_at) <= now.getTime()) return 'expired';
  if (game.status === 'active') {
    const base = game.last_move_at ?? game.started_at;
    if (base && Date.parse(base) + ABANDON_HOURS * 3600_000 <= now.getTime()) return 'abandoned';
  }
  return game.status;
}

export const isOpenStatus = (s: GameStatus) => s === 'invited' || s === 'active';

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

/** 대국 화면 위 한 줄 (차례·결과) */
export function gameHeadline(game: Game, me: string, now: Date, nameOf: (memberId: string) => string): string {
  const status = effectiveStatus(game, now);
  const opp = opponentOf(game, me);
  switch (status) {
    case 'invited':
      return game.created_by === me ? `${nim(nameOf(opp))}을 기다리고 있어요` : inviteMessage(nameOf(game.created_by));
    case 'active':
      return turnMemberId(game) === me ? '내 차례예요' : `${nim(nameOf(opp))} 차례예요`;
    case 'declined':
      return game.created_by === me ? `${nim(nameOf(opp))}이 다음에 하자고 해요` : '초대를 거절했어요';
    case 'expired':
      return '초대가 만료됐어요';
    case 'abandoned':
      return `${ABANDON_HOURS}시간 동안 수가 없어 판을 멈췄어요`;
    case 'finished':
      if (game.end_reason === 'draw') return '판이 다 찼어요. 비겼어요';
      if (game.winner_id === me) {
        return game.end_reason === 'resign' ? `${nim(nameOf(opp))}이 기권했어요. 이겼어요` : '다섯 개를 이었어요! 이겼어요';
      }
      return game.end_reason === 'resign' ? '기권했어요. 한 판 더 할까요?' : '아쉽게 졌어요. 한 판 더 할까요?';
  }
}

/** 칸 읽기용 이름: "8행 8열" (1부터) */
export const cellLabel = (x: number, y: number) => `${y + 1}행 ${x + 1}열`;
