import { vi } from 'vitest';
import type { AssetBalanceHistory } from './types';

/** supabase rpc → select → order → order → range 체인을 흉내 낸다. range 마다 한 쪽(page)을 돌려준다 */
const fake = vi.hoisted(() => ({
  rows: [] as unknown[],
  /** 서버 조회 상한 (Supabase 기본 1000) */
  maxRows: 1000,
  /** count 를 다르게 알려 주거나 없앤다 */
  count: undefined as number | null | undefined,
  calls: [] as { fn: string; args: unknown; from: number; to: number }[],
  error: null as Error | null,
}));
vi.mock('./supabase', () => ({
  getSupabase: () => ({
    rpc: (fn: string, args: unknown, opts: { count?: string }) => {
      expect(opts).toEqual({ count: 'exact' });
      const q = {
        select: () => q,
        order: () => q,
        range: async (from: number, to: number) => {
          fake.calls.push({ fn, args, from, to });
          if (fake.error) return { data: null, error: fake.error, count: null };
          const end = Math.min(to + 1, from + fake.maxRows);
          return { data: fake.rows.slice(from, end), error: null, count: fake.count === undefined ? fake.rows.length : fake.count };
        },
      };
      return q;
    },
  }),
}));

import { HISTORY_PAGE_SIZE, HistoryIncompleteError, listBalanceHistory } from './asset';

const rows = (n: number): AssetBalanceHistory[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    asset_id: 'a1',
    ledger_id: 'L1',
    balance: i,
    changed_by: null,
    changed_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  }));

const SINCE = Date.UTC(2026, 4, 31, 15); // 2026-06-01 00:00 KST

beforeEach(() => {
  fake.rows = [];
  fake.maxRows = 1000;
  fake.count = undefined;
  fake.calls = [];
  fake.error = null;
});

describe('listBalanceHistory: 추이 범위만, 끝까지 나눠 받기 (BANB-30)', () => {
  it('범위 함수에 가계부·창 시작을 넘긴다', async () => {
    fake.rows = rows(3);
    expect(await listBalanceHistory('L1', SINCE)).toHaveLength(3);
    expect(fake.calls).toEqual([
      { fn: 'asset_balance_history_window', args: { p_ledger_id: 'L1', p_since: '2026-05-31T15:00:00.000Z' }, from: 0, to: HISTORY_PAGE_SIZE - 1 },
    ]);
  });

  it('1,000행이 넘으면 나눠 받아 하나도 빠뜨리지 않는다', async () => {
    fake.rows = rows(2500);
    const got = await listBalanceHistory('L1', SINCE);
    expect(got).toHaveLength(2500);
    expect(got.at(-1)!.id).toBe(2500); // 최신 이력까지
    expect(fake.calls.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('정확히 1,000행이면 한 번만 받는다', async () => {
    fake.rows = rows(1000);
    expect(await listBalanceHistory('L1', SINCE)).toHaveLength(1000);
    expect(fake.calls).toHaveLength(1);
  });

  it('서버 상한이 쪽 크기보다 작아도 받은 만큼 이어서 받는다', async () => {
    fake.maxRows = 300;
    fake.rows = rows(1000);
    const got = await listBalanceHistory('L1', SINCE);
    expect(got.map((r) => r.id)).toEqual(rows(1000).map((r) => r.id));
  });

  it('빈 가계부', async () => {
    expect(await listBalanceHistory('L1', SINCE)).toEqual([]);
  });

  it('더 있다는데 빈 쪽이 오면 잘린 채로 쓰지 않고 오류', async () => {
    fake.rows = rows(10);
    fake.count = 20;
    await expect(listBalanceHistory('L1', SINCE)).rejects.toBeInstanceOf(HistoryIncompleteError);
  });

  it('전체 행 수를 알 수 없으면 오류', async () => {
    fake.rows = rows(10);
    fake.count = null;
    await expect(listBalanceHistory('L1', SINCE)).rejects.toBeInstanceOf(HistoryIncompleteError);
  });

  it('조회 오류는 그대로 던진다', async () => {
    fake.error = new Error('network');
    await expect(listBalanceHistory('L1', SINCE)).rejects.toThrow('network');
  });
});
