import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Coins,
  Flag,
  MoveHorizontal,
  Pause,
  PiggyBank,
  Play,
  RotateCcw,
  RotateCw,
  Smartphone,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGames } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { PLAY_PATH } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { GameAvatar } from '../../components/GameAvatar';
import { Icon } from '../../components/Icon';
import { StackBoard, StackIllustration, StackPiece } from '../../components/StackBoard';
import { StatusScreen } from '../../components/StatusScreen';
import { listStackBests, recordStackScore } from '../../data/game';
import { vibrate } from '../../data/gamePrefs';
import type { Member, StackBest } from '../../data/types';
import { formatWon } from '../../domain/format';
import {
  COLS,
  REPEAT_MS,
  ROWS,
  act,
  clearMessage,
  dropPosition,
  endView,
  levelMessage,
  myBest,
  newGame,
  step,
  topOtherBest,
  type EndIcon,
  type StackAction,
  type StackState,
} from '../../domain/stack';

/**
 * 반반 쌓기 1인 모드 (BANB-52, design.md 5.34·5.35): 시작 → 3초 세기 → 플레이 → (일시정지) → 끝 시트.
 * 판 상태는 서버에 저장하지 않는다. 끝날 때 1번 가계부 × 멤버 최고 기록만 보낸다(더 높을 때만 바뀜).
 */
type Phase = 'intro' | 'countdown' | 'playing' | 'paused' | 'over';
type PauseReason = 'user' | 'away';

interface Finished {
  amount: number;
  lines: number;
  level: number;
  quit: boolean;
  /** 이번 판 전 내 최고 기록 (서버 응답이 오면 그 값으로 맞춘다) */
  prevBest: number | null;
  save: 'skip' | 'saving' | 'saved' | 'error';
}

/** 줄 지우는 연출 (빛남 0.2초 + 떠오르며 사라짐). 줄인 움직임이면 0 */
const CLEAR_MS = 450;
const CHEER_MS = 1200;

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 칸 크기: floor(min((폭 − 48) / 8, (높이 − 256) / 14)), 24~36 (design.md 5.34) */
export function cellSize(width: number, height: number): number {
  const s = Math.floor(Math.min((Math.min(width, 480) - 48) / COLS, (height - 256) / ROWS));
  return Math.max(24, Math.min(36, s));
}

function useCellSize(): number {
  const [s, setS] = useState(() => cellSize(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const on = () => setS(cellSize(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

export function StackPage() {
  const ledgerId = useLedgerId();
  const navigate = useNavigate();
  const location = useLocation();
  const { me, members, ready, failed, refresh } = useGames();
  const bests = useLoad(() => listStackBests(ledgerId), [ledgerId]);
  const size = useCellSize();

  const [phase, setPhase] = useState<Phase>('intro');
  const [pauseReason, setPauseReason] = useState<PauseReason>('user');
  const [count, setCount] = useState(3);
  const [game, setGame] = useState<StackState | null>(null);
  const [cheer, setCheer] = useState<{ text: string; key: number; plus?: { amount: number; row: number } } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const gameRef = useRef<StackState | null>(null);
  const phaseRef = useRef<Phase>('intro');
  phaseRef.current = phase;

  const bestList: StackBest[] | null = bests.state.status === 'ready' ? bests.state.data : null;
  const mine = me && bestList ? myBest(bestList, me) : null;
  const other = me && bestList ? topOtherBest(bestList, me, members) : null;

  // ── 뒤로 막기: 판을 하는 동안 기록 하나를 더 넣어 두고, 기기 뒤로가 그걸 빼면 일시정지한다
  const guarded = (location.state as { stackGuard?: boolean } | null)?.stackGuard === true;
  const guard = useCallback(() => {
    if (!guarded) navigate(location.pathname, { state: { stackGuard: true } });
  }, [guarded, navigate, location.pathname]);

  const pause = useCallback((reason: PauseReason) => {
    if (phaseRef.current !== 'playing' && phaseRef.current !== 'countdown') return;
    setPauseReason(reason);
    setPhase('paused');
  }, []);

  useEffect(() => {
    if (!guarded) pause('user');
  }, [guarded, pause]);

  // ── 앱을 나가면 자동 일시정지 (백그라운드·화면 꺼짐·전화)
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') pause('away');
    };
    const onPageHide = () => pause('away');
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [pause]);

  // ── 알림 알약·토스트 자동 숨김
  useEffect(() => {
    if (!cheer) return;
    const t = setTimeout(() => setCheer(null), CHEER_MS);
    return () => clearTimeout(t);
  }, [cheer]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── 끝: 기록 저장 (판마다 1번)
  const finish = useCallback(
    (s: StackState, quit: boolean) => {
      const prevBest = mine;
      const view = endView(s.score, prevBest, quit, null);
      const f: Finished = { amount: s.score, lines: s.lines, level: s.level, quit, prevBest, save: view.save ? 'saving' : 'skip' };
      setFinished(f);
      setPhase('over');
      vibrate([30, 60, 30]);
      if (!view.save) return;
      recordStackScore(ledgerId, s.score, s.lines).then(
        (r) => {
          setFinished((cur) => (cur === f ? { ...f, prevBest: r.previous_best, save: 'saved' } : cur));
          if (me && bestList) {
            const rest = bestList.filter((b) => b.member_id !== me);
            const old = bestList.find((b) => b.member_id === me);
            bests.setData([...rest, { member_id: me, best_amount: r.best_amount, best_lines: r.is_new ? s.lines : (old?.best_lines ?? s.lines) }]);
          } else {
            bests.reload();
          }
        },
        () => {
          setFinished((cur) => (cur === f ? { ...f, save: 'error' } : cur));
          setToast('기록을 저장하지 못했어요');
        },
      );
    },
    [mine, ledgerId, me, bestList, bests],
  );

  // ── 상태 바꾸기 + 일어난 일(줄 저금·속도·끝) 알리기
  // 떨어지기 루프가 화면이 다시 그려질 때마다 다시 시작되지 않게, 끝 처리·알림은 ref 로 최신 것을 부른다
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const apply = useCallback((next: StackState) => {
    const prev = gameRef.current;
    if (next === prev) return;
    gameRef.current = next;
    if (
      !prev ||
      next.board !== prev.board ||
      next.active !== prev.active ||
      next.clearing?.rows !== prev.clearing?.rows ||
      next.over !== prev.over
    )
      setGame(next);
    for (const e of next.events) {
      if (e.type === 'clear') {
        const text = clearMessage(e.count);
        setCheer({ text, key: Date.now(), plus: { amount: e.amount, row: e.rows[0] } });
        setAnnounce(`${text} ${formatWon(e.amount)}`);
        vibrate(30);
      } else if (e.type === 'level') {
        // 줄 저금 알약이 먼저 보이고, 이어서 속도 알림
        const text = levelMessage(e.level);
        setTimeout(() => setCheer({ text, key: Date.now() }), CHEER_MS);
        setAnnounce((a) => `${a} ${text}`);
      }
    }
    if (next.over) finishRef.current(next, false);
  }, []);

  const options = useCallback(() => ({ rng: Math.random, clearMs: reducedMotion() ? 0 : CLEAR_MS }), []);

  const control = useCallback(
    (action: StackAction) => {
      if (phaseRef.current !== 'playing' || !gameRef.current) return;
      apply(act(gameRef.current, action, options()));
    },
    [apply, options],
  );

  // ── 떨어지기 (requestAnimationFrame). 한 번에 너무 많이 흐르지 않게 100ms 로 자른다
  useEffect(() => {
    if (phase !== 'playing') return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      const s = gameRef.current;
      if (s && !s.over) apply(step(s, dt, options()));
      if (phaseRef.current === 'playing' && !gameRef.current?.over) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, apply, options]);

  // ── 3초 세기
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) {
      setPhase('playing');
      return;
    }
    const t = setTimeout(() => setCount((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count]);

  function startCountdown() {
    setCount(3);
    setPhase('countdown');
  }

  function start() {
    guard();
    const s = newGame(Math.random);
    gameRef.current = s;
    setGame(s);
    setFinished(null);
    setCheer(null);
    setAnnounce('');
    startCountdown();
  }

  function resume() {
    guard();
    startCountdown();
  }

  function quit() {
    if (gameRef.current) finish(gameRef.current, true);
  }

  function toIntro() {
    if (guarded) navigate(-1);
    setPhase('intro');
    setGame(null);
    gameRef.current = null;
    setFinished(null);
  }

  function leave() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    const steps = guarded ? 2 : 1;
    if (idx >= steps) navigate(-steps);
    else navigate(PLAY_PATH, { replace: true });
  }

  function back() {
    if (phase === 'playing' || phase === 'countdown') pause('user');
    else leave();
  }

  // ── 키보드: ←→ 이동, ↑ 돌리기, ↓ 빨리, Space 바로 내리기, P/Esc 일시정지
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phaseRef.current !== 'playing') return;
      const map: Record<string, StackAction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'rotate', ArrowDown: 'soft', ' ': 'hard' };
      if (map[e.key]) {
        e.preventDefault();
        control(map[e.key]);
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        pause('user');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [control, pause]);

  if (!ready && failed) return <StatusScreen kind="error" message="미니게임을 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={refresh} />;
  if (!ready) return <StatusScreen kind="loading" message="반반 쌓기를 준비하고 있어요" />;
  if (!me) return <StatusScreen kind="error" message="이 가계부의 멤버가 아니에요" />;

  const header = (
    <header className="topbar">
      <button type="button" className="icon-button" aria-label={phase === 'playing' || phase === 'countdown' ? '뒤로 (일시정지)' : '뒤로'} onClick={back}>
        <Icon name="back" />
      </button>
      <h1 className="topbar__title">반반 쌓기</h1>
      {phase === 'playing' || phase === 'countdown' ? (
        <button type="button" className="icon-button" aria-label="일시정지" onClick={() => pause('user')}>
          <Pause size={22} aria-hidden="true" />
        </button>
      ) : (
        <span className="icon-button" aria-hidden="true" />
      )}
    </header>
  );

  if (phase === 'intro' || !game) {
    return (
      <div className="shell">
        {header}
        <main className="content content--no-tabbar stack-intro">
          <section className="play-panel stack-intro__hero">
            <div className="stack-intro__illust">
              <StackIllustration />
            </div>
            <p className="stack-intro__title">동전·지폐를 쌓아 한 줄을 채우면 저금돼요</p>
            <p className="stack-intro__sub">맨 위까지 쌓이면 끝나요. 한 줄에 1,000원!</p>
          </section>

          <section className="play-panel" aria-labelledby="stack-best-title">
            <h2 id="stack-best-title" className="play-panel__label">
              내 최고 기록
            </h2>
            {bests.state.status === 'loading' ? (
              <p className="stack-best__empty">기록을 불러오고 있어요</p>
            ) : bests.state.status === 'error' ? (
              <p className="stack-best__empty">
                기록을 불러오지 못했어요{' '}
                <button type="button" className="button button--text" onClick={bests.reload}>
                  다시 시도
                </button>
              </p>
            ) : mine !== null ? (
              <p className="stack-best__amount">{formatWon(mine)}</p>
            ) : (
              <div>
                <p className="stack-best__empty-title">아직 기록이 없어요</p>
                <p className="stack-best__empty">첫 판을 해 볼까요?</p>
              </div>
            )}
            {other && <MemberLine memberId={other.member.id} members={members} text={<>{other.member.display_name}님 최고 기록 <b>{formatWon(other.amount)}</b>이에요</>} />}
          </section>

          <section className="play-panel" aria-labelledby="stack-howto-title">
            <h2 id="stack-howto-title" className="play-panel__label">
              이렇게 해요
            </h2>
            <ul className="stack-howto">
              <li>
                <MoveHorizontal size={20} aria-hidden="true" /> 좌우로 밀거나 ‹ › 눌러 옮겨요
              </li>
              <li>
                <RotateCw size={20} aria-hidden="true" /> 판을 톡 누르면 돌아가요
              </li>
              <li>
                <ArrowDownToLine size={20} aria-hidden="true" /> 아래로 밀면 바로 내려가요
              </li>
            </ul>
          </section>
        </main>
        <div className="play-bottom">
          <button type="button" className="button button--primary play-bottom__main" onClick={start}>
            <Play size={20} aria-hidden="true" /> 시작하기
          </button>
        </div>
      </div>
    );
  }

  const ghost = game.active ? dropPosition(game.board, game.active) : null;
  const playing = phase === 'playing';

  return (
    <div className="shell stack-shell">
      {header}
      <main className="stack" style={{ ['--stack-cell' as string]: `${size}px` }}>
        <div className="stack-info">
          <div className="stack-info__money">
            <span className="stack-info__label">모은 돈</span>
            <b className="stack-info__amount">{formatWon(game.score)}</b>
          </div>
          <div className="stack-info__meta">
            <span>
              저금한 줄 <b>{game.lines}</b>
            </span>
            <span>
              속도 <b>{game.level}</b>
            </span>
          </div>
          <div className="stack-next" aria-label="다음 조각">
            <StackPiece kind={game.next} />
            <span aria-hidden="true">다음</span>
          </div>
        </div>

        <div className="stack-board-wrap">
          <BoardGestures size={size} onAction={control} enabled={playing}>
            <StackBoard
              board={game.board}
              active={game.active}
              ghost={ghost}
              clearing={game.clearing?.rows ?? null}
              size={size}
              dim={phase === 'paused'}
              label={`모은 돈 ${formatWon(game.score)}, 저금한 줄 ${game.lines}`}
            />
          </BoardGestures>
          {cheer && (
            <>
              <span key={`c${cheer.key}`} className="stack-cheer" aria-hidden="true">
                <Coins size={18} /> {cheer.text}
              </span>
              {cheer.plus && (
                <span key={`p${cheer.key}`} className="stack-plus" style={{ top: cheer.plus.row * size }} aria-hidden="true">
                  +{formatWon(cheer.plus.amount)}
                </span>
              )}
            </>
          )}
          {phase === 'countdown' && (
            <span className="stack-count" aria-live="assertive">
              {Math.max(count, 1)}
            </span>
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </main>

      <Controls onAction={control} disabled={!playing} />

      {toast && (
        <p className="toast toast--no-tabbar play-toast" role="status">
          {toast}
        </p>
      )}

      {phase === 'paused' && (
        <PauseSheet reason={pauseReason} score={game.score} lines={game.lines} onQuit={quit} onResume={resume} />
      )}
      {phase === 'over' && finished && (
        <EndSheet finished={finished} other={other} members={members} onQuit={toIntro} onAgain={start} />
      )}
    </div>
  );
}

/* ───────────────────────── 판 몸짓 ───────────────────────── */

/**
 * 판 위 몸짓 (design.md 5.34): 좌우로 밀기 = 칸 하나만큼 갈 때마다 1칸 · 톡 = 돌리기
 * · 아래로 빠르게 밀기 = 바로 내리기 · 천천히 아래로 끌기 = 끄는 동안 빨리 내림
 */
function BoardGestures({
  size,
  onAction,
  enabled,
  children,
}: {
  size: number;
  onAction: (a: StackAction) => void;
  enabled: boolean;
  children: ReactNode;
}) {
  const g = useRef<{ id: number; x0: number; y0: number; t0: number; lastX: number; lastY: number; moved: boolean } | null>(null);

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (!enabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), lastX: e.clientX, lastY: e.clientY, moved: false };
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const s = g.current;
    if (!s || s.id !== e.pointerId || !enabled) return;
    while (e.clientX - s.lastX >= size) {
      onAction('right');
      s.lastX += size;
      s.moved = true;
    }
    while (s.lastX - e.clientX >= size) {
      onAction('left');
      s.lastX -= size;
      s.moved = true;
    }
    // 아래로 끄는 동안 칸 하나만큼마다 1칸씩 (가로로 미는 중이면 무시)
    if (Math.abs(e.clientY - s.y0) > Math.abs(e.clientX - s.x0)) {
      while (e.clientY - s.lastY >= size) {
        onAction('soft');
        s.lastY += size;
        s.moved = true;
      }
    }
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    const s = g.current;
    g.current = null;
    if (!s || s.id !== e.pointerId || !enabled) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    const ms = performance.now() - s.t0;
    if (dy > size * 1.5 && dy > Math.abs(dx) * 1.5 && dy / Math.max(ms, 1) > 0.6) onAction('hard');
    else if (!s.moved && Math.hypot(dx, dy) < 10 && ms < 400) onAction('rotate');
  }

  return (
    <div className="stack-gesture" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => (g.current = null)}>
      {children}
    </div>
  );
}

/* ───────────────────────── 버튼 4개 (항상 보임) ───────────────────────── */

function Controls({ onAction, disabled }: { onAction: (a: StackAction) => void; disabled: boolean }) {
  return (
    <div className="stack-controls" role="group" aria-label="조작">
      <RepeatButton label="왼쪽으로" onAction={() => onAction('left')} disabled={disabled} repeat>
        <ChevronLeft size={24} aria-hidden="true" />
      </RepeatButton>
      <RepeatButton label="돌리기" onAction={() => onAction('rotate')} disabled={disabled} main>
        <RotateCw size={24} aria-hidden="true" />
      </RepeatButton>
      <RepeatButton label="오른쪽으로" onAction={() => onAction('right')} disabled={disabled} repeat>
        <ChevronRight size={24} aria-hidden="true" />
      </RepeatButton>
      <RepeatButton label="바로 내리기" onAction={() => onAction('hard')} disabled={disabled}>
        <ArrowDownToLine size={24} aria-hidden="true" />
      </RepeatButton>
    </div>
  );
}

/** 누르는 순간 동작(손가락을 뗄 때까지 기다리지 않음). repeat 이면 길게 누를 때 0.15초마다 반복 */
function RepeatButton({
  label,
  onAction,
  disabled,
  repeat,
  main,
  children,
}: {
  label: string;
  onAction: () => void;
  disabled: boolean;
  repeat?: boolean;
  main?: boolean;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const byPointer = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);

  function down(e: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    e.preventDefault();
    byPointer.current = true;
    onAction();
    if (!repeat) return;
    const again = () => {
      onAction();
      timer.current = setTimeout(again, REPEAT_MS);
    };
    timer.current = setTimeout(again, REPEAT_MS * 2);
  }

  return (
    <button
      type="button"
      className={`stack-control${main ? ' is-main' : ''}`}
      aria-label={label}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // 키보드(Enter·Space)로 누른 경우만 — 손가락은 이미 pointerdown 에서 처리했다
        if (byPointer.current) byPointer.current = false;
        else onAction();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/* ───────────────────────── 시트 ───────────────────────── */

function MemberLine({ memberId, members, text }: { memberId: string; members: readonly Member[]; text: ReactNode }) {
  return (
    <p className="play-sheet__record stack-member-line">
      <GameAvatar memberId={memberId} members={members} size={24} />
      <span>{text}</span>
    </p>
  );
}

function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/** 일시정지 (design.md 5.35): 시트 밖을 눌러도 닫히지 않는다 */
function PauseSheet({
  reason,
  score,
  lines,
  onQuit,
  onResume,
}: {
  reason: PauseReason;
  score: number;
  lines: number;
  onQuit: () => void;
  onResume: () => void;
}) {
  const panel = useFocusOnMount<HTMLDivElement>();
  return (
    <div className="play-sheet-backdrop">
      <div className="play-sheet" role="dialog" aria-modal="true" aria-labelledby="stack-pause-title" tabIndex={-1} ref={panel}>
        <span className="play-sheet__handle" aria-hidden="true" />
        <span className="play-sheet__icon" aria-hidden="true">
          {reason === 'away' ? <Smartphone size={32} /> : <Pause size={32} />}
        </span>
        <h2 id="stack-pause-title" className="play-sheet__title">
          {reason === 'away' ? '앱을 나가서 잠시 멈췄어요' : '잠깐 쉬는 중이에요'}
        </h2>
        <p className="play-sheet__line">
          모은 돈 <b>{formatWon(score)}</b> · 저금한 줄 <b>{lines}</b>
        </p>
        <div className="play-actions">
          <button type="button" className="button button--secondary" onClick={onQuit}>
            그만하기
          </button>
          <button type="button" className="button button--primary" onClick={onResume}>
            <Play size={18} aria-hidden="true" /> 이어서 하기
          </button>
        </div>
        <p className="play-sheet__note">이어서 하면 3초 뒤에 다시 떨어져요</p>
      </div>
    </div>
  );
}

const END_ICON: Record<EndIcon, ReactNode> = {
  piggy: <PiggyBank size={32} />,
  trophy: <Trophy size={32} />,
  flag: <Flag size={32} />,
};

/** 끝 (design.md 5.35 표) */
function EndSheet({
  finished,
  other,
  members,
  onQuit,
  onAgain,
}: {
  finished: Finished;
  other: { member: Member | { id: string; display_name: string; left_at: string | null }; amount: number } | null;
  members: readonly Member[];
  onQuit: () => void;
  onAgain: () => void;
}) {
  const panel = useFocusOnMount<HTMLDivElement>();
  const v = endView(finished.amount, finished.prevBest, finished.quit, other?.amount ?? null);
  return (
    <div className="play-sheet-backdrop">
      <div className="play-sheet" role="dialog" aria-modal="true" aria-labelledby="stack-end-title" tabIndex={-1} ref={panel}>
        <span className="play-sheet__handle" aria-hidden="true" />
        <span className={`play-sheet__icon${v.highlight ? ' is-win' : ''}`} aria-hidden="true">
          {END_ICON[v.icon]}
        </span>
        <h2 id="stack-end-title" className="play-sheet__title">
          {v.title}
        </h2>
        <p className="stack-end__amount">{formatWon(finished.amount)}</p>
        <p className="play-sheet__line">
          저금한 줄 <b>{finished.lines}</b> · 속도 <b>{finished.level}</b>
        </p>
        {other && v.compare && (
          <MemberLine
            memberId={other.member.id}
            members={members}
            text={
              v.compare === 'beat' ? (
                <>
                  {other.member.display_name}님 기록 <b>{formatWon(other.amount)}</b>을 넘었어요
                </>
              ) : (
                <>
                  {other.member.display_name}님 최고 기록 <b>{formatWon(other.amount)}</b>이에요
                </>
              )
            }
          />
        )}
        {v.zeroNote && <p className="play-sheet__note">한 줄만 채워도 1,000원이에요</p>}
        {v.showMyBest && finished.prevBest !== null && (
          <p className="play-sheet__note">
            내 최고 기록 <b>{formatWon(finished.prevBest)}</b>
          </p>
        )}
        {finished.save === 'saving' && <p className="play-sheet__note">기록을 저장하고 있어요</p>}
        <div className="play-actions">
          <button type="button" className="button button--secondary" onClick={onQuit}>
            그만하기
          </button>
          <button type="button" className="button button--primary" onClick={onAgain}>
            <RotateCcw size={18} aria-hidden="true" /> 한 판 더
          </button>
        </div>
      </div>
    </div>
  );
}
