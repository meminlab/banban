import { describe, expect, it } from 'vitest';
import {
  COLS,
  PIECES,
  PIECE_KINDS,
  ROWS,
  act,
  amountFor,
  cellsOf,
  clearMessage,
  distinctRotations,
  dropPosition,
  emptyBoard,
  endView,
  fallInterval,
  fits,
  levelFor,
  levelMessage,
  newGame,
  pickPiece,
  removeRows,
  rotated,
  shapeOf,
  sizeOf,
  spawnAt,
  step,
  topOtherBest,
  type Board,
  type PieceKind,
  type StackState,
} from './stack';

/** 늘 같은 값을 돌려주는 rng (첫 조각 = coin1: 가중치 앞쪽) */
const fixed = (v: number) => () => v;
const opt = { rng: fixed(0), clearMs: 0 };

/** 바닥 n줄을 x = hole 만 비우고 채운다 */
function filledBoard(rows: number[], hole: number | null = null): Board {
  const b = emptyBoard();
  for (const y of rows) for (let x = 0; x < COLS; x++) if (x !== hole) b[y][x] = { id: 900 + y, kind: 'coin1', deco: false };
  return b;
}

function stateWith(board: Board, kind: PieceKind, x: number, y: number, rot = 0): StackState {
  return { ...newGame(fixed(0)), board, active: { kind, rot, x, y, id: 50 }, next: 'coin1', recent: ['coin1', 'coin2'], nextId: 51 };
}

describe('조각 세트 (design.md 5.33)', () => {
  it('6종, 칸 수 1·2·3·3·4·5, 확률 합 100', () => {
    expect(PIECE_KINDS).toHaveLength(6);
    expect(PIECE_KINDS.map((k) => PIECES[k].cells.length)).toEqual([1, 2, 3, 3, 4, 5]);
    expect(PIECE_KINDS.reduce((s, k) => s + PIECES[k].weight, 0)).toBe(100);
  });

  it('표준 4칸 일자·S/Z·T·L/J 모양이 없다 (4칸은 2×2 지갑뿐)', () => {
    const four = PIECE_KINDS.filter((k) => PIECES[k].cells.length === 4);
    expect(four).toEqual(['wallet']);
    expect(sizeOf(shapeOf('wallet', 0))).toEqual({ w: 2, h: 2 });
  });

  it('돌린 모양 수: 동전 1 · 동전 둘 2 · 지폐 2 · 꺾인 동전 4 · 지갑 1 · 저금통 4', () => {
    expect(PIECE_KINDS.map(distinctRotations)).toEqual([1, 2, 2, 4, 1, 4]);
  });

  it('시계 방향 돌리기: 지폐 가로 → 세로, 저금통 다리가 왼쪽으로', () => {
    expect(shapeOf('bill', 1)).toEqual([[0, 0], [0, 1], [0, 2]]);
    // 몸통 (0,0)(1,0)(2,0) + 다리 (0,1)(2,1) → 시계 방향: 몸통이 오른쪽 세로줄, 다리가 왼쪽
    const piggy = shapeOf('piggy', 1).map(([x, y]) => `${x},${y}`).sort();
    expect(piggy).toEqual(['0,0', '0,2', '1,0', '1,1', '1,2']);
  });
});

describe('판·충돌', () => {
  it('판은 8 × 14', () => {
    const b = emptyBoard();
    expect(b).toHaveLength(ROWS);
    expect(b[0]).toHaveLength(COLS);
  });

  it('맨 위 가운데에서 나온다', () => {
    expect(spawnAt('coin1', 1)).toMatchObject({ x: 3, y: 0 });
    expect(spawnAt('bill', 1)).toMatchObject({ x: 2, y: 0 });
    expect(spawnAt('wallet', 1)).toMatchObject({ x: 3, y: 0 });
  });

  it('판 밖·찬 칸은 놓을 수 없다', () => {
    const b = filledBoard([13]);
    expect(fits(b, { kind: 'coin1', rot: 0, x: -1, y: 0, id: 1 })).toBe(false);
    expect(fits(b, { kind: 'bill', rot: 0, x: 6, y: 0, id: 1 })).toBe(false);
    expect(fits(b, { kind: 'coin1', rot: 0, x: 0, y: 13, id: 1 })).toBe(false);
    expect(fits(b, { kind: 'coin1', rot: 0, x: 0, y: 12, id: 1 })).toBe(true);
  });

  it('떨어질 자리 = 바로 내리면 멈출 곳', () => {
    const b = filledBoard([13, 12]);
    expect(dropPosition(b, { kind: 'wallet', rot: 0, x: 0, y: 0, id: 1 }).y).toBe(10);
  });
});

describe('조작', () => {
  it('좌우 이동, 벽에서는 그대로', () => {
    const s = stateWith(emptyBoard(), 'coin1', 0, 0);
    expect(act(s, 'left', opt)).toBe(s);
    expect(act(s, 'right', opt).active?.x).toBe(1);
  });

  it('돌리기: 벽에 막히면 1칸 밀어서 돌린다', () => {
    // 세로 지폐가 오른쪽 벽(x=7)에 붙어 있으면 가로로 돌릴 때 왼쪽으로 민다
    const s = stateWith(emptyBoard(), 'bill', 7, 3, 1);
    const r = act(s, 'rotate', opt);
    expect(r.active?.rot).toBe(2);
    expect(cellsOf(r.active!).every(([x]) => x >= 0 && x < COLS)).toBe(true);
  });

  it('돌릴 자리가 전혀 없으면 돌리지 않는다', () => {
    const b = emptyBoard();
    // 세로 지폐(x=3, y=5~7)의 좌우 2칸을 모두 막는다
    for (let y = 0; y < ROWS; y++) for (const x of [1, 2, 4, 5]) b[y][x] = { id: 99, kind: 'coin1', deco: false };
    expect(rotated(b, { kind: 'bill', rot: 1, x: 3, y: 5, id: 1 })).toBeNull();
  });

  it('바로 내리기: 즉시 고정 → 다음 조각', () => {
    const s = stateWith(emptyBoard(), 'wallet', 0, 0);
    const r = act(s, 'hard', opt);
    expect(r.board[13][0]?.kind).toBe('wallet');
    expect(r.board[12][1]?.kind).toBe('wallet');
    expect(r.active?.kind).toBe('coin1');
  });

  it('지갑 똑딱이·저금통 동전 구멍 칸이 표시된다', () => {
    const r = act(stateWith(emptyBoard(), 'wallet', 0, 0), 'hard', opt);
    expect(r.board[12][1]?.deco).toBe(true);
    expect(r.board[12][0]?.deco).toBe(false);
  });
});

describe('떨어지기·고정 (design.md 5.34)', () => {
  it('속도 1은 0.8초에 1칸', () => {
    const s = stateWith(emptyBoard(), 'coin1', 3, 0);
    expect(step(s, 799, opt).active?.y).toBe(0);
    expect(step(s, 800, opt).active?.y).toBe(1);
    expect(step(s, 2400, opt).active?.y).toBe(3);
  });

  it('닿은 뒤 0.4초는 옮길 수 있고, 그 뒤 고정', () => {
    const s = stateWith(emptyBoard(), 'coin1', 3, 13);
    const touching = step(s, 399, opt);
    expect(touching.active?.y).toBe(13);
    expect(touching.board[13][3]).toBeNull();
    const moved = act(touching, 'left', opt);
    expect(moved.active?.x).toBe(2);
    const locked = step(moved, 1, opt);
    expect(locked.board[13][2]?.kind).toBe('coin1');
  });

  it('속도: 10줄마다 +1, 한 칸 시간 × 0.85, 최저 0.12초', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(fallInterval(1)).toBe(800);
    expect(fallInterval(2)).toBe(680);
    expect(fallInterval(50)).toBe(120);
  });
});

describe('줄 저금', () => {
  it('점수: 1줄 10 · 2줄 30 · 3줄 60', () => {
    expect([0, 1, 2, 3].map(amountFor)).toEqual([0, 10, 30, 60]);
  });

  it('한 줄 채우면 지우고 10점, 위 칸이 내려온다', () => {
    const b = filledBoard([13], 7);
    b[12][0] = { id: 77, kind: 'coin1', deco: false };
    const s = stateWith(b, 'coin1', 7, 0);
    const r = act(s, 'hard', opt);
    expect(r.score).toBe(10);
    expect(r.lines).toBe(1);
    expect(r.events).toContainEqual({ type: 'clear', rows: [13], count: 1, amount: 10 });
    expect(r.board[13][0]?.kind).toBe('coin1');
    expect(r.board[13].filter(Boolean)).toHaveLength(1);
  });

  it('세로 지폐로 세 줄을 한 번에 → 60점', () => {
    const b = filledBoard([11, 12, 13], 0);
    const r = act(stateWith(b, 'bill', 0, 0, 1), 'hard', opt);
    expect(r.score).toBe(60);
    expect(r.lines).toBe(3);
    expect(r.board.every((row) => row.every((c) => c === null))).toBe(true);
  });

  it('10줄째에 속도가 오른다는 알림', () => {
    const b = filledBoard([13], 7);
    const s = { ...stateWith(b, 'coin1', 7, 0), lines: 9 };
    const r = act(s, 'hard', opt);
    expect(r.level).toBe(2);
    expect(r.events).toContainEqual({ type: 'level', level: 2 });
  });

  it('지우는 연출 시간 동안은 멈춰 있다가 줄을 없앤다', () => {
    const b = filledBoard([13], 7);
    const r = act(stateWith(b, 'coin1', 7, 0), 'hard', { ...opt, clearMs: 400 });
    expect(r.clearing?.rows).toEqual([13]);
    expect(r.active).toBeNull();
    expect(act(r, 'left', opt)).toBe(r);
    const mid = step(r, 200, opt);
    expect(mid.clearing?.leftMs).toBe(200);
    const done = step(mid, 200, opt);
    expect(done.clearing).toBeNull();
    expect(done.board[13].every((c) => c === null)).toBe(true);
    expect(done.active).not.toBeNull();
  });

  it('지운 줄 위·아래로 갈린 같은 조각은 따로 그린다 (번호를 나눈다)', () => {
    const b = emptyBoard();
    b[11][0] = { id: 5, kind: 'bill', deco: false };
    b[12][0] = { id: 5, kind: 'bill', deco: false };
    b[13][0] = { id: 5, kind: 'bill', deco: false };
    const { board } = removeRows(b, [12], 100);
    expect(board[12][0]?.id).not.toBe(board[13][0]?.id);
  });
});

describe('조각 뽑기', () => {
  it('가중치대로 뽑는다', () => {
    expect(pickPiece([], fixed(0))).toBe('coin1');
    expect(pickPiece([], fixed(0.999))).toBe('piggy');
  });

  it('같은 조각이 3번 연속 나오지 않는다', () => {
    expect(pickPiece(['coin1', 'coin1'], fixed(0))).not.toBe('coin1');
    expect(pickPiece(['coin1', 'coin2'], fixed(0))).toBe('coin1');
    // 무작위로 많이 뽑아도 3연속 없음
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const seq: PieceKind[] = [];
    for (let i = 0; i < 2000; i++) seq.push(pickPiece(seq.slice(-2), rng));
    expect(seq.some((k, i) => i >= 2 && k === seq[i - 1] && k === seq[i - 2])).toBe(false);
  });
});

describe('끝 판정', () => {
  it('나올 자리가 막혀 있으면 끝', () => {
    const b = emptyBoard();
    b[0][3] = { id: 9, kind: 'coin1', deco: false };
    b[0][4] = { id: 9, kind: 'coin1', deco: false };
    const s = stateWith(b, 'coin1', 0, 13);
    const r = act({ ...s, next: 'coin1' }, 'hard', opt);
    expect(r.over).toBe(true);
    expect(r.active).toBeNull();
    expect(r.events).toContainEqual({ type: 'over' });
    // 끝난 뒤에는 시간도 조작도 무시
    expect(step(r, 1000, opt)).toMatchObject({ over: true });
    expect(act(r, 'left', opt)).toBe(r);
  });

  it('계속 바로 내리면 언젠가 끝난다 (무한 루프 없음)', () => {
    let s = newGame(fixed(0.5));
    for (let i = 0; i < 200 && !s.over; i++) s = act(s, 'hard', { rng: fixed(0.5), clearMs: 0 });
    expect(s.over).toBe(true);
  });
});

describe('문구', () => {
  it('줄 저금·속도 알림', () => {
    expect(clearMessage(1)).toBe('한 줄 지웠어요!');
    expect(clearMessage(2)).toBe('두 줄 한 번에 지웠어요!');
    expect(clearMessage(3)).toBe('세 줄 한꺼번에! 대단해요');
    expect(levelMessage(3)).toBe('속도 3이에요. 조금 빨라져요');
    expect(levelMessage(2)).toBe('속도 2예요. 조금 빨라져요');
  });
});

describe('기록 비교·끝 시트 (design.md 5.35)', () => {
  const members = [
    { id: 'me', display_name: '민지', left_at: null },
    { id: 'j', display_name: '준호', left_at: null },
    { id: 'k', display_name: '수아', left_at: null },
    { id: 'gone', display_name: '나간 사람', left_at: '2026-11-01T00:00:00Z' },
  ];

  it('다른 멤버 중 가장 높은 1명 (나간 멤버·나는 빼고), 없으면 null', () => {
    const bests = [
      { member_id: 'me', best_amount: 99000, best_lines: 99 },
      { member_id: 'j', best_amount: 32000, best_lines: 30 },
      { member_id: 'k', best_amount: 41000, best_lines: 40 },
      { member_id: 'gone', best_amount: 90000, best_lines: 90 },
    ];
    expect(topOtherBest(bests, 'me', members)).toEqual({ member: members[2], amount: 41000 });
    expect(topOtherBest([bests[0]], 'me', members)).toBeNull();
  });

  it('기본 / 새 최고 기록 / 첫 기록 / 그만하기 / 0원', () => {
    expect(endView(12000, 28000, false, 32000)).toMatchObject({ title: '아쉽지만 여기까지예요', icon: 'piggy', compare: 'show', showMyBest: true, save: true });
    expect(endView(40000, 28000, false, 32000)).toMatchObject({ title: '새 최고 기록이에요!', icon: 'trophy', highlight: true, compare: 'beat', showMyBest: false });
    expect(endView(30000, 28000, false, 32000)).toMatchObject({ title: '새 최고 기록이에요!', compare: 'show' });
    expect(endView(5000, null, false, 32000)).toMatchObject({ title: '첫 기록이에요!', compare: 'show', showMyBest: false });
    expect(endView(5000, 28000, true, null)).toMatchObject({ title: '여기까지 할게요', icon: 'flag', compare: null });
    expect(endView(0, 28000, false, 32000)).toMatchObject({ title: '아쉽지만 여기까지예요', zeroNote: true, save: false });
    expect(endView(0, null, false, null)).toMatchObject({ title: '아쉽지만 여기까지예요', zeroNote: true, save: false, showMyBest: false });
    // 같은 금액은 새 기록이 아니다
    expect(endView(28000, 28000, false, null)).toMatchObject({ title: '아쉽지만 여기까지예요', showMyBest: true });
  });
});
