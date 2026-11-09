import { Grid3x3, Info, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { MEMBERS_PATH, omokPath } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { GameAvatar } from '../../components/GameAvatar';
import { PlayInviteBanner, playErrorMessage } from '../../components/PlayInvite';
import { StatusScreen } from '../../components/StatusScreen';
import { SubPageTopbar } from '../../components/SubPageTopbar';
import { inviteGame, listFinishedGames } from '../../data/game';
import { formatHeadToHead, headToHead, isBusy, myOpenGame, opponentOf, turnText } from '../../domain/omok';

/**
 * 같이 놀기 화면 (BANB-49, design.md 5.28): 두던 판 → 게임(1차 오목) → 상대 고르기(화면 안 라디오, 멤버 2명이면 미리 골라 둠)
 * → 안내 → 전적 → "○○님 초대하기" → 대기실. 진행 중인 판이 있으면 새 초대는 막는다(한 사람 진행 중 판 1개).
 */
export function PlayHomePage() {
  const ledgerId = useLedgerId();
  const navigate = useNavigate();
  const { me, members, open, ready, failed, refresh } = useGames();
  const nameOf = useMemberName();
  const now = useNow(1000);
  const finished = useLoad(() => listFinishedGames(ledgerId), [ledgerId]);
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready && failed)
    return <StatusScreen kind="error" message="같이 놀기를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={refresh} />;
  if (!ready) return <StatusScreen kind="loading" message="같이 놀기를 불러오고 있어요" />;
  if (!me) return <StatusScreen kind="error" message="이 가계부의 멤버가 아니에요" />;

  const others = members.filter((m) => m.left_at === null && m.id !== me);
  const mine = myOpenGame(open, me, now);
  const selectable = others.filter((m) => !isBusy(open, m.id, now));
  // 고를 수 있는 상대가 1명이면 미리 골라 둔다 (버튼 한 번으로 초대)
  const opponent = picked && selectable.some((m) => m.id === picked) ? picked : selectable.length === 1 ? selectable[0].id : null;
  const records = finished.state.status === 'ready' ? finished.state.data : null;

  async function send() {
    if (!opponent || mine || sending) return;
    setSending(true);
    setError(null);
    try {
      const id = await inviteGame(ledgerId, opponent);
      refresh();
      navigate(omokPath(id));
    } catch (e) {
      setError(playErrorMessage(e, nameOf, opponent));
      refresh();
      setSending(false);
    }
  }

  return (
    <div className="shell">
      <SubPageTopbar title="같이 놀기" fallback="/" />
      <PlayInviteBanner />
      <main className="content content--no-tabbar play-home">
        {mine && mine.kind !== 'invited-me' && (
          <section className="play-panel" aria-labelledby="play-open-title">
            <p id="play-open-title" className="play-panel__label">
              두던 판이 있어요
            </p>
            <p className="play-panel__title">
              {nameOf(opponentOf(mine.game, me))}님과 오목 ·{' '}
              <span className="is-accent">{mine.kind === 'waiting' ? '답을 기다리는 중' : turnText(mine.game, me, nameOf)}</span>
            </p>
            <Link to={omokPath(mine.game.id)} className="button button--primary button--block play-link-button">
              이어서 두기
            </Link>
          </section>
        )}

        <section className="play-panel" aria-label="게임">
          <div className={`play-game${mine ? ' is-disabled' : ''}`}>
            <span className="play-game__icon" aria-hidden="true">
              <Grid3x3 size={24} />
            </span>
            <span className="play-game__body">
              <span className="play-game__name">오목</span>
              <span className="play-game__desc">{mine ? '두던 판을 끝내면 새로 둘 수 있어요' : '다섯 개를 먼저 이으면 이겨요'}</span>
            </span>
          </div>
        </section>

        {others.length === 0 && (
          <section className="play-panel play-empty">
            <p>같이 놀 멤버가 아직 없어요. 가계부에 초대해 보세요.</p>
            <Link to={MEMBERS_PATH} className="button button--secondary button--small">
              멤버·초대
            </Link>
          </section>
        )}

        {!mine && others.length > 0 && (
          <section className="play-panel" aria-labelledby="play-opponent-title">
            <h2 id="play-opponent-title" className="play-panel__label">
              누구랑 둘까요?
            </h2>
            <div role="radiogroup" aria-labelledby="play-opponent-title" className="play-opponents">
              {others.map((m) => {
                const busy = isBusy(open, m.id, now);
                const record = records ? formatHeadToHead(headToHead(records, me, m.id)) : '';
                return (
                  <label key={m.id} className={`play-opponent${busy ? ' is-busy' : ''}`}>
                    <input
                      type="radio"
                      name="opponent"
                      value={m.id}
                      checked={opponent === m.id}
                      disabled={busy}
                      onChange={() => setPicked(m.id)}
                    />
                    <span className="play-opponent__radio" aria-hidden="true" />
                    <GameAvatar memberId={m.id} members={members} size={32} dim={busy} />
                    <span className="play-opponent__body">
                      <span className="play-opponent__name">{m.display_name}</span>
                      <span className="play-opponent__sub">{busy ? '다른 판을 두는 중이에요' : record}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="notice-box">
              <Info size={16} aria-hidden="true" />
              <span>
                초대받은 사람이 흑으로 먼저 둬요.
                <br />
                10분 안에 답이 없으면 초대가 사라져요.
              </span>
            </p>
          </section>
        )}

        {others.length > 0 && (
          <section className="play-panel" aria-labelledby="play-record-title">
            <h2 id="play-record-title" className="play-panel__label">
              전적
            </h2>
            {finished.state.status === 'error' ? (
              <p className="play-help">전적을 불러오지 못했어요</p>
            ) : (
              <ul className="play-records">
                {others.map((m) => (
                  <li key={m.id} className="play-record">
                    <GameAvatar memberId={m.id} members={members} size={32} />
                    <span className="play-record__name">{m.display_name}님과</span>
                    <b className="play-record__value">{records ? formatHeadToHead(headToHead(records, me, m.id)) : ''}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {error && (
          <p className="play-error" role="alert">
            {error}
          </p>
        )}
        {!mine && others.length > 0 && (
          <button type="button" className="button button--primary button--block play-send" disabled={!opponent || sending} onClick={send}>
            <Send size={18} aria-hidden="true" />
            {sending ? '보내고 있어요' : opponent ? `${nameOf(opponent)}님 초대하기` : selectable.length === 0 ? '모두 다른 판을 두는 중이에요' : '상대를 골라 주세요'}
          </button>
        )}
      </main>
    </div>
  );
}
