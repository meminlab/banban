import { ChevronRight, Grid3x3, Nut, PiggyBank, Receipt, Swords, Vibrate } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../../app/games';
import { useLedgerId } from '../../app/guards';
import { MEMBERS_PATH, STACK_PATH, TEN_PATH, gamePath } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { PlayInviteBanner } from '../../components/PlayInvite';
import { PlayInviteSheet } from '../../components/PlayInviteSheet';
import { StatusScreen } from '../../components/StatusScreen';
import { SubPageTopbar } from '../../components/SubPageTopbar';
import { listFinishedGames, listStackBests, listTenBests } from '../../data/game';
import type { GameKind } from '../../data/types';
import { readGameVibrate, saveGameVibrate } from '../../data/gamePrefs';
import { formatHeadToHead, gameName, headToHead, isVsKind, myOpenGame, opponentOf, turnText } from '../../domain/omok';
import { formatPoints, myBest } from '../../domain/stack';
import { myTenBest, points } from '../../domain/ten';

/**
 * 미니게임 화면 (BANB-49 → v1.8 → v1.9 → v1.10, design.md 5.32·5.36·5.42): 두던 판 → 게임 목록
 * (둘이 같이: 오목 · 반반 쌓기 대전 · 도토리 열 알 대전 / 혼자서: 반반 쌓기 · 도토리 열 알) · 진동 설정.
 * 둘이 하는 게임 행을 누르면 상대 고르기 시트(멤버 2명이면 미리 골라 둠, 대전은 내기 걸기) → "○○님 초대하기" → 대기실.
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
  const tenBests = useLoad(() => listTenBests(ledgerId), [ledgerId]);
  const [vibrateOn, setVibrateOn] = useState(readGameVibrate);
  const [sheet, setSheet] = useState<GameKind | null>(null);
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
  const records = finished.state.status === 'ready' ? finished.state.data : null;
  // 행 보조 줄 = 그 게임 전적 (상대가 1명이면 그 사람, 여럿이면 그 게임의 가장 최근 상대). 전적 없으면 설명
  function recordLine(kind: GameKind) {
    const recent = records?.find((g) => (g.kind ?? 'omok') === kind && (g.black_id === me || g.white_id === me));
    const withId = others.length === 1 ? others[0].id : recent && me ? opponentOf(recent, me) : null;
    const r = records && withId && me ? headToHead(records, me, withId, kind) : null;
    if (!r || !withId || r.win + r.loss + r.draw === 0) return null;
    return (
      <>
        {nameOf(withId)}님과 <b>{isVsKind(kind) ? `${r.win}승 ${r.loss}패${r.draw > 0 ? ` ${r.draw}무` : ''}` : formatHeadToHead(r)}</b>
      </>
    );
  }
  const duoBlocked = mine ? '두던 판을 끝내면 새로 할 수 있어요' : others.length === 0 ? '같이 쓰는 멤버가 있어야 해요' : null;
  const stackBest = stackBests.state.status === 'ready' ? myBest(stackBests.state.data, me) : null;
  const tenBest = tenBests.state.status === 'ready' ? myTenBest(tenBests.state.data, me) : null;
  const duoGames: { kind: GameKind; icon: ReactNode; desc: string }[] = [
    { kind: 'omok', icon: <Grid3x3 size={24} />, desc: '다섯 개를 먼저 이으면 이겨요' },
    { kind: 'stack_vs', icon: <Receipt size={24} />, desc: '줄을 지워 영수증을 보내요' },
    { kind: 'ten_vs', icon: <Swords size={24} />, desc: '같은 판으로 2분 동안 겨뤄요' },
  ];

  return (
    <div className="shell">
      <SubPageTopbar title="미니게임" fallback="/" />
      <PlayInviteBanner />
      <main className="content content--no-tabbar play-home">
        {mine && mine.kind !== 'invited-me' && (
          <section className="play-panel" aria-labelledby="play-open-title">
            <p id="play-open-title" className="play-panel__label">
              {mine.kind === 'playing' ? `진행 중인 ${gameName(mine.game.kind)}이 있어요` : '두던 판이 있어요'}
            </p>
            <p className="play-panel__title">
              {nameOf(opponentOf(mine.game, me))}님과 {gameName(mine.game.kind)} ·{' '}
              <span className="is-accent">
                {mine.kind === 'waiting' ? '답을 기다리는 중' : isVsKind(mine.game.kind) ? '대전 중' : turnText(mine.game, me, nameOf)}
              </span>
            </p>
            <Link to={gamePath(mine.game)} className="button button--primary button--block play-link-button">
              {isVsKind(mine.game.kind) ? '이어서 하기' : mine.kind === 'playing' ? '이어 두기' : '이어서 두기'}
            </Link>
          </section>
        )}

        <section className="play-panel" aria-labelledby="play-duo-title">
          <h2 id="play-duo-title" className="play-section">둘이 같이</h2>
          <ul className="play-games">
            {duoGames.map((d) => (
              <li key={d.kind}>
                <button
                  type="button"
                  className={`play-game play-game--link${duoBlocked ? ' is-disabled' : ''}`}
                  disabled={!!duoBlocked}
                  onClick={() => setSheet(d.kind)}
                >
                  <span className="play-game__icon" aria-hidden="true">
                    {d.icon}
                  </span>
                  <span className="play-game__body">
                    <span className="play-game__name">{gameName(d.kind)}</span>
                    <span className="play-game__desc">{duoBlocked ?? recordLine(d.kind) ?? d.desc}</span>
                  </span>
                  <ChevronRight size={20} aria-hidden="true" className="play-game__arrow" />
                </button>
              </li>
            ))}
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
                        내 최고 <b>{formatPoints(stackBest)}</b>
                      </>
                    ) : (
                      '동전을 쌓아 한 줄씩 지워요'
                    )}
                  </span>
                </span>
                <ChevronRight size={20} aria-hidden="true" className="play-game__arrow" />
              </Link>
            </li>
            <li>
              <Link to={TEN_PATH} className="play-game play-game--link">
                <span className="play-game__icon" aria-hidden="true">
                  <Nut size={24} />
                </span>
                <span className="play-game__body">
                  <span className="play-game__name">도토리 열 알</span>
                  <span className="play-game__desc">
                    {tenBest !== null ? (
                      <>
                        내 최고 <b>{points(tenBest)}</b>
                      </>
                    ) : (
                      '합이 10이 되게 도토리를 묶어요'
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
                줄을 지우거나 도토리를 모을 때 짧게 울려요
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
      {sheet && !mine && <PlayInviteSheet kind={sheet} finished={records} onClose={() => setSheet(null)} />}
      {flash && (
        <p className="toast toast--no-tabbar" role="status">
          {flash}
        </p>
      )}
    </div>
  );
}
