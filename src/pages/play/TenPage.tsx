import { ChevronLeft, Equal, Info, Nut, Play, RotateCcw, RotateCw, SquareDashedMousePointer, Timer, Trophy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGames } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { PLAY_PATH } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { Dialog } from '../../components/Dialog';
import { GameAvatar } from '../../components/GameAvatar';
import { Icon } from '../../components/Icon';
import { StatusScreen } from '../../components/StatusScreen';
import { TenBoard, TenIllustration, type Popping } from '../../components/TenBoard';
import { listTenBests, recordTenScore } from '../../data/game';
import { vibrate } from '../../data/gamePrefs';
import type { Member } from '../../data/types';
import {
  DURATION_MS,
  LAST_SECONDS,
  LAST_SECONDS_MESSAGE,
  dragOf,
  formatClock,
  isLandscape,
  myTenBest,
  points,
  popMessage,
  popRect,
  randomSeed,
  soloResult,
  spokenClock,
  tenBoard,
  tenCellSize,
  topOtherTenBest,
  type Drag,
  type Rect,
  type TenBoard as Board,
} from '../../domain/ten';
import { reducedMotion } from './StackPage';

/**
 * 도토리 열 알 1인 모드 (BANB-57, design.md 5.41~5.43): 시작(세로) → (세로면 "가로로 돌려 주세요") → 3·2·1 → 120초 → 결과 카드.
 * 판은 순서 값으로 만들고, 끝날 때 순서 값 + 드래그 기록을 보내 서버가 다시 센 점수로 최고 기록을 남긴다.
 * 게임 중 세로로 돌리거나 나가기 확인 창이 떠도 시간은 흐른다.
 */

/** 터짐 연출 (0.15초 커짐 + 0.4초 작아지며 사라짐). 줄인 움직임이면 0 */
export const POP_MS = 550;
const PILL_MS = 1200;

/* ───────────────────────── 화면 크기 · 방향 ───────────────────────── */

export function useViewport(): { width: number; height: number } {
  const [v, setV] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const on = () => setV({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return v;
}

/** 방향 잠금 API가 되는 기기에서는 가로로 잠근다 (안 되면 조용히 넘어감 — "가로로 돌려 주세요" 화면이 대신한다) */
export function tryLockLandscape() {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    void o?.lock?.('landscape')?.catch(() => undefined);
  } catch {
    // 지원 안 함
  }
}
export function unlockOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // 지원 안 함
  }
}

/** "가로로 돌려 주세요" (design.md 5.42). 시작 전 = 회전 잠금 안내 + 나가기 / 게임 중 = 남은 시간·점수 (시간은 흐름) */
export function RotateScreen({
  playing,
  remainingMs,
  score,
  onLeave,
}: {
  playing: boolean;
  remainingMs?: number;
  score?: number;
  onLeave?: () => void;
}) {
  return (
    <div className="ten-rotate" role="alert">
      <span className="ten-rotate__art" aria-hidden="true">
        <span className="ten-rotate__phone ten-rotate__phone--tall" />
        <span className="ten-rotate__phone ten-rotate__phone--wide" />
        <RotateCw size={28} className="ten-rotate__arrow" />
      </span>
      <h2 className="ten-rotate__title">가로로 돌려 주세요</h2>
      {playing ? (
        <>
          <p className="ten-rotate__desc">게임은 멈추지 않아요. 시간이 계속 흐르고 있어요</p>
          <p className="ten-rotate__stats">
            <span>
              남은 시간 <b>{formatClock(remainingMs ?? 0)}</b>
            </span>
            <span>
              점수 <b>{points(score ?? 0)}</b>
            </span>
          </p>
        </>
      ) : (
        <>
          <p className="ten-rotate__desc">판이 옆으로 넓어서 폰을 눕혀서 해요. 돌리면 3초 뒤에 시작해요</p>
          <p className="notice-box ten-rotate__notice">
            <Info size={16} aria-hidden="true" />
            <span>
              화면이 안 돌아가면 기기의 <b>화면 회전 잠금</b>을 꺼 주세요
            </span>
          </p>
          {onLeave && (
            <button type="button" className="button button--secondary ten-rotate__leave" onClick={onLeave}>
              나가기
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** 위 줄 남은 시간 + 판 오른쪽 세로 막대 (위에서부터 줄어듦) */
export function TimeBar({ remainingMs }: { remainingMs: number }) {
  const ratio = Math.max(0, Math.min(1, remainingMs / DURATION_MS));
  return (
    <span className="ten-timebar" aria-hidden="true">
      <span className="ten-timebar__fill" style={{ transform: `scaleY(${ratio})` }} />
    </span>
  );
}

export function TimeText({ remainingMs }: { remainingMs: number }) {
  const last = remainingMs <= LAST_SECONDS * 1000;
  return (
    <span className={`ten-time${last ? ' is-last' : ''}`}>
      <Timer size={18} aria-hidden="true" />
      <b>{formatClock(remainingMs)}</b>
    </span>
  );
}

/* ───────────────────────── 판 진행 (1인·대전 같이 씀) ───────────────────────── */

export interface Play {
  board: Board;
  score: number;
  drags: Drag[];
}

/**
 * 판 위에서 네모를 놓았을 때: 터지면 판·점수·기록을 바꾸고 연출·알림을 고른다.
 * 결과 null = 아무 일 없음 (합 ≠ 10)
 */
export function dropOn(play: Play, rect: Rect): { next: Play; popping: Popping; message: string | null } | null {
  const before = play.board;
  const r = popRect(before, rect);
  if (r.popped.length === 0) return null;
  const next: Play = { board: r.board, score: play.score + r.popped.length, drags: [...play.drags, dragOf(rect)] };
  return {
    next,
    popping: { cells: r.popped.map((i) => ({ i, v: before[i] })), rect, key: Date.now() + Math.random() },
    message: popMessage(r.popped.length, play.score === 0),
  };
}

/* ───────────────────────── 1인 화면 ───────────────────────── */

type Phase = 'intro' | 'ready' | 'countdown' | 'playing' | 'over';

interface Finished {
  score: number;
  prevBest: number | null;
  save: 'skip' | 'saving' | 'saved' | 'error';
}

export function TenPage() {
  const ledgerId = useLedgerId();
  const navigate = useNavigate();
  const location = useLocation();
  const { me, members, ready, failed, refresh } = useGames();
  const bests = useLoad(() => listTenBests(ledgerId), [ledgerId]);
  const { width, height } = useViewport();
  const landscape = isLandscape(width, height);
  const size = tenCellSize(width, height);

  const [phase, setPhase] = useState<Phase>('intro');
  const [count, setCount] = useState(3);
  const [play, setPlay] = useState<Play | null>(null);
  const playRef = useRef<Play | null>(null);
  const seedRef = useRef(0);
  const endAt = useRef(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [popping, setPopping] = useState<Popping | null>(null);
  const [pill, setPill] = useState<{ text: string; key: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastWarned = useRef(false);

  const bestList = bests.state.status === 'ready' ? bests.state.data : null;
  const mine = me && bestList ? myTenBest(bestList, me) : null;
  const other = me && bestList ? topOtherTenBest(bestList, me, members) : null;

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

  // ── 뒤로 막기: 판을 하는 동안 기록 하나를 더 넣어 두고, 기기 뒤로가 그걸 빼면 확인 창(시간은 흐름)
  const active = phase === 'ready' || phase === 'countdown' || phase === 'playing';
  const guarded = (location.state as { tenGuard?: boolean } | null)?.tenGuard === true;
  const guardedOnce = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (guarded) {
      guardedOnce.current = true;
      return;
    }
    if (guardedOnce.current) {
      if (phase === 'ready') setPhase('intro');
      else setConfirmQuit(true);
    }
    navigate(location.pathname, { state: { tenGuard: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guarded, active]);

  // ── 끝: 기록 저장 (판마다 1번, 서버가 다시 센 점수)
  const finish = useCallback(() => {
    const p = playRef.current;
    if (!p) return;
    const prevBest = mine;
    const f: Finished = { score: p.score, prevBest, save: p.score > 0 ? 'saving' : 'skip' };
    setFinished(f);
    setPhase('over');
    setConfirmQuit(false);
    vibrate(30);
    setAnnounce(`끝났어요. ${points(p.score)}`);
    if (p.score <= 0) return;
    recordTenScore(ledgerId, seedRef.current, p.drags).then(
      (r) => {
        setFinished((cur) => (cur === f ? { score: r.score, prevBest: r.previous_best, save: 'saved' } : cur));
        if (me && bestList && r.best_score !== null) {
          bests.setData([...bestList.filter((b) => b.member_id !== me), { member_id: me, best_score: r.best_score }]);
        } else bests.reload();
      },
      () => {
        setFinished((cur) => (cur === f ? { ...f, save: 'error' } : cur));
        setToast('기록을 저장하지 못했어요');
      },
    );
  }, [mine, ledgerId, me, bestList, bests]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // ── 3초 세기 (가로일 때만 — 세로면 기다림, 세는 중에 세로로 돌리면 다시 "가로로 돌려 주세요")
  useEffect(() => {
    if (phase === 'ready' && landscape) {
      setCount(3);
      setPhase('countdown');
    } else if (phase === 'countdown' && !landscape) setPhase('ready');
  }, [phase, landscape]);
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) {
      endAt.current = Date.now() + DURATION_MS;
      lastWarned.current = false;
      setRemaining(DURATION_MS);
      setPhase('playing');
      return;
    }
    const t = setTimeout(() => setCount((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count]);

  // ── 시간 (세로로 돌려도·확인 창이 떠도 흐른다)
  useEffect(() => {
    if (phase !== 'playing') return;
    const tick = () => {
      const left = endAt.current - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= LAST_SECONDS * 1000 && !lastWarned.current) {
        lastWarned.current = true;
        setPill({ text: LAST_SECONDS_MESSAGE, key: Date.now() });
        setAnnounce(LAST_SECONDS_MESSAGE);
      }
      if (left <= 0) finishRef.current();
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [phase]);

  function start() {
    tryLockLandscape();
    const seed = randomSeed();
    seedRef.current = seed;
    const p: Play = { board: tenBoard(seed), score: 0, drags: [] };
    playRef.current = p;
    setPlay(p);
    setFinished(null);
    setPopping(null);
    setPill(null);
    setAnnounce('');
    setRemaining(DURATION_MS);
    if (landscape) {
      setCount(3);
      setPhase('countdown');
    } else setPhase('ready');
  }

  function drop(rect: Rect) {
    const p = playRef.current;
    if (!p || phase !== 'playing') return;
    const r = dropOn(p, rect);
    if (!r) return;
    playRef.current = r.next;
    setPlay(r.next);
    setPopping(r.popping);
    if (r.message) setPill({ text: r.message, key: Date.now() });
    setAnnounce(`${r.message ?? ''} +${points(r.popping.cells.length)}, 점수 ${points(r.next.score)}`.trim());
    vibrate(20);
  }

  function leave() {
    unlockOrientation();
    navigate(PLAY_PATH, { replace: true });
  }

  function back() {
    if (phase === 'playing' || phase === 'countdown') setConfirmQuit(true);
    else if (phase === 'ready') setPhase('intro');
    else leave();
  }

  if (!ready && failed) return <StatusScreen kind="error" message="미니게임을 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={refresh} />;
  if (!ready) return <StatusScreen kind="loading" message="도토리 열 알을 준비하고 있어요" />;
  if (!me) return <StatusScreen kind="error" message="이 가계부의 멤버가 아니에요" />;

  if (phase === 'intro' || !play) {
    return (
      <TenIntro
        best={mine}
        loading={bests.state.status === 'loading'}
        error={bests.state.status === 'error'}
        onRetry={bests.reload}
        other={other}
        members={members}
        onBack={leave}
        onStart={start}
      />
    );
  }

  if (phase === 'ready' && !landscape) {
    return (
      <div className="ten-shell ten-shell--portrait">
        <RotateScreen playing={false} onLeave={() => setPhase('intro')} />
      </div>
    );
  }

  const playing = phase === 'playing';
  const shownRemaining = phase === 'playing' || phase === 'over' ? remaining : DURATION_MS;

  return (
    <div className="ten-shell" style={{ ['--ten-cell' as string]: `${size}px` }}>
      <header className="ten-top">
        <button type="button" className="icon-button" aria-label={phase === 'over' ? '나가기' : '나가기 (확인)'} onClick={back}>
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <span className="ten-score">
          <span className="ten-score__label">점수</span>
          <b className={`ten-score__num${popping ? ' is-bump' : ''}`} key={play.score}>
            {play.score}
          </b>
          <span className="ten-score__unit">점</span>
        </span>
        {mine !== null && (
          <span className="ten-best">
            최고 <b>{mine}</b>점
          </span>
        )}
        <span className="ten-top__space" />
        <TimeText remainingMs={shownRemaining} />
      </header>

      <main className="ten-main">
        <div className="ten-board-wrap">
          <TenBoard
            board={play.board}
            size={size}
            enabled={playing}
            dim={phase === 'over'}
            popping={popping}
            label={`점수 ${points(play.score)}, 남은 시간 ${spokenClock(shownRemaining)}`}
            onDrop={drop}
          />
          {pill && (
            <span key={pill.key} className="vs-pill vs-pill--info ten-pill" aria-hidden="true">
              {pill.text}
            </span>
          )}
          {phase === 'countdown' && (
            <span className="ten-count" aria-live="assertive">
              <b>{Math.max(count, 1)}</b>
            </span>
          )}
        </div>
        <TimeBar remainingMs={shownRemaining} />
      </main>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {playing && !landscape && <RotateScreen playing remainingMs={remaining} score={play.score} />}

      {confirmQuit && phase !== 'over' && (
        <Dialog
          title="그만할까요?"
          onCancel={() => setConfirmQuit(false)}
          actions={
            <>
              <button type="button" className="button button--secondary" onClick={() => setConfirmQuit(false)}>
                계속할게요
              </button>
              <button type="button" className="button button--danger" onClick={leave}>
                그만하기
              </button>
            </>
          }
        >
          <p>이번 판 기록은 남지 않아요</p>
        </Dialog>
      )}

      {phase === 'over' && finished && (
        <SoloResultCard finished={finished} other={other} members={members} onLeave={leave} onAgain={start} />
      )}

      {toast && (
        <p className="toast toast--no-tabbar play-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── 시작 화면 (세로, 5.42) ───────────────────────── */

type OtherBest = { member: Member | { id: string; display_name: string; left_at: string | null }; score: number } | null;

function MemberLine({ memberId, members, text }: { memberId: string; members: readonly Member[]; text: ReactNode }) {
  return (
    <p className="play-sheet__record stack-member-line">
      <GameAvatar memberId={memberId} members={members} size={24} />
      <span>{text}</span>
    </p>
  );
}

function TenIntro({
  best,
  loading,
  error,
  onRetry,
  other,
  members,
  onBack,
  onStart,
}: {
  best: number | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  other: OtherBest;
  members: readonly Member[];
  onBack: () => void;
  onStart: () => void;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="뒤로" onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1 className="topbar__title">도토리 열 알</h1>
        <span className="icon-button" aria-hidden="true" />
      </header>
      <main className="content content--no-tabbar stack-intro">
        <section className="play-panel stack-intro__hero">
          <div className="stack-intro__illust">
            <TenIllustration />
          </div>
          <p className="stack-intro__title">숫자 도토리를 네모로 묶어 합 10을 만들어요</p>
        </section>

        <section className="play-panel" aria-labelledby="ten-best-title">
          <h2 id="ten-best-title" className="play-panel__label">
            내 최고 기록
          </h2>
          {loading ? (
            <p className="stack-best__empty">기록을 불러오고 있어요</p>
          ) : error ? (
            <p className="stack-best__empty">
              기록을 불러오지 못했어요{' '}
              <button type="button" className="button button--text" onClick={onRetry}>
                다시 시도
              </button>
            </p>
          ) : best !== null ? (
            <p className="stack-best__amount">{points(best)}</p>
          ) : (
            <div>
              <p className="stack-best__empty-title">아직 기록이 없어요</p>
              <p className="stack-best__empty">첫 판을 해 볼까요?</p>
            </div>
          )}
          {other && (
            <MemberLine
              memberId={other.member.id}
              members={members}
              text={
                <>
                  {other.member.display_name}님 최고 기록 <b>{points(other.score)}</b>이에요
                </>
              }
            />
          )}
        </section>

        <section className="play-panel" aria-labelledby="ten-howto-title">
          <h2 id="ten-howto-title" className="play-panel__label">
            이렇게 해요
          </h2>
          <ul className="stack-howto">
            <li>
              <SquareDashedMousePointer size={20} aria-hidden="true" /> 손가락으로 끌어 네모를 그려요
            </li>
            <li>
              <Equal size={20} aria-hidden="true" /> 네모 안 숫자 합이 10이면 도토리를 모아요
            </li>
            <li>
              <Timer size={20} aria-hidden="true" /> 2분 동안 많이 모을수록 좋아요
            </li>
          </ul>
        </section>
      </main>
      <div className="play-bottom">
        <button type="button" className="button button--primary play-bottom__main" onClick={onStart}>
          <Play size={20} aria-hidden="true" /> 시작하기
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── 1인 결과 (가운데 카드, 5.43) ───────────────────────── */

function SoloResultCard({
  finished,
  other,
  members,
  onLeave,
  onAgain,
}: {
  finished: Finished;
  other: OtherBest;
  members: readonly Member[];
  onLeave: () => void;
  onAgain: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const v = soloResult(finished.score, finished.prevBest);
  return (
    <div className="ten-card-backdrop">
      <div className="ten-card" role="dialog" aria-modal="true" aria-labelledby="ten-solo-title" tabIndex={-1} ref={panel}>
        <div className="ten-card__head">
          <span className={`ten-card__icon${v.highlight ? ' is-win' : ''}`} aria-hidden="true">
            {v.icon === 'trophy' ? <Trophy size={28} /> : <Nut size={28} />}
          </span>
          <span className="ten-card__text">
            <h2 id="ten-solo-title" className="ten-card__title">
              {v.title}
            </h2>
            <span className="ten-card__line">{v.line}</span>
          </span>
          <b className="ten-card__score">{points(finished.score)}</b>
        </div>
        {other && (
          <MemberLine
            memberId={other.member.id}
            members={members}
            text={
              finished.score > other.score ? (
                <>
                  {other.member.display_name}님 기록 <b>{points(other.score)}</b>을 넘었어요
                </>
              ) : (
                <>
                  {other.member.display_name}님 최고 기록 <b>{points(other.score)}</b>이에요
                </>
              )
            }
          />
        )}
        {finished.save === 'saving' && <p className="play-sheet__note">기록을 저장하고 있어요</p>}
        <div className="play-actions">
          <button type="button" className="button button--secondary" onClick={onLeave}>
            나가기
          </button>
          <button type="button" className="button button--primary" onClick={onAgain}>
            <RotateCcw size={18} aria-hidden="true" /> 한 판 더
          </button>
        </div>
      </div>
    </div>
  );
}
