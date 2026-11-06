// 자산(BANB-7) 추가·수정·삭제를 실제 Supabase API로 확인한다. 쿼리 모양은 src/data/asset.ts 와 같다.
// ⚠️ 로컬 Supabase(`supabase start`) 전용. 테스트 계정을 실제로 만들기 때문에 운영 프로젝트에 돌리지 않는다.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> node supabase/tests/asset_flow.mjs
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY 필요');
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('로컬 Supabase에서만 실행한다');

const run = Date.now();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const COLUMNS = 'id, ledger_id, name, kind, owner_id, balance, memo, created_at, updated_at';
const step = (msg) => console.log(`✔ ${msg}`);

async function signUp(name) {
  const c = createClient(url, key, opts);
  const { data, error } = await c.auth.signUp({ email: `${name}-${run}@test.local`, password: 'password-1234' });
  assert.equal(error, null, `${name} 가입 실패: ${error?.message}`);
  assert.ok(data.session, `${name}: 세션 없음`);
  return c;
}

// 준비: A 가계부 생성, B 참여, X 외부인
const A = await signUp('a');
const B = await signUp('b');
const X = await signUp('x');
const { data: ledgerId, error: e1 } = await A.rpc('create_ledger', { p_name: '우리집', p_display_name: 'A' });
assert.equal(e1, null, e1?.message);
const { data: invite } = await A.from('invite').insert({ ledger_id: ledgerId }).select().single();
const { error: e2 } = await B.rpc('join_ledger', { p_code: invite.code, p_display_name: 'B' });
assert.equal(e2, null, e2?.message);
const { data: members } = await A.from('member').select('id, display_name').eq('ledger_id', ledgerId).order('joined_at');
const [mA, mB] = members;
step('A 가계부 생성, B 참여');

const sum = (rows) => rows.reduce((s, r) => s + r.balance, 0);
const list = async (c) => {
  const { data, error } = await c.from('asset').select(COLUMNS).eq('ledger_id', ledgerId);
  assert.equal(error, null, error?.message);
  return data;
};

// A: 본인 자산·공동 자산 추가
const ins = async (c, row) => c.from('asset').insert({ ledger_id: ledgerId, memo: null, ...row }).select(COLUMNS).single();
const r1 = await ins(A, { name: 'A 적금', kind: 'installment_saving', owner_id: mA.id, balance: 1_000_000 });
assert.equal(r1.error, null, r1.error?.message);
const r2 = await ins(A, { name: '생활비 통장', kind: 'checking', owner_id: null, balance: 9_999_999_999 });
assert.equal(r2.error, null, r2.error?.message);
assert.equal(r2.data.balance, 9_999_999_999, '상한 금액이 숫자로 정확히 돌아온다');
step('A 자산 2개 추가 (본인 / 공동, 상한 금액 포함)');

// B에게도 보이고 수정 가능
let rows = await list(B);
assert.equal(rows.length, 2);
assert.equal(sum(rows), 10_000_999_999);
const { data: upd, error: e3 } = await B.from('asset').update({ balance: 1_500_000, owner_id: mB.id }).eq('id', r1.data.id).select(COLUMNS);
assert.equal(e3, null, e3?.message);
assert.equal(upd.length, 1);
assert.ok(upd[0].updated_at > r1.data.updated_at, '수정 시각이 갱신된다');
rows = await list(A);
assert.equal(sum(rows), 10_001_499_999);
step('B가 A의 자산을 보고 수정함, A 화면 합계 반영, 수정 시각 갱신');

// 저장되면 안 되는 값
for (const [label, row] of [
  ['음수', { balance: -1 }],
  ['소수', { balance: 1.5 }],
  ['빈 값(null)', { balance: null }],
  ['상한 초과', { balance: 10_000_000_000 }],
  ['이름 공백', { name: '   ' }],
  ['이름 21자', { name: '가'.repeat(21) }],
  ['알 수 없는 종류', { kind: 'crypto' }],
]) {
  const { error } = await ins(A, { name: '테스트', kind: 'cash', owner_id: null, balance: 0, ...row });
  assert.ok(error, `${label} 이 저장됨`);
}
const r0 = await ins(A, { name: '빈 지갑', kind: 'cash', owner_id: null, balance: 0 });
assert.equal(r0.error, null, '0원은 저장된다');
step('음수·소수·빈 값·상한 초과·이름 규칙 위반은 DB에서 거부, 0원은 저장');

// 다른 가계부 멤버(id)를 소유자로 지정 불가
const { error: e4 } = await ins(A, { name: '남의 것', kind: 'cash', owner_id: '00000000-0000-0000-0000-000000000000', balance: 1 });
assert.ok(e4, '없는 멤버가 소유자로 저장됨');
step('가계부 밖 멤버를 소유자로 지정 불가');

// 외부인 차단
const { data: xRows } = await X.from('asset').select('*').eq('ledger_id', ledgerId);
assert.equal(xRows.length, 0);
const { data: xUpd } = await X.from('asset').update({ balance: 0 }).eq('id', r1.data.id).select();
assert.equal(xUpd.length, 0);
const { error: xIns } = await ins(X, { name: '몰래', kind: 'cash', owner_id: null, balance: 1 });
assert.ok(xIns);
step('외부인은 조회·수정·추가 불가');

// 삭제 → 합계 반영. 삭제된 자산 수정 시 0행 (화면은 "삭제된 자산" 안내)
const { error: e5 } = await A.from('asset').delete().eq('id', r2.data.id);
assert.equal(e5, null, e5?.message);
rows = await list(B);
assert.equal(rows.length, 2);
assert.equal(sum(rows), 1_500_000);
const { data: gone, error: e6 } = await B.from('asset').update({ balance: 1 }).eq('id', r2.data.id).select(COLUMNS);
assert.equal(e6, null);
assert.equal(gone.length, 0);
step('A 삭제 → B 합계 반영, 삭제된 자산 수정은 0행');

console.log('✅ asset flow passed');
