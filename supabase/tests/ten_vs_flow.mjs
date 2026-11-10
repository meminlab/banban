// 도토리 열 알 대전(BANB-57) 실시간 흐름을 실제 Supabase API(supabase-js, Realtime)로 확인한다.
// ⚠️ 로컬 Supabase(`supabase start`) 전용. 테스트 계정을 실제로 만들기 때문에 운영 프로젝트에 돌리지 않는다.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<publishable key> node supabase/tests/ten_vs_flow.mjs
// 판 마감을 실제 시간으로 기다린다 (수락 + 125초 + 5초 ≈ 2분 15초).
// 확인: 내기 초대·수락 · 두 사람 같은 마감·같은 판 값 · 기록 저장 → 서버가 다시 센 점수(조작 0점) · 대전 중 상대 기록 비공개
//      · 점수·이모지 broadcast 도착(지연) · 마감 + 5초 확정 → 결과가 상대에게 실시간 도착 · 끝난 뒤 두 기록 공개
//      · 다른 가계부 사람은 판·기록·실시간 모두 못 받음 · 1인 최고 기록 · 메시지 수 기록
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
  const { data, error } = await c.auth.signUp({ email: `${name}-${run}@tenvs.local`, password: 'password-1234' });
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
const X = await signUp('x');

const ledger = await rpc(A, 'create_ledger', { p_name: '도토리 가계부', p_display_name: '에이' });
const { data: inv, error: invErr } = await A.from('invite').insert({ ledger_id: ledger }).select('code').single();
assert.equal(invErr, null);
await rpc(B, 'join_ledger', { p_code: inv.code, p_display_name: '비' });
await rpc(X, 'create_ledger', { p_name: '남의 가계부', p_display_name: '엑스' });
const { data: members } = await A.from('member').select('id, display_name').eq('ledger_id', ledger);
const mA = members.find((m) => m.display_name === '에이').id;
const mB = members.find((m) => m.display_name === '비').id;
step('가계부·멤버 준비 (A·B 대전, X 다른 가계부)');

// 0) 1인 최고 기록: 서버가 다시 센다 (순서 값 12345 첫 줄 2 2 8 … → (1,0)~(2,0) = 10)
const solo = await rpc(A, 'record_ten_score', { p_ledger_id: ledger, p_seed: 12345, p_drags: [[1, 0, 2, 0], [0, 0, 14, 7]] });
assert.equal(solo.score, 2);
assert.equal(solo.is_new, true);
const { data: xBest } = await X.from('game_ten_best').select('member_id').eq('ledger_id', ledger);
assert.equal(xBest.length, 0);
step('1인 기록: 서버 점수 2 (가짜 네모 무시) · 다른 가계부는 못 봄');

// 1) 내기 초대
const gameId = await rpc(A, 'invite_game', { p_ledger_id: ledger, p_opponent: mB, p_kind: 'ten_vs', p_rematch_of: null, p_bet: ' 진 사람이 커피 ' });
const { data: seenByB } = await B.from('game').select('kind, bet, seed, status, turn_deadline').eq('id', gameId).single();
assert.equal(seenByB.kind, 'ten_vs');
assert.equal(seenByB.bet, '진 사람이 커피');
assert.equal(seenByB.turn_deadline, null);
step(`B 가 수락 전에 내기를 봄: "${seenByB.bet}"`);

// 2) 대전 채널 (A·B): 판 UPDATE + broadcast(점수·이모지) + Presence. X 는 game 변화를 엿들으려 함
const counts = { A: 0, B: 0 };
function room(client, me, log, who) {
  const ch = client.channel(`tenvs:${gameId}`, { config: { presence: { key: me }, broadcast: { self: false } } });
  ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game', filter: `id=eq.${gameId}` }, (p) => {
    counts[who] += 1;
    log.push({ at: Date.now(), kind: 'game', p });
  })
    .on('broadcast', { event: 'score' }, ({ payload }) => {
      counts[who] += 1;
      log.push({ at: Date.now(), kind: 'score', payload });
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
const gameX = [];
await subscribed(X.channel(`x-${run}`).on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, (p) => gameX.push(p)));
await waitFor(logA, (e) => e.kind === 'presence' && e.keys.includes(mB), 15000);
await sleep(2000); // 첫 구독 때 변경 스트림을 여는 시간 (운영에서는 이미 열려 있다)

let t0 = Date.now();
await rpc(B, 'respond_game', { p_game_id: gameId, p_accept: true });
const accepted = await waitFor(logA, (e) => e.kind === 'game' && e.p.new.status === 'active');
step(`수락이 A 에게 실시간 도착 (${accepted.at - t0}ms)`);
const { data: gA } = await A.from('game').select('seed, started_at, turn_deadline').eq('id', gameId).single();
const { data: gB } = await B.from('game').select('seed, turn_deadline').eq('id', gameId).single();
assert.equal(gA.seed, gB.seed);
assert.equal(gA.turn_deadline, gB.turn_deadline);
assert.equal(Date.parse(gA.turn_deadline) - Date.parse(gA.started_at), 125_000);
step(`두 사람 같은 판 값(seed ${gA.seed}) · 같은 마감(수락 + 125초, 서버 시각)`);

// 3) 기록 저장 → 서버가 다시 센 점수 (판을 화면과 같은 계산으로 만들어 합 10 네모를 찾는다)
function board(seed) {
  const MOD = 2147483647;
  let s = ((((Math.trunc(seed) || 0) % (MOD - 1)) + (MOD - 1)) % (MOD - 1)) + 1;
  const b = [];
  for (let i = 0; i < 120; i++) {
    s = (s * 48271) % MOD;
    b.push(1 + (s % 9));
  }
  return b;
}
function findTens(b, limit) {
  const out = [];
  const cur = b.slice();
  for (let y = 0; y < 8 && out.length < limit; y++)
    for (let x = 0; x < 14 && out.length < limit; x++) {
      if (cur[y * 15 + x] && cur[y * 15 + x + 1] && cur[y * 15 + x] + cur[y * 15 + x + 1] === 10) {
        out.push([x, y, x + 1, y]);
        cur[y * 15 + x] = 0;
        cur[y * 15 + x + 1] = 0;
      }
    }
  return out;
}
const tens = findTens(board(gA.seed), 4);
assert.ok(tens.length >= 2, '가로 두 칸 합 10 네모가 2개 이상 있어야 한다 (판이 다르면 다시 실행)');
const saveA = await rpc(A, 'ten_vs_save', { p_game_id: gameId, p_drags: tens, p_final: false });
assert.equal(saveA.my_score, tens.length * 2);
assert.equal(saveA.opp_score, null);
const cheat = await rpc(B, 'ten_vs_save', { p_game_id: gameId, p_drags: [tens[0], [0, 0, 14, 7], [0, 0, 14, 7]], p_final: false });
assert.equal(cheat.my_score, 2);
step(`A 기록 → 서버 점수 ${saveA.my_score} · B 가짜 네모는 0점 처리(서버 점수 ${cheat.my_score}) · 대전 중 상대 점수 비공개`);
const { data: bSees } = await B.from('game_ten_board').select('member_id').eq('game_id', gameId);
assert.deepEqual(bSees.map((r) => r.member_id), [mB]);
step('대전 중에는 자기 기록만 읽힘 (상대 네모 = 답 힌트)');

// 4) broadcast: 점수 · 이모지 (저장하지 않음)
t0 = Date.now();
await roomA.send({ type: 'broadcast', event: 'score', payload: { m: mA, s: saveA.my_score } });
const sc = await waitFor(logB, (e) => e.kind === 'score');
await roomB.send({ type: 'broadcast', event: 'emoji', payload: { m: mB, e: 0 } });
const em = await waitFor(logA, (e) => e.kind === 'emoji');
assert.equal(sc.payload.s, saveA.my_score);
assert.ok(!logA.some((e) => e.kind === 'score'));
step(`점수 B 도착 (${sc.at - t0}ms) · 이모지 A 도착 (${em.at - t0}ms), 보낸 사람 자신에게는 안 옴`);

// 5) 권한: 외부인
await expectRpcError(X, 'ten_vs_save', { p_game_id: gameId, p_drags: [], p_final: false }, 'GAME_NOT_FOUND');
await expectRpcError(X, 'ten_vs_quit', { p_game_id: gameId }, 'GAME_NOT_FOUND');
await expectRpcError(A, 'stack_vs_end', { p_game_id: gameId, p_reason: 'quit' }, 'GAME_BAD_KIND');
await expectRpcError(A, 'ten_vs_settle', { p_game_id: gameId }, 'GAME_NOT_TIMED_OUT');
const direct = await A.from('game_ten_board').update({ score: 120 }).eq('game_id', gameId);
assert.ok(direct.error || (direct.count ?? 0) === 0, '직접 쓰기는 막혀야 한다');
const { data: xGame } = await X.from('game').select('id').eq('id', gameId);
const { data: xRows } = await X.from('game_ten_board').select('member_id').eq('game_id', gameId);
assert.equal(xGame.length + xRows.length, 0);
step('외부인 판·기록 조회 0건, 외부인·다른 게임 함수·마감 전 확정·직접 쓰기 거부');

// 6) 마감까지 기다림 → A 만 마지막 기록, B 는 안 보냄 → 마감 + 5초에 확정 → 결과가 B 에게 실시간 도착
const { data: nowStr } = await A.rpc('game_server_now');
const offset = Date.parse(nowStr) - Date.now();
const deadline = Date.parse(gA.turn_deadline);
const waitMs = deadline - (Date.now() + offset) + 300;
console.log(`… 마감까지 ${Math.round(waitMs / 1000)}초 기다림`);
await sleep(Math.max(0, waitMs));
const fin = await rpc(A, 'ten_vs_save', { p_game_id: gameId, p_drags: tens, p_final: true });
assert.equal(fin.status, 'active', 'B 마지막 기록이 없으니 아직');
await sleep(5_500);
t0 = Date.now();
const settled = await rpc(A, 'ten_vs_settle', { p_game_id: gameId });
assert.equal(settled.applied, true);
assert.equal(settled.status, 'finished');
assert.equal(settled.end_reason, 'score');
assert.equal(settled.winner_id, mA);
assert.equal(settled.opp_score, 2);
const done = await waitFor(logB, (e) => e.kind === 'game' && e.p.new.status === 'finished');
step(`마감 + 5초 확정: A ${settled.my_score} : B ${settled.opp_score} → A 승 · 결과가 B 에게 실시간 도착 (${done.at - t0}ms)`);
const late = await rpc(B, 'ten_vs_save', { p_game_id: gameId, p_drags: tens, p_final: true });
assert.equal(late.applied, false);
const { data: bAfter } = await B.from('game_ten_board').select('member_id, score').eq('game_id', gameId);
assert.equal(bAfter.length, 2);
step('끝난 뒤 늦은 기록 거부 · 두 사람 기록 공개');

await sleep(1000);
assert.equal(gameX.length, 0, `X 가 판 이벤트를 받음: ${gameX.length}`);
step('다른 가계부 사람은 판 변화를 실시간으로도 받지 못함');
console.log(`ℹ 이번 흐름에서 받은 실시간 메시지: A ${counts.A}건 · B ${counts.B}건 (판 상태 · 점수 1 · 이모지 1)`);

await Promise.all([A, B, X].map((c) => c.removeAllChannels()));
console.log('✅ ten_vs flow passed');
process.exit(0);
