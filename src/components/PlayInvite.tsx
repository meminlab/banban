import { ChevronRight, Gamepad2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../app/games';
import { omokPath, PLAY_PATH } from '../app/routes';
import { GameError, respondGame } from '../data/game';
import type { Game } from '../data/types';
import {
  formatRemaining,
  gameHeadline,
  inviteMessage,
  inviteRemainingMs,
  myOpenGame,
  type MyOpenGame,
} from '../domain/omok';

/** 서버 거부·네트워크 오류 문구 */
export function playErrorMessage(e: unknown, nameOf?: (id: string) => string, opponentId?: string): string {
  if (e instanceof GameError) {
    switch (e.code) {
      case 'GAME_ALREADY_OPEN':
        return '이미 진행 중인 판이 있어요';
      case 'GAME_OPPONENT_BUSY':
        return `${opponentId && nameOf ? `${nameOf(opponentId)}님은` : '상대가'} 다른 판을 하고 있어요`;
      case 'GAME_BAD_OPPONENT':
        return '같이 놀 수 없는 멤버예요';
      case 'GAME_NOT_YOUR_TURN':
        return '아직 내 차례가 아니에요';
      case 'GAME_CELL_TAKEN':
        return '이미 돌이 있는 칸이에요';
      case 'GAME_NOT_ACTIVE':
        return '이미 끝난 판이에요';
      case 'GAME_NOT_FOUND':
      case 'NOT_IN_LEDGER':
        return '판을 찾을 수 없어요';
      default:
        return '요청을 처리하지 못했어요';
    }
  }
  return '연결이 불안정해요. 잠시 후 다시 시도해 주세요';
}

/** 초대 수락·거절. 수락하면 판 화면으로 간다. 만료됐으면 알려 준다 */
export function useRespond(onDone?: () => void) {
  const navigate = useNavigate();
  const { upsert, refresh } = useGames();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(game: Game, accept: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await respondGame(game.id, accept);
      upsert({ ...game, status: r.status });
      if (r.status === 'active') navigate(omokPath(game.id));
      else if (r.status === 'expired') setError('초대가 만료됐어요');
      else if (!r.applied) refresh();
      onDone?.();
    } catch (e) {
      setError(playErrorMessage(e));
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return { respond, busy, error };
}

function useMyOpenGame(): MyOpenGame | null {
  const { open, me } = useGames();
  const now = useNow(1000);
  return me ? myOpenGame(open, me, now) : null;
}

/** 수락·거절 버튼 줄 */
function RespondButtons({ game }: { game: Game }) {
  const { respond, busy, error } = useRespond();
  return (
    <>
      <div className="play-invite__actions">
        <button type="button" className="button button--secondary button--small" disabled={busy} onClick={() => respond(game, false)}>
          다음에 할게요
        </button>
        <button type="button" className="button button--primary button--small" disabled={busy} onClick={() => respond(game, true)}>
          한 판 해요
        </button>
      </div>
      {error && (
        <p className="play-invite__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * 앱 안 초대 배너 (탭 화면 위). 나를 초대한 판이 있을 때만. 홈에서는 같이 놀기 카드가 같은 내용을 보여 줘서 숨긴다
 */
export function PlayInviteBanner({ hidden }: { hidden?: boolean }) {
  const mine = useMyOpenGame();
  const nameOf = useMemberName();
  if (hidden || mine?.kind !== 'invited-me') return null;
  return (
    <section className="play-invite" aria-live="polite" aria-label="오목 초대">
      <p className="play-invite__text">
        <Gamepad2 size={20} aria-hidden="true" className="play-invite__icon" />
        {inviteMessage(nameOf(mine.game.created_by))}
      </p>
      <RespondButtons game={mine.game} />
    </section>
  );
}

/**
 * 홈 "같이 놀기" 카드: 초대 받음(수락/거절) / 기다리는 중(남은 시간) / 대국 중(누구 차례) / 평소(오목 한 판 할까요?)
 */
export function PlayHomeCard() {
  const { me, ready } = useGames();
  const mine = useMyOpenGame();
  const nameOf = useMemberName();
  const now = useNow(1000);
  if (!ready || !me) return null;

  if (mine?.kind === 'invited-me') {
    return (
      <section className="play-card" aria-label="같이 놀기" data-testid="play-card">
        <p className="play-card__title">{inviteMessage(nameOf(mine.game.created_by))}</p>
        <RespondButtons game={mine.game} />
      </section>
    );
  }
  if (mine) {
    const line =
      mine.kind === 'waiting'
        ? `${gameHeadline(mine.game, me, now, nameOf)} · ${formatRemaining(inviteRemainingMs(mine.game, now))}`
        : `오목 두는 중 · ${gameHeadline(mine.game, me, now, nameOf)}`;
    return (
      <Link to={omokPath(mine.game.id)} className="play-card play-card--link" data-testid="play-card">
        <span className="play-card__body">
          <span className="play-card__label">같이 놀기</span>
          <span className="play-card__title">{line}</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </Link>
    );
  }
  return (
    <Link to={PLAY_PATH} className="play-card play-card--link" data-testid="play-card">
      <span className="play-card__body">
        <span className="play-card__label">같이 놀기</span>
        <span className="play-card__title">오목 한 판 할까요?</span>
      </span>
      <ChevronRight size={20} aria-hidden="true" />
    </Link>
  );
}
