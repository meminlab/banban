import {
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Coffee,
  Flag,
  Handshake,
  LoaderCircle,
  Move,
  RotateCcw,
  Smile,
  Trophy,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { omokPath, PLAY_PATH } from '../../app/routes';
import { Dialog } from '../../components/Dialog';
import { GameAvatar } from '../../components/GameAvatar';
import { Icon } from '../../components/Icon';
import { OmokBoard } from '../../components/OmokBoard';
import { playErrorMessage, RespondButtons } from '../../components/PlayInvite';
import { StatusScreen } from '../../components/StatusScreen';
import {
  cancelGame,
  getGame,
  GameError,
  inviteGame,
  listFinishedGames,
  listMoves,
  playMove,
  resignGame,
  subscribeGameRoom,
  sweepGames,
  type GameResult,
} from '../../data/game';
import type { Game, GameMove, GameStatus, Member } from '../../data/types';
import {
  buildBoard,
  cellIndex,
  cellLabel,
  colorOf,
  effectiveStatus,
  formatHeadToHead,
  formatRemaining,
  headToHead,
  inviteRemainingMs,
  isPlayer,
  mergeMoves,
  moveZoom,
  myOpenGame,
  opponentOf,
  resultCopy,
  roomCopy,
  turnText,
  winningLine,
  zoomOrigin as zoomOriginFor,
  type ResultIcon,
  type Stone,
} from '../../domain/omok';

/** 상대가 판 화면에서 사라진 뒤 "자리 비움"을 띄우기까지 (깜빡임 방지) */
const AWAY_DELAY_MS = 10_000;
/** "둘 다 왔어요!" 뒤 판으로 넘어가기까지 */
const BOTH_IN_MS = 1500;
/** 받은 사람이 수락한 뒤 보낸 사람을 기다리는 최대 시간 (그 뒤엔 판으로, 자리 비움 표시) */
const WAIT_INVITER_MS = 10_000;

type RoomState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'missing' }
  | { status: 'ready'; game: Game; moves: GameMove[] };

/**
 * 한 판의 서버 상태 + 실시간. 처음·다시 연결·앱을 다시 열 때 서버 값으로 맞추고,
 * 그 사이에는 실시간으로 받은 수·판 상태를 합친다(순번이 비면 다시 받는다)
 */
function useGameRoom(gameId: string, me: string | null) {
  const [state, setState] = useState<RoomState>({ status: 'loading' });
  const [present, setPresent] = useState<string[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [resyncs, setResyncs] = useState(0);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    Promise.all([getGame(gameId), listMoves(gameId)]).then(
      ([game, moves]) => {
        if (mine !== seq.current) return;
        setState(game ? { status: 'ready', game, moves } : { status: 'missing' });
      },
      () => mine === seq.current && setState((s) => (s.status === 'ready' ? s : { status: 'error' })),
    );
  }, [gameId]);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    const onOffline = () => setConnected(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('offline', onOffline);
    let stop = () => {};
    if (me) {
      try {
        stop = subscribeGameRoom(gameId, me, {
          onMove: (move) =>
            setState((s) => {
              if (s.status !== 'ready') return s;
              const merged = mergeMoves(s.moves, [move]);
              if (merged.gap) load();
              return { ...s, moves: merged.moves };
            }),
          onGame: (game) => setState((s) => (s.status === 'ready' ? { ...s, game } : s)),
          onPresence: setPresent,
          onResync: () => {
            setResyncs((n) => n + 1);
            load();
          },
          onConnected: setConnected,
        });
      } catch {
        // 실시간을 열지 못해도 판은 보인다 (다시 열면 맞춰진다)
      }
    }
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('offline', onOffline);
    };
  }, [gameId, me, load]);

  /** 내가 보낸 요청의 결과를 실시간 도착 전에 반영 */
  const apply = useCallback((r: GameResult, move?: GameMove) => {
    setState((s) => {
      if (s.status !== 'ready') return s;
      const game: Game = {
        ...s.game,
        status: r.status,
        move_count: Math.max(s.game.move_count, r.move_count),
        winner_id: r.winner_id,
        end_reason: r.end_reason,
      };
      return { ...s, game, moves: move ? mergeMoves(s.moves, [move]).moves : s.moves };
    });
  }, []);

  return { state, present, connected, resyncs, load, apply };
}

/** 오목 한 판: 대기실 / 대국 / 결과 (BANB-49, design.md 5.28~5.31) */
export function OmokPage() {
  const { gameId = '' } = useParams();
  const { me, ready, failed, refresh } = useGames();
  const room = useGameRoom(gameId, me);
  const { state } = room;

  if (state.status === 'missing') return <NoAccess />;
  if (state.status === 'error' || (failed && !ready))
    return <StatusScreen kind="error" message="판을 불러오지 못했어요" onRetry={() => (room.load(), refresh())} />;
  if (state.status === 'loading' || !ready) return <StatusScreen kind="loading" message="판을 불러오고 있어요" />;
  if (!me || !isPlayer(state.game, me)) return <NoAccess />;

  return <Room key={state.game.id} game={state.game} moves={state.moves} me={me} room={room} />;
}

/** 다른 가계부의 판·두 사람이 아닌 판 (design.md 5.31) */
function NoAccess() {
  const navigate = useNavigate();
  return (
    <div className="shell">
      <main className="status-screen" role="alert">
        <p>이 판은 볼 수 없어요</p>
        <button type="button" className="button button--secondary" onClick={() => navigate(PLAY_PATH, { replace: true })}>
          같이 놀기로 가기
        </button>
      </main>
    </div>
  );
}

/** 하위 화면 제목줄 + 오른쪽 자리 */
function GameTopbar({ title, right }: { title: string; right?: ReactNode }) {
  const navigate = useNavigate();
  function back() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(PLAY_PATH, { replace: true });
  }
  return (
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="뒤로" onClick={back}>
        <Icon name="back" />
      </button>
      <h1 className="topbar__title">{title}</h1>
      {right ?? <span className="icon-button" aria-hidden="true" />}
    </header>
  );
}

type RoomApi = ReturnType<typeof useGameRoom>;

function Room({ game, moves, me, room }: { game: Game; moves: GameMove[]; me: string; room: RoomApi }) {
  const location = useLocation();
  const { members } = useGames();
  const now = useNow(1000);
  const status = effectiveStatus(game, now);
  const opp = opponentOf(game, me);
  const oppPresent = room.present?.includes(opp) ?? null;

  // 대기실 → 판 넘어가기: 보낸 사람은 invited → active 를 보면, 받은 사람은 수락하고 들어오면 "둘 다 왔어요!" 1.5초
  const justAccepted = (location.state as { justAccepted?: boolean } | null)?.justAccepted === true;
  const [phase, setPhase] = useState<'both' | 'wait-inviter' | null>(() =>
    justAccepted && status === 'active' && game.move_count === 0 ? 'wait-inviter' : null,
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

  // 서버 상태와 화면 상태가 다르면(10분·24시간 지남) 서버에서 닫는다 → 두 사람 화면에 실시간 반영
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
  return <BoardScreen game={game} moves={moves} me={me} status={status} room={room} />;
}

/* ───────────────────────── 대기실 (5.28) ───────────────────────── */

type PersonState = 'in' | 'waiting' | 'out';
const PERSON_STATE: Record<PersonState, { icon: ReactNode; text: string }> = {
  in: { icon: <CircleCheck size={14} aria-hidden="true" />, text: '들어왔어요' },
  waiting: { icon: <LoaderCircle size={14} aria-hidden="true" />, text: '기다리는 중' },
  out: { icon: <CircleX size={14} aria-hidden="true" />, text: '못 와요' },
};

function WaitingRoom({
  game,
  me,
  status,
  phase,
  now,
  members,
  oppPresent,
  load,
}: {
  game: Game;
  me: string;
  status: GameStatus;
  phase: 'both' | 'wait-inviter' | null;
  now: Date;
  members: Member[];
  oppPresent: boolean | null;
  load: () => void;
}) {
  const navigate = useNavigate();
  const ledgerId = useLedgerId();
  const nameOf = useMemberName();
  const { refresh } = useGames();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opp = opponentOf(game, me);
  const oppName = nameOf(opp);
  const iInvited = game.created_by === me;

  let copy = roomCopy(status, game, me, nameOf);
  if (phase === 'both') {
    copy = {
      title: '둘 다 왔어요!',
      desc: game.black_id === me ? '내가 흑으로 먼저 둬요. 곧 시작해요' : `${oppName}님이 흑으로 먼저 둬요. 곧 시작해요`,
    };
  } else if (phase === 'wait-inviter') {
    copy = { title: `${oppName}님을 기다리고 있어요`, desc: `${oppName}님이 들어오면 시작해요` };
  }

  const stateOf = (memberId: string): PersonState => {
    if (phase === 'both') return 'in';
    if (phase === 'wait-inviter') return memberId === me || oppPresent ? 'in' : 'waiting';
    if (memberId === game.created_by) return status === 'canceled' ? 'out' : 'in';
    if (status === 'declined') return 'out';
    return memberId === me ? 'in' : 'waiting';
  };

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelGame(game.id);
      refresh();
      navigate(PLAY_PATH, { replace: true });
    } catch (e) {
      setError(playErrorMessage(e));
      load();
      setBusy(false);
    }
  }

  async function inviteAgain() {
    setBusy(true);
    setError(null);
    try {
      const id = await inviteGame(ledgerId, opp);
      refresh();
      navigate(omokPath(id), { replace: true });
    } catch (e) {
      setError(playErrorMessage(e, nameOf, opp));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const ended = status === 'expired' || status === 'canceled';
  const players: [string, Stone][] = [
    [game.black_id, 'black'],
    [game.white_id, 'white'],
  ];

  return (
    <div className="shell play-room-shell">
      <GameTopbar title="대기실" />
      <main className="play-room" aria-live="polite">
        {ended ? (
          <span className="play-room__icon" aria-hidden="true">
            {status === 'expired' ? <Clock size={32} /> : <CircleX size={32} />}
          </span>
        ) : (
          <div className="play-room__people">
            {players.map(([id, stone], i) => {
              const st = stateOf(id);
              return (
                <div key={id} className="play-room__person-wrap">
                  {i === 1 && (
                    <span className="play-room__vs" aria-hidden="true">
                      VS
                    </span>
                  )}
                  <div className={`play-room__person is-${st}`}>
                    <GameAvatar memberId={id} members={members} size={56} stone={stone} dim={st !== 'in'} />
                    <span className="play-room__name">{id === me ? '나' : nameOf(id)}</span>
                    <span className="play-room__state">
                      {PERSON_STATE[st].icon}
                      {PERSON_STATE[st].text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <h2 className="play-room__title">{copy.title}</h2>
        <p className="play-room__desc">{copy.desc}</p>
        {status === 'invited' && !phase && (
          <p className="play-room__timer">
            <b>{formatRemaining(inviteRemainingMs(game, now))}</b>
            <span>지나면 초대가 사라져요</span>
          </p>
        )}
        {phase === 'both' && <LoaderCircle size={28} className="play-room__spinner" aria-hidden="true" />}
        {error && (
          <p className="play-error" role="alert">
            {error}
          </p>
        )}
      </main>

      <div className="play-bottom">
        {status === 'invited' && !phase && iInvited && (
          <button type="button" className="button button--secondary play-bottom__main" disabled={busy} onClick={cancel}>
            초대 취소
          </button>
        )}
        {status === 'invited' && !phase && !iInvited && <InviteeButtons game={game} load={load} />}
        {status === 'expired' && (
          <>
            <button type="button" className="button button--secondary" onClick={() => navigate(PLAY_PATH, { replace: true })}>
              닫기
            </button>
            <button type="button" className="button button--primary play-bottom__main" disabled={busy} onClick={inviteAgain}>
              다시 초대하기
            </button>
          </>
        )}
        {(status === 'declined' || status === 'canceled') && !phase && (
          <button type="button" className="button button--primary play-bottom__main" onClick={() => navigate(PLAY_PATH, { replace: true })}>
            알겠어요
          </button>
        )}
      </div>
    </div>
  );
}

function InviteeButtons({ game, load }: { game: Game; load: () => void }) {
  return (
    <div className="play-bottom__respond">
      <RespondButtons game={game} onDone={load} />
    </div>
  );
}

/* ───────────────────────── 대국 (5.29) ───────────────────────── */

function BoardScreen({ game, moves, me, status, room }: { game: Game; moves: GameMove[]; me: string; status: GameStatus; room: RoomApi }) {
  const nameOf = useMemberName();
  const { members } = useGames();
  const opp = opponentOf(game, me);
  const oppName = nameOf(opp);
  const myStone = colorOf(game, me);
  const active = status === 'active';

  // 실시간이 수를 먼저 보내고 판 상태를 나중에 보낼 수 있어 둘 중 큰 쪽으로 차례를 정한다
  const moveCount = Math.max(game.move_count, moves.length);
  const turnOf = active ? (moveCount % 2 === 0 ? game.black_id : game.white_id) : null;
  const myTurn = turnOf === me;
  const board = useMemo(() => buildBoard(moves), [moves]);
  const last = moves.length > 0 ? moves[moves.length - 1] : null;
  const winLine = useMemo(
    () => (status === 'finished' && game.end_reason === 'five' && last ? winningLine(board, last.x, last.y) : null),
    [status, game.end_reason, last, board],
  );

  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [dragHint, setDragHint] = useState(false);
  const [announce, setAnnounce] = useState('');

  // 자리 비움: 상대가 판 화면에서 10초 넘게 안 보이면
  const [away, setAway] = useState(false);
  const oppPresent = room.present?.includes(opp) ?? null;
  useEffect(() => {
    if (oppPresent !== false) {
      setAway(false);
      return;
    }
    const t = setTimeout(() => setAway(true), AWAY_DELAY_MS);
    return () => clearTimeout(t);
  }, [oppPresent]);

  // 다시 연결되면 서버 판으로 맞춘 뒤 고른 칸은 해제
  useEffect(() => {
    if (room.resyncs > 1) setSelected(null);
  }, [room.resyncs]);

  // 상대가 둔 순간 읽어 주기
  const lastSeqSeen = useRef(last?.seq ?? 0);
  useEffect(() => {
    if (!last || last.seq <= lastSeqSeen.current) return;
    lastSeqSeen.current = last.seq;
    if (last.member_id !== me) setAnnounce(`${oppName}님이 ${cellLabel(last.x, last.y)}에 뒀어요. ${active ? '내 차례예요' : ''}`);
  }, [last, me, oppName, active]);

  // 토스트 2.5초
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // 고른 칸이 그사이 채워졌거나 내 차례가 아니게 되면 지운다
  const selectedValid = selected && myTurn && room.connected && board[cellIndex(selected[0], selected[1])] === null ? selected : null;

  async function place() {
    if (!selectedValid || busy) return;
    const [x, y] = selectedValid;
    setBusy(true);
    try {
      const r = await playMove(game.id, x, y);
      const move: GameMove | undefined =
        r.applied && r.seq
          ? { game_id: game.id, ledger_id: game.ledger_id, seq: r.seq, x, y, member_id: me, created_at: new Date().toISOString() }
          : undefined;
      room.apply(r, move);
      setSelected(null);
      if (!r.applied) room.load();
    } catch (e) {
      setToast(playErrorMessage(e, nameOf, opp));
      setSelected(null);
      if (e instanceof GameError) room.load();
    } finally {
      setBusy(false);
    }
  }

  async function resign() {
    setConfirmResign(false);
    setBusy(true);
    try {
      room.apply(await resignGame(game.id));
    } catch (e) {
      setToast(playErrorMessage(e));
      room.load();
    } finally {
      setBusy(false);
    }
  }

  function toggleZoom() {
    if (zoom) {
      setZoom(null);
      return;
    }
    setZoom(zoomOriginFor(selected ?? (last ? [last.x, last.y] : [7, 7])));
    setDragHint(true);
    setTimeout(() => setDragHint(false), 2000);
  }

  // 아래 버튼
  let main: ReactNode;
  if (!room.connected) {
    main = (
      <button type="button" className="button button--primary play-bottom__main" disabled>
        <LoaderCircle size={20} className="play-spin" aria-hidden="true" /> 연결하는 중…
      </button>
    );
  } else if (busy) {
    main = (
      <button type="button" className="button button--primary play-bottom__main" disabled>
        <LoaderCircle size={20} className="play-spin" aria-hidden="true" /> 두고 있어요
      </button>
    );
  } else if (myTurn && selectedValid) {
    main = (
      <button type="button" className="button button--primary play-bottom__main" onClick={place}>
        <Check size={20} aria-hidden="true" /> 여기에 둘게요
      </button>
    );
  } else {
    main = (
      <button type="button" className="button button--primary play-bottom__main" disabled>
        {myTurn ? '둘 곳을 눌러 주세요' : away ? `${oppName}님을 기다리고 있어요` : `${oppName}님이 두고 있어요`}
      </button>
    );
  }

  const help = !room.connected ? (
    <p className="notice-box">
      <WifiOff size={16} aria-hidden="true" />
      연결이 잠시 끊겼어요. 다시 연결하는 중이에요
    </p>
  ) : active && away ? (
    <p className="notice-box">
      <Coffee size={16} aria-hidden="true" />
      {oppName}님이 잠시 자리를 비웠어요. 돌아오면 이어서 해요
    </p>
  ) : active && myTurn ? (
    <p className="play-help">{selectedValid ? '다른 곳을 누르면 옮겨져요' : '놓을 곳을 누르면 미리 보여 드려요'}</p>
  ) : null;

  const players: [string, Stone][] = [
    [game.black_id, 'black'],
    [game.white_id, 'white'],
  ];

  return (
    <div className="shell omok-shell">
      <GameTopbar
        title="오목"
        right={
          active ? (
            <button type="button" className="button button--text omok-resign" disabled={busy} onClick={() => setConfirmResign(true)}>
              <Flag size={18} aria-hidden="true" /> 기권
            </button>
          ) : undefined
        }
      />
      <main className="omok">
        <ul className="omok-players" aria-label="두 사람">
          {players.map(([id, stone]) => {
            const isTurn = turnOf === id;
            const isAway = id === opp && active && away;
            return (
              <li key={id} className={`omok-player${isTurn ? ' is-turn' : ''}${isAway ? ' is-away' : ''}`}>
                <GameAvatar memberId={id} members={members} size={32} stone={stone} dim={isAway} />
                <span className="omok-player__body">
                  <span className="omok-player__name">{id === me ? '나' : nameOf(id)}</span>
                  <span className="omok-player__sub">
                    {isTurn ? (id === me ? '내 차례예요' : '차례예요') : isAway ? '자리 비움' : stone === 'black' ? '흑 · 먼저' : '백'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="omok-turn">
          {turnOf ? (
            <>
              <GameAvatar memberId={turnOf} members={members} size={32} stone={colorOf(game, turnOf)} />
              <span className={`omok-turn__text${myTurn ? ' is-mine' : ''}`}>{turnText({ ...game, move_count: moveCount }, me, nameOf)}</span>
            </>
          ) : (
            <span className="omok-turn__text">대국이 끝났어요</span>
          )}
          <span className="omok-turn__count">{moveCount}수</span>
        </div>

        <div className="omok-board-wrap">
          <OmokBoard
            board={board}
            selected={selectedValid}
            onSelect={(x, y) => setSelected([x, y])}
            onConfirm={place}
            interactive={myTurn && !busy && room.connected}
            pendingStone={myStone}
            lastMove={last ? [last.x, last.y] : null}
            lastSeq={last?.seq ?? 0}
            winLine={winLine}
            zoomOrigin={zoom}
            onPan={(dx, dy) => setZoom((z) => (z ? moveZoom(z, dx, dy) : z))}
          />
          {zoom && dragHint && (
            <span className="omok-drag-hint">
              <Move size={14} aria-hidden="true" /> 끌어서 옮겨요
            </span>
          )}
        </div>

        {help}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </main>

      {active && (
        <div className="play-bottom">
          <button
            type="button"
            className={`button button--secondary play-bottom__zoom${zoom ? ' is-on' : ''}`}
            aria-label={zoom ? '전체 판 보기' : '확대해서 보기'}
            aria-pressed={zoom !== null}
            onClick={toggleZoom}
          >
            {zoom ? <ZoomOut size={22} aria-hidden="true" /> : <ZoomIn size={22} aria-hidden="true" />}
          </button>
          {main}
        </div>
      )}

      {toast && (
        <p className="toast toast--no-tabbar play-toast" role="status">
          {toast}
        </p>
      )}

      {(status === 'finished' || status === 'abandoned') && <ResultSheet game={{ ...game, status }} me={me} members={members} />}

      {confirmResign && (
        <Dialog
          title="기권할까요?"
          onCancel={() => setConfirmResign(false)}
          actions={
            <>
              <button type="button" className="button button--secondary" onClick={() => setConfirmResign(false)}>
                계속 둘게요
              </button>
              <button type="button" className="button button--danger" onClick={resign}>
                기권하기
              </button>
            </>
          }
        >
          <p>이번 판은 {oppName}님 승리로 끝나요. 전적에도 남아요.</p>
        </Dialog>
      )}
      <SyncOpenList game={game} />
    </div>
  );
}

/** 판 상태가 바뀌면 진행 중 목록(홈 카드·배너)에도 반영 */
function SyncOpenList({ game }: { game: Game }) {
  const { upsert } = useGames();
  useEffect(() => {
    upsert(game);
  }, [game, upsert]);
  return null;
}

/* ───────────────────────── 결과 시트 (5.30) ───────────────────────── */

const RESULT_ICON: Record<ResultIcon, ReactNode> = {
  trophy: <Trophy size={32} aria-hidden="true" />,
  smile: <Smile size={32} aria-hidden="true" />,
  flag: <Flag size={32} aria-hidden="true" />,
  handshake: <Handshake size={32} aria-hidden="true" />,
  clock: <Clock size={32} aria-hidden="true" />,
};

function ResultSheet({ game, me, members }: { game: Game; me: string; members: Member[] }) {
  const navigate = useNavigate();
  const ledgerId = useLedgerId();
  const nameOf = useMemberName();
  const { open, refresh } = useGames();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Game[] | null>(null);
  const opp = opponentOf(game, me);
  const oppName = nameOf(opp);
  const copy = resultCopy(game, me, nameOf);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  // 전적 (이번 판 반영 후)
  useEffect(() => {
    let alive = true;
    listFinishedGames(ledgerId).then(
      (games) => alive && setFinished(games.some((g) => g.id === game.id) || game.status !== 'finished' ? games : [game, ...games]),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, game]);

  // 상대가 먼저 "한 판 더"를 눌렀으면 그 초대를 보여 준다
  const incoming = myOpenGame(open, me, now);
  const rematchIn = incoming?.kind === 'invited-me' && incoming.game.created_by === opp ? incoming.game : null;

  async function again() {
    setBusy(true);
    setError(null);
    try {
      const id = await inviteGame(ledgerId, opp, game.id);
      refresh();
      navigate(omokPath(id), { replace: true });
    } catch (e) {
      // 거의 동시에 눌렀으면 상대 초대가 먼저 들어가 있다 → 목록을 새로 받으면 시트가 "한 판 더 하재요"로 바뀐다
      refresh();
      setError(e instanceof GameError && e.code === 'GAME_OPPONENT_BUSY' ? null : playErrorMessage(e, nameOf, opp));
    } finally {
      setBusy(false);
    }
  }

  const record = finished ? headToHead(finished, me, opp) : null;
  const iAmBlackNext = game.white_id === me;

  return (
    <div className="play-sheet-backdrop">
      <div className="play-sheet" role="dialog" aria-modal="true" aria-labelledby="play-result-title" tabIndex={-1} ref={panel}>
        <span className="play-sheet__handle" aria-hidden="true" />
        {rematchIn ? (
          <>
            <span className="play-sheet__icon" aria-hidden="true">
              <RotateCcw size={32} />
            </span>
            <h2 id="play-result-title" className="play-sheet__title">
              {oppName}님이 한 판 더 하재요
            </h2>
            <p className="play-sheet__line">{rematchIn.black_id === me ? '이번엔 내가 흑이에요 (흑백을 바꿔요)' : `이번엔 ${oppName}님이 흑이에요`}</p>
            <RespondButtons game={rematchIn} />
          </>
        ) : (
          <>
            <span className={`play-sheet__icon${copy.win ? ' is-win' : ''}`} aria-hidden="true">
              {RESULT_ICON[copy.icon]}
            </span>
            <h2 id="play-result-title" className="play-sheet__title">
              {copy.title}
            </h2>
            <p className="play-sheet__line">{copy.line}</p>
            {copy.counted && record && (
              <p className="play-sheet__record">
                <GameAvatar memberId={opp} members={members} size={24} />
                {oppName}님과 <b>{formatHeadToHead(record)}</b>
              </p>
            )}
            {error && (
              <p className="play-error" role="alert">
                {error}
              </p>
            )}
            <div className="play-actions">
              <button type="button" className="button button--secondary" onClick={() => navigate(PLAY_PATH, { replace: true })}>
                나가기
              </button>
              <button type="button" className="button button--primary" disabled={busy} onClick={again}>
                <RotateCcw size={18} aria-hidden="true" /> 한 판 더
              </button>
            </div>
            <p className="play-sheet__note">{iAmBlackNext ? '다음 판은 내가 흑이에요 (흑백을 바꿔요)' : `다음 판은 ${oppName}님이 흑이에요`}</p>
          </>
        )}
      </div>
    </div>
  );
}
