import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { omokPath, PLAY_PATH } from '../../app/routes';
import { Dialog } from '../../components/Dialog';
import { OmokBoard } from '../../components/OmokBoard';
import { PlayInviteBanner, playErrorMessage, useRespond } from '../../components/PlayInvite';
import { StatusScreen } from '../../components/StatusScreen';
import { SubPageTopbar } from '../../components/SubPageTopbar';
import {
  getGame,
  GameError,
  inviteGame,
  listMoves,
  playMove,
  resignGame,
  subscribeGameRoom,
  sweepGames,
  type GameResult,
} from '../../data/game';
import type { Game, GameMove } from '../../data/types';
import {
  buildBoard,
  colorOf,
  effectiveStatus,
  formatRemaining,
  gameHeadline,
  inviteRemainingMs,
  isPlayer,
  mergeMoves,
  opponentOf,
  stoneOfSeq,
  winningLine,
} from '../../domain/omok';

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
    document.addEventListener('visibilitychange', onVisible);
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
          onResync: load,
        });
      } catch {
        // 실시간을 열지 못해도 판은 보인다 (다시 열면 맞춰진다)
      }
    }
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
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

  return { state, present, load, apply };
}

/** 오목 한 판: 초대 대기실 / 초대 받음 / 대국 / 결과 (BANB-49) */
export function OmokPage() {
  const { gameId = '' } = useParams();
  const { me, ready, failed, refresh } = useGames();
  const { state, present, load, apply } = useGameRoom(gameId, me);

  if (state.status === 'missing') return <StatusScreen kind="error" message="판을 찾을 수 없어요" />;
  if (state.status === 'error' || (failed && !ready))
    return <StatusScreen kind="error" message="판을 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={() => (load(), refresh())} />;
  if (state.status === 'loading' || !ready) return <StatusScreen kind="loading" message="판을 불러오고 있어요" />;
  if (!me || !isPlayer(state.game, me)) return <StatusScreen kind="error" message="두 사람만 볼 수 있는 판이에요" />;

  return <Room key={state.game.id} game={state.game} moves={state.moves} me={me} present={present} load={load} apply={apply} />;
}

function Room({
  game,
  moves,
  me,
  present,
  load,
  apply,
}: {
  game: Game;
  moves: GameMove[];
  me: string;
  present: string[] | null;
  load: () => void;
  apply: (r: GameResult, move?: GameMove) => void;
}) {
  const ledgerId = useLedgerId();
  const navigate = useNavigate();
  const nameOf = useMemberName();
  const { refresh, upsert } = useGames();
  const now = useNow(1000);
  const status = effectiveStatus(game, now);
  const opp = opponentOf(game, me);
  const myStone = colorOf(game, me);

  // 실시간이 수를 먼저 보내고 판 상태를 나중에 보낼 수 있어 둘 중 큰 쪽으로 차례를 정한다
  const moveCount = Math.max(game.move_count, moves.length);
  const myTurn = status === 'active' && (moveCount % 2 === 0 ? game.black_id : game.white_id) === me;
  const board = useMemo(() => buildBoard(moves), [moves]);
  const last = moves.length > 0 ? moves[moves.length - 1] : null;
  const winLine = useMemo(
    () => (status === 'finished' && game.end_reason === 'five' && last ? winningLine(board, last.x, last.y) : null),
    [status, game.end_reason, last, board],
  );

  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);

  // 고른 칸이 그사이 채워졌거나 내 차례가 아니게 되면 지운다
  const selectedValid = selected && myTurn && board[selected[1] * 15 + selected[0]] === null ? selected : null;

  // 서버 상태와 화면 상태가 다르면(10분·24시간 지남) 서버에서 닫는다 → 두 사람 화면에 실시간 반영
  const swept = useRef<string | null>(null);
  useEffect(() => {
    if (status !== game.status && swept.current !== `${game.id}:${status}`) {
      swept.current = `${game.id}:${status}`;
      sweepGames(ledgerId).then(load, () => undefined);
    }
  }, [status, game.status, game.id, ledgerId, load]);

  async function place() {
    if (!selectedValid || busy) return;
    const [x, y] = selectedValid;
    setBusy(true);
    setMessage(null);
    try {
      const r = await playMove(game.id, x, y);
      const move: GameMove | undefined = r.applied && r.seq
        ? { game_id: game.id, ledger_id: game.ledger_id, seq: r.seq, x, y, member_id: me, created_at: new Date().toISOString() }
        : undefined;
      apply(r, move);
      setSelected(null);
      if (!r.applied) load();
    } catch (e) {
      setMessage(playErrorMessage(e));
      if (e instanceof GameError) load();
    } finally {
      setBusy(false);
    }
  }

  async function resign() {
    setConfirmResign(false);
    setBusy(true);
    try {
      apply(await resignGame(game.id));
      refresh();
    } catch (e) {
      setMessage(playErrorMessage(e));
      load();
    } finally {
      setBusy(false);
    }
  }

  /** 한 판 더 (끝난 판: 흑백 바꿈) / 다시 초대 (거절·만료: 처음처럼 상대가 흑) */
  async function again() {
    setBusy(true);
    setMessage(null);
    try {
      const rematch = status === 'finished' || status === 'abandoned';
      const id = await inviteGame(ledgerId, opp, rematch ? game.id : undefined);
      refresh();
      navigate(omokPath(id), { replace: true });
    } catch (e) {
      setMessage(playErrorMessage(e, nameOf, opp));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const headline = gameHeadline(game, me, now, nameOf);
  const away = status === 'active' && present !== null && !present.includes(opp);
  const turnOf = status === 'active' ? (moveCount % 2 === 0 ? game.black_id : game.white_id) : null;

  return (
    <div className="shell">
      <SubPageTopbar title="오목" fallback={PLAY_PATH} />
      <main className="content content--no-tabbar omok">
        <PlayInviteBanner hidden={status === 'invited'} />

        <PlayersRow game={game} me={me} turnOf={turnOf} nameOf={nameOf} />

        <p className={`omok__headline${myTurn ? ' is-my-turn' : ''}`} role="status" aria-live="polite">
          {headline}
        </p>
        {away && <p className="notice">{nameOf(opp)}님이 잠시 자리를 비웠어요</p>}

        {status === 'invited' && game.created_by === me && <WaitingRoom game={game} now={now} />}
        {status === 'invited' && game.created_by !== me && <InvitedActions game={game} myStone={myStone} onDone={load} />}

        {(status === 'active' || status === 'finished' || status === 'abandoned') && (
          <OmokBoard
            board={board}
            selected={selectedValid}
            onSelect={(x, y) => setSelected([x, y])}
            interactive={myTurn && !busy}
            pendingStone={myStone}
            lastMove={last ? [last.x, last.y] : null}
            winLine={winLine}
          />
        )}

        {message && (
          <p className="play-error" role="alert">
            {message}
          </p>
        )}

        {status === 'active' && (
          <div className="omok__actions">
            <button type="button" className="button button--text button--danger-text" disabled={busy} onClick={() => setConfirmResign(true)}>
              기권
            </button>
            <button type="button" className="button button--primary" disabled={!selectedValid || busy} onClick={place}>
              {busy ? '두고 있어요' : selectedValid ? '여기에 둘게요' : myTurn ? '둘 곳을 눌러 주세요' : `${nameOf(opp)}님 차례예요`}
            </button>
          </div>
        )}

        {status !== 'active' && status !== 'invited' && (
          <div className="omok__actions">
            <Link to={PLAY_PATH} className="button button--secondary">
              같이 놀기
            </Link>
            <button type="button" className="button button--primary" disabled={busy} onClick={again}>
              {status === 'finished' || status === 'abandoned' ? '한 판 더' : '다시 초대하기'}
            </button>
          </div>
        )}

        {status === 'active' && moveCount > 0 && last && (
          <p className="play-hint">
            {moveCount}수째 · 마지막 수 {stoneOfSeq(last.seq) === 'black' ? '흑' : '백'}
          </p>
        )}
      </main>

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
          <p>{nameOf(opp)}님이 이긴 판으로 끝나요.</p>
        </Dialog>
      )}
      <SyncOpenList game={game} upsert={upsert} />
    </div>
  );
}

/** 판 상태가 바뀌면 진행 중 목록(홈 카드·배너)에도 반영 */
function SyncOpenList({ game, upsert }: { game: Game; upsert: (g: Game) => void }) {
  useEffect(() => {
    upsert(game);
  }, [game, upsert]);
  return null;
}

function PlayersRow({
  game,
  me,
  turnOf,
  nameOf,
}: {
  game: Game;
  me: string;
  turnOf: string | null;
  nameOf: (id: string) => string;
}) {
  const players: [string, 'black' | 'white'][] = [
    [game.black_id, 'black'],
    [game.white_id, 'white'],
  ];
  return (
    <ul className="omok-players" aria-label="두 사람">
      {players.map(([id, stone]) => (
        <li key={id} className={`omok-player${turnOf === id ? ' is-turn' : ''}`}>
          <span className={`omok-stone omok-stone--${stone}`} aria-hidden="true" />
          <span className="omok-player__name">
            {id === me ? '나' : nameOf(id)}
            <span className="sr-only">{stone === 'black' ? ' 흑' : ' 백'}</span>
          </span>
          <span className="omok-player__role">{stone === 'black' ? '먼저' : '나중'}</span>
          {turnOf === id && <span className="sr-only">, 지금 차례</span>}
        </li>
      ))}
    </ul>
  );
}

/** 초대한 사람: 상대 수락을 기다린다 (10분) */
function WaitingRoom({ game, now }: { game: Game; now: Date }) {
  const remaining = inviteRemainingMs(game, now);
  return (
    <div className="omok-waiting">
      <span className="spinner" aria-hidden="true" />
      <p>
        <b className="omok-waiting__time">{formatRemaining(remaining)}</b> 안에 수락하면 시작해요
      </p>
    </div>
  );
}

/** 초대받은 사람: 수락하면 바로 대국 (나는 흑 = 먼저) */
function InvitedActions({ game, myStone, onDone }: { game: Game; myStone: 'black' | 'white'; onDone: () => void }) {
  const { respond, busy, error } = useRespond(onDone);
  return (
    <div className="omok-waiting">
      <p>{myStone === 'black' ? '수락하면 내가 먼저(흑) 둬요' : '수락하면 상대가 먼저(흑) 둬요'}</p>
      <div className="omok__actions">
        <button type="button" className="button button--secondary" disabled={busy} onClick={() => respond(game, false)}>
          다음에 할게요
        </button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => respond(game, true)}>
          한 판 해요
        </button>
      </div>
      {error && (
        <p className="play-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
