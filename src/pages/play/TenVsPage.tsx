import { ChevronLeft, Flag, Handshake, LoaderCircle, RotateCcw, Shuffle, Smile, SmilePlus, Ticket, Trophy, WifiOff, Clock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { PLAY_PATH } from '../../app/routes';
import { Dialog } from '../../components/Dialog';
import { GameAvatar } from '../../components/GameAvatar';
import { BetBox, RespondButtons } from '../../components/PlayInvite';
import { PlayInviteSheet } from '../../components/PlayInviteSheet';
import { StatusScreen } from '../../components/StatusScreen';
import { TenBoard, type Popping } from '../../components/TenBoard';
import {
  GameError,
  getGame,
  getServerNow,
  listFinishedGames,
  listTenBoards,
  subscribeTenVsRoom,
  sweepGames,
  tenVsQuit,
  tenVsSave,
  tenVsSettle,
  type GameResult,
  type TenVsRoom,
} from '../../data/game';
import { vibrate } from '../../data/gamePrefs';
import type { Game, GameStatus } from '../../data/types';
import { clockOffset, effectiveStatus, headToHead, isPlayer, myOpenGame, opponentOf } from '../../domain/omok';
import { EMOJIS, EMOJI_COOLDOWN_MS, EMOJI_PICKER_MS, EMOJI_SHOW_MS, emojiAllowed, emojiAnnounce } from '../../domain/stackVs';
import {
  DURATION_MS,
  LAST_SECONDS,
  LAST_SECONDS_MESSAGE,
  SCORE_MS,
  VS_GRACE_MS,
  isLandscape,
  parseDrags,
  points,
  replay,
  spokenClock,
  tenCellSize,
  tenVsResult,
  vsTimes,
  type Rect,
  type TenVsIcon,
} from '../../domain/ten';
import { NoAccess, WaitingRoom } from './OmokPage';
import { reducedMotion } from './StackPage';
import { POP_MS, RotateScreen, TimeBar, TimeText, dropOn, tryLockLandscape, unlockOrientation, useViewport, type Play } from './TenPage';

/**
 * 도토리 열 알 대전 한 판 (BANB-57, design.md 5.44): 대기실 → (같은 판) 3·2·1 → 120초 → 점수 맞춰 보기 → 결과.
 * 시작·마감은 서버 시각(수락 때 정한 turn_deadline)이라 두 사람이 같다. 판은 각자 독립이라 끊겨도 멈추지 않는다.
 * 터질 때마다 드래그 기록을 서버에 보내고(서버가 다시 셈), 마감 뒤 마지막 기록을 보낸다. 결과는 서버 점수만 보여 준다.
 */

/** "둘 다 왔어요!" 뒤 판으로 넘어가기까지 */
const BOTH_IN_MS = 1500;
/** 상대가 화면에서 빠진 뒤 "연결이 끊겼어요"로 보기까지 (Presence 깜빡임 방지) */
const AWAY_GRACE_MS = 2000;
/** 결과 확정이 "아직"으로 거부되면(기기·서버 시계 차이) 다시 묻는 간격·횟수 */
const SETTLE_RETRY_MS = 1000;
const SETTLE_RETRIES = 6;
const PILL_MS = 1200;

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; game: Game };

/** 앱이 살아 있는 동안 판을 기억 (대전 화면을 나갔다 와도 메모리의 기록으로 이어서) */
const memory = new Map<string, Play>();

/** 한 판의 서버 상태 + 실시간 (판 상태 · Presence · 상대 점수 · 이모지) */
function useTenRoom(gameId: string, me: string | null) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [present, setPresent] = useState<string[] | null>(null);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [channelDown, setChannelDown] = useState(false);
  const [offset, setOffset] = useState(0);
  const [oppScore, setOppScore] = useState<number | null>(null);
  const roomRef = useRef<TenVsRoom | null>(null);
  const onEmoji = useRef<((index: number) => void) | null>(null);
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
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (me) {
      try {
        roomRef.current = subscribeTenVsRoom(gameId, me, {
          onGame: (game) => setState((s) => (s.status === 'ready' ? { ...s, game: { ...s.game, ...game } } : s)),
          onPresence: setPresent,
          onScore: (member, score) => member !== me && setOppScore(score),
          onEmoji: (member, index) => member !== me && onEmoji.current?.(index),
          onResync: load,
          onConnected: (up) => setChannelDown(!up),
        });
      } catch {
        // 실시간을 열지 못해도 판은 보인다
      }
    }
    // 앱을 다시 열면 서버 값(판 상태·시계)으로 맞춘다
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      roomRef.current?.stop();
      roomRef.current = null;
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [gameId, me, load]);

  /** 내가 보낸 요청의 결과를 실시간 도착 전에 반영 */
  const apply = useCallback((r: GameResult) => {
    setState((s) =>
      s.status === 'ready' && s.game.status === 'active' && r.status !== 'active'
        ? { ...s, game: { ...s.game, status: r.status, winner_id: r.winner_id, end_reason: r.end_reason, finished_at: r.finished_at ?? s.game.finished_at } }
        : s,
    );
  }, []);

  return { state, present, connected: !offline && !channelDown, offset, oppScore, load, apply, roomRef, onEmoji };
}

type RoomApi = ReturnType<typeof useTenRoom>;

export function TenVsPage() {
  const { gameId = '' } = useParams();
  const { me, ready, failed, refresh } = useGames();
  const room = useTenRoom(gameId, me);
  const { state } = room;

  if (state.status === 'missing') return <NoAccess />;
  if (state.status === 'error' || (failed && !ready))
    return <StatusScreen kind="error" message="판을 불러오지 못했어요" onRetry={() => (room.load(), refresh())} />;
  if (state.status === 'loading' || !ready) return <StatusScreen kind="loading" message="판을 불러오고 있어요" />;
  if (!me || !isPlayer(state.game, me) || state.game.kind !== 'ten_vs') return <NoAccess />;
  return <VsRoom key={state.game.id} game={state.game} me={me} room={room} />;
}

function VsRoom({ game, me, room }: { game: Game; me: string; room: RoomApi }) {
  const location = useLocation();
  const { members, upsert } = useGames();
  const now = useNow(1000);
  const status = effectiveStatus(game, now);
  const opp = opponentOf(game, me);
  const oppPresent = room.present?.includes(opp) ?? null;

  // 대기실 → 판: 보낸 사람은 invited → active 를 보면, 받은 사람은 수락하고 들어오면 "둘 다 왔어요!" 1.5초
  // (시작은 서버 시각이라 상대를 기다리지 않는다 — 늦게 들어오면 남은 시간만큼)
  const justAccepted = (location.state as { justAccepted?: boolean } | null)?.justAccepted === true;
  const [phase, setPhase] = useState<'both' | null>(() => (justAccepted && status === 'active' && !memory.has(game.id) ? 'both' : null));
  const prevStatus = useRef<GameStatus>(game.status);
  useEffect(() => {
    if (prevStatus.current === 'invited' && game.status === 'active') setPhase('both');
    prevStatus.current = game.status;
  }, [game.status]);
  useEffect(() => {
    if (phase !== 'both') return;
    const t = setTimeout(() => setPhase(null), BOTH_IN_MS);
    return () => clearTimeout(t);
  }, [phase]);

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

/* ───────────────────────── 대전 화면 (5.44) ───────────────────────── */

type Mode = 'loading' | 'countdown' | 'playing' | 'ending' | 'over' | 'error';

function VsBoard({ game, me, room }: { game: Game; me: string; room: RoomApi }) {
  const navigate = useNavigate();
  const location = useLocation();
  const nameOf = useMemberName();
  const { members } = useGames();
  const { width, height } = useViewport();
  const landscape = isLandscape(width, height);
  const size = tenCellSize(width, height);
  const opp = opponentOf(game, me);
  const oppName = nameOf(opp);
  const live = game.status === 'active';
  const times = vsTimes(game);
  const now = useNow(200);
  const serverNow = now.getTime() + room.offset;

  const [play, setPlay] = useState<Play | null>(null);
  const playRef = useRef<Play | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [popping, setPopping] = useState<Popping | null>(null);
  const [pill, setPill] = useState<{ text: string; key: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [serverMine, setServerMine] = useState<number | null>(null);
  const lastWarned = useRef(false);

  // ── 처음: 메모리의 기록 → 서버에 저장된 내 기록 → 새 판(같은 순서 값)
  useEffect(() => {
    tryLockLandscape();
    let alive = true;
    const seed = game.seed ?? 0;
    const cached = memory.get(game.id);
    if (cached) {
      playRef.current = cached;
      setPlay(cached);
      return;
    }
    listTenBoards(game.id).then(
      (rows) => {
        if (!alive) return;
        const drags = parseDrags(rows.find((r) => r.member_id === me)?.drags);
        const r = replay(seed, drags);
        const p: Play = { board: r.board, score: r.score, drags };
        playRef.current = p;
        setPlay(p);
      },
      () => alive && setLoadFailed(true),
    );
    return () => {
      alive = false;
      unlockOrientation();
    };
    // 판마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  // ── 시간 → 모드 (서버 시각 기준)
  let mode: Mode;
  if (loadFailed) mode = 'error';
  else if (!play || !times) mode = live ? 'loading' : 'over';
  else if (!live) mode = 'over';
  else if (serverNow < times.startMs) mode = 'countdown';
  else if (serverNow < times.endMs) mode = 'playing';
  else mode = 'ending';
  const remaining = times ? Math.max(0, Math.min(DURATION_MS, times.endMs - serverNow)) : DURATION_MS;
  const countLeft = times ? Math.ceil((times.startMs - serverNow) / 1000) : 3;

  // ── 알림 자동 숨김
  useEffect(() => {
    if (!pill) return;
    const t = setTimeout(() => setPill(null), PILL_MS);
    return () => clearTimeout(t);
  }, [pill]);
  useEffect(() => {
    if (!popping) return;
    const t = setTimeout(() => setPopping(null), reducedMotion() ? 600 : POP_MS + 100);
    return () => clearTimeout(t);
  }, [popping]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── 남은 10초 알림 (1번)
  useEffect(() => {
    if (mode === 'playing' && remaining <= LAST_SECONDS * 1000 && !lastWarned.current) {
      lastWarned.current = true;
      setPill({ text: LAST_SECONDS_MESSAGE, key: Date.now() });
      setAnnounce(LAST_SECONDS_MESSAGE);
    }
  }, [mode, remaining]);

  // ── 기록 보내기: 바뀌면 순서대로 1개씩(항상 처음부터 전부 — 서버가 다시 셈). 네트워크 오류면 1초 뒤 다시
  const dirty = useRef(false);
  const sending = useRef(false);
  const finalSent = useRef(false);
  const flush = useCallback(
    async (final: boolean) => {
      if (sending.current) {
        if (final) dirty.current = true;
        return;
      }
      sending.current = true;
      try {
        for (let tries = 0; tries < 30; tries++) {
          const p = playRef.current;
          if (!p) break;
          const isFinal = final || finalSent.current;
          dirty.current = false;
          try {
            const r = await tenVsSave(game.id, p.drags, isFinal);
            if (typeof r.my_score === 'number') setServerMine(r.my_score);
            if (r.status !== 'active') room.apply(r);
            if (!dirty.current) break;
          } catch (e) {
            if (e instanceof GameError) {
              room.load();
              break;
            }
            await new Promise((res) => setTimeout(res, 1000));
          }
        }
      } finally {
        sending.current = false;
      }
    },
    [game.id, room],
  );

  function drop(rect: Rect) {
    const p = playRef.current;
    if (!p || mode !== 'playing') return;
    const r = dropOn(p, rect);
    if (!r) return;
    playRef.current = r.next;
    memory.set(game.id, r.next);
    setPlay(r.next);
    setPopping(r.popping);
    if (r.message) setPill({ text: r.message, key: Date.now() });
    setAnnounce(`${r.message ?? ''} +${points(r.popping.cells.length)}, 점수 ${points(r.next.score)}`.trim());
    vibrate(20);
    dirty.current = true;
    void flush(false);
  }

  // ── 마감: 마지막 기록 1번 → 두 사람 다 오면 서버가 바로 결과. 아니면 마감 + 5초에 확정 요청
  useEffect(() => {
    if (mode !== 'ending' || finalSent.current) return;
    finalSent.current = true;
    vibrate(30);
    void flush(true);
  }, [mode, flush]);
  const settling = useRef(false);
  const settleDue = mode === 'ending' && times !== null && serverNow >= times.endMs + VS_GRACE_MS + 300;
  useEffect(() => {
    if (!settleDue || settling.current) return;
    settling.current = true;
    (async () => {
      for (let i = 0; i < SETTLE_RETRIES; i++) {
        try {
          room.apply(await tenVsSettle(game.id));
          break;
        } catch (e) {
          if (!(e instanceof GameError && e.code === 'GAME_NOT_TIMED_OUT') && e instanceof GameError) {
            room.load();
            break;
          }
          await new Promise((res) => setTimeout(res, SETTLE_RETRY_MS));
        }
      }
      settling.current = false;
      room.load();
    })();
  }, [settleDue, game.id, room]);

  // ── 끝나면 기억 지우기
  useEffect(() => {
    if (!live) memory.delete(game.id);
  }, [live, game.id]);

  // ── 내 점수 (0.5초마다, 바뀌었을 때만) · 상대가 다시 들어오면 한 번 더
  const oppPresent = room.present?.includes(opp) ?? null;
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    if (oppPresent) lastSent.current = null;
  }, [oppPresent]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      const s = playRef.current?.score;
      if (s === undefined || s === lastSent.current || !room.roomRef.current) return;
      lastSent.current = s;
      room.roomRef.current.sendScore(s);
    }, SCORE_MS);
    return () => clearInterval(t);
  }, [live, room.roomRef]);

  // ── 상대 끊김: Presence 에서 2초 넘게 빠짐 → 알약 흐림 + 토스트 1번 (판은 멈추지 않음)
  const [oppAway, setOppAway] = useState(false);
  useEffect(() => {
    if (oppPresent === null) return;
    if (oppPresent) {
      setOppAway(false);
      return;
    }
    const t = setTimeout(() => setOppAway(true), AWAY_GRACE_MS);
    return () => clearTimeout(t);
  }, [oppPresent]);
  const wasAway = useRef(false);
  useEffect(() => {
    if (!live) return;
    if (oppAway && !wasAway.current) setToast(`${oppName}님 연결이 끊겼어요. 판은 그대로 이어져요`);
    else if (!oppAway && wasAway.current) setToast(`${oppName}님이 돌아왔어요`);
    wasAway.current = oppAway;
  }, [oppAway, live, oppName]);

  // ── 내 연결이 돌아오면 남은 기록을 보낸다
  const offline = !room.connected && live;
  useEffect(() => {
    if (!offline && dirty.current) void flush(finalSent.current);
  }, [offline, flush]);

  // ── 이모지 반응 (5.37 그대로)
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

  // ── 그만하기 (확인 창이 떠도 시간은 흐른다)
  const quitting = useRef(false);
  async function quit() {
    setConfirmQuit(false);
    if (quitting.current) return;
    quitting.current = true;
    try {
      room.apply(await tenVsQuit(game.id));
    } catch {
      setToast('결과를 저장하지 못했어요');
      room.load();
    } finally {
      quitting.current = false;
    }
  }

  // ── 뒤로(‹ · 기기 뒤로) = 그만하기 확인 창
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
    unlockOrientation();
    navigate(PLAY_PATH, { replace: true });
  }

  if (mode === 'error') return <StatusScreen kind="error" message="판을 불러오지 못했어요" onRetry={() => window.location.reload()} />;
  if (mode === 'loading' || !play) return <StatusScreen kind="loading" message="판을 준비하고 있어요" />;

  const over = mode === 'over';
  const myScore = play.score;
  const shownRemaining = mode === 'countdown' ? DURATION_MS : remaining;

  return (
    <div className="ten-shell" style={{ ['--ten-cell' as string]: `${size}px` }}>
      <header className="ten-top">
        <button type="button" className="icon-button" aria-label={over ? '나가기' : '그만하기 (확인)'} onClick={() => (over ? leave() : setConfirmQuit(true))}>
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <span className="ten-score">
          <span className="ten-score__label">점수</span>
          <b className={`ten-score__num${popping ? ' is-bump' : ''}`} key={myScore}>
            {myScore}
          </b>
          <span className="ten-score__unit">점</span>
        </span>
        <span className={`ten-opp${oppAway ? ' is-away' : ''}`}>
          <GameAvatar memberId={opp} members={members} size={24} />
          <span className="ten-opp__name">{oppName}</span>
          <b className="ten-opp__score">{room.oppScore ?? 0}</b>
          {oppAway && <WifiOff size={14} aria-label="연결 끊김" />}
          {bubble && (
            <span key={bubble.key} className="ten-bubble" aria-hidden="true">
              {EMOJIS[bubble.index]?.emoji}
            </span>
          )}
        </span>
        {!over && (
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
        )}
        <span className="ten-top__space" />
        {!over && (
          <button type="button" className="button button--text omok-resign" onClick={() => setConfirmQuit(true)}>
            <Flag size={18} aria-hidden="true" /> 그만하기
          </button>
        )}
        <TimeText remainingMs={shownRemaining} />
      </header>
      {picker && !over && (
        <div className="vs-emoji-picker ten-emoji-picker" role="group" aria-label="반응 고르기">
          {EMOJIS.map((e, i) => (
            <button key={e.label} type="button" className="vs-emoji" aria-label={e.label} onClick={() => sendEmoji(i)}>
              {e.emoji}
            </button>
          ))}
        </div>
      )}

      <main className="ten-main">
        <div className="ten-board-wrap">
          <TenBoard
            board={play.board}
            size={size}
            enabled={mode === 'playing'}
            dim={mode === 'countdown' || mode === 'ending' || over}
            popping={popping}
            label={`내 판, 점수 ${points(myScore)}, 남은 시간 ${spokenClock(shownRemaining)}, ${oppName}님 ${points(room.oppScore ?? 0)}`}
            onDrop={drop}
          />
          {pill && (
            <span key={pill.key} className="vs-pill vs-pill--info ten-pill" aria-hidden="true">
              {pill.text}
            </span>
          )}
          {offline && mode !== 'over' && (
            <span className="vs-pill vs-pill--received ten-pill ten-pill--offline" role="status">
              <WifiOff size={16} aria-hidden="true" /> 연결이 끊겼어요. 다시 연결되면 점수를 보낼게요
            </span>
          )}
          {mode === 'countdown' && (
            <>
              <span className="vs-pill vs-pill--received ten-pill ten-pill--start" aria-hidden="true">
                <Shuffle size={16} /> 같은 판으로 동시에 시작해요
              </span>
              <span className="ten-count" aria-live="assertive">
                <b>{Math.max(1, Math.min(3, countLeft))}</b>
              </span>
            </>
          )}
          {mode === 'ending' && (
            <div className="ten-wait" role="status">
              <div className="ten-wait__card">
                <LoaderCircle size={32} className="play-room__spinner" aria-hidden="true" />
                <b>점수를 맞춰 보는 중이에요</b>
                <span>{oppName}님 기록이 오면 바로 알려 드릴게요</span>
              </div>
            </div>
          )}
        </div>
        <TimeBar remainingMs={shownRemaining} />
      </main>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {mode === 'playing' && !landscape && <RotateScreen playing remainingMs={remaining} score={myScore} />}
      {mode === 'countdown' && !landscape && <RotateScreen playing={false} />}

      {toast && (
        <p className="toast toast--no-tabbar play-toast" role="status">
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
              <button type="button" className="button button--danger" onClick={() => void quit()}>
                그만하기
              </button>
            </>
          }
        >
          <p>지금 그만하면 이번 판은 {oppName}님이 이겨요. 전적에도 남아요.</p>
        </Dialog>
      )}

      {over && <VsResultCard game={game} me={me} fallbackMine={serverMine ?? myScore} onLeave={leave} />}
    </div>
  );
}

/* ───────────────────────── 결과 (가운데 카드, 5.44) ───────────────────────── */

const RESULT_ICON: Record<TenVsIcon, ReactNode> = {
  trophy: <Trophy size={28} aria-hidden="true" />,
  smile: <Smile size={28} aria-hidden="true" />,
  handshake: <Handshake size={28} aria-hidden="true" />,
  flag: <Flag size={28} aria-hidden="true" />,
  clock: <Clock size={28} aria-hidden="true" />,
};

function VsResultCard({ game, me, fallbackMine, onLeave }: { game: Game; me: string; fallbackMine: number; onLeave: () => void }) {
  const ledgerId = useLedgerId();
  const nameOf = useMemberName();
  const { open, members } = useGames();
  const now = useNow(1000);
  const [finished, setFinished] = useState<Game[] | null>(null);
  const [scores, setScores] = useState<{ mine: number; opp: number } | null>(null);
  const [again, setAgain] = useState(false);
  const opp = opponentOf(game, me);
  const oppName = nameOf(opp);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    let alive = true;
    listFinishedGames(ledgerId).then(
      (games) => alive && setFinished(games.some((g) => g.id === game.id) || game.status !== 'finished' ? games : [game, ...games]),
      () => undefined,
    );
    // 서버가 센 점수만 보여 준다 (화면 점수와 달라도 설명 없이 서버 값)
    listTenBoards(game.id).then(
      (rows) =>
        alive &&
        setScores({
          mine: rows.find((r) => r.member_id === me)?.score ?? 0,
          opp: rows.find((r) => r.member_id === opp)?.score ?? 0,
        }),
      () => alive && setScores({ mine: fallbackMine, opp: 0 }),
    );
    return () => {
      alive = false;
    };
    // 끝난 판마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerId, game.id, game.status, me, opp]);

  const copy = tenVsResult(game, me, nameOf, game.end_reason === 'quit' ? null : scores);
  // 상대가 먼저 "한 판 더"를 눌렀으면 그 초대를 보여 준다
  const incoming = myOpenGame(open, me, now);
  const rematchIn = incoming?.kind === 'invited-me' && incoming.game.created_by === opp && incoming.game.kind === 'ten_vs' ? incoming.game : null;
  const record = finished ? headToHead(finished, me, opp, 'ten_vs') : null;
  const showScores = game.end_reason === 'score' || game.end_reason === 'draw';

  return (
    <div className="ten-card-backdrop">
      <div className="ten-card ten-card--vs" role="dialog" aria-modal="true" aria-labelledby="ten-vs-title" tabIndex={-1} ref={panel}>
        {rematchIn ? (
          <div className="ten-card__col">
            <span className="ten-card__icon" aria-hidden="true">
              <RotateCcw size={28} />
            </span>
            <h2 id="ten-vs-title" className="ten-card__title">
              {oppName}님이 한 판 더 하재요
            </h2>
            <BetBox bet={rematchIn.bet} />
            <RespondButtons game={rematchIn} />
          </div>
        ) : (
          <>
            <div className="ten-card__col">
              <div className="ten-card__head">
                <span className={`ten-card__icon${copy.win ? ' is-win' : ''}`} aria-hidden="true">
                  {RESULT_ICON[copy.icon]}
                </span>
                <span className="ten-card__text">
                  <h2 id="ten-vs-title" className="ten-card__title">
                    {copy.title}
                  </h2>
                  {copy.line && <span className="ten-card__line">{copy.line}</span>}
                </span>
              </div>
              {showScores && (
                <div className="ten-scores">
                  {scores ? (
                    <>
                      <span className={`ten-scores__cell${scores.mine > scores.opp ? ' is-win' : ''}`}>
                        <span>나</span>
                        <b>{points(scores.mine)}</b>
                      </span>
                      <span className={`ten-scores__cell${scores.opp > scores.mine ? ' is-win' : ''}`}>
                        <span>{oppName}님</span>
                        <b>{points(scores.opp)}</b>
                      </span>
                    </>
                  ) : (
                    <span className="ten-scores__loading">점수를 불러오고 있어요</span>
                  )}
                </div>
              )}
            </div>
            <div className="ten-card__col">
              {game.bet && copy.bet && copy.counted && (
                <div className="vs-bet-result">
                  <span className="vs-bet-result__bet">
                    <Ticket size={16} aria-hidden="true" /> {game.bet}
                  </span>
                  <b className="vs-bet-result__who">{copy.bet}</b>
                </div>
              )}
              {copy.counted && record && (
                <p className="play-sheet__record">
                  <GameAvatar memberId={opp} members={members} size={24} />
                  {oppName}님과{' '}
                  <b>
                    {record.win}승 {record.loss}패{record.draw > 0 ? ` ${record.draw}무` : ''}
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
            </div>
          </>
        )}
      </div>
      {again && !rematchIn && <PlayInviteSheet kind="ten_vs" finished={finished} rematchOf={game} initialBet={game.bet} onClose={() => setAgain(false)} />}
    </div>
  );
}
