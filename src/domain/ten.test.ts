import { describe, expect, it } from 'vitest';
import type { Game } from '../data/types';
import {
  CELLS,
  formatClock,
  isLandscape,
  parseDrags,
  popMessage,
  popRect,
  randomSeed,
  rectOf,
  rectSum,
  replay,
  soloResult,
  spokenClock,
  tenBoard,
  tenCellSize,
  tenVsOneLine,
  tenVsResult,
  topOtherTenBest,
  vsTimes,
  type Drag,
} from './ten';

/** supabase/tests/99_game_ten_test.sql TB-01 과 같은 값 — 서버 ten_board 와 화면이 같은 판을 만드는지 */
const BOARD_12345 =
  '228278914719738259522249128589589554257357577534221579584232151192247578269629688624841938783578812673676571888323197534';
/** 같은 SQL 테스트 TR-01: 터짐 2 · 2 · 이미 터진 칸 0 · 합 ≠ 10 0 · 모서리 반대 2 · 빈칸 걸친 합 10 → 2 = 8 */
const DRAGS_12345: Drag[] = [
  [1, 0, 2, 0],
  [6, 0, 7, 0],
  [1, 0, 2, 0],
  [0, 0, 0, 0],
  [4, 4, 3, 4],
  [4, 5, 4, 3],
];

describe('판 (서버 ten_board 와 같은 계산)', () => {
  it('같은 순서 값 = 같은 판, 120칸 · 1~9', () => {
    expect(tenBoard(12345).join('')).toBe(BOARD_12345);
    expect(tenBoard(12345)).toEqual(tenBoard(12345));
    const b = tenBoard(777);
    expect(b).toHaveLength(CELLS);
    expect(b.every((v) => v >= 1 && v <= 9)).toBe(true);
  });

  it('순서 값 0 과 2^31−2 는 같은 판 (서버와 같은 나머지 규칙), 다른 값은 다른 판', () => {
    expect(tenBoard(0)).toEqual(tenBoard(2147483646));
    expect(tenBoard(1)).not.toEqual(tenBoard(2));
  });

  it('숫자가 한쪽으로 쏠리지 않는다 (판 50개면 1~9 모두 나온다)', () => {
    const seen = new Set<number>();
    for (let s = 1; s <= 50; s++) tenBoard(s * 7919).forEach((v) => seen.add(v));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('1인 새 순서 값은 서버가 받는 범위 (0 ~ 2^31−2)', () => {
    expect(randomSeed(() => 0)).toBe(0);
    expect(randomSeed(() => 0.999999999999)).toBeLessThanOrEqual(2147483646);
  });
});

describe('네모 · 터짐 · 다시 세기', () => {
  it('두 칸 순서와 상관없이 같은 네모, 판 밖은 가장자리로', () => {
    expect(rectOf(4, 5, 2, 1)).toEqual({ x1: 2, y1: 1, x2: 4, y2: 5 });
    expect(rectOf(-3, 9, 20, -1)).toEqual({ x1: 0, y1: 0, x2: 14, y2: 7 });
  });

  it('합 10이면 안의 도토리가 빈칸이 되고, 아니면 그대로 (벌점 없음)', () => {
    const b = tenBoard(12345); // 첫 줄 2 2 8 2 7 8 9 1 …
    expect(rectSum(b, rectOf(1, 0, 2, 0))).toEqual({ sum: 10, count: 2 });
    const hit = popRect(b, rectOf(1, 0, 2, 0));
    expect(hit.popped).toEqual([1, 2]);
    expect(hit.board[1]).toBe(0);
    const miss = popRect(b, rectOf(0, 0, 2, 0)); // 12
    expect(miss.popped).toEqual([]);
    expect(miss.board).toBe(b);
  });

  it('다시 세기: 이미 터진 칸은 다시 세지 않고, 빈칸이 걸친 네모도 남은 숫자 합이 10이면 터진다', () => {
    expect(replay(12345, DRAGS_12345).score).toBe(8);
    expect(replay(12345, []).score).toBe(0);
  });

  it('점수 조작: 합이 10이 아닌 네모를 아무리 보내도 0점', () => {
    const fake: Drag[] = Array.from({ length: 60 }, () => [0, 0, 14, 7] as Drag);
    expect(replay(12345, fake).score).toBe(0);
  });

  it('서버 기록 읽기: 모양이 틀린 것은 버린다', () => {
    expect(parseDrags([[1, 0, 2, 0], [1, 2], 'x', [0, 0, 15, 0], [0, 0, 0, 8], [0.5, 0, 1, 0]])).toEqual([[1, 0, 2, 0]]);
    expect(parseDrags(null)).toEqual([]);
  });
});

describe('화면 크기 · 시간', () => {
  it('칸 크기 (design.md 5.41 예): 640×360 → 37, 667×375 → 38, 932×430 → 45, 30~48', () => {
    expect(tenCellSize(640, 360)).toBe(37);
    expect(tenCellSize(667, 375)).toBe(38);
    expect(tenCellSize(932, 430)).toBe(45);
    expect(tenCellSize(320, 200)).toBe(30);
    expect(tenCellSize(2000, 1200)).toBe(48);
  });

  it('가로 판정은 화면 비율', () => {
    expect(isLandscape(640, 360)).toBe(true);
    expect(isLandscape(360, 640)).toBe(false);
  });

  it('남은 시간 "1:24" (올림) · 읽기 "1분 24초"', () => {
    expect(formatClock(120_000)).toBe('2:00');
    expect(formatClock(83_100)).toBe('1:24');
    expect(formatClock(-5)).toBe('0:00');
    expect(spokenClock(84_000)).toBe('1분 24초');
    expect(spokenClock(60_000)).toBe('1분');
    expect(spokenClock(9_500)).toBe('10초');
  });

  it('대전 시작 = 서버 마감 − 120초', () => {
    expect(vsTimes({ turn_deadline: '2026-11-10T00:02:05Z' })).toEqual({
      startMs: Date.parse('2026-11-10T00:00:05Z'),
      endMs: Date.parse('2026-11-10T00:02:05Z'),
    });
    expect(vsTimes({ turn_deadline: null })).toBeNull();
  });
});

describe('문구', () => {
  it('터짐 알약: 첫 터짐 · 4개 이상만', () => {
    expect(popMessage(2, true)).toBe('열 알 모았어요!');
    expect(popMessage(5, false)).toBe('도토리 5개로 열 알 모았어요!');
    expect(popMessage(3, false)).toBeNull();
  });

  it('1인 결과 (design.md 5.43 표)', () => {
    expect(soloResult(52, 41)).toMatchObject({ icon: 'trophy', highlight: true, title: '새 최고 기록이에요!', line: '지난 최고 41점보다 11점 더 얻었어요' });
    expect(soloResult(30, 52)).toMatchObject({ icon: 'nut', title: '끝났어요', line: '내 최고 기록은 52점이에요' });
    expect(soloResult(12, null)).toMatchObject({ title: '첫 기록이에요!', line: '다음엔 더 모아 봐요' });
    expect(soloResult(0, 41)).toMatchObject({ title: '끝났어요', line: '다음엔 하나 만들어 봐요' });
  });

  it('멤버 비교 줄: 나간 멤버·나는 빼고 가장 높은 기록', () => {
    const members = [
      { id: 'me', display_name: '민지', left_at: null },
      { id: 'a', display_name: '준호', left_at: null },
      { id: 'b', display_name: '지난', left_at: '2026-11-01' },
    ];
    const bests = [
      { member_id: 'me', best_score: 50 },
      { member_id: 'a', best_score: 33 },
      { member_id: 'b', best_score: 90 },
    ];
    expect(topOtherTenBest(bests, 'me', members)).toEqual({ member: members[1], score: 33 });
  });

  const g = (p: Partial<Game>) =>
    ({ status: 'finished', end_reason: 'score', winner_id: 'me', black_id: 'me', white_id: 'jun', ...p }) as Game;
  const nameOf = (id: string) => (id === 'jun' ? '준호' : '민지');

  it('대전 결과 (design.md 5.44 표): 이김 · 짐 · 무승부 · 그만함 · 중단', () => {
    const win = tenVsResult(g({}), 'me', nameOf, { mine: 35, opp: 32 });
    expect(win).toMatchObject({ icon: 'trophy', title: '이겼어요!', line: '준호님 32점, 나 35점', win: true, bet: '준호님 당첨이에요!' });
    expect(tenVsOneLine(win)).toBe('준호님 32점, 나 35점 — 이겼어요!');
    expect(tenVsResult(g({ winner_id: 'jun' }), 'me', nameOf, { mine: 29, opp: 32 })).toMatchObject({
      icon: 'smile',
      title: '아쉽게 졌어요',
      line: '준호님 32점, 나 29점',
      bet: '이번엔 내가 당첨이에요',
    });
    expect(tenVsResult(g({ end_reason: 'draw', winner_id: null }), 'me', nameOf, { mine: 32, opp: 32 })).toMatchObject({
      icon: 'handshake',
      title: '비겼어요!',
      line: '둘 다 32점이에요',
      bet: '이번엔 둘 다 무사해요',
      counted: true,
    });
    expect(tenVsResult(g({ end_reason: 'quit', winner_id: 'me' }), 'me', nameOf, null)).toMatchObject({ title: '이겼어요!', line: '준호님이 그만했어요' });
    expect(tenVsResult(g({ end_reason: 'quit', winner_id: 'jun' }), 'me', nameOf, null)).toMatchObject({ icon: 'flag', title: '그만했어요' });
    expect(tenVsResult(g({ status: 'abandoned', end_reason: 'timeout', winner_id: null }), 'me', nameOf, null)).toMatchObject({ counted: false });
  });
});
