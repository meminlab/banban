// 반반 쌓기 대전(BANB-55) 실시간 흐름을 실제 Supabase API(supabase-js, Realtime)로 확인한다.
// ⚠️ 로컬 Supabase(`supabase start`) 전용. 테스트 계정을 실제로 만들기 때문에 운영 프로젝트에 돌리지 않는다.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> node supabase/tests/stack_vs_flow.mjs
// 확인: 내기 초대·수락 · 두 사람 같은 순서 값 · 방해 줄이 상대에게 실시간 도착(지연 측정) · 미리보기·이모지 broadcast 도착
//      · 다른 가계부 사람은 방해 줄을 실시간으로도 못 받음 · 외부인·구경꾼 API 거부 · 먼저 닿은 사람 패 · 메시지 수 기록
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
  const { data, error } = await c.auth.signUp({ email: `${name}-${run}@stackvs.local`, password: 'password-1234' });
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

function subscribed(channel) {
  return new Promise((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve(channel);
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
    });
  });
}

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
const C = await signUp('c');
const X = await signUp('x');

const ledger = await rpc(A, 'create_ledger', { p_name: '대전 가계부', p_display_name: '에이' });
const { data: inv, error: invErr } = await A.from('invite').insert({ ledger_id: ledger }).select('code').single();
assert.equal(invErr, null);
await rpc(B, 'join_ledger', { p_code: inv.code, p_display_name: '비' });
await rpc(C, 'join_ledger', { p_code: inv.code, p_display_name: '씨' });
await rpc(X, 'create_ledger', { p_name: '남의 가계부', p_display_name: '엑스' });
const { data: members } = await A.from('member').select('id, display_name').eq('ledger_id', ledger);
const mA = members.find((m) => m.display_name === '에이').id;
const mB = members.find((m) => m.display_name === '비').id;
step('가계부·멤버 준비 (A·B 대전, C 구경꾼, X 다른 가계부)');

// 1) 내기 초대 → 수락
const gameId = await rpc(A, 'invite_game', { p_ledger_id: ledger, p_opponent: mB, p_kind: 'stack_vs', p_rematch_of: null, p_bet: ' 진 사람이 설거지 ' });
const { data: seenByB } = await B.from('game').select('kind, bet, seed, status').eq('id', gameId).single();
assert.equal(seenByB.kind, 'stack_vs');
assert.equal(seenByB.bet, '진 사람이 설거지');
step(`B 가 수락 전에 내기를 봄: "${seenByB.bet}"`);
await expectRpcError(A, 'invite_game', { p_ledger_id: ledger, p_opponent: mB, p_kind: 'stack_vs', p_rematch_of: null, p_bet: '가'.repeat(31) }, 'GAME_');

// 2) 대전 채널 (A·B): 방해 줄 INSERT + 판 UPDATE + broadcast(미리보기·이모지) + Presence
const counts = { A: 0, B: 0 };
function room(client, me, log, who) {
  const ch = client.channel(`stackvs:${gameId}`, { config: { presence: { key: me }, broadcast: { self: false } } });
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_stack_garbage', filter: `game_id=eq.${gameId}` }, (p) => {
    counts[who] += 1;
    log.push({ at: Date.now(), kind: 'garbage', p });
  })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game', filter: `id=eq.${gameId}` }, (p) => {
      counts[who] += 1;
      log.push({ at: Date.now(), kind: 'game', p });
    })
    .on('broadcast', { event: 'preview' }, ({ payload }) => {
      counts[who] += 1;
      log.push({ at: Date.now(), kind: 'preview', payload });
    })
    .on('broadcast', { event: 'emoji' }, ({ payload }) => {
      counts[who] += 1;
      log.push({ at: Date.now(), kind: 'emoji', payload });
    })
    .on('presence', { event: 'sync' }, () => log.push({ at: Date.now(), kind: 'presence', keys: Object.keys(ch.presenceState()) }));
  return ch;
}
const logA = [];
const logB = [];
const roomA = await subscribed(room(A, mA, logA, 'A'));
await roomA.track({ at: Date.now() });
const roomB = await subscribed(room(B, mB, logB, 'B'));
await roomB.track({ at: Date.now() });
const garbageX = [];
await subscribed(
  X.channel(`x-${run}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_stack_garbage' }, (p) => garbageX.push(p)),
);
await waitFor(logA, (e) => e.kind === "presence" && e.keys.includes(mB), 15000); // 로컬 Realtime 첫 연결은 느릴 수 있다
await sleep(2000); // 첫 구독 때 변경 스트림을 여는 시간 (운영에서는 이미 열려 있다)

let t0 = Date.now();
await rpc(B, 'respond_game', { p_game_id: gameId, p_accept: true });
const accepted = await waitFor(logA, (e) => e.kind === 'game' && e.p.new.status === 'active');
step(`수락이 A 에게 실시간 도착 (${accepted.at - t0}ms)`);
const { data: gA } = await A.from('game').select('seed').eq('id', gameId).single();
const { data: gB } = await B.from('game').select('seed').eq('id', gameId).single();
assert.equal(gA.seed, gB.seed);
step(`두 사람 같은 조각 순서 값 (seed ${gA.seed})`);

// 3) 판 저장 · 방해 줄 보내기 → 상대에게 도착 (지연)
await rpc(A, 'stack_vs_save', { p_game_id: gameId, p_state: { v: 1 }, p_lines: 0 });
await rpc(B, 'stack_vs_save', { p_game_id: gameId, p_state: { v: 1 }, p_lines: 0 });
const latencies = [];
for (let i = 1; i <= 5; i += 1) {
  t0 = Date.now();
  const r = await rpc(A, 'stack_vs_send', { p_game_id: gameId, p_seq: i, p_cleared: 2 + (i % 3) });
  const got = await waitFor(logB, (e) => e.kind === 'garbage' && e.p.new.seq === i && e.p.new.from_member === mA);
  assert.equal(got.p.new.hole, r.hole);
  assert.equal(got.p.new.lines, r.lines);
  latencies.push(got.at - t0);
}
step(`방해 줄 5묶음 B 화면 도착: ${latencies.join(', ')}ms (최대 ${Math.max(...latencies)}ms) · 장수·빈칸 서버 값 그대로`);
assert.ok(Math.max(...latencies) < 1500, '로컬 기준 1.5초 안에 도착해야 한다');
const again = await rpc(A, 'stack_vs_send', { p_game_id: gameId, p_seq: 5, p_cleared: 2 });
assert.equal(again.applied, false);
await expectRpcError(A, 'stack_vs_send', { p_game_id: gameId, p_seq: 9, p_cleared: 2 }, 'STACK_BAD_SEQ');
step('같은 순번 다시 = 한 번만, 건너뛴 순번 거부');

// 4) broadcast: 미리보기 · 이모지 (저장하지 않음)
t0 = Date.now();
await roomA.send({ type: 'broadcast', event: 'preview', payload: { m: mA, cells: '.'.repeat(112), lines: 3, sent: 4, danger: false } });
const pv = await waitFor(logB, (e) => e.kind === 'preview');
await roomB.send({ type: 'broadcast', event: 'emoji', payload: { m: mB, e: 1 } });
const em = await waitFor(logA, (e) => e.kind === 'emoji');
step(`미리보기 B 도착 (${pv.at - t0}ms) · 이모지 A 도착 (${em.at - t0}ms), 보낸 사람 자신에게는 안 옴: ${!logA.some((e) => e.kind === 'preview')}`);
assert.ok(!logA.some((e) => e.kind === 'preview'));

// 5) 권한: 외부인·구경꾼
await expectRpcError(X, 'stack_vs_send', { p_game_id: gameId, p_seq: 6, p_cleared: 2 }, 'GAME_NOT_FOUND');
await expectRpcError(C, 'stack_vs_send', { p_game_id: gameId, p_seq: 1, p_cleared: 2 }, 'GAME_NOT_PLAYER');
await expectRpcError(A, 'play_move', { p_game_id: gameId, p_x: 7, p_y: 7 }, 'GAME_BAD_KIND');
const direct = await A.from('game_stack_garbage').insert({ game_id: gameId, ledger_id: ledger, from_member: mA, seq: 6, cleared: 4, lines: 3, hole: 0 });
assert.ok(direct.error, '직접 쓰기는 막혀야 한다');
const { data: xGame } = await X.from('game').select('id').eq('id', gameId);
const { data: xRows } = await X.from('game_stack_garbage').select('seq').eq('game_id', gameId);
assert.equal(xGame.length + xRows.length, 0);
step('외부인 판·방해 줄 조회 0건, 외부인·구경꾼·오목 함수·직접 쓰기 거부');

// 6) 끝: B 가 먼저 닿음 → B 패, A 는 늦게 닿아도 반영 안 됨
const endB = await rpc(B, 'stack_vs_end', { p_game_id: gameId, p_reason: 'topout' });
const endA = await rpc(A, 'stack_vs_end', { p_game_id: gameId, p_reason: 'topout' });
assert.equal(endB.applied, true);
assert.equal(endA.applied, false);
assert.equal(endB.winner_id, mA);
await waitFor(logA, (e) => e.kind === 'game' && e.p.new.status === 'finished' && e.p.new.winner_id === mA);
await expectRpcError(A, 'stack_vs_send', { p_game_id: gameId, p_seq: 6, p_cleared: 2 }, 'GAME_NOT_ACTIVE');
step('먼저 닿은 B 패 · 늦게 온 A 는 반영 안 됨 · 끝난 판 보내기 거부 · 결과가 A 에게 실시간 도착');

await sleep(1000);
assert.equal(garbageX.length, 0, `X 가 방해 줄 이벤트를 받음: ${garbageX.length}`);
step('다른 가계부 사람은 방해 줄을 실시간으로도 받지 못함');
console.log(`ℹ 이번 흐름에서 받은 실시간 메시지: A ${counts.A}건 · B ${counts.B}건 (방해 줄 5 · 판 상태 · 미리보기 1 · 이모지 1)`);

await Promise.all([A, B, C, X].map((c) => c.removeAllChannels()));
console.log('✅ stack_vs flow passed');
process.exit(0);
