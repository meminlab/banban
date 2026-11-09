import { ChevronRight, Grid3x3, Info, PiggyBank, Send, Vibrate } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { MEMBERS_PATH, STACK_PATH, omokPath } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { GameAvatar } from '../../components/GameAvatar';
import { PlayInviteBanner, playErrorMessage } from '../../components/PlayInvite';
import { StatusScreen } from '../../components/StatusScreen';
import { SubPageTopbar } from '../../components/SubPageTopbar';
import { inviteGame, listFinishedGames, listStackBests } from '../../data/game';
import { readGameVibrate, saveGameVibrate } from '../../data/gamePrefs';
import { formatWon } from '../../domain/format';
import { formatHeadToHead, headToHead, isBusy, myOpenGame, opponentOf, turnText } from '../../domain/omok';
import { myBest } from '../../domain/stack';

/**
 * 미니게임 화면 (BANB-49 → v1.8, design.md 5.32): 두던 판 → 게임 목록(둘이 같이: 오목 / 혼자서: 반반 쌓기)
 * → 오목 상대 고르기(화면 안 라디오, 멤버 2명이면 미리 골라 둠) → 안내 → "○○님 초대하기" → 대기실 · 진동 설정.
 * 진행 중인 판이 있으면 새 초대는 막는다(한 사람 진행 중 판 1개). 혼자 쓰는 가계부도 반반 쌓기는 할 수 있다.
 */
export function PlayHomePage() {
  const ledgerId = useLedgerId();
  const navigate = useNavigate();
  const { me, members, open, ready, failed, refresh } = useGames();
  const nameOf = useMemberName();
  const now = useNow(1000);
  const finished = useLoad(() => listFinishedGames(ledgerId), [ledgerId]);
  const stackBests = useLoad(() => listStackBests(ledgerId), [ledgerId]);
  const [vibrateOn, setVibrateOn] = useState(readGameVibrate);
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  // 오목 판에서 "나가기"로 왔을 때 한 번 (BANB-53 "판은 그대로 두고 나갈게요"). 새로고침·뒤로가기로 다시 뜨지 않게 state 를 지운다
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const text = (location.state as { playFlash?: string } | null)?.playFlash;
    if (!text) return;
    setFlash(text);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  if (!ready && failed)
    return <StatusScreen kind="error" message="미니게임을 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={refresh} />;
  if (!ready) return <StatusScreen kind="loading" message="미니게임을 불러오고 있어요" />;
  if (!me) return <StatusScreen kind="error" message="이 가계부의 멤버가 아니에요" />;

  const others = members.filter((m) => m.left_at === null && m.id !== me);
  const mine = myOpenGame(open, me, now);
  const selectable = others.filter((m) => !isBusy(open, m.id, now));
  // 고를 수 있는 상대가 1명이면 미리 골라 둔다 (버튼 한 번으로 초대)
  const opponent = picked && selectable.some((m) => m.id === picked) ? picked : selectable.length === 1 ? selectable[0].id : null;
  const records = finished.state.status === 'ready' ? finished.state.data : null;
  // 오목 행 보조 줄 = 전적 (상대가 1명이면 그 사람, 여럿이면 가장 최근 상대). 전적 없으면 설명
  const recent = records?.find((g) => g.black_id === me || g.white_id === me);
  const recordWith = others.length === 1 ? others[0].id : recent ? opponentOf(recent, me) : null;
  const omokRecord = records && recordWith ? headToHead(records, me, recordWith) : null;
  const omokDesc = mine
    ? '두던 판을 끝내면 새로 둘 수 있어요'
    : others.length === 0
      ? '같이 쓰는 멤버가 있어야 해요'
      : null;
  const stackBest = stackBests.state.status === 'ready' ? myBest(stackBests.state.data, me) : null;

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
      <SubPageTopbar title="미니게임" fallback="/" />
      <PlayInviteBanner />
      <main className="content content--no-tabbar play-home">
        {mine && mine.kind !== 'invited-me' && (
          <section className="play-panel" aria-labelledby="play-open-title">
            <p id="play-open-title" className="play-panel__label">
              {mine.kind === 'playing' ? '진행 중인 오목이 있어요' : '두던 판이 있어요'}
            </p>
            <p className="play-panel__title">
              {nameOf(opponentOf(mine.game, me))}님과 오목 ·{' '}
              <span className="is-accent">{mine.kind === 'waiting' ? '답을 기다리는 중' : turnText(mine.game, me, nameOf)}</span>
            </p>
            <Link to={omokPath(mine.game.id)} className="button button--primary button--block play-link-button">
              {mine.kind === 'playing' ? '이어 두기' : '이어서 두기'}
            </Link>
          </section>
        )}

        <section className="play-panel" aria-labelledby="play-duo-title">
          <h2 id="play-duo-title" className="play-section">둘이 같이</h2>
          <ul className="play-games">
            <li className={`play-game${mine || others.length === 0 ? ' is-disabled' : ''}`}>
              <span className="play-game__icon" aria-hidden="true">
                <Grid3x3 size={24} />
              </span>
              <span className="play-game__body">
                <span className="play-game__name">오목</span>
                <span className="play-game__desc">
                  {omokDesc ??
                    (omokRecord && omokRecord.win + omokRecord.loss + omokRecord.draw > 0 && recordWith ? (
                      <>
                        {nameOf(recordWith)}님과 <b>{formatHeadToHead(omokRecord)}</b>
                      </>
                    ) : (
                      '다섯 개를 먼저 이으면 이겨요'
                    ))}
                </span>
              </span>
            </li>
          </ul>
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
        <section className="play-panel" aria-labelledby="play-solo-title">
          <h2 id="play-solo-title" className="play-section">혼자서</h2>
          <ul className="play-games">
            <li>
              <Link to={STACK_PATH} className="play-game play-game--link">
                <span className="play-game__icon" aria-hidden="true">
                  <PiggyBank size={24} />
                </span>
                <span className="play-game__body">
                  <span className="play-game__name">반반 쌓기</span>
                  <span className="play-game__desc">
                    {stackBest !== null ? (
                      <>
                        내 최고 <b>{formatWon(stackBest)}</b>
                      </>
                    ) : (
                      '동전을 쌓아 한 줄씩 저금해요'
                    )}
                  </span>
                </span>
                <ChevronRight size={20} aria-hidden="true" className="play-game__arrow" />
              </Link>
            </li>
          </ul>
        </section>
        <section className="play-panel" aria-label="진동">
          <label className="switch-row">
            <Vibrate size={20} strokeWidth={2} aria-hidden="true" />
            <span className="switch-row__text">
              <span className="switch-row__label">진동</span>
              <span className="switch-row__sub" id="play-vibrate-sub">
                줄을 저금하거나 끝날 때 짧게 울려요
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={vibrateOn}
              aria-describedby="play-vibrate-sub"
              onChange={(e) => {
                setVibrateOn(e.target.checked);
                saveGameVibrate(e.target.checked);
              }}
            />
          </label>
        </section>
      </main>
      {flash && (
        <p className="toast toast--no-tabbar" role="status">
          {flash}
        </p>
      )}
    </div>
  );
}
