// 같이 놀기(오목, BANB-49) 실시간 흐름을 실제 Supabase API(supabase-js, Realtime)로 확인한다.
// ⚠️ 로컬 Supabase(`supabase start`) 전용. 테스트 계정을 실제로 만들기 때문에 운영 프로젝트에 돌리지 않는다.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> node supabase/tests/game_flow.mjs
// 확인: 초대·수락·수가 상대에게 실시간으로 도착(지연 측정) · 다른 가계부 사람은 실시간으로도 못 받음 · 자리 비움(Presence)
//      · 차례·빈칸·외부인 요청 서버 거부(API 직접 호출) · 새 기기(앱 다시 열기)에서 같은 판·같은 차례 · 5목 승리
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY 필요');
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('로컬 Supabase에서만 실행한다');

const run = Date.now();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const step = (msg) => console.log(`✔ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signUp(name) {
  const c = createClient(url, key, opts);
  const { data, error } = await c.auth.signUp({ email: `${name}-${run}@game.local`, password: 'password-1234' });
  assert.equal(error, null, `${name} 가입 실패: ${error?.message}`);
  assert.ok(data.session, `${name}: 세션 없음`);
  await c.realtime.setAuth(data.session.access_token);
  return c;
}

async function rpc(c, fn, args) {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

async function expectRpcError(c, fn, args, code) {
  const { error } = await c.rpc(fn, args);
  assert.ok(error?.message?.includes(code), `${fn} → ${code} 기대, 받은 것: ${error?.message ?? '성공'}`);
}

/** 채널 구독 완료까지 기다린다 */
function subscribed(channel) {
  return new Promise((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve(channel);
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
    });
  });
}

/** 조건을 만족하는 이벤트가 올 때까지 (timeout ms) */
function waitFor(list, pred, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const t = setInterval(() => {
      const hit = list.find(pred);
      if (hit) {
        clearInterval(t);
        resolve(hit);
      } else if (Date.now() - started > timeout) {
        clearInterval(t);
        reject(new Error('이벤트가 오지 않음'));
      }
    }, 5);
  });
}

const A = await signUp('a');
const B = await signUp('b');
const X = await signUp('x');

// 가계부 L(A·B), LX(X)
const ledger = await rpc(A, 'create_ledger', { p_name: '놀이 가계부', p_display_name: '에이' });
const { data: inv, error: invErr } = await A.from('invite').insert({ ledger_id: ledger }).select('code').single();
assert.equal(invErr, null);
await rpc(B, 'join_ledger', { p_code: inv.code, p_display_name: '비' });
await rpc(X, 'create_ledger', { p_name: '남의 가계부', p_display_name: '엑스' });
const { data: members } = await A.from('member').select('id, display_name').eq('ledger_id', ledger);
const mA = members.find((m) => m.display_name === '에이').id;
const mB = members.find((m) => m.display_name === '비').id;
step('가계부·멤버 준비');

// 실시간 구독: B 와 X 가 같은 필터(이 가계부의 game)로 구독 → X 는 RLS 로 아무것도 못 받아야 한다
const eventsB = [];
const eventsX = [];
const ledgerFilter = { event: '*', schema: 'public', table: 'game', filter: `ledger_id=eq.${ledger}` };
await subscribed(B.channel(`games-b-${run}`).on('postgres_changes', ledgerFilter, (p) => eventsB.push({ at: Date.now(), p })));
await subscribed(X.channel(`games-x-${run}`).on('postgres_changes', ledgerFilter, (p) => eventsX.push({ at: Date.now(), p })));
const movesX = [];
await subscribed(
  X.channel(`moves-x-${run}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_move' }, (p) => movesX.push(p)),
);
// 첫 구독 때 서버가 변경 스트림(복제 슬롯)을 여는 시간 (운영에서는 이미 열려 있다)
await sleep(2000);

// 1) 초대 → B 에게 실시간 도착
let t0 = Date.now();
const gameId = await rpc(A, 'invite_game', { p_ledger_id: ledger, p_opponent: mB, p_kind: 'omok', p_rematch_of: null });
const invited = await waitFor(eventsB, (e) => e.p.eventType === 'INSERT' && e.p.new.id === gameId);
step(`초대가 B 에게 실시간 도착 (${invited.at - t0}ms) · 흑 = B: ${invited.p.new.black_id === mB}`);
assert.equal(invited.p.new.black_id, mB);

// 2) 판 채널 (A·B) + Presence
function room(client, me, log) {
  const ch = client.channel(`game:${gameId}`, { config: { presence: { key: me } } });
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_move', filter: `game_id=eq.${gameId}` }, (p) =>
    log.push({ at: Date.now(), kind: 'move', p }),
  )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game', filter: `id=eq.${gameId}` }, (p) =>
      log.push({ at: Date.now(), kind: 'game', p }),
    )
    .on('presence', { event: 'sync' }, () => log.push({ at: Date.now(), kind: 'presence', keys: Object.keys(ch.presenceState()) }));
  return ch;
}
const logA = [];
const logB = [];
const roomA = await subscribed(room(A, mA, logA));
await roomA.track({ at: Date.now() });
const roomB = await subscribed(room(B, mB, logB));
await roomB.track({ at: Date.now() });
await waitFor(logA, (e) => e.kind === 'presence' && e.keys.includes(mB));
step('Presence: A 화면에서 B 가 판에 들어온 것이 보임');

// 3) 수락 → A 에게 active 도착
t0 = Date.now();
await rpc(B, 'respond_game', { p_game_id: gameId, p_accept: true });
const accepted = await waitFor(logA, (e) => e.kind === 'game' && e.p.new.status === 'active');
step(`수락이 A 에게 실시간 도착 (${accepted.at - t0}ms)`);

// 4) 서버 거부 (API 직접 호출)
await expectRpcError(A, 'play_move', { p_game_id: gameId, p_x: 7, p_y: 7 }, 'GAME_NOT_YOUR_TURN');
await expectRpcError(X, 'play_move', { p_game_id: gameId, p_x: 7, p_y: 7 }, 'GAME_NOT_FOUND');
await expectRpcError(B, 'play_move', { p_game_id: gameId, p_x: 15, p_y: 7 }, 'GAME_BAD_CELL');
const direct = await A.from('game_move').insert({ game_id: gameId, ledger_id: ledger, seq: 1, x: 0, y: 0, member_id: mA });
assert.ok(direct.error, '직접 쓰기는 막혀야 한다');
const forged = await A.from('game').update({ status: 'finished', winner_id: mA }).eq('id', gameId).select('id');
assert.ok(forged.error || forged.data.length === 0, '판 상태 직접 수정은 막혀야 한다');
const { data: seenByX } = await X.from('game').select('id').eq('id', gameId);
assert.equal(seenByX.length, 0);
step('차례 아님·외부인·범위 밖·직접 쓰기·직접 수정 거부, 외부인은 판 조회 0건');

// 5) 수 주고받기: B(흑) 가로 (3..7, 7), A(백) (3..6, 8) — 각 수가 상대 화면에 도착하는 시간
const plan = [
  [B, [3, 7], logA],
  [A, [3, 8], logB],
  [B, [4, 7], logA],
  [A, [4, 8], logB],
  [B, [5, 7], logA],
  [A, [5, 8], logB],
  [B, [6, 7], logA],
];
const latencies = [];
for (let i = 0; i < plan.length; i += 1) {
  const [client, [x, y], otherLog] = plan[i];
  t0 = Date.now();
  await rpc(client, 'play_move', { p_game_id: gameId, p_x: x, p_y: y });
  const got = await waitFor(otherLog, (e) => e.kind === 'move' && e.p.new.seq === i + 1);
  latencies.push(got.at - t0);
}
await expectRpcError(A, 'play_move', { p_game_id: gameId, p_x: 6, p_y: 7 }, 'GAME_CELL_TAKEN');
step(`수 ${plan.length}개 상대 화면 도착: ${latencies.join(', ')}ms (최대 ${Math.max(...latencies)}ms)`);
assert.ok(Math.max(...latencies) < 1500, '로컬 기준 1.5초 안에 도착해야 한다');

// 6) 앱 다시 열기 = 새 클라이언트로 로그인해서 서버 값만으로 같은 판·같은 차례
const A2 = createClient(url, key, opts);
await A2.auth.signInWithPassword({ email: `a-${run}@game.local`, password: 'password-1234' });
const { data: g2 } = await A2.from('game').select('*').eq('id', gameId).single();
const { data: m2 } = await A2.from('game_move').select('seq, x, y, member_id').eq('game_id', gameId).order('seq');
assert.equal(g2.move_count, 7);
assert.equal(m2.length, 7);
assert.equal(g2.move_count % 2 === 0 ? g2.black_id : g2.white_id, mA, '다음 차례는 A(백)');
step('새 기기에서 다시 열어도 같은 판·같은 차례(수 7개, A 차례)');

// 7) 자리 비움: B 가 판 화면을 떠나면 A 에게 Presence 변화
await B.removeChannel(roomB);
await waitFor(logA, (e) => e.kind === 'presence' && !e.keys.includes(mB));
step('B 가 판을 떠나면 A 화면에서 자리 비움으로 바뀜');
const roomB2 = await subscribed(room(B, mB, logB));
await roomB2.track({ at: Date.now() });

// 8) A 한 수 → B 5목 (3..7, 7) → 둘 다 finished 수신
await rpc(A, 'play_move', { p_game_id: gameId, p_x: 0, p_y: 0 });
const win = await rpc(B, 'play_move', { p_game_id: gameId, p_x: 7, p_y: 7 });
assert.equal(win.status, 'finished');
assert.equal(win.end_reason, 'five');
assert.equal(win.winner_id, mB);
await waitFor(logA, (e) => e.kind === 'game' && e.p.new.status === 'finished' && e.p.new.winner_id === mB);
await waitFor(eventsB, (e) => e.p.eventType === 'UPDATE' && e.p.new.status === 'finished');
step('5목 승리가 서버 판정되고 A 화면·B 가계부 채널에 도착');

// 9) 외부인 X 는 같은 필터로 구독했지만 아무것도 받지 못했다
// 늦게 오는 이벤트까지 기다린다
await sleep(1000);
assert.equal(eventsX.length, 0, `X 가 판 이벤트를 받음: ${eventsX.length}`);
assert.equal(movesX.length, 0, `X 가 수 이벤트를 받음: ${movesX.length}`);
step('다른 가계부 사람은 실시간으로도 판·수를 받지 못함');

await Promise.all([A, B, X].map((c) => c.removeAllChannels()));
console.log('✅ game flow passed');
process.exit(0);
