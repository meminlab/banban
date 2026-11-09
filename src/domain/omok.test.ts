import { describe, expect, it } from 'vitest';
import type { Game, GameMove } from '../data/types';
import {
  buildBoard,
  cellIndex,
  effectiveStatus,
  formatHeadToHead,
  formatRemaining,
  gameHeadline,
  headToHead,
  inviteRemainingMs,
  isBusy,
  mergeMoves,
  myOpenGame,
  turnMemberId,
  winningLine,
} from './omok';

const A = 'member-a';
const B = 'member-b';
const C = 'member-c';
const NOW = new Date('2026-11-09T12:00:00Z');
const iso = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

function game(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    ledger_id: 'l1',
    kind: 'omok',
    black_id: B,
    white_id: A,
    status: 'active',
    winner_id: null,
    end_reason: null,
    move_count: 0,
    created_by: A,
    rematch_of: null,
    created_at: iso(-5 * MIN),
    invite_expires_at: iso(5 * MIN),
    started_at: iso(-4 * MIN),
    last_move_at: null,
    finished_at: null,
    ...over,
  };
}

function moves(cells: [number, number][]): GameMove[] {
  return cells.map(([x, y], i) => ({
    game_id: 'g1',
    ledger_id: 'l1',
    seq: i + 1,
    x,
    y,
    member_id: i % 2 === 0 ? B : A,
    created_at: iso(0),
  }));
}

describe('buildBoard', () => {
  it('홀수 순번은 흑, 짝수는 백', () => {
    const board = buildBoard(moves([[7, 7], [8, 7]]));
    expect(board[cellIndex(7, 7)]).toBe('black');
    expect(board[cellIndex(8, 7)]).toBe('white');
    expect(board.filter(Boolean)).toHaveLength(2);
  });
});

describe('winningLine', () => {
  // 흑: 가로 (3..7, 0) / 백: 아무 데나
  const five = moves([[3, 0], [0, 14], [4, 0], [1, 14], [5, 0], [2, 14], [6, 0], [3, 14], [7, 0]]);

  it('5목이면 그 줄(왼쪽부터)', () => {
    expect(winningLine(buildBoard(five), 5, 0)).toEqual([[3, 0], [4, 0], [5, 0], [6, 0], [7, 0]]);
  });
  it('장목(6개)도 승리 줄', () => {
    const six = moves([[0, 5], [9, 9], [1, 5], [9, 10], [2, 5], [9, 11], [4, 5], [9, 12], [5, 5], [14, 0], [3, 5]]);
    expect(winningLine(buildBoard(six), 3, 5)).toHaveLength(6);
  });
  it('대각선 (/ 방향, 가장자리)', () => {
    const diag = moves([[14, 0], [0, 0], [13, 1], [0, 1], [12, 2], [0, 2], [11, 3], [0, 3], [10, 4]]);
    expect(winningLine(buildBoard(diag), 10, 4)).toHaveLength(5);
  });
  it('4개 + 한 칸 띄움은 아님, 빈칸은 null', () => {
    const four = moves([[0, 0], [9, 9], [1, 0], [9, 10], [2, 0], [9, 11], [3, 0], [9, 12], [5, 0]]);
    expect(winningLine(buildBoard(four), 3, 0)).toBeNull();
    expect(winningLine(buildBoard(four), 4, 0)).toBeNull();
  });
});

describe('mergeMoves', () => {
  const all = moves([[1, 1], [2, 2], [3, 3]]);
  it('같은 순번은 한 번, 순번 순서', () => {
    const r = mergeMoves([all[0], all[1]], [all[2], all[1]]);
    expect(r.moves.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(r.gap).toBe(false);
  });
  it('중간이 비면 gap', () => {
    expect(mergeMoves([all[0]], [all[2]]).gap).toBe(true);
  });
});

describe('effectiveStatus', () => {
  it('초대 10분이 지나면 만료로 본다', () => {
    expect(effectiveStatus(game({ status: 'invited', started_at: null, invite_expires_at: iso(1000) }), NOW)).toBe('invited');
    expect(effectiveStatus(game({ status: 'invited', started_at: null, invite_expires_at: iso(0) }), NOW)).toBe('expired');
  });
  it('마지막 수(없으면 시작)부터 24시간이면 중단', () => {
    expect(effectiveStatus(game({ started_at: iso(-24 * HOUR) }), NOW)).toBe('abandoned');
    expect(effectiveStatus(game({ started_at: iso(-30 * HOUR), last_move_at: iso(-23 * HOUR) }), NOW)).toBe('active');
    expect(effectiveStatus(game({ started_at: iso(-30 * HOUR), last_move_at: iso(-24 * HOUR) }), NOW)).toBe('abandoned');
  });
  it('끝난 판은 그대로', () => {
    expect(effectiveStatus(game({ status: 'finished', started_at: iso(-48 * HOUR) }), NOW)).toBe('finished');
  });
});

describe('초대 남은 시간', () => {
  it('분:초, 0 아래로 안 내려감', () => {
    expect(formatRemaining(inviteRemainingMs(game({ invite_expires_at: iso(9 * MIN + 41_000) }), NOW))).toBe('9:41');
    expect(formatRemaining(inviteRemainingMs(game({ invite_expires_at: iso(-1000) }), NOW))).toBe('0:00');
  });
});

describe('turnMemberId', () => {
  it('짝수 수 다음은 흑, 홀수 다음은 백, 대국 중 아니면 없음', () => {
    expect(turnMemberId(game({ move_count: 0 }))).toBe(B);
    expect(turnMemberId(game({ move_count: 1 }))).toBe(A);
    expect(turnMemberId(game({ status: 'finished', move_count: 9 }))).toBeNull();
  });
});

describe('headToHead', () => {
  const games = [
    game({ id: '1', status: 'finished', winner_id: A, end_reason: 'five' }),
    game({ id: '2', status: 'finished', winner_id: B, end_reason: 'resign', black_id: A, white_id: B }),
    game({ id: '3', status: 'finished', winner_id: null, end_reason: 'draw' }),
    game({ id: '4', status: 'abandoned', end_reason: 'timeout' }),
    game({ id: '5', status: 'finished', winner_id: A, end_reason: 'five', black_id: C }),
  ];
  it('두 사람 사이 끝난 판만 센다 (중단·다른 상대 제외)', () => {
    expect(headToHead(games, A, B)).toEqual({ win: 1, loss: 1, draw: 1 });
    expect(headToHead(games, B, A)).toEqual({ win: 1, loss: 1, draw: 1 });
    expect(headToHead(games, A, C)).toEqual({ win: 1, loss: 0, draw: 0 });
  });
  it('문구', () => {
    expect(formatHeadToHead({ win: 3, loss: 2, draw: 1 })).toBe('3승 2패 1무');
    expect(formatHeadToHead({ win: 0, loss: 0, draw: 0 })).toBe('아직 둔 판이 없어요');
  });
});

describe('myOpenGame / isBusy', () => {
  it('나를 초대한 판 / 내가 기다리는 판 / 대국 중', () => {
    const invited = game({ status: 'invited', started_at: null });
    expect(myOpenGame([invited], B, NOW)).toEqual({ kind: 'invited-me', game: invited });
    expect(myOpenGame([invited], A, NOW)).toEqual({ kind: 'waiting', game: invited });
    expect(myOpenGame([game()], A, NOW)?.kind).toBe('playing');
    expect(myOpenGame([invited], C, NOW)).toBeNull();
  });
  it('지난 초대·끝난 판은 없음으로', () => {
    const old = game({ status: 'invited', started_at: null, invite_expires_at: iso(-1) });
    expect(myOpenGame([old, game({ status: 'finished', winner_id: A, end_reason: 'five' })], B, NOW)).toBeNull();
    expect(isBusy([old], B, NOW)).toBe(false);
    expect(isBusy([game()], B, NOW)).toBe(true);
    expect(isBusy([game()], C, NOW)).toBe(false);
  });
});

describe('gameHeadline', () => {
  const names: Record<string, string> = { [A]: '민지', [B]: '준호' };
  const nameOf = (id: string) => names[id] ?? '?';
  it('차례', () => {
    expect(gameHeadline(game({ move_count: 0 }), B, NOW, nameOf)).toBe('내 차례예요');
    expect(gameHeadline(game({ move_count: 0 }), A, NOW, nameOf)).toBe('준호님 차례예요');
  });
  it('초대', () => {
    const g = game({ status: 'invited', started_at: null });
    expect(gameHeadline(g, B, NOW, nameOf)).toBe('민지님이 오목 한 판 하자고 해요');
    expect(gameHeadline(g, A, NOW, nameOf)).toBe('준호님을 기다리고 있어요');
  });
  it('결과', () => {
    const won = game({ status: 'finished', winner_id: B, end_reason: 'five' });
    expect(gameHeadline(won, B, NOW, nameOf)).toBe('다섯 개를 이었어요! 이겼어요');
    expect(gameHeadline(won, A, NOW, nameOf)).toBe('아쉽게 졌어요. 한 판 더 할까요?');
    const resigned = game({ status: 'finished', winner_id: B, end_reason: 'resign' });
    expect(gameHeadline(resigned, B, NOW, nameOf)).toBe('민지님이 기권했어요. 이겼어요');
    expect(gameHeadline(game({ status: 'finished', end_reason: 'draw' }), A, NOW, nameOf)).toBe('판이 다 찼어요. 비겼어요');
    expect(gameHeadline(game({ started_at: iso(-25 * HOUR) }), A, NOW, nameOf)).toBe('24시간 동안 수가 없어 판을 멈췄어요');
  });
});
