// 내역 입력·수정·삭제 흐름을 실제 Supabase API(supabase-js)로 확인한다. (BANB-8)
// src/data/transaction.ts 와 같은 쿼리를 쓴다.
// ⚠️ 로컬 Supabase(`supabase start`) 전용. 테스트 계정을 실제로 만들기 때문에 운영 프로젝트에 돌리지 않는다.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> node supabase/tests/transaction_flow.mjs
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY 필요');
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('로컬 Supabase에서만 실행한다');

const run = Date.now();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const COLUMNS =
  'id, ledger_id, type, amount, occurred_on, category_id, pocket_id, spender_id, is_fixed, memo, source, created_by, updated_by, created_at, updated_at';

async function signUp(name) {
  const c = createClient(url, key, opts);
  const { data, error } = await c.auth.signUp({ email: `${name}-${run}@test.local`, password: 'password-1234' });
  assert.equal(error, null, `${name} 가입 실패: ${error?.message}`);
  assert.ok(data.session, `${name}: 세션 없음`);
  return { c, uid: data.user.id };
}
const step = (msg) => console.log(`✔ ${msg}`);

// 준비: A가 가계부를 만들고 B가 참여, X는 외부인
const A = await signUp('a');
const B = await signUp('b');
const X = await signUp('x');
const { data: ledgerId, error: e0 } = await A.c.rpc('create_ledger', { p_name: '우리집', p_display_name: '에이' });
assert.equal(e0, null, e0?.message);
const { data: invite, error: e1 } = await A.c.from('invite').insert({ ledger_id: ledgerId }).select('code').single();
assert.equal(e1, null, e1?.message);
const { error: e2 } = await B.c.rpc('join_ledger', { p_code: invite.code, p_display_name: '비' });
assert.equal(e2, null, e2?.message);
step('가계부 생성, B 참여');

// 입력 화면 선택지 (getTransactionFormOptions)
const [cats, pockets, members] = await Promise.all([
  B.c.from('category').select('id, ledger_id, type, parent_id, name, sort_order, is_hidden, created_at').eq('ledger_id', ledgerId),
  B.c.from('pocket').select('id, ledger_id, name, scope, sort_order, is_hidden, created_at').eq('ledger_id', ledgerId),
  B.c.from('member').select('id, ledger_id, user_id, role, display_name, joined_at, left_at').eq('ledger_id', ledgerId),
]);
for (const r of [cats, pockets, members]) assert.equal(r.error, null, r.error?.message);
assert.equal(members.data.length, 2);
const ma = members.data.find((m) => m.user_id === A.uid).id;
const mb = members.data.find((m) => m.user_id === B.uid).id;
const child = (type, parentName) => {
  const p = cats.data.find((c) => c.type === type && c.parent_id === null && c.name === parentName);
  return cats.data.find((c) => c.parent_id === p.id).id;
};
const food = child('expense', '식비');
const salary = child('income', '급여');
const shared = pockets.data.find((p) => p.name === '공동소비').id;
step('선택지 조회: 카테고리·주머니·멤버 2명');

// A: 지출 입력 (createTransaction) — 작성자·source 는 클라이언트가 보내지 않는다
const { data: created, error: e3 } = await A.c
  .from('transaction')
  .insert({
    ledger_id: ledgerId,
    source: 'manual',
    type: 'expense',
    amount: 9_999_999_999,
    occurred_on: '2030-01-01',
    category_id: food,
    pocket_id: shared,
    spender_id: mb,
    is_fixed: true,
    memo: '미래 날짜 + 최대 금액',
  })
  .select('id')
  .single();
assert.equal(e3, null, e3?.message);
let { data: row } = await A.c.from('transaction').select(COLUMNS).eq('id', created.id).maybeSingle();
assert.equal(row.amount, 9_999_999_999);
assert.equal(row.source, 'manual');
assert.equal(row.created_by, ma);
assert.equal(row.updated_by, ma);
step('A 지출 입력: 최대 금액·미래 날짜 저장, 작성자·마지막 수정자 = A, source = manual');

// 수입: 주머니 없이
const { error: e4 } = await A.c.from('transaction').insert({
  ledger_id: ledgerId, source: 'manual', type: 'income', amount: 1, occurred_on: '2026-11-06',
  category_id: salary, pocket_id: null, spender_id: ma, is_fixed: false, memo: null,
});
assert.equal(e4, null, e4?.message);
step('수입 입력 (주머니 없음)');

// 금액 0·소수·상한 초과는 DB도 거절
for (const amount of [0, -1, 10_000_000_000]) {
  const { error } = await A.c.from('transaction').insert({
    ledger_id: ledgerId, type: 'expense', amount, occurred_on: '2026-11-06', category_id: food, pocket_id: shared, spender_id: ma,
  });
  assert.ok(error, `금액 ${amount} 이 저장됨`);
}
step('금액 0·음수·상한 초과는 DB도 거절');

// B: A가 입력한 내역 수정 (updateTransaction) → 마지막 수정자 = B
await new Promise((r) => setTimeout(r, 20));
const { data: upd, error: e5 } = await B.c
  .from('transaction')
  .update({ type: 'expense', amount: 12000, occurred_on: '2026-11-05', category_id: food, pocket_id: shared, spender_id: mb, is_fixed: false, memo: 'B가 고침' })
  .eq('id', created.id)
  .select('id');
assert.equal(e5, null, e5?.message);
assert.equal(upd.length, 1);
({ data: row } = await A.c.from('transaction').select(COLUMNS).eq('id', created.id).maybeSingle());
assert.equal(row.amount, 12000);
assert.equal(row.created_by, ma);
assert.equal(row.updated_by, mb);
assert.ok(row.updated_at > row.created_at);
step('B가 A의 내역 수정: 작성자 A 유지, 마지막 수정자 B, 수정 시각 갱신');

// 외부인은 읽기·수정·삭제 불가
const { data: xr } = await X.c.from('transaction').select('id').eq('id', created.id).maybeSingle();
assert.equal(xr, null);
const { data: xu } = await X.c.from('transaction').update({ amount: 1 }).eq('id', created.id).select('id');
assert.deepEqual(xu, []);
step('외부인은 내역을 읽거나 수정할 수 없음');

// A가 삭제 (deleteTransaction) → B가 그 내역을 저장하면 0행 = '삭제된 내역' (새로 생기지 않음)
const { error: e6 } = await A.c.from('transaction').delete().eq('id', created.id);
assert.equal(e6, null, e6?.message);
const { data: gone, error: e7 } = await B.c.from('transaction').update({ amount: 5000 }).eq('id', created.id).select('id');
assert.equal(e7, null, e7?.message);
assert.deepEqual(gone, []);
const { data: after } = await B.c.from('transaction').select('id').eq('ledger_id', ledgerId);
assert.equal(after.length, 1); // 수입 1건만 남음
step("A 삭제 후 B 저장: 0행('삭제된 내역입니다'), 새 내역 안 생김");

// 이미 지운 내역 삭제는 오류 아님
const { error: e8 } = await B.c.from('transaction').delete().eq('id', created.id);
assert.equal(e8, null);
step('이미 지운 내역 삭제는 오류 없음');

console.log('✅ transaction flow passed');
