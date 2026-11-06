// @vitest-environment node
/**
 * 잔액 이력 범위 조회(src/data/asset.ts listBalanceHistory, BANB-30)를 실제 Supabase API로 확인한다.
 * 서버 조회 상한(max_rows 1000)이 걸린 상태에서 이력 1,500건 자산 + 오래 안 바뀐 자산으로 추이 값이 전체 이력과 같은지 본다.
 * ⚠️ 로컬 Supabase 전용 — 테스트 계정을 만들고, 지난 시각 이력을 넣으려고 secret key 를 쓴다. 환경변수가 없으면 건너뛴다.
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> SUPABASE_SECRET_KEY=<로컬 secret key> \
 *     npx vitest run src/data/asset.integration.test.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { homeNetWorth, netWorthTrend, trendWindowStart } from '../domain/netWorth';
import type { Asset, AssetBalanceHistory } from './types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const url = env.SUPABASE_URL ?? '';
const key = env.SUPABASE_KEY ?? '';
const secret = env.SUPABASE_SECRET_KEY ?? '';
const enabled = Boolean(url && key && secret);
if (enabled && !/127\.0\.0\.1|localhost/.test(url)) throw new Error('로컬 Supabase에서만 실행한다');

let current: SupabaseClient | null = null;
vi.mock('./supabase', () => ({ getSupabase: () => current }));
const assetApi = await import('./asset');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
async function signUp(name: string) {
  const c = createClient(url, key, opts);
  const { data, error } = await c.auth.signUp({ email: `${name}-${Date.now()}@test.local`, password: 'password-1234' });
  if (error || !data.session) throw new Error(`${name} 가입 실패: ${error?.message ?? '세션 없음'}`);
  return c;
}

const NOW = new Date('2026-11-06T03:00:00Z');
const kst = (s: string) => new Date(`${s}+09:00`).toISOString();
const byKey = (h: AssetBalanceHistory) => h.id;

describe.skipIf(!enabled)('잔액 이력 범위 조회 (로컬 Supabase, 조회 상한 1000)', () => {
  let A: SupabaseClient;
  let X: SupabaseClient;
  let admin: SupabaseClient;
  let ledgerId: string;
  let assets: Asset[];
  let all: AssetBalanceHistory[];

  beforeAll(async () => {
    admin = createClient(url, secret, opts);
    [A, X] = await Promise.all([signUp('h30a'), signUp('h30x')]);
    const created = await A.rpc('create_ledger', { p_name: '이력', p_display_name: 'A' });
    if (created.error) throw created.error;
    ledgerId = created.data as string;
    current = A;
    const busy = await assetApi.createAsset(ledgerId, { name: '활발통장', kind: 'checking', owner_id: null, balance: 1, memo: null });
    const house = await assetApi.createAsset(ledgerId, { name: '오래된집', kind: 'real_estate', owner_id: null, balance: 410, memo: null });

    // 지난 시각 이력: 활발통장 2025-02-01부터 10시간 간격 1,500건(~2026-10-19), 오래된집 2024-03-01 1건
    const del = await admin.from('asset_balance_history').delete().eq('ledger_id', ledgerId);
    if (del.error) throw del.error;
    const base = Date.parse(kst('2025-02-01T09:00:00'));
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      asset_id: busy.id,
      ledger_id: ledgerId,
      balance: 1000 + i,
      changed_by: null,
      changed_at: new Date(base + i * 10 * 3600_000).toISOString(),
    }));
    rows.push({ asset_id: house.id, ledger_id: ledgerId, balance: 410, changed_by: null, changed_at: kst('2024-03-01T09:00:00') });
    for (let i = 0; i < rows.length; i += 500) {
      const ins = await admin.from('asset_balance_history').insert(rows.slice(i, i + 500));
      if (ins.error) throw ins.error;
    }
    await assetApi.updateAsset(busy.id, { name: '활발통장', kind: 'checking', owner_id: null, balance: 2222, memo: null }); // 지금 시각 1건
    assets = await assetApi.listAssets(ledgerId);

    // 기준: 관리자 권한으로 전체 이력 (나눠서)
    all = [];
    for (;;) {
      const r = await admin
        .from('asset_balance_history')
        .select('id, asset_id, ledger_id, balance, changed_by, changed_at')
        .eq('ledger_id', ledgerId)
        .order('changed_at')
        .order('id')
        .range(all.length, all.length + 999);
      if (r.error) throw r.error;
      all.push(...(r.data as AssetBalanceHistory[]));
      if (r.data.length === 0) break;
    }
  }, 60_000);

  it('준비: 전체 이력 1,502건, 예전 방식(한 번에 조회)은 1,000건에서 잘린다', async () => {
    expect(all).toHaveLength(1502);
    const naive = await A.from('asset_balance_history').select('id').eq('ledger_id', ledgerId).order('changed_at').order('id');
    expect(naive.data).toHaveLength(1000);
  });

  it('창 시작을 아주 이르게 잡으면 1,000행 상한을 넘어 전부 받는다', async () => {
    current = A;
    const got = await assetApi.listBalanceHistory(ledgerId, Date.parse('2000-01-01T00:00:00Z'));
    expect(got.map(byKey)).toEqual(all.map(byKey));
  });

  it.each(['2026-11', '2026-08', '2026-05', '2025-09'] as const)('%s 기준 6개월 추이·홈 카드 값이 전체 이력과 같다', async (end) => {
    current = A;
    const part = await assetApi.listBalanceHistory(ledgerId, trendWindowStart(end));
    expect(part.length).toBeLessThan(all.length);
    expect(netWorthTrend(assets, part, NOW, 6, end)).toEqual(netWorthTrend(assets, all, NOW, 6, end));
    expect(homeNetWorth(assets, part, end, NOW)).toEqual(homeNetWorth(assets, all, end, NOW));
  });

  it('6개월 넘게 안 바뀐 자산이 추이의 모든 달에 들어간다', async () => {
    current = A;
    const part = await assetApi.listBalanceHistory(ledgerId, trendWindowStart('2026-11'));
    const house = assets.filter((a) => a.name === '오래된집');
    expect(netWorthTrend(house, part, NOW).map((p) => p.net)).toEqual([410, 410, 410, 410, 410, 410]);
  });

  it('외부인은 0건', async () => {
    current = X;
    expect(await assetApi.listBalanceHistory(ledgerId, Date.parse('2000-01-01T00:00:00Z'))).toEqual([]);
  });
});
