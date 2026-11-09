import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { MEMBERS_PATH, omokPath } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { PlayInviteBanner, playErrorMessage } from '../../components/PlayInvite';
import { StatusScreen } from '../../components/StatusScreen';
import { SubPageTopbar } from '../../components/SubPageTopbar';
import { inviteGame, listFinishedGames } from '../../data/game';
import { formatHeadToHead, gameHeadline, headToHead, isBusy, myOpenGame } from '../../domain/omok';

/**
 * 같이 놀기 홈 (BANB-49): 게임 고르기(1차는 오목만) → 상대 고르기(같은 가계부 멤버, 전적 1줄) → 초대 보내기 → 대기실.
 * 진행 중인 판이 있으면 그 판으로 가는 줄을 맨 위에 보여 주고 새 초대는 막는다(한 사람 진행 중 판 1개).
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
  // 한 명뿐이면 미리 고른다
  const opponent = picked ?? (others.length === 1 ? others[0].id : null);
  const opponentBusy = opponent ? isBusy(open, opponent, now) : false;
  const canInvite = !mine && opponent !== null && !opponentBusy && !sending;

  async function send() {
    if (!opponent || !canInvite) return;
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
      <main className="content content--no-tabbar play-home">
        <PlayInviteBanner />

        {mine && mine.kind !== 'invited-me' && (
          <Link to={omokPath(mine.game.id)} className="play-card play-card--link">
            <span className="play-card__body">
              <span className="play-card__label">진행 중인 판</span>
              <span className="play-card__title">{gameHeadline(mine.game, me, now, nameOf)}</span>
            </span>
            <ChevronRight size={20} aria-hidden="true" />
          </Link>
        )}

        <section aria-labelledby="play-game-title" className="play-section">
          <h2 id="play-game-title" className="play-section__title">
            게임
          </h2>
          <div className="play-game is-selected" aria-current="true">
            <span className="play-game__stones" aria-hidden="true">
              <span className="omok-stone omok-stone--black" />
              <span className="omok-stone omok-stone--white" />
            </span>
            <span className="play-game__body">
              <span className="play-game__name">오목</span>
              <span className="play-game__desc">다섯 개를 먼저 이으면 이겨요</span>
            </span>
          </div>
        </section>

        <section aria-labelledby="play-opponent-title" className="play-section">
          <h2 id="play-opponent-title" className="play-section__title">
            누구와 할까요?
          </h2>
          {others.length === 0 ? (
            <div className="play-empty">
              <p>같이 놀 멤버가 아직 없어요. 가계부에 초대해 보세요.</p>
              <Link to={MEMBERS_PATH} className="button button--secondary button--small">
                멤버·초대
              </Link>
            </div>
          ) : (
            <div role="radiogroup" aria-labelledby="play-opponent-title" className="play-opponents">
              {others.map((m) => {
                const busy = isBusy(open, m.id, now);
                const record =
                  finished.state.status === 'ready' ? formatHeadToHead(headToHead(finished.state.data, me, m.id)) : null;
                return (
                  <label key={m.id} className={`play-opponent${opponent === m.id ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="opponent"
                      value={m.id}
                      checked={opponent === m.id}
                      onChange={() => setPicked(m.id)}
                    />
                    <span className="play-opponent__name">{m.display_name}</span>
                    <span className="play-opponent__sub">
                      {busy ? '다른 판을 하고 있어요' : (record ?? (finished.state.status === 'error' ? '전적을 불러오지 못했어요' : ''))}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {error && (
          <p className="play-error" role="alert">
            {error}
          </p>
        )}
        {others.length > 0 && (
          <button type="button" className="button button--primary button--block" disabled={!canInvite} onClick={send}>
            {sending ? '보내고 있어요' : '초대 보내기'}
          </button>
        )}
        {mine && <p className="play-hint">진행 중인 판이 끝나면 새로 초대할 수 있어요</p>}
        {!mine && opponentBusy && opponent && <p className="play-hint">{nameOf(opponent)}님의 판이 끝나면 초대할 수 있어요</p>}
      </main>
    </div>
  );
}
