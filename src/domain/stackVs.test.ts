import type { Game } from '../data/types';
import { COLS, ROWS, act, addGarbage, emptyBoard, step, type StackState } from './stack';
import {
  awayRemainingSeconds,
  betWinnerText,
  clampBet,
  decodePreview,
  emojiAllowed,
  encodePreview,
  formatElapsed,
  fromSnapshot,
  garbageLines,
  isCloseCall,
  isDanger,
  newBatches,
  newVsGame,
  normalizeBet,
  pendingLines,
  receivedMessage,
  seededRng,
  sentMessage,
  toSnapshot,
  vsLevel,
  vsLevelMessage,
  vsResultCopy,
} from './stackVs';

const A = 'member-a';
const B = 'member-b';
const nameOf = (id: string) => (id === A ? '민지' : '준호');
const opt = (rng: () => number) => ({ rng, clearMs: 0, timeLevel: true });

/** 바로 내리기만 계속해서 나온 조각 순서 (판이 찰 때까지, 최대 n개) */
function pieceOrder(seed: number, n: number): string[] {
  const { state, rng } = newVsGame(seed);
  let s = state;
  const order = [s.active!.kind as string];
  for (let i = 0; i < n && s.active && !s.over; i++) {
    s = act(s, 'hard', opt(rng));
    if (s.active) order.push(s.active.kind);
  }
  return order;
}

function game(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    ledger_id: 'l1',
    kind: 'stack_vs',
    bet: null,
    seed: 1,
    black_id: B,
    white_id: A,
    status: 'finished',
    winner_id: A,
    end_reason: 'topout',
    move_count: 0,
    created_by: A,
    rematch_of: null,
    created_at: '2026-11-10T00:00:00Z',
    invite_expires_at: '2026-11-10T00:10:00Z',
    started_at: '2026-11-10T00:01:00Z',
    last_move_at: null,
    finished_at: '2026-11-10T00:05:00Z',
    rule: 'stack_vs',
    turn_deadline: null,
    draw_offer_by: null,
    draw_offer_count: null,
    ...over,
  };
}

describe('같은 조각 순서 (서버 순서 값)', () => {
  it('같은 seed 면 두 기기에서 같은 순서, 다른 seed 면 다르다', () => {
    const one = pieceOrder(12345, 30);
    expect(one.length).toBeGreaterThan(5);
    expect(pieceOrder(12345, 30)).toEqual(one);
    expect(pieceOrder(54321, 30)).not.toEqual(one);
  });

  it('놓는 시간·조작이 달라도 순서는 같다 (조각을 꺼낼 때만 난수를 쓴다)', () => {
    const a = newVsGame(777);
    const b = newVsGame(777);
    let sa = a.state;
    let sb = b.state;
    const seqA: string[] = [];
    const seqB: string[] = [];
    for (let i = 0; i < 8; i++) {
      // A 는 바로 내리기, B 는 옮기고 돌린 뒤 시간을 흘려 떨어뜨린다
      sa = act(sa, 'hard', opt(a.rng));
      const id = sb.active?.id;
      sb = act(act(sb, i % 2 ? 'left' : 'right', opt(b.rng)), 'rotate', opt(b.rng));
      for (let t = 0; t < 400 && sb.active && sb.active.id === id; t++) sb = step(sb, 100, opt(b.rng));
      if (sa.over || sb.over) break;
      seqA.push(sa.next);
      seqB.push(sb.next);
    }
    expect(seqB.length).toBeGreaterThan(3);
    expect(seqB).toEqual(seqA);
  });

  it('난수열 상태를 저장했다가 이어서 뽑으면 같은 수열', () => {
    const r1 = seededRng(42);
    r1();
    r1();
    const saved = r1.state();
    const rest1 = [r1(), r1(), r1()];
    const r2 = seededRng(saved);
    expect([r2(), r2(), r2()]).toEqual(rest1);
  });
});

describe('방해 줄 (영수증 줄)', () => {
  it('보내는 장수: 1줄 0 · 2줄 1 · 3줄 2 · 4줄 이상 3', () => {
    expect([0, 1, 2, 3, 4, 5].map(garbageLines)).toEqual([0, 0, 1, 2, 3, 3]);
  });

  it('바닥에서 올라오고 같은 묶음은 같은 칸이 빈다, 줄마다 다른 id', () => {
    const { board, overflow } = addGarbage(emptyBoard(), [{ lines: 2, hole: 3 }], 100);
    expect(overflow).toBe(false);
    const bottom = board[ROWS - 1];
    const above = board[ROWS - 2];
    expect(bottom.map((c) => (c ? 'r' : '.')).join('')).toBe('rrr.rrrr');
    expect(above.map((c) => (c ? 'r' : '.')).join('')).toBe('rrr.rrrr');
    expect(bottom[0]!.id).not.toBe(above[0]!.id);
    expect(bottom.every((c) => !c || c.kind === 'receipt')).toBe(true);
  });

  it('판 전체가 위로 밀리고, 맨 위 칸이 밀려 나가면 넘침', () => {
    const b = emptyBoard();
    b[0][0] = { id: 1, kind: 'coin1', deco: false };
    expect(addGarbage(b, [{ lines: 1, hole: 0 }], 10).overflow).toBe(true);
    const c = emptyBoard();
    c[5][2] = { id: 1, kind: 'coin1', deco: false };
    const up = addGarbage(c, [{ lines: 1, hole: 0 }], 10);
    expect(up.board[4][2]?.kind).toBe('coin1');
  });

  it('받은 줄은 내가 다음 조각을 놓을 때 올라온다 (garbage 이벤트)', () => {
    const { state, rng } = newVsGame(5);
    const s: StackState = { ...state, garbage: [{ lines: 2, hole: 6 }] };
    expect(s.board[ROWS - 1].some((c) => c)).toBe(false);
    const after = act(s, 'hard', opt(rng));
    expect(after.garbage).toEqual([]);
    expect(after.events.some((e) => e.type === 'garbage' && e.lines === 2)).toBe(true);
    expect(after.board[ROWS - 1][6]).toBeNull();
    expect(after.board[ROWS - 1].filter((c) => c?.kind === 'receipt').length).toBe(COLS - 1);
  });

  it('영수증 줄도 빈칸을 채우면 지워지고 1줄로 센다', () => {
    const { state, rng } = newVsGame(9);
    // 맨 아래를 영수증 줄(빈칸 0)로, 떨어지는 조각을 동전 하나로 바꿔 빈칸에 넣는다
    const up = addGarbage(state.board, [{ lines: 1, hole: 0 }], state.nextId);
    const s: StackState = { ...state, board: up.board, nextId: up.nextId, active: { kind: 'coin1', rot: 0, x: 0, y: 0, id: up.nextId + 1 } };
    const after = act(s, 'hard', opt(rng));
    expect(after.lines).toBe(1);
    expect(after.board[ROWS - 1].some((c) => c)).toBe(false);
  });

  it('상대 묶음은 순번대로 한 번씩만, 빠진 순번이면 다시 받기', () => {
    const rows = [
      { from_member: B, seq: 2, lines: 2, hole: 1 },
      { from_member: B, seq: 1, lines: 1, hole: 4 },
      { from_member: A, seq: 1, lines: 3, hole: 0 },
    ];
    expect(newBatches(rows, B, 0)).toEqual({ batches: [rows[1], rows[0]], gap: false });
    expect(newBatches(rows, B, 1)).toEqual({ batches: [rows[0]], gap: false });
    expect(newBatches(rows, B, 2)).toEqual({ batches: [], gap: false });
    expect(newBatches([{ from_member: B, seq: 3, lines: 1, hole: 0 }], B, 1).gap).toBe(true);
    expect(pendingLines([{ lines: 2, hole: 0 }, { lines: 3, hole: 1 }])).toBe(5);
  });

  it('문구', () => {
    expect(sentMessage(1)).toBe('영수증 1장을 보냈어요!');
    expect(receivedMessage('준호', 2)).toBe('준호님이 영수증 2장을 보냈어요');
  });
});

describe('속도 · 시간', () => {
  it('3분부터 30초마다 한 단계', () => {
    expect(vsLevel(0)).toBe(1);
    expect(vsLevel(179_999)).toBe(1);
    expect(vsLevel(180_000)).toBe(2);
    expect(vsLevel(209_999)).toBe(2);
    expect(vsLevel(210_000)).toBe(3);
    expect(vsLevel(300_000)).toBe(6);
  });

  it('속도 알약: 처음은 3분 안내, 그 뒤 "속도 N예요/이에요"', () => {
    expect(vsLevelMessage(2)).toBe('3분이 지났어요. 조금씩 빨라져요');
    expect(vsLevelMessage(5)).toBe('속도 5예요');
    expect(vsLevelMessage(3)).toBe('속도 3이에요');
  });

  it('대전은 지운 줄로 속도를 올리지 않는다 (timeLevel)', () => {
    const { state, rng } = newVsGame(3);
    const s: StackState = { ...state, lines: 99, level: 1 };
    expect(act(s, 'hard', opt(rng)).level).toBe(1);
  });

  it('지난 시간 표시', () => {
    expect(formatElapsed(161_000)).toBe('2:41');
    expect(formatElapsed(0)).toBe('0:00');
  });

  it('끊김 30초: 상대가 마지막으로 저장한 시각부터 (서버 시각)', () => {
    expect(awayRemainingSeconds(1_000, 5_000, 1_000)).toBe(30);
    expect(awayRemainingSeconds(1_000, 5_000, 21_500)).toBe(10);
    expect(awayRemainingSeconds(1_000, 5_000, 40_000)).toBe(0);
    expect(awayRemainingSeconds(null, 5_000, 5_000)).toBe(30);
  });
});

describe('판 저장본 · 미리보기', () => {
  it('저장본으로 같은 판·같은 다음 조각·같은 난수열로 이어진다', () => {
    const { state, rng } = newVsGame(2024);
    let s = state;
    for (let i = 0; i < 6; i++) s = act(s, 'hard', opt(rng));
    s = { ...s, garbage: [{ lines: 1, hole: 2 }] };
    const snap = JSON.parse(JSON.stringify(toSnapshot(s, { elapsedMs: 61_000, sent: 3, sendSeq: 2, received: 1 }, rng.state())));
    expect(JSON.stringify(snap).length).toBeLessThan(8192);
    const back = fromSnapshot(snap)!;
    expect(back.state.board).toEqual(s.board);
    expect(back.state.next).toBe(s.next);
    expect(back.state.garbage).toEqual(s.garbage);
    expect(back.progress).toEqual({ elapsedMs: 61_000, sent: 3, sendSeq: 2, received: 1 });
    // 이어서 같은 조각
    const a = act(s, 'hard', opt(rng));
    const b = act(back.state, 'hard', opt(back.rng));
    expect(b.next).toBe(a.next);
    expect(b.board).toEqual(a.board);
  });

  it('모양이 맞지 않는 저장본은 null', () => {
    expect(fromSnapshot(null)).toBeNull();
    expect(fromSnapshot({ v: 2 })).toBeNull();
    expect(fromSnapshot({ v: 1, board: [], next: 'coin1', rng: 1 })).toBeNull();
  });

  it('미리보기 112글자: 재질·영수증·떨어지는 조각', () => {
    const up = addGarbage(emptyBoard(), [{ lines: 1, hole: 7 }], 1);
    const text = encodePreview({ board: up.board, active: { kind: 'bill', rot: 0, x: 0, y: 0, id: 9 } });
    expect(text).toHaveLength(COLS * ROWS);
    const grid = decodePreview(text);
    expect(grid[0].slice(0, 3)).toEqual(['bill', 'bill', 'bill']);
    expect(grid[ROWS - 1][0]).toBe('receipt');
    expect(grid[ROWS - 1][7]).toBeNull();
  });

  it('위 3줄 안까지 차면 위험', () => {
    const b = emptyBoard();
    expect(isDanger(b)).toBe(false);
    b[2][4] = { id: 1, kind: 'coin1', deco: false };
    expect(isDanger(b)).toBe(true);
  });
});

describe('결과 · 내기 · 이모지', () => {
  it('끝 사유별 문구 (design.md 5.39 표)', () => {
    expect(vsResultCopy(game({ winner_id: A, end_reason: 'topout' }), A, nameOf)).toMatchObject({ title: '이겼어요!', line: '준호님 판이 먼저 꽉 찼어요', win: true });
    expect(vsResultCopy(game({ winner_id: A, end_reason: 'topout' }), B, nameOf)).toMatchObject({ title: '아쉽게 졌어요', line: '한 판 더 할까요?' });
    expect(vsResultCopy(game({ winner_id: A, end_reason: 'topout' }), A, nameOf, true).line).toBe('준호님 판이 먼저 꽉 찼어요 · 아슬아슬했어요');
    expect(vsResultCopy(game({ winner_id: A, end_reason: 'quit' }), A, nameOf).line).toBe('준호님이 그만했어요');
    expect(vsResultCopy(game({ winner_id: A, end_reason: 'quit' }), B, nameOf)).toMatchObject({ icon: 'flag', title: '그만했어요', line: '다음엔 끝까지 해 봐요' });
    expect(vsResultCopy(game({ winner_id: A, end_reason: 'disconnect' }), A, nameOf).line).toBe('준호님 연결이 끊겨서 판이 끝났어요');
    expect(vsResultCopy(game({ winner_id: A, end_reason: 'disconnect' }), B, nameOf)).toMatchObject({ icon: 'wifi-off', title: '연결이 끊겨서 졌어요' });
    expect(vsResultCopy(game({ status: 'abandoned', winner_id: null, end_reason: 'timeout' }), A, nameOf).counted).toBe(false);
  });

  it('거의 동시: 두 사람이 닿은 시각 차이 1.5초 안', () => {
    expect(isCloseCall(['2026-11-10T00:00:00.000Z', '2026-11-10T00:00:01.200Z'])).toBe(true);
    expect(isCloseCall(['2026-11-10T00:00:00.000Z', '2026-11-10T00:00:02.000Z'])).toBe(false);
    expect(isCloseCall(['2026-11-10T00:00:00.000Z', null])).toBe(false);
  });

  it('내기: 진 사람이 당첨, 이름 + "당첨"만', () => {
    expect(betWinnerText(game({ bet: '진 사람이 설거지', winner_id: A }), A, nameOf)).toBe('준호님 당첨이에요!');
    expect(betWinnerText(game({ bet: '진 사람이 설거지', winner_id: A }), B, nameOf)).toBe('이번엔 내가 당첨이에요');
    expect(betWinnerText(game({ bet: null }), A, nameOf)).toBeNull();
    expect(betWinnerText(game({ bet: '커피', winner_id: null }), A, nameOf)).toBeNull();
  });

  it('내기 입력: 30자까지, 앞뒤 공백 제거, 비면 없음', () => {
    expect(clampBet('가'.repeat(35))).toHaveLength(30);
    expect(normalizeBet('  진 사람이 설거지 ')).toBe('진 사람이 설거지');
    expect(normalizeBet('   ')).toBeNull();
    // 이모지 같은 글자도 1자로 센다 (서버 char_length 와 같게)
    expect(Array.from(clampBet('😀'.repeat(31)))).toHaveLength(30);
  });

  it('이모지 3초에 1번', () => {
    expect(emojiAllowed(null, 0)).toBe(true);
    expect(emojiAllowed(1000, 3999)).toBe(false);
    expect(emojiAllowed(1000, 4000)).toBe(true);
  });
});
