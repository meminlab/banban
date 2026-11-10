import { ChevronRight, Gamepad2, Ticket, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../app/games';
import { useLedgerId } from '../app/guards';
import { gamePath, PLAY_PATH } from '../app/routes';
import { GameError, inviteGame, respondGame } from '../data/game';
import type { Game } from '../data/types';
import {
  gameName,
  inviteMessage,
  inviteRemainingMs,
  minutesLeftText,
  myOpenGame,
  opponentOf,
  turnMemberId,
  turnText,
  isVsKind,
  type MyOpenGame,
} from '../domain/omok';
import { Dialog } from './Dialog';
import { GameAvatar } from './GameAvatar';

/** 서버 거부·네트워크 오류 문구 (design.md 5.31) */
export function playErrorMessage(e: unknown, nameOf?: (id: string) => string, opponentId?: string): string {
  const opp = opponentId && nameOf ? `${nameOf(opponentId)}님` : '상대';
  if (e instanceof GameError) {
    switch (e.code) {
      case 'GAME_ALREADY_OPEN':
        return '두던 판을 끝내면 새로 둘 수 있어요';
      case 'GAME_OPPONENT_BUSY':
        return `${opp}은 다른 판을 두는 중이에요`;
      case 'GAME_BAD_OPPONENT':
        return '같이 놀 수 없는 멤버예요';
      case 'GAME_NOT_YOUR_TURN':
        return `지금은 ${opp} 차례예요`;
      case 'GAME_CELL_TAKEN':
        return '이미 돌이 있는 자리예요';
      case 'GAME_NOT_ACTIVE':
        return '이미 끝난 판이에요';
      case 'GAME_FORBIDDEN_33':
        return '33이라 둘 수 없어요';
      case 'GAME_DRAW_TOO_SOON':
        return `${opp}이 한 수 둔 뒤에 다시 제안할 수 있어요`;
      case 'GAME_DRAW_PENDING':
        return `${opp} 무승부 제안에 먼저 답해 주세요`;
      case 'GAME_BAD_BET':
        return '내기는 30자까지 쓸 수 있어요';
      case 'GAME_NOT_FOUND':
      case 'NOT_IN_LEDGER':
        return '이 판은 볼 수 없어요';
      default:
        return '요청을 처리하지 못했어요';
    }
  }
  return '연결이 불안정해요. 잠시 후 다시 시도해 주세요';
}

/* 배너 "나중에"·홈 줄 X 로 숨긴 초대 (앱을 켜 둔 동안만 기억. 초대 자체는 남는다) */
const hidden = { banner: new Set<string>(), row: new Set<string>() };
const listeners = new Set<() => void>();
let version = 0;
function hide(kind: 'banner' | 'row', gameId: string) {
  hidden[kind].add(gameId);
  version += 1;
  listeners.forEach((l) => l());
}
function useHiddenVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/**
 * 초대 수락·거절. 수락하면 판 화면(대기실 "둘 다 왔어요")으로 간다.
 * 그사이 10분이 지났으면 확인 창 "초대가 만료됐어요" → [닫기] [○○님 초대하기] (design.md 5.28)
 */
export function useRespond(onDone?: () => void) {
  const navigate = useNavigate();
  const ledgerId = useLedgerId();
  const nameOf = useMemberName();
  const { upsert, refresh } = useGames();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState<Game | null>(null);

  async function respond(game: Game, accept: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await respondGame(game.id, accept);
      upsert({ ...game, status: r.status });
      if (r.status === 'active') navigate(gamePath(game), { state: { justAccepted: true } });
      else if (r.status === 'expired') setExpired(game);
      else if (!r.applied) refresh();
      onDone?.();
    } catch (e) {
      setError(playErrorMessage(e));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function inviteBack(game: Game) {
    setBusy(true);
    try {
      const id = await inviteGame(ledgerId, game.created_by, undefined, { kind: game.kind });
      refresh();
      navigate(gamePath({ id, kind: game.kind }));
    } catch (e) {
      setError(playErrorMessage(e, nameOf, game.created_by));
    } finally {
      setExpired(null);
      setBusy(false);
    }
  }

  const expiredDialog = expired && (
    <Dialog
      title="초대가 만료됐어요"
      onCancel={() => setExpired(null)}
      actions={
        <>
          <button type="button" className="button button--secondary" onClick={() => setExpired(null)}>
            닫기
          </button>
          <button type="button" className="button button--primary" disabled={busy} onClick={() => inviteBack(expired)}>
            {nameOf(expired.created_by)}님 초대하기
          </button>
        </>
      }
    >
      <p>{nameOf(expired.created_by)}님 초대가 10분이 지나 사라졌어요. 이번엔 내가 불러 볼까요?</p>
    </Dialog>
  );

  return { respond, busy, error, expiredDialog };
}

function useMyOpenGame(): MyOpenGame | null {
  const { open, me } = useGames();
  const now = useNow(1000);
  return me ? myOpenGame(open, me, now) : null;
}

/**
 * 내기 상자 (BANB-55, design.md 5.36): 받는 쪽이 수락 전에 본다 · 대기실. 내기가 없으면 그리지 않는다
 */
export function BetBox({ bet, label = '내기' }: { bet: string | null | undefined; label?: string }) {
  if (!bet) return null;
  return (
    <div className="play-bet">
      <Ticket size={20} aria-hidden="true" />
      <span className="play-bet__body">
        <span className="play-bet__label">{label}</span>
        <span className="play-bet__text">{bet}</span>
      </span>
    </div>
  );
}

/** 거절·수락 버튼 줄 (홈 카드·결과 시트) */
export function RespondButtons({ game, onDone }: { game: Game; onDone?: () => void }) {
  const { respond, busy, error, expiredDialog } = useRespond(onDone);
  return (
    <>
      <div className="play-actions">
        <button type="button" className="button button--secondary" disabled={busy} onClick={() => respond(game, false)}>
          다음에 할게요
        </button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => respond(game, true)}>
          좋아요
        </button>
      </div>
      {error && (
        <p className="play-error" role="alert">
          {error}
        </p>
      )}
      {expiredDialog}
    </>
  );
}

/**
 * 앱 안 초대 배너 (design.md 5.28): 받은 초대가 살아 있는 동안 지금 화면 위에 뜬다.
 * [나중에] = 배너만 닫기(초대는 남음) / [같이 놀기] = 수락 → 대기실. 거절은 홈 카드에서만(실수 방지).
 * 홈에서는 맨 위 한 줄 + 카드가 대신 보여 줘서 숨긴다(hidden)
 */
export function PlayInviteBanner({ hidden: hide_ }: { hidden?: boolean }) {
  const mine = useMyOpenGame();
  const { members } = useGames();
  const nameOf = useMemberName();
  const { respond, busy, error, expiredDialog } = useRespond();
  useHiddenVersion();
  if (expiredDialog) return expiredDialog;
  if (hide_ || mine?.kind !== 'invited-me' || hidden.banner.has(mine.game.id)) return null;
  const g = mine.game;
  return (
    <section className="play-banner" role="alert" aria-label={`${gameName(g.kind)} 초대`}>
      <div className="play-banner__head">
        <GameAvatar memberId={g.created_by} members={members} size={32} />
        <div className="play-banner__text">
          <p className="play-banner__title">{inviteMessage(nameOf(g.created_by), g.kind)}</p>
          <p className="play-banner__sub">10분 안에 답해 주세요</p>
        </div>
      </div>
      <BetBox bet={g.bet} />
      <div className="play-actions">
        <button type="button" className="button button--secondary" onClick={() => hide('banner', g.id)}>
          나중에
        </button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => respond(g, true)}>
          같이 놀기
        </button>
      </div>
      {error && (
        <p className="play-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export const PLAY_CARD_ID = 'play-card';

/**
 * 홈 맨 위 한 줄 (design.md 5.28): 받은 초대가 살아 있는 동안. 누르면 홈 카드로 스크롤, X 는 이 줄만 숨김
 */
export function PlayInviteRow() {
  const mine = useMyOpenGame();
  const nameOf = useMemberName();
  useHiddenVersion();
  if (mine?.kind !== 'invited-me' || hidden.row.has(mine.game.id)) return null;
  const g = mine.game;
  return (
    <div className="month-check recurring-row play-row">
      <button
        type="button"
        className="month-check__body recurring-row__body"
        onClick={() => document.getElementById(PLAY_CARD_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      >
        <Gamepad2 size={20} strokeWidth={2} aria-hidden="true" className="play-row__icon" />
        <span className="recurring-row__text">{inviteMessage(nameOf(g.created_by), g.kind)}</span>
        <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label="이 알림 숨기기" onClick={() => hide('row', g.id)}>
        <X size={20} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/** 카드 라벨 줄: Gamepad2 "같이 놀기" + (새로 배지 | ChevronRight) */
function CardLabel({ isNew }: { isNew?: boolean }) {
  return (
    <span className="play-card__label">
      <Gamepad2 size={18} strokeWidth={2} aria-hidden="true" />
      같이 놀기
      {isNew ? <span className="badge badge--primary">새로</span> : <ChevronRight size={20} aria-hidden="true" className="play-card__arrow" />}
    </span>
  );
}

/**
 * 홈 맨 아래 "같이 놀기" (design.md 5.28 + v1.8 5.32): 할 일이 있을 때(초대 보냄 · 초대 받음 · 대국 중)만 3줄 카드,
 * 평소엔 한 줄(52) "같이 놀기 · 오목 · 반반 쌓기" → 미니게임 화면. 멤버가 나 혼자면 숨김.
 */
export function PlayHomeCard() {
  const { me, members, ready } = useGames();
  const mine = useMyOpenGame();
  const nameOf = useMemberName();
  const now = useNow(1000);

  if (!ready || !me) return null;
  const others = members.filter((m) => m.left_at === null && m.id !== me);
  if (others.length === 0) return null;

  if (mine?.kind === 'invited-me') {
    return (
      <section className="play-card" id={PLAY_CARD_ID} aria-label="같이 놀기" data-testid="play-card">
        <CardLabel isNew />
        <p className="play-card__title">{inviteMessage(nameOf(mine.game.created_by), mine.game.kind)}</p>
        <BetBox bet={mine.game.bet} />
        <RespondButtons game={mine.game} />
      </section>
    );
  }

  if (mine) {
    const g = mine.game;
    const opp = nameOf(opponentOf(g, me));
    const vs = isVsKind(g.kind);
    const title =
      mine.kind === 'waiting' ? `${opp}님 답을 기다리고 있어요` : vs ? `${opp}님과 ${gameName(g.kind)} 중` : turnText(g, me, nameOf);
    const sub =
      mine.kind === 'waiting'
        ? `${gameName(g.kind)} · ${minutesLeftText(inviteRemainingMs(g, now))}`
        : vs
          ? '진행 중인 대전이 있어요 · 이어서 하기'
          : '진행 중인 오목이 있어요 · 이어 두기';
    return (
      <Link to={gamePath(g)} className="play-card play-card--link" id={PLAY_CARD_ID} data-testid="play-card">
        <CardLabel />
        <span className={`play-card__title${mine.kind === 'playing' && !vs && turnMemberId(g) === me ? ' is-my-turn' : ''}`}>{title}</span>
        <span className="play-card__sub">{sub}</span>
      </Link>
    );
  }

  // 평소: 한 줄 (정기 내역 제안 줄과 같은 모양, 닫기 X 없음)
  return (
    <div className="month-check recurring-row play-row play-row--home" id={PLAY_CARD_ID} data-testid="play-card">
      <Link to={PLAY_PATH} className="month-check__body recurring-row__body" aria-label="같이 놀기: 오목, 반반 쌓기">
        <Gamepad2 size={20} strokeWidth={2} aria-hidden="true" className="play-row__icon" />
        <span className="recurring-row__text">같이 놀기</span>
        <span className="play-row__hint" aria-hidden="true">
          오목 · 반반 쌓기
        </span>
        <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
      </Link>
    </div>
  );
}
