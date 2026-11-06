// @vitest-environment node
/**
 * 카테고리·주머니 저장소 함수(src/data/catalog.ts)를 실제 Supabase API로 확인한다 (BANB-6).
 * ⚠️ 로컬 Supabase 전용 — 테스트 계정을 만든다. 환경변수가 없으면 건너뛴다.
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> npx vitest run src/data/catalog.integration.test.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

// 앱 tsconfig에는 node 타입이 없어 globalThis로 읽는다
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const url = env.SUPABASE_URL ?? '';
const key = env.SUPABASE_KEY ?? '';
const enabled = Boolean(url && key);
if (enabled && !/127\.0\.0\.1|localhost/.test(url)) throw new Error('로컬 Supabase에서만 실행한다');

let current: SupabaseClient | null = null;
vi.mock('./supabase', () => ({ getSupabase: () => current }));

const catalog = await import('./catalog');
const as = (c: SupabaseClient) => {
  current = c;
};

async function signUp(name: string) {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signUp({ email: `${name}-${Date.now()}@test.local`, password: 'password-1234' });
  if (error || !data.session) throw new Error(`${name} 가입 실패: ${error?.message ?? '세션 없음'}`);
  return c;
}

describe.skipIf(!enabled)('카테고리·주머니 저장소 (로컬 Supabase)', () => {
  let A: SupabaseClient;
  let B: SupabaseClient;
  let X: SupabaseClient;
  let ledgerId: string;

  beforeAll(async () => {
    [A, B, X] = await Promise.all([signUp('a6'), signUp('b6'), signUp('x6')]);
    const created = await A.rpc('create_ledger', { p_name: '카테고리', p_display_name: 'A' });
    if (created.error) throw created.error;
    ledgerId = created.data as string;
    const inv = await A.from('invite').insert({ ledger_id: ledgerId }).select('code').single();
    if (inv.error) throw inv.error;
    const joined = await B.rpc('join_ledger', { p_code: inv.data.code, p_display_name: 'B' });
    if (joined.error) throw joined.error;
  }, 30_000);

  it('새 가계부에 기본 카테고리 70개(대분류 27)·주머니 4개가 보인다', async () => {
    as(B);
    const cats = await catalog.listCategories(ledgerId);
    expect(cats).toHaveLength(70);
    expect(cats.filter((c) => c.parent_id === null)).toHaveLength(27);
    const pockets = await catalog.listPockets(ledgerId);
    expect(pockets.map((p) => [p.name, p.scope]).sort()).toEqual(
      [['경조사비', 'shared'], ['공동소비', 'shared'], ['개인용돈', 'personal'], ['여행', 'shared']].sort(),
    );
  });

  it('A가 바꾼 카테고리를 B가 다시 불러오면 본다 (추가·이름·순서·숨김)', async () => {
    as(A);
    const parent = await catalog.addParentCategory({ ledgerId, type: 'expense', name: '술', sortOrder: 16 });
    const food = (await catalog.listCategories(ledgerId)).find((c) => c.name === '식비' && c.parent_id === null)!;
    const child = await catalog.addChildCategory({ ledgerId, type: 'expense', parentId: food.id, name: '야식', sortOrder: 5 });
    await catalog.updateCategory(child.id, { name: '밤참' });
    await catalog.updateCategory(child.id, { is_hidden: true });
    await catalog.saveOrder('category', [{ id: child.id, sort_order: 0 }]);

    as(B);
    const cats = await catalog.listCategories(ledgerId);
    expect(cats.filter((c) => c.name === '술').map((c) => (c.parent_id === null ? 'parent' : c.parent_id))).toEqual(
      expect.arrayContaining(['parent', parent.id]),
    );
    expect(cats.find((c) => c.id === child.id)).toMatchObject({ name: '밤참', is_hidden: true, sort_order: 0, parent_id: food.id });
  });

  it('B가 바꾼 주머니를 A가 다시 불러오면 본다 (추가·이름·공동/개인·순서·숨김)', async () => {
    as(B);
    const added = await catalog.addPocket({ ledgerId, name: '취미', scope: 'personal', sortOrder: 5 });
    await catalog.updatePocket(added.id, { name: '취미생활', scope: 'shared' });
    await catalog.saveOrder('pocket', [{ id: added.id, sort_order: 0 }]);
    await catalog.updatePocket(added.id, { is_hidden: true });

    as(A);
    const p = (await catalog.listPockets(ledgerId)).find((x) => x.id === added.id);
    expect(p).toMatchObject({ name: '취미생활', scope: 'shared', sort_order: 0, is_hidden: true });
  });

  it('이름 규칙 위반은 INVALID_NAME, 외부인 수정은 NOT_FOUND', async () => {
    as(A);
    const [first] = await catalog.listPockets(ledgerId);
    await expect(catalog.updatePocket(first.id, { name: '   ' })).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(catalog.updatePocket(first.id, { name: '가'.repeat(21) })).rejects.toMatchObject({ code: 'INVALID_NAME' });
    as(X);
    await expect(catalog.listPockets(ledgerId)).resolves.toEqual([]);
    await expect(catalog.updatePocket(first.id, { name: '해킹' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('숨긴 카테고리·주머니가 쓰인 지난 내역에는 이름이 그대로 보인다', async () => {
    as(A);
    const cats = await catalog.listCategories(ledgerId);
    const eatout = cats.find((c) => c.name === '외식')!;
    const pocket = (await catalog.listPockets(ledgerId)).find((p) => p.name === '여행')!;
    const me = await A.from('member').select('id').eq('ledger_id', ledgerId).eq('display_name', 'A').single();
    const tx = await A.from('transaction')
      .insert({ ledger_id: ledgerId, type: 'expense', amount: 23000, category_id: eatout.id, pocket_id: pocket.id, spender_id: me.data!.id })
      .select('id')
      .single();
    expect(tx.error).toBeNull();
    await catalog.updateCategory(eatout.id, { is_hidden: true });
    await catalog.updatePocket(pocket.id, { is_hidden: true });

    // 지난 내역 표시 = 내역의 id로 카테고리·주머니 이름을 찾는다 (숨김 여부와 상관없이 조회됨)
    as(B);
    const seen = (await B.from('transaction').select('category_id, pocket_id').eq('id', tx.data!.id).single()).data!;
    const bCats = await catalog.listCategories(ledgerId);
    const bPockets = await catalog.listPockets(ledgerId);
    expect(bCats.find((c) => c.id === seen.category_id)).toMatchObject({ name: '외식', is_hidden: true });
    expect(bPockets.find((p) => p.id === seen.pocket_id)).toMatchObject({ name: '여행', is_hidden: true });
  });

  it('N1: 내역에 쓰인 소분류를 API로 대분류로 바꾸면 거부되고, 대분류를 가리키는 내역은 0건', async () => {
    const eatout = (await B.from('category').select('id').eq('ledger_id', ledgerId).eq('name', '외식').single()).data!;
    const res = await B.from('category').update({ parent_id: null }).eq('id', eatout.id).select('id');
    expect(res.error?.message).toContain('CATEGORY_IN_USE_MUST_STAY_CHILD');

    // 완료 기준: 내역의 category가 대분류를 가리키는 행 0건
    const txs = (await B.from('transaction').select('category_id').eq('ledger_id', ledgerId)).data!;
    const parents = new Set((await B.from('category').select('id').eq('ledger_id', ledgerId).is('parent_id', null)).data!.map((c) => c.id));
    expect(txs.filter((t) => parents.has(t.category_id))).toHaveLength(0);
    const all = await B.from('transaction').select('id').eq('ledger_id', ledgerId);
    expect(all.data!.length).toBeGreaterThan(0);
  });
});
