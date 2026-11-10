import {
  Clock,
  Flag,
  LoaderCircle,
  Receipt,
  RotateCcw,
  Send,
  Shuffle,
  Smile,
  SmilePlus,
  Ticket,
  Trophy,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { PLAY_PATH } from '../../app/routes';
import { Dialog } from '../../components/Dialog';
import { GameAvatar } from '../../components/GameAvatar';
import { BetBox, RespondButtons } from '../../components/PlayInvite';
import { PlayInviteSheet } from '../../components/PlayInviteSheet';
import { StackBoard, StackPiece } from '../../components/StackBoard';
import { StatusScreen } from '../../components/StatusScreen';
import {
  GameError,
  getGame,
  getServerNow,
  listFinishedGames,
  listStackBoards,
  listStackGarbage,
  stackVsClaimDisconnect,
  stackVsEnd,
  stackVsSave,
  stackVsSend,
  subscribeStackVsRoom,
  sweepGames,
  type GameResult,
  type StackVsPreview,
  type StackVsRoom,
} from '../../data/game';
import { vibrate } from '../../data/gamePrefs';
import type { Game, GameStatus, StackGarbage } from '../../data/types';
import { clockOffset, effectiveStatus, headToHead, isPlayer, myOpenGame, opponentOf } from '../../domain/omok';
import { COLS, ROWS, act, dropPosition, step, type StackAction, type StackState } from '../../domain/stack';
import {
  EMOJIS,
  EMOJI_COOLDOWN_MS,
  EMOJI_PICKER_MS,
  EMOJI_SHOW_MS,
  PREVIEW_MS,
  SAVE_MS,
  awayRemainingSeconds,
  betWinnerText,
  decodePreview,
  emojiAllowed,
  emojiAnnounce,
  encodePreview,
  formatElapsed,
  fromSnapshot,
  garbageLines,
  isCloseCall,
  isDanger,
  newBatches,
  newVsGame,
  pendingLines,
  receivedMessage,
  seededRng,
  sentMessage,
  toSnapshot,
  vsLevel,
  vsLevelMessage,
  vsResultCopy,
  type SeededRng,
  type VsProgress,
  type VsResultIcon,
} from '../../domain/stackVs';
import { GameTopbar, NoAccess, WaitingRoom } from './OmokPage';
import { BoardGestures, CLEAR_MS, Controls, reducedMotion } from './StackPage';

/**
 * 반반 쌓기 대전 한 판 (BANB-55, design.md 5.36~5.39): 대기실 → 3·2·1 → 대전 → 결과.
 * 각자 판의 낙하는 화면에서(domain/stack), 서버는 조각 순서 값·방해 줄 장수·빈칸·끝 판정 순서·끊김 30초를 맡는다.
 * 판은 2초마다 서버에 저장해, 앱을 껐다 켜도 마지막 저장본으로 이어진다(앱이 살아 있으면 메모리의 판 그대로).
 */

/** "둘 다 왔어요!" 뒤 판으로 넘어가기까지 */
const BOTH_IN_MS = 1500;
/** 받은 사람이 수락한 뒤 보낸 사람을 기다리는 최대 시간 */
const WAIT_INVITER_MS = 10_000;
/** 상대가 화면에서 빠진 뒤 "연결이 끊겼어요"로 멈추기까지 (Presence 깜빡임 방지) */
const AWAY_GRACE_MS = 2000;
/** 상대 저장이 이만큼 없으면(서버 시각) Presence 와 상관없이 멈춘다 */
const STALE_MS = 8000;
/** 끊김 확정이 "아직"으로 거부되면(기기·서버 시계 차이) 다시 묻는 간격·횟수 */
const CLAIM_RETRY_MS = 1000;
const CLAIM_RETRIES = 5;
const PILL_MS = 1500;
const SENT_PILL_MS = 1200;

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; game: Game };

/** 앱이 살아 있는 동안 판을 기억 (대전 화면을 나갔다 와도 메모리의 판으로 이어서) */
const memory = new Map<string, { state: StackState; progress: VsProgress; rng: number }>();

/** 칸 크기: floor(min((폭 − 80) / 8, (높이 − 270) / 14)), 24~36 (design.md 5.37) */
export function vsCellSize(width: number, height: number): number {
  const s = Math.floor(Math.min((Math.min(width, 480) - 80) / COLS, (height - 270) / ROWS));
  return Math.max(24, Math.min(36, s));
}

function useVsCellSize(): number {
  const [s, setS] = useState(() => vsCellSize(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const on = () => setS(vsCellSize(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

/**
 * 한 판의 서버 상태 + 실시간 (방해 줄 · 판 상태 · Presence · 미리보기 · 이모지).
 * 방해 줄·이모지·다시 맞추기는 판 화면이 듣는다(listener ref) — 대기실에서는 아무도 듣지 않는다
 */
function useVsRoom(gameId: string, me: string | null) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [present, setPresent] = useState<string[] | null>(null);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [channelDown, setChannelDown] = useState(false);
  const [offset, setOffset] = useState(0);
  const [oppPreview, setOppPreview] = useState<StackVsPreview | null>(null);
  const roomRef = useRef<StackVsRoom | null>(null);
  const onGarbage = useRef<((row: StackGarbage) => void) | null>(null);
  const onEmoji = useRef<((index: number) => void) | null>(null);
  const onResync = useRef<(() => void) | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    const sent = Date.now();
    getServerNow().then(
      (server) => setOffset(clockOffset(server, sent, Date.now())),
      () => undefined,
    );
    getGame(gameId).then(
      (game) => mine === seq.current && setState(game ? { status: 'ready', game } : { status: 'missing' }),
      () => mine === seq.current && setState((s) => (s.status === 'ready' ? s : { status: 'error' })),
    );
  }, [gameId]);

  useEffect(() => {
    load();
    const onOffline = () => setOffline(true);
    const onOnline = () => {
      setOffline(false);
      load();
      onResync.current?.();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (me) {
      try {
        roomRef.current = subscribeStackVsRoom(gameId, me, {
          onGarbage: (row) => onGarbage.current?.(row),
          onGame: (game) => setState((s) => (s.status === 'ready' ? { ...s, game: { ...s.game, ...game } } : s)),
          onPresence: setPresent,
          onPreview: (member, p) => member !== me && setOppPreview(p),
          onEmoji: (member, index) => member !== me && onEmoji.current?.(index),
          onResync: () => {
            load();
            onResync.current?.();
          },
          onConnected: (up) => setChannelDown(!up),
        });
      } catch {
        // 실시간을 열지 못해도 판은 보인다 (다시 열면 맞춰진다)
      }
    }
    return () => {
      roomRef.current?.stop();
      roomRef.current = null;
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [gameId, me, load]);

  /** 내가 보낸 요청의 결과를 실시간 도착 전에 반영 */
  const apply = useCallback((r: GameResult) => {
    setState((s) =>
      s.status === 'ready' && s.game.status === 'active'
        ? { ...s, game: { ...s.game, status: r.status, winner_id: r.winner_id, end_reason: r.end_reason, finished_at: r.finished_at ?? s.game.finished_at } }
        : s,
    );
  }, []);

  return { state, present, connected: !offline && !channelDown, offset, oppPreview, load, apply, roomRef, onGarbage, onEmoji, onResync };
}

type RoomApi = ReturnType<typeof useVsRoom>;

export function StackVsPage() {
  const { gameId = '' } = useParams();
  const { me, ready, failed, refresh } = useGames();
  const room = useVsRoom(gameId, me);
  const { state } = room;

  if (state.status === 'missing') return <NoAccess />;
  if (state.status === 'error' || (failed && !ready))
    return <StatusScreen kind="error" message="판을 불러오지 못했어요" onRetry={() => (room.load(), refresh())} />;
  if (state.status === 'loading' || !ready) return <StatusScreen kind="loading" message="판을 불러오고 있어요" />;
  if (!me || !isPlayer(state.game, me) || state.game.kind !== 'stack_vs') return <NoAccess />;
  return <VsRoom key={state.game.id} game={state.game} me={me} room={room} />;
}

function VsRoom({ game, me, room }: { game: Game; me: string; room: RoomApi }) {
  const location = useLocation();
  const { members, upsert } = useGames();
  const now = useNow(1000);
  const status = effectiveStatus(game, now);
  const opp = opponentOf(game, me);
  const oppPresent = room.present?.includes(opp) ?? null;

  // 대기실 → 판: 보낸 사람은 invited → active 를 보면, 받은 사람은 수락하고 들어와 보낸 사람이 보이면 "둘 다 왔어요!" 1.5초
  const justAccepted = (location.state as { justAccepted?: boolean } | null)?.justAccepted === true;
  const [phase, setPhase] = useState<'both' | 'wait-inviter' | null>(() =>
    justAccepted && status === 'active' && !memory.has(game.id) ? 'wait-inviter' : null,
  );
  const prevStatus = useRef<GameStatus>(game.status);
  useEffect(() => {
    if (prevStatus.current === 'invited' && game.status === 'active') setPhase('both');
    prevStatus.current = game.status;
  }, [game.status]);
  useEffect(() => {
    if (phase === 'wait-inviter') {
      if (oppPresent) {
        setPhase('both');
        return;
      }
      const t = setTimeout(() => setPhase(null), WAIT_INVITER_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'both') {
      const t = setTimeout(() => setPhase(null), BOTH_IN_MS);
      return () => clearTimeout(t);
    }
  }, [phase, oppPresent]);

  // 판 상태가 바뀌면 진행 중 목록(홈 카드·배너)에도 반영
  useEffect(() => {
    upsert(game);
  }, [game, upsert]);

  // 지난 초대(10분)는 서버에서 닫는다 → 두 사람 화면에 실시간 반영
  const ledgerId = useLedgerId();
  const swept = useRef<string | null>(null);
  useEffect(() => {
    if (status !== game.status && swept.current !== `${game.id}:${status}`) {
      swept.current = `${game.id}:${status}`;
      sweepGames(ledgerId).then(room.load, () => undefined);
    }
  }, [status, game.status, game.id, ledgerId, room.load]);

  if (phase || status === 'invited' || status === 'declined' || status === 'canceled' || status === 'expired') {
    return <WaitingRoom game={game} me={me} status={status} phase={phase} now={now} members={members} oppPresent={oppPresent} load={room.load} />;
  }
  return <VsBoard game={game} me={me} room={room} />;
}

/* ───────────────────────── 대전 화면 (5.37) ───────────────────────── */

type Mode = 'loading' | 'countdown' | 'playing' | 'wait-opp' | 'away-me' | 'over' | 'error';
type Pill = { text: string; kind: 'sent' | 'received' | 'info'; key: number };

function VsBoard({ game, me, room }: { game: Game; me: string; room: RoomApi }) {
  const navigate = useNavigate();
  const location = useLocation();
  const nameOf = useMemberName();
  const { members } = useGames();
  const size = useVsCellSize();
  const opp = opponentOf(game, me);
  const oppName = nameOf(opp);
  const live = game.status === 'active';
  const liveRef = useRef(live);
  liveRef.current = live;

  const sRef = useRef<StackState | null>(null);
  const rngRef = useRef<SeededRng | null>(null);
  const pRef = useRef<VsProgress>({ elapsedMs: 0, sent: 0, sendSeq: 0, received: 0 });
  const [view, setView] = useState<StackState | null>(null);
  const [mode, setModeState] = useState<Mode>('loading');
  const modeRef = useRef<Mode>('loading');
  const setMode = useCallback((m: Mode) => {
    modeRef.current = m;
    setModeState(m);
  }, []);
  const [count, setCount] = useState(3);
  const [fresh, setFresh] = useState(false); // 새 판 첫 3·2·1 ("같은 조각이 같은 순서로 나와요")
  const [seconds, setSeconds] = useState(0);
  const [pill, setPill] = useState<Pill | null>(null);
  const [announce, setAnnounce] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [rising, setRising] = useState(0);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [oppSeen, setOppSeen] = useState<{ seenMs: number | null; serverMs: number } | null>(null);
  const [waitStart, setWaitStart] = useState<number | null>(null);
  const [closeCall, setCloseCall] = useState(false);
  const [endError, setEndError] = useState(false);
  const mountedAt = useRef(Date.now());
  const serverNow = useCallback(() => Date.now() + room.offset, [room.offset]);

  // ── 판 바꾸기 + 일어난 일 알리기
  const sendQueue = useRef<number[]>([]);
  const sending = useRef(false);
  const ending = useRef(false);

  const showPill = useCallback((text: string, kind: Pill['kind']) => setPill({ text, kind, key: Date.now() + Math.random() }), []);
  useEffect(() => {
    if (!pill) return;
    const t = setTimeout(() => setPill(null), pill.kind === 'sent' ? SENT_PILL_MS : PILL_MS);
    return () => clearTimeout(t);
  }, [pill]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const remember = useCallback(() => {
    const s = sRef.current;
    if (s && rngRef.current && live) memory.set(game.id, { state: s, progress: { ...pRef.current }, rng: rngRef.current.state() });
  }, [game.id, live]);

  /** 방해 줄 보내기 (순서대로 1개씩, 네트워크 오류면 1초 뒤 다시) */
  const flushSends = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (sendQueue.current.length > 0) {
        const cleared = sendQueue.current[0];
        try {
          const r = await stackVsSend(game.id, pRef.current.sendSeq + 1, cleared);
          if (r.status !== 'active') {
            room.apply(r);
            sendQueue.current = [];
            break;
          }
          pRef.current.sendSeq = r.seq ?? pRef.current.sendSeq + 1;
          sendQueue.current.shift();
        } catch (e) {
          if (e instanceof GameError && e.code === 'STACK_BAD_SEQ') {
            // 순번이 어긋남(다른 기기·앱 재시작) → 서버 순번으로 맞추고 다시
            const rows = await listStackGarbage(game.id).catch(() => null);
            if (rows) pRef.current.sendSeq = rows.filter((r) => r.from_member === me).reduce((m, r) => Math.max(m, r.seq), 0);
            continue;
          }
          if (e instanceof GameError) {
            sendQueue.current = [];
            room.load();
            break;
          }
          await new Promise((res) => setTimeout(res, 1000));
          if (modeRef.current === 'over') break;
        }
      }
    } finally {
      sending.current = false;
    }
  }, [game.id, me, room]);

  /** 끝내기 (맨 위에 닿음 · 그만하기). 실패하면 몇 번 더 시도하고 토스트 */
  const end = useCallback(
    async (reason: 'topout' | 'quit') => {
      if (ending.current) return;
      ending.current = true;
      for (let i = 0; i < 4; i++) {
        try {
          const r = await stackVsEnd(game.id, reason);
          if (!r.applied && reason === 'topout' && r.winner_id === me) setCloseCall(true);
          room.apply(r);
          if (r.status === 'active') room.load();
          return;
        } catch (e) {
          if (e instanceof GameError) {
            room.load();
            return;
          }
          await new Promise((res) => setTimeout(res, 1000));
        }
      }
      ending.current = false;
      setEndError(true);
      setToast('결과를 저장하지 못했어요');
      room.load();
    },
    [game.id, me, room],
  );

  const apply = useCallback(
    (next: StackState) => {
      const prev = sRef.current;
      if (next === prev) return;
      sRef.current = next;
      if (
        !prev ||
        next.board !== prev.board ||
        next.active !== prev.active ||
        next.clearing?.rows !== prev.clearing?.rows ||
        next.garbage !== prev.garbage ||
        next.over !== prev.over ||
        next.level !== prev.level
      )
        setView(next);
      for (const e of next.events) {
        if (e.type === 'clear') {
          vibrate(30);
          const lines = garbageLines(e.count);
          if (lines > 0) {
            pRef.current.sent += lines;
            sendQueue.current.push(e.count);
            void flushSends();
            showPill(sentMessage(lines), 'sent');
            setAnnounce(sentMessage(lines));
          }
        } else if (e.type === 'garbage') {
          vibrate(20);
          setRising((n) => n + 1);
        }
      }
      if (next.over && modeRef.current !== 'over') {
        vibrate([30, 60, 30]);
        void end('topout');
      }
    },
    [end, flushSends, showPill],
  );

  // ── 받은 방해 줄: 받을 막대에 쌓고, 내가 다음 조각을 놓을 때 올라온다
  const receive = useCallback(
    (rows: readonly StackGarbage[]) => {
      const s = sRef.current;
      if (!s || modeRef.current === 'over' || modeRef.current === 'loading') return;
      const { batches, gap } = newBatches(rows, opp, pRef.current.received);
      if (batches.length > 0) {
        pRef.current.received += batches.length;
        sRef.current = { ...s, garbage: [...s.garbage, ...batches.map((b) => ({ lines: b.lines, hole: b.hole }))] };
        setView(sRef.current);
        const lines = batches.reduce((n, b) => n + b.lines, 0);
        showPill(receivedMessage(oppName, lines), 'received');
        setAnnounce(receivedMessage(oppName, lines));
      }
      if (gap) listStackGarbage(game.id).then(receive, () => undefined);
    },
    [game.id, opp, oppName, showPill],
  );

  // ── 처음: 메모리의 판 → 서버 저장본 → 새 판(순서 값). 그다음 서버의 방해 줄로 맞춘다
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = memory.get(game.id);
        let base: { state: StackState; progress: VsProgress; rng: SeededRng } | null = null;
        if (cached) {
          // 메모리 판 + 그때의 난수열 상태로 이어서
          base = { state: cached.state, progress: { ...cached.progress }, rng: seededRng(cached.rng) };
        } else {
          const boards = await listStackBoards(game.id);
          const mine = boards.find((b) => b.member_id === me);
          const restored = mine?.state ? fromSnapshot(mine.state) : null;
          if (restored) base = restored;
          else {
            const fresh = newVsGame(game.seed ?? 0);
            base = { state: fresh.state, progress: { elapsedMs: 0, sent: 0, sendSeq: 0, received: 0 }, rng: fresh.rng };
          }
        }
        const rows = await listStackGarbage(game.id);
        if (!alive || !base) return;
        // 내가 보낸 것은 서버가 정본 (앱이 꺼져 못 보낸 것은 버린다)
        const mineSent = rows.filter((r) => r.from_member === me);
        base.progress.sendSeq = mineSent.reduce((m, r) => Math.max(m, r.seq), 0);
        base.progress.sent = mineSent.reduce((n, r) => n + r.lines, 0);
        const { batches } = newBatches(rows, opp, base.progress.received);
        base.state = { ...base.state, garbage: [...base.state.garbage, ...batches.map((b) => ({ lines: b.lines, hole: b.hole }))], events: [] };
        base.progress.received += batches.length;
        sRef.current = base.state;
        rngRef.current = base.rng;
        pRef.current = base.progress;
        setView(base.state);
        setSeconds(Math.floor(base.progress.elapsedMs / 1000));
        if (liveRef.current && !base.state.over) {
          setFresh(base.progress.elapsedMs === 0 && base.state.lines === 0);
          setCount(3);
          setMode('countdown');
        } else {
          setMode('over');
          if (base.state.over && liveRef.current) void end('topout');
        }
      } catch {
        if (alive) setMode('error');
      }
    })();
    return () => {
      alive = false;
    };
    // 판마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  // 실시간 연결
  useEffect(() => {
    room.onGarbage.current = (row) => receive([row]);
    room.onResync.current = () => listStackGarbage(game.id).then(receive, () => undefined);
    return () => {
      room.onGarbage.current = null;
      room.onResync.current = null;
    };
  }, [room, receive, game.id]);

  // ── 판이 끝나면 (서버: 상대 닿음·그만하기·끊김 / 내 결과) 멈추고 결과
  useEffect(() => {
    if (!live && modeRef.current !== 'loading') {
      setMode('over');
      memory.delete(game.id);
    }
    if (!live) memory.delete(game.id);
  }, [live, game.id, setMode]);

  // ── 3초 세기
  useEffect(() => {
    if (mode !== 'countdown') return;
    if (count <= 0) {
      setFresh(false);
      setMode('playing');
      return;
    }
    const t = setTimeout(() => setCount((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [mode, count, setMode]);
  const startCountdown = useCallback(() => {
    setCount(3);
    setMode('countdown');
  }, [setMode]);

  // ── 떨어지기 (requestAnimationFrame). 시간 속도: 3분부터 30초마다 +1
  useEffect(() => {
    if (mode !== 'playing') return;
    let raf = 0;
    let last = performance.now();
    const opt = { clearMs: reducedMotion() ? 0 : CLEAR_MS, timeLevel: true };
    const loop = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      const s = sRef.current;
      const rng = rngRef.current;
      if (s && rng && !s.over) {
        const p = pRef.current;
        p.elapsedMs += dt;
        const sec = Math.floor(p.elapsedMs / 1000);
        setSeconds((cur) => (cur === sec ? cur : sec));
        const level = vsLevel(p.elapsedMs);
        let cur = s;
        if (level !== s.level) {
          cur = { ...s, level };
          showPill(vsLevelMessage(level), 'info');
        }
        apply(step(cur, dt, { ...opt, rng }));
      }
      if (modeRef.current === 'playing' && !sRef.current?.over) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, apply, showPill]);

  const control = useCallback(
    (action: StackAction) => {
      const s = sRef.current;
      const rng = rngRef.current;
      if (modeRef.current !== 'playing' || !s || !rng) return;
      apply(act(s, action, { rng, clearMs: reducedMotion() ? 0 : CLEAR_MS, timeLevel: true }));
    },
    [apply],
  );

  // ── 저장 (2초마다 · 처음 바로). 기다리는 동안은 "보임" 시각만
  const save = useCallback(
    (full: boolean) => {
      const s = sRef.current;
      const rng = rngRef.current;
      if (!s || !rng || !live) return Promise.resolve();
      remember();
      const snap = full ? toSnapshot(s, pRef.current, rng.state()) : null;
      return stackVsSave(game.id, snap, s.lines).then(
        (r) => {
          if (r.server_now) setOppSeen({ seenMs: r.opp_seen_at ? Date.parse(r.opp_seen_at) : null, serverMs: Date.parse(r.server_now) });
          if (r.status !== 'active') room.apply(r);
        },
        (e) => {
          if (e instanceof GameError) room.load();
        },
      );
    },
    [game.id, live, remember, room],
  );
  useEffect(() => {
    if (!live || mode === 'loading' || mode === 'over' || mode === 'error' || mode === 'away-me') return;
    void save(mode !== 'wait-opp');
    const t = setInterval(() => void save(modeRef.current !== 'wait-opp'), SAVE_MS);
    return () => clearInterval(t);
  }, [live, mode, save]);

  // ── 미리보기 (0.5초마다, 바뀌었을 때만)
  const lastPreview = useRef('');
  useEffect(() => {
    if (!live || mode === 'loading' || mode === 'over' || mode === 'error') return;
    const t = setInterval(() => {
      const s = sRef.current;
      if (!s || !room.roomRef.current) return;
      const msg = { cells: encodePreview(s), lines: s.lines, sent: pRef.current.sent, danger: isDanger(s.board) };
      const key = JSON.stringify(msg);
      if (key === lastPreview.current) return;
      lastPreview.current = key;
      room.roomRef.current.sendPreview(msg);
    }, PREVIEW_MS);
    return () => clearInterval(t);
  }, [live, mode, room.roomRef]);
  // 상대가 다시 들어오면 내 미리보기를 한 번 더 보낸다
  const oppPresent = room.present?.includes(opp) ?? null;
  useEffect(() => {
    if (oppPresent) lastPreview.current = '';
  }, [oppPresent]);

  // ── 상대 자리 비움: Presence 에서 2초 넘게 빠짐 · 또는 서버 저장이 8초 넘게 없음(서버 시각)
  // (Presence 타이머는 Presence 값만 보고 돈다 — 2초마다 오는 저장 응답이 타이머를 다시 시작하지 않게)
  const [presenceAway, setPresenceAway] = useState(false);
  useEffect(() => {
    if (oppPresent === null) return;
    if (oppPresent) {
      setPresenceAway(false);
      return;
    }
    const t = setTimeout(() => setPresenceAway(true), AWAY_GRACE_MS);
    return () => clearTimeout(t);
  }, [oppPresent]);
  const staleAway =
    !!oppSeen && oppSeen.seenMs !== null && Date.now() - mountedAt.current >= STALE_MS && oppSeen.serverMs - oppSeen.seenMs > STALE_MS;
  const oppAway = presenceAway || staleAway;

  // 상대가 빠지면 내 판도 멈춤 → 돌아오면 두 폰 모두 3·2·1
  useEffect(() => {
    if (!live) return;
    if (oppAway && (mode === 'playing' || mode === 'countdown')) {
      setWaitStart(serverNow());
      setMode('wait-opp');
    } else if (!oppAway && mode === 'wait-opp') {
      setToast(`${oppName}님이 돌아왔어요`);
      setWaitStart(null);
      startCountdown();
    }
  }, [oppAway, mode, live, oppName, serverNow, setMode, startCountdown]);

  // 30초가 지나면 서버에 끊김 확정 (서버가 30초를 다시 확인)
  const now = useNow(mode === 'wait-opp' ? 250 : 1000);
  const awayLeft =
    mode === 'wait-opp' && waitStart !== null
      ? awayRemainingSeconds(oppSeen?.seenMs ?? null, waitStart, now.getTime() + room.offset)
      : null;
  const claiming = useRef(false);
  useEffect(() => {
    if (awayLeft !== 0 || claiming.current) return;
    claiming.current = true;
    (async () => {
      for (let i = 0; i < CLAIM_RETRIES; i++) {
        try {
          const r = await stackVsClaimDisconnect(game.id);
          room.apply(r);
          break;
        } catch (e) {
          if (!(e instanceof GameError && e.code === 'GAME_NOT_TIMED_OUT')) break;
          await new Promise((res) => setTimeout(res, CLAIM_RETRY_MS));
        }
      }
      claiming.current = false;
      void save(false);
    })();
  }, [awayLeft, game.id, room, save]);

  // ── 내가 앱을 내림 → 멈추고 Presence 에서 빠짐(상대 30초 세기), 바로 저장. 돌아오면 저장 → 3·2·1
  useEffect(() => {
    const onVisible = () => {
      if (!live) return;
      if (document.visibilityState === 'hidden') {
        if (modeRef.current === 'playing' || modeRef.current === 'countdown' || modeRef.current === 'wait-opp') {
          room.roomRef.current?.setHere(false);
          void save(true);
          remember();
          setMode('away-me');
        }
      } else if (modeRef.current === 'away-me') {
        room.roomRef.current?.setHere(true);
        room.load();
        void save(true).then(() => {
          if (modeRef.current !== 'away-me') return;
          startCountdown();
        });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onVisible);
    };
  }, [live, room, save, remember, setMode, startCountdown]);

  // ── 내 연결 끊김 (네트워크): 멈추고 다시 연결되면 3·2·1
  const offline = !room.connected && live;
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
      if (modeRef.current === 'playing' || modeRef.current === 'countdown') setMode('away-me');
    } else if (wasOffline.current) {
      wasOffline.current = false;
      if (modeRef.current === 'away-me' && document.visibilityState !== 'hidden') startCountdown();
    }
  }, [offline, setMode, startCountdown]);

  // ── 이모지 반응
  const [picker, setPicker] = useState(false);
  const [lastEmojiSent, setLastEmojiSent] = useState<number | null>(null);
  const [bubble, setBubble] = useState<{ index: number; key: number } | null>(null);
  const lastEmojiIn = useRef<number | null>(null);
  useEffect(() => {
    room.onEmoji.current = (index) => {
      const t = Date.now();
      if (!emojiAllowed(lastEmojiIn.current, t) || !EMOJIS[index]) return;
      lastEmojiIn.current = t;
      setBubble({ index, key: t });
      setAnnounce(emojiAnnounce(oppName, index));
    };
    return () => {
      room.onEmoji.current = null;
    };
  }, [room, oppName]);
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), EMOJI_SHOW_MS);
    return () => clearTimeout(t);
  }, [bubble]);
  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(() => setPicker(false), EMOJI_PICKER_MS);
    return () => clearTimeout(t);
  }, [picker]);
  const cooling = lastEmojiSent !== null && now.getTime() - lastEmojiSent < EMOJI_COOLDOWN_MS;
  function sendEmoji(index: number) {
    const t = Date.now();
    setPicker(false);
    if (!emojiAllowed(lastEmojiSent, t)) return;
    room.roomRef.current?.sendEmoji(index);
    setLastEmojiSent(t);
    setToast(`${EMOJIS[index].emoji} 보냈어요`);
  }

  // ── 뒤로(‹ · 기기 뒤로) = 그만하기 확인 창. 판은 계속 떨어진다
  const guarded = (location.state as { vsGuard?: boolean } | null)?.vsGuard === true;
  const guardedOnce = useRef(false);
  useEffect(() => {
    if (!live) return;
    if (guarded) {
      guardedOnce.current = true;
      return;
    }
    if (guardedOnce.current) setConfirmQuit(true);
    navigate(location.pathname, { state: { vsGuard: true } });
  }, [guarded, live, navigate, location.pathname]);
  function leave() {
    navigate(PLAY_PATH, { replace: true });
  }

  // ── 키보드: ←→ 이동, ↑ 돌리기, ↓ 빨리, Space 바로 내리기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (modeRef.current !== 'playing' || confirmQuit) return;
      const map: Record<string, StackAction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'rotate', ArrowDown: 'soft', ' ': 'hard' };
      if (map[e.key]) {
        e.preventDefault();
        control(map[e.key]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [control, confirmQuit]);

  if (mode === 'error') return <StatusScreen kind="error" message="판을 불러오지 못했어요" onRetry={() => window.location.reload()} />;
  if (mode === 'loading' || !view) return <StatusScreen kind="loading" message="판을 준비하고 있어요" />;

  const playing = mode === 'playing';
  const over = mode === 'over' || !live;
  const ghost = view.active ? dropPosition(view.board, view.active) : null;
  const pending = pendingLines(view.garbage);
  const oppAwayShown = mode === 'wait-opp';

  const header = (
    <GameTopbar
      title="반반 쌓기 대전"
      right={
        over ? undefined : (
          <div className="omok-topbar-actions">
            <button
              type="button"
              className={`icon-button vs-react${cooling ? ' is-cooling' : ''}`}
              aria-label={cooling ? '반응 보내기 (잠시 뒤에 다시)' : '반응 보내기'}
              aria-disabled={cooling}
              aria-expanded={picker}
              onClick={() => !cooling && setPicker((p) => !p)}
            >
              <SmilePlus size={22} aria-hidden="true" />
            </button>
            <button type="button" className="button button--text omok-resign" onClick={() => setConfirmQuit(true)}>
              <Flag size={18} aria-hidden="true" /> 그만하기
            </button>
          </div>
        )
      }
    />
  );

  return (
    <div className="shell stack-shell vs-shell">
      {header}
      {picker && !over && (
        <div className="vs-emoji-picker" role="group" aria-label="반응 고르기">
          {EMOJIS.map((e, i) => (
            <button key={e.label} type="button" className="vs-emoji" aria-label={e.label} onClick={() => sendEmoji(i)}>
              {e.emoji}
            </button>
          ))}
        </div>
      )}
      <main className="stack vs" style={{ ['--stack-cell' as string]: `${size}px` }}>
        <div className="vs-info">
          <OpponentCard
            memberId={opp}
            name={oppName}
            members={members}
            preview={room.oppPreview}
            away={oppAwayShown}
            bubble={bubble ? EMOJIS[bubble.index]?.emoji : null}
            bubbleKey={bubble?.key}
          />
          <div className="vs-mine">
            <span className="vs-mine__label">지운 줄</span>
            <b className="vs-mine__lines">{view.lines}</b>
            <span className="vs-mine__meta">
              보낸 영수증 <b>{pRef.current.sent}</b>
            </span>
            <span className="vs-mine__meta">
              {formatElapsed(seconds * 1000)} · 속도 <b>{view.level}</b>
            </span>
          </div>
          <div className="stack-next vs-next" aria-label="다음 조각">
            <StackPiece kind={view.next} size={11} />
            <span aria-hidden="true">다음</span>
          </div>
        </div>

        <div className="vs-board-row">
          <ReceiptBar count={pending} />
          <div className={`stack-board-wrap vs-board-wrap${rising ? ' is-rising' : ''}`} key={`r${rising}`}>
            <BoardGestures size={size} onAction={control} enabled={playing}>
              <StackBoard
                board={view.board}
                active={view.active}
                ghost={ghost}
                clearing={view.clearing?.rows ?? null}
                size={size}
                dim={mode === 'wait-opp' || mode === 'away-me'}
                label={`내 판, 지운 줄 ${view.lines}, 받을 영수증 ${pending}장`}
              />
            </BoardGestures>
            {pill && (
              <span key={pill.key} className={`vs-pill vs-pill--${pill.kind}`} aria-hidden="true">
                {pill.kind === 'sent' ? <Send size={16} /> : pill.kind === 'received' ? <Receipt size={16} /> : null}
                {pill.text}
              </span>
            )}
            {mode === 'countdown' && (
              <>
                {fresh && (
                  <span className="vs-pill vs-pill--received vs-pill--top" aria-hidden="true">
                    <Shuffle size={16} /> 같은 조각이 같은 순서로 나와요
                  </span>
                )}
                <span className="stack-count" aria-live="assertive">
                  {Math.max(count, 1)}
                </span>
              </>
            )}
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </main>

      <Controls onAction={control} disabled={!playing} />

      {(mode === 'wait-opp' || mode === 'away-me') && !over && (
        <AwayCard mine={mode === 'away-me'} offline={offline} oppName={oppName} myName={nameOf(me)} seconds={awayLeft} />
      )}

      {toast && (
        <p className="toast toast--no-tabbar play-toast" role="status">
          {mode === 'playing' && toast.endsWith('돌아왔어요') ? <Wifi size={16} aria-hidden="true" /> : null}
          {toast}
        </p>
      )}

      {confirmQuit && !over && (
        <Dialog
          title="그만할까요?"
          onCancel={() => setConfirmQuit(false)}
          actions={
            <>
              <button type="button" className="button button--secondary" onClick={() => setConfirmQuit(false)}>
                계속할게요
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  setConfirmQuit(false);
                  void end('quit');
                }}
              >
                그만하기
              </button>
            </>
          }
        >
          <p>지금 그만하면 이번 판은 {oppName}님이 이겨요. 전적에도 남아요.</p>
        </Dialog>
      )}

      {over && game.status !== 'active' && (
        <VsResultSheet game={game} me={me} lines={view.lines} sent={pRef.current.sent} closeCall={closeCall} onLeave={leave} />
      )}
      {over && game.status === 'active' && endError && (
        <p className="play-error vs-end-error" role="alert">
          결과를 저장하지 못했어요.{' '}
          <button type="button" className="button button--text" onClick={() => void end('topout')}>
            다시 시도
          </button>
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── 상대 칸 · 받을 막대 · 끊김 카드 ───────────────────────── */

function MiniBoard({ cells }: { cells: string | null }) {
  const s = 6;
  const grid = useMemo(() => (cells ? decodePreview(cells) : null), [cells]);
  return (
    <svg className="vs-mini" width={COLS * s} height={ROWS * s} viewBox={`0 0 ${COLS * s} ${ROWS * s}`} aria-hidden="true">
      {grid?.flatMap((row, y) =>
        row.map((c, x) => (c ? <rect key={`${x},${y}`} className={`vs-mini__${c}`} x={x * s + 0.5} y={y * s + 0.5} width={s - 1} height={s - 1} rx={1} /> : null)),
      )}
    </svg>
  );
}

function OpponentCard({
  memberId,
  name,
  members,
  preview,
  away,
  bubble,
  bubbleKey,
}: {
  memberId: string;
  name: string;
  members: Parameters<typeof GameAvatar>[0]['members'];
  preview: StackVsPreview | null;
  away: boolean;
  bubble: string | null;
  bubbleKey?: number;
}) {
  return (
    <div className={`vs-opp${preview?.danger ? ' is-danger' : ''}${away ? ' is-away' : ''}`}>
      <div className="vs-opp__mini">
        <MiniBoard cells={preview?.cells ?? null} />
        {away && <WifiOff size={16} className="vs-opp__off" aria-hidden="true" />}
      </div>
      <div className="vs-opp__body">
        <span className="vs-opp__name">
          <GameAvatar memberId={memberId} members={members} size={24} />
          <span>{name}</span>
        </span>
        {away ? (
          <span className="vs-opp__stat">연결 끊김</span>
        ) : (
          <>
            <span className="vs-opp__stat">
              지운 줄 <b>{preview?.lines ?? 0}</b>
            </span>
            <span className="vs-opp__stat">
              보낸 영수증 <b>{preview?.sent ?? 0}</b>
            </span>
          </>
        )}
      </div>
      {bubble && (
        <span key={bubbleKey} className="vs-bubble" aria-hidden="true">
          {bubble}
        </span>
      )}
    </div>
  );
}

function ReceiptBar({ count }: { count: number }) {
  return (
    <div className="vs-receipts" aria-hidden="true">
      <Receipt size={16} className="vs-receipts__icon" />
      {count > 0 && (
        <div className="vs-receipts__stack">
          <b className="vs-receipts__count">{count}</b>
          {Array.from({ length: Math.min(count, 10) }, (_, i) => (
            <svg key={i} width={20} height={26} viewBox="0 0 20 26" className="vs-receipts__paper">
              <path d="M2 1h16v20l-2 2.5-2-2.5-2 2.5-2-2.5-2 2.5-2-2.5-2 2.5-2-2.5z" strokeWidth={1.5} strokeLinejoin="round" />
              <line x1={5} y1={8} x2={15} y2={8} strokeWidth={1.5} />
              <line x1={5} y1={13} x2={12} y2={13} strokeWidth={1.5} />
            </svg>
          ))}
        </div>
      )}
    </div>
  );
}

function AwayCard({ mine, offline, oppName, myName, seconds }: { mine: boolean; offline: boolean; oppName: string; myName: string; seconds: number | null }) {
  if (mine && !offline) return null; // 앱을 내렸다 돌아온 경우는 카드 없이 3·2·1
  const sec = seconds ?? 30;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <div className="vs-away-backdrop">
      <div className="vs-away" role="alert">
        {mine ? (
          <LoaderCircle size={48} className="play-room__spinner" aria-hidden="true" />
        ) : (
          <div className="vs-away__ring" aria-hidden="true">
            <svg width={96} height={96} viewBox="0 0 96 96">
              <circle cx={48} cy={48} r={r} className="vs-away__track" strokeWidth={8} />
              <circle
                cx={48}
                cy={48}
                r={r}
                className="vs-away__arc"
                strokeWidth={8}
                strokeDasharray={c}
                strokeDashoffset={c * (1 - sec / 30)}
                transform="rotate(-90 48 48)"
              />
            </svg>
            <b>{sec}</b>
          </div>
        )}
        <h2 className="vs-away__title">{mine ? '연결이 끊겼어요' : `${oppName}님 연결이 잠깐 끊겼어요`}</h2>
        <p className="vs-away__desc">
          {mine ? '다시 연결하는 중이에요. 30초 안에 연결되면 이어서 해요.' : '30초 안에 돌아오면 이어서 해요. 기다리는 동안 내 판도 멈춰 있어요.'}
        </p>
        {!mine && <p className="vs-away__note">못 돌아오면 {myName}님이 이겨요</p>}
      </div>
    </div>
  );
}

/* ───────────────────────── 결과 (5.39) ───────────────────────── */

const RESULT_ICON: Record<VsResultIcon, ReactNode> = {
  trophy: <Trophy size={32} aria-hidden="true" />,
  smile: <Smile size={32} aria-hidden="true" />,
  flag: <Flag size={32} aria-hidden="true" />,
  'wifi-off': <WifiOff size={32} aria-hidden="true" />,
  clock: <Clock size={32} aria-hidden="true" />,
};

function VsResultSheet({
  game,
  me,
  lines,
  sent,
  closeCall,
  onLeave,
}: {
  game: Game;
  me: string;
  lines: number;
  sent: number;
  closeCall: boolean;
  onLeave: () => void;
}) {
  const ledgerId = useLedgerId();
  const nameOf = useMemberName();
  const { open, members } = useGames();
  const now = useNow(1000);
  const [finished, setFinished] = useState<Game[] | null>(null);
  const [close, setClose] = useState(closeCall);
  const [again, setAgain] = useState(false);
  const opp = opponentOf(game, me);
  const oppName = nameOf(opp);
  const panel = useRef<HTMLDivElement>(null);
  const copy = vsResultCopy(game, me, nameOf, close);
  const betText = betWinnerText(game, me, nameOf);

  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    let alive = true;
    listFinishedGames(ledgerId).then(
      (games) => alive && setFinished(games.some((g) => g.id === game.id) || game.status !== 'finished' ? games : [game, ...games]),
      () => undefined,
    );
    if (game.end_reason === 'topout')
      listStackBoards(game.id).then(
        (rows) => alive && isCloseCall(rows.map((r) => r.topped_out_at)) && setClose(true),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [ledgerId, game]);

  // 상대가 먼저 "한 판 더"를 눌렀으면 그 초대를 보여 준다
  const incoming = myOpenGame(open, me, now);
  const rematchIn = incoming?.kind === 'invited-me' && incoming.game.created_by === opp && incoming.game.kind === 'stack_vs' ? incoming.game : null;
  const record = finished ? headToHead(finished, me, opp, 'stack_vs') : null;

  return (
    <div className="play-sheet-backdrop">
      <div className="play-sheet" role="dialog" aria-modal="true" aria-labelledby="vs-result-title" tabIndex={-1} ref={panel}>
        <span className="play-sheet__handle" aria-hidden="true" />
        {rematchIn ? (
          <>
            <span className="play-sheet__icon" aria-hidden="true">
              <RotateCcw size={32} />
            </span>
            <h2 id="vs-result-title" className="play-sheet__title">
              {oppName}님이 한 판 더 하재요
            </h2>
            <BetBox bet={rematchIn.bet} />
            <RespondButtons game={rematchIn} />
          </>
        ) : (
          <>
            <span className={`play-sheet__icon${copy.win ? ' is-win' : ''}`} aria-hidden="true">
              {RESULT_ICON[copy.icon]}
            </span>
            <h2 id="vs-result-title" className="play-sheet__title">
              {copy.title}
            </h2>
            <p className="play-sheet__line">{copy.line}</p>
            {game.bet && betText && (
              <div className="vs-bet-result">
                <span className="vs-bet-result__bet">
                  <Ticket size={16} aria-hidden="true" /> {game.bet}
                </span>
                <b className="vs-bet-result__who">{betText}</b>
              </div>
            )}
            <div className="vs-stats">
              <span className="vs-stats__cell">
                <span>지운 줄</span>
                <b>{lines}</b>
              </span>
              <span className="vs-stats__cell">
                <span>보낸 영수증</span>
                <b>{sent}</b>
              </span>
            </div>
            {copy.counted && record && (
              <p className="play-sheet__record">
                <GameAvatar memberId={opp} members={members} size={24} />
                {oppName}님과 대전{' '}
                <b>
                  {record.win}승 {record.loss}패
                </b>
              </p>
            )}
            <div className="play-actions">
              <button type="button" className="button button--secondary" onClick={onLeave}>
                나가기
              </button>
              <button type="button" className="button button--primary" onClick={() => setAgain(true)}>
                <RotateCcw size={18} aria-hidden="true" /> 한 판 더
              </button>
            </div>
          </>
        )}
      </div>
      {again && !rematchIn && (
        <PlayInviteSheet kind="stack_vs" finished={finished} rematchOf={game} initialBet={game.bet} onClose={() => setAgain(false)} />
      )}
    </div>
  );
}
