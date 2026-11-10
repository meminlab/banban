import { describe, expect, it } from 'vitest';
import type { Game, GameMove } from '../data/types';
import {
  buildBoard,
  canOfferDraw,
  cellIndex,
  clockOffset,
  doubleThreeAt,
  effectiveStatus,
  forbiddenCells,
  isForbidden,
  makesFive,
  remainingSeconds,
  remainingText,
  turnRemainingMs,
  formatHeadToHead,
  formatRemaining,
  gameHeadline,
  headToHead,
  initialOf,
  minutesLeftText,
  moveZoom,
  resultCopy,
  roomCopy,
  zoomOrigin,
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
    bet: null,
    seed: null,
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
    rule: 'free',
    turn_deadline: null,
    draw_offer_by: null,
    draw_offer_count: null,
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

describe('문구 (design.md 5.28·5.31)', () => {
  const names: Record<string, string> = { [A]: '민지', [B]: '준호' };
  const nameOf = (id: string) => names[id] ?? '?';
  it('차례', () => {
    expect(gameHeadline(game({ move_count: 0 }), B, NOW, nameOf)).toBe('내 차례예요');
    expect(gameHeadline(game({ move_count: 0 }), A, NOW, nameOf)).toBe('준호님 차례예요');
  });
  it('대기실: 답 기다림·받음·만료·거절·취소', () => {
    const g = game({ status: 'invited', started_at: null });
    expect(roomCopy('invited', g, A, nameOf).title).toBe('준호님 답을 기다리고 있어요');
    expect(roomCopy('invited', g, B, nameOf).title).toBe('민지님이 오목 한 판 하자고 해요');
    expect(roomCopy('expired', g, A, nameOf)).toEqual({ title: '초대가 만료됐어요', desc: '10분 동안 답이 없었어요. 다음에 다시 불러 볼까요?' });
    expect(roomCopy('declined', g, A, nameOf)).toEqual({ title: '준호님이 다음에 하재요', desc: '나중에 다시 초대해 보세요' });
    expect(roomCopy('canceled', g, B, nameOf).title).toBe('민지님이 초대를 취소했어요');
  });
  it('결과 시트 표', () => {
    const won = game({ status: 'finished', winner_id: B, end_reason: 'five' });
    expect(resultCopy(won, B, nameOf)).toMatchObject({ icon: 'trophy', title: '이겼어요!', line: '다섯 개를 이었어요', win: true });
    expect(resultCopy(won, A, nameOf)).toMatchObject({ icon: 'smile', title: '아쉽게 졌어요', line: '한 판 더 할까요?', win: false });
    const resigned = game({ status: 'finished', winner_id: B, end_reason: 'resign' });
    expect(resultCopy(resigned, B, nameOf)).toMatchObject({ icon: 'trophy', line: '민지님이 기권했어요' });
    expect(resultCopy(resigned, A, nameOf)).toMatchObject({ icon: 'flag', title: '기권했어요' });
    expect(resultCopy(game({ status: 'finished', end_reason: 'draw' }), A, nameOf)).toMatchObject({
      icon: 'handshake',
      title: '비겼어요',
      line: '판이 꽉 찼어요. 막상막하네요',
    });
    expect(resultCopy(game({ status: 'abandoned', end_reason: 'timeout' }), A, nameOf)).toMatchObject({
      icon: 'clock',
      title: '판을 닫았어요',
      counted: false,
    });
    expect(gameHeadline(game({ started_at: iso(-25 * HOUR) }), A, NOW, nameOf)).toBe('판을 닫았어요');
  });
  it('홈 카드 남은 시간 (분 단위)', () => {
    expect(minutesLeftText(9 * MIN + 41_000)).toBe('9분 남았어요');
    expect(minutesLeftText(59_000)).toBe('곧 사라져요');
  });
});

describe('확대 창 (9줄)', () => {
  it('가운데 맞춤, 판 밖으로 안 나감', () => {
    expect(zoomOrigin([7, 7])).toEqual([3, 3]);
    expect(zoomOrigin([0, 14])).toEqual([0, 6]);
    expect(moveZoom([3, 3], -5, 9)).toEqual([0, 6]);
  });
  it('이니셜', () => {
    expect(initialOf(' 준호')).toBe('준');
  });
});

/* ───────────── BANB-53: 33 금지 · 30초 · 무승부 제안 ───────────── */

/** 흑·백 돌을 바로 놓은 판 (순번 무관) */
function boardOf(black: [number, number][], white: [number, number][] = []) {
  const b = buildBoard([]);
  for (const [x, y] of black) b[cellIndex(x, y)] = 'black';
  for (const [x, y] of white) b[cellIndex(x, y)] = 'white';
  return b;
}

describe('33 금지 (QA RJ-01~12, 서버 omok_is_double_three 와 같은 결과)', () => {
  // [이름, 흑, 백, 두는 돌, 자리, 기대]  — forbidden / ok / win
  const cases: [string, [number, number][], [number, number][], 'black' | 'white', [number, number], 'forbidden' | 'ok' | 'win'][] = [
    ['RJ-01 세로·가로 열린 3', [[7, 5], [7, 6], [5, 7], [6, 7]], [], 'black', [7, 7], 'forbidden'],
    ['RJ-02 한 칸 띈 3', [[7, 4], [7, 5], [5, 7], [6, 7]], [], 'black', [7, 7], 'forbidden'],
    ['RJ-03 한쪽 막힘', [[7, 5], [7, 6], [5, 7], [6, 7]], [[7, 4]], 'black', [7, 7], 'ok'],
    ['RJ-04 한 칸 떨어져 막힘', [[7, 5], [7, 6], [5, 7], [6, 7]], [[7, 9]], 'black', [7, 7], 'forbidden'],
    ['RJ-05 44', [[7, 4], [7, 5], [7, 6], [4, 7], [5, 7], [6, 7]], [], 'black', [7, 7], 'ok'],
    ['RJ-06 43', [[7, 4], [7, 5], [7, 6], [5, 7], [6, 7]], [], 'black', [7, 7], 'ok'],
    ['RJ-07 장목', [[7, 2], [7, 3], [7, 4], [7, 6], [7, 7]], [], 'black', [7, 5], 'win'],
    ['RJ-08 5목 + 33', [[7, 3], [7, 4], [7, 5], [7, 6], [5, 7], [6, 7], [5, 5], [6, 6]], [], 'black', [7, 7], 'win'],
    ['RJ-09 다른 곳의 열린 3', [[2, 2], [3, 2], [4, 2], [5, 7], [6, 7]], [], 'black', [7, 7], 'ok'],
    ['RJ-10 판 끝', [[0, 7], [1, 7], [2, 6], [2, 5]], [], 'black', [2, 7], 'ok'],
    ['RJ-11 백도 금지', [], [[7, 5], [7, 6], [5, 7], [6, 7]], 'white', [7, 7], 'forbidden'],
    ['RJ-12 대각 2방향', [[5, 5], [6, 6], [9, 5], [8, 6]], [], 'black', [7, 7], 'forbidden'],
  ];
  it.each(cases)('%s', (_name, black, white, stone, [x, y], expected) => {
    const b = boardOf(black, white);
    const got = makesFive(b, x, y, stone) ? 'win' : isForbidden(b, x, y, stone) ? 'forbidden' : 'ok';
    expect(got).toBe(expected);
  });
  it('X 표시 = 금지 자리만, 상대 돌 색 기준으로는 따로', () => {
    const b = boardOf([[7, 5], [7, 6], [5, 7], [6, 7]]);
    const black = forbiddenCells(b, 'black');
    expect(black.has(cellIndex(7, 7))).toBe(true);
    expect(forbiddenCells(b, 'white').size).toBe(0);
    // 막히면 X 가 사라진다 (RX-06)
    b[cellIndex(7, 4)] = 'white';
    expect(forbiddenCells(b, 'black').has(cellIndex(7, 7))).toBe(false);
  });
  it('이미 4인 줄은 3으로 세지 않는다 (한 칸 띈 4 + 열린 3 = 43)', () => {
    // 세로 (7,3)(7,4)(7,5)_(7,7) → (7,6)이면 5 → 4. 가로 (5,7)(6,7)+(7,7) 열린 3
    expect(doubleThreeAt(boardOf([[7, 3], [7, 4], [7, 5], [5, 7], [6, 7]]), 7, 7, 'black')).toBe(false);
  });
});

describe('한 수 30초', () => {
  const nameOf = (id: string) => ({ [A]: '민지', [B]: '준호' })[id] ?? '?';
  it('서버 시계 보정: 보낸·받은 때의 가운데', () => {
    expect(clockOffset(10_500, 1_000, 2_000)).toBe(9_000);
  });
  it('남은 시간 = 마감 - 서버 지금. 마감 없는 판·끝난 판은 null', () => {
    const now = NOW.getTime();
    expect(turnRemainingMs(game({ rule: 'renju_lite', turn_deadline: iso(8_200) }), now)).toBe(8_200);
    expect(turnRemainingMs(game({ rule: 'free' }), now)).toBeNull();
    expect(turnRemainingMs(game({ status: 'finished', turn_deadline: iso(1000) }), now)).toBeNull();
    expect(remainingSeconds(8_200)).toBe(9);
    expect(remainingSeconds(-300)).toBe(0);
    expect(remainingText(8)).toBe('남은 시간 8초예요');
  });
  it('30초 판은 24시간 중단을 화면에서도 적용하지 않는다 (Q19)', () => {
    expect(effectiveStatus(game({ rule: 'renju_lite', turn_deadline: iso(-25 * HOUR), started_at: iso(-25 * HOUR) }), NOW)).toBe('active');
    expect(effectiveStatus(game({ rule: 'free', started_at: iso(-25 * HOUR) }), NOW)).toBe('abandoned');
  });
  it('결과 문구: 시간 초과·무승부 합의', () => {
    const t = game({ status: 'finished', winner_id: B, end_reason: 'turn_timeout' });
    expect(resultCopy(t, A, nameOf)).toMatchObject({ icon: 'clock', title: '시간이 다 됐어요', line: '이번 판은 준호님이 이겼어요', counted: true });
    expect(resultCopy(t, B, nameOf)).toMatchObject({ icon: 'trophy', title: '이겼어요!', win: true });
    expect(resultCopy(game({ status: 'finished', end_reason: 'draw_agreed' }), A, nameOf)).toMatchObject({
      icon: 'handshake',
      title: '무승부로 끝냈어요',
      counted: true,
    });
    expect(headToHead([game({ status: 'finished', end_reason: 'draw_agreed' })], A, B)).toEqual({ win: 0, loss: 0, draw: 1 });
  });
});

describe('무승부 제안', () => {
  it('내 차례·답 기다리는 제안 없음·지난 제안 뒤 수가 늘었을 때만', () => {
    // move_count 0 → 흑(B) 차례
    expect(canOfferDraw(game(), B)).toBe(true);
    expect(canOfferDraw(game(), A)).toBe(false);
    expect(canOfferDraw(game({ draw_offer_by: B, draw_offer_count: 0 }), B)).toBe(false);
    expect(canOfferDraw(game({ draw_offer_count: 0 }), B)).toBe(false); // 거절당한 같은 차례 (DR-06)
    expect(canOfferDraw(game({ move_count: 2, draw_offer_count: 0 }), B)).toBe(true);
    expect(canOfferDraw(game({ status: 'finished' }), B)).toBe(false);
  });
});

describe('게임 종류 (BANB-55)', () => {
  it('전적은 종류마다 따로 (오목 / 반반 쌓기 대전)', async () => {
    const { headToHead, inviteMessage, gameName } = await import('./omok');
    const done = (kind: Game['kind'], winner: string, id: string) => game({ id, kind, status: 'finished', winner_id: winner, end_reason: kind === 'omok' ? 'five' : 'topout' });
    const games = [done('omok', A, 'o1'), done('stack_vs', B, 's1'), done('stack_vs', B, 's2')];
    expect(headToHead(games, A, B)).toEqual({ win: 1, loss: 0, draw: 0 });
    expect(headToHead(games, A, B, 'stack_vs')).toEqual({ win: 0, loss: 2, draw: 0 });
    expect(inviteMessage('민지', 'stack_vs')).toBe('민지님이 반반 쌓기 대전을 하재요');
    expect(inviteMessage('민지')).toBe('민지님이 오목 한 판 하자고 해요');
    expect(gameName('stack_vs')).toBe('반반 쌓기 대전');
  });

  it('반반 쌓기 대전은 24시간 중단을 화면에서 보지 않는다 (서버 30초 끊김으로 닫음)', async () => {
    const { effectiveStatus } = await import('./omok');
    const g = game({ kind: 'stack_vs', rule: 'stack_vs', status: 'active', started_at: iso(-30 * HOUR), last_move_at: null });
    expect(effectiveStatus(g, NOW)).toBe('active');
  });
});
