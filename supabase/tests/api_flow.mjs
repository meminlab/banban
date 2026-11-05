// 가입 → 가계부 생성 → 초대 → 참여 흐름을 실제 Supabase API(supabase-js)로 확인한다.
// ⚠️ 로컬 Supabase(`supabase start`) 전용. 테스트 계정을 실제로 만들기 때문에 운영 프로젝트에 돌리지 않는다.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> node supabase/tests/api_flow.mjs
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY 필요');
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('로컬 Supabase에서만 실행한다');

const run = Date.now();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function signUp(name) {
  const c = createClient(url, key, opts);
  const { data, error } = await c.auth.signUp({ email: `${name}-${run}@test.local`, password: 'password-1234' });
  assert.equal(error, null, `${name} 가입 실패: ${error?.message}`);
  assert.ok(data.session, `${name}: 세션 없음 (이메일 확인이 켜져 있으면 로컬 config에서 끈다)`);
  return c;
}

const step = (msg) => console.log(`✔ ${msg}`);

const anon = createClient(url, key, opts);
const A = await signUp('a');
const B = await signUp('b');
const C = await signUp('c');
const X = await signUp('x');
step('4개 계정 가입');

// A: 가계부 생성
const { data: ledgerId, error: e1 } = await A.rpc('create_ledger', { p_name: '우리집', p_display_name: 'A' });
assert.equal(e1, null, e1?.message);
const { data: cats } = await A.from('category').select('id, parent_id, type, name');
assert.equal(cats.length, 70);
const { data: pockets } = await A.from('pocket').select('name, scope').order('sort_order');
assert.deepEqual(pockets.map((p) => p.name), ['공동소비', '개인용돈', '여행', '경조사비']);
step('A 가계부 생성 + 기본 카테고리 70개 / 주머니 4개');

// A: 초대 발급
const { data: invite, error: e2 } = await A.from('invite').insert({ ledger_id: ledgerId }).select().single();
assert.equal(e2, null, e2?.message);
assert.match(invite.code, /^[A-Z0-9]{8}$/);
step(`A 초대 코드 발급 (${invite.code})`);

// X(외부인)·anon: 아무것도 안 보임
for (const t of ['ledger', 'member', 'invite', 'category', 'pocket', 'transaction', 'asset']) {
  const { data } = await X.from(t).select('*');
  assert.equal(data.length, 0, `X가 ${t}를 봄`);
  const r = await anon.from(t).select('*');
  assert.ok(r.error || r.data.length === 0, `anon이 ${t}를 봄`);
}
const { error: xIns } = await X.from('pocket').insert({ ledger_id: ledgerId, name: '몰래', scope: 'shared' });
assert.ok(xIns, 'X가 주머니를 추가함');
step('외부인·비로그인은 읽기/쓰기 차단');

// B: 참여 → A 데이터가 보임
const { data: joined, error: e3 } = await B.rpc('join_ledger', { p_code: invite.code, p_display_name: 'B' });
assert.equal(e3, null, e3?.message);
assert.equal(joined, ledgerId);
const { data: members } = await B.from('member').select('id, display_name, role').order('joined_at');
assert.deepEqual(members.map((m) => `${m.display_name}:${m.role}`), ['A:owner', 'B:member']);
step('B 초대 코드로 참여, 같은 가계부가 보임');

// C: 상한 초과
const { error: e4 } = await C.rpc('join_ledger', { p_code: invite.code, p_display_name: 'C' });
assert.match(e4?.message ?? '', /MEMBER_LIMIT_REACHED/);
step('C는 상한(2명) 초과로 참여 거부');

// B가 입력한 내역을 A가 봄, 작성자는 B로 기록
const child = cats.find((c) => c.type === 'expense' && c.name === '외식');
const { data: pocketRows } = await B.from('pocket').select('id').eq('name', '공동소비');
const memberB = members.find((m) => m.display_name === 'B');
const memberA = members.find((m) => m.display_name === 'A');
const { error: e5 } = await B.from('transaction').insert({
  ledger_id: ledgerId, type: 'expense', amount: 12000, category_id: child.id,
  pocket_id: pocketRows[0].id, spender_id: memberB.id, created_by: memberA.id, updated_by: memberA.id,
});
assert.equal(e5, null, e5?.message);
const { data: txs } = await A.from('transaction').select('amount, source, created_by, updated_by');
assert.equal(txs.length, 1);
assert.equal(txs[0].source, 'manual');
assert.equal(txs[0].created_by, memberB.id, '작성자 위조가 통함');
step('B가 입력한 내역이 A에게 보임, source=manual, 작성자=B(위조 무시)');

// member_limit 변경 불가
const { error: e6 } = await A.from('ledger').update({ member_limit: 10 }).eq('id', ledgerId);
assert.ok(e6, 'member_limit이 바뀜');
step('member_limit 변경 차단');

console.log('\n✅ API 흐름 확인 완료');
