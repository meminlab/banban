import { Info, Send, Ticket } from 'lucide-react';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGames, useMemberName, useNow } from '../app/games';
import { useLedgerId } from '../app/guards';
import { gamePath } from '../app/routes';
import { inviteGame } from '../data/game';
import type { Game, GameKind } from '../data/types';
import { formatHeadToHead, headToHead, isBusy } from '../domain/omok';
import { BET_MAX, betLength, clampBet, normalizeBet } from '../domain/stackVs';
import { GameAvatar } from './GameAvatar';
import { playErrorMessage } from './PlayInvite';
import { Sheet } from './Sheet';

/**
 * 상대 고르기 시트 (design.md 5.28 · 5.36): 미니게임 화면의 오목 / 반반 쌓기 대전 행, 대전 결과의 "한 판 더".
 * 다른 판(오목 포함)을 하는 멤버는 고를 수 없다(1인 1판). 고를 수 있는 상대가 1명이면 미리 골라 둔다.
 * 반반 쌓기 대전은 내기 걸기(선택, 1~30자)를 함께 보낸다.
 */
export function PlayInviteSheet({
  kind,
  finished,
  onClose,
  rematchOf,
  initialBet,
}: {
  kind: GameKind;
  /** 끝난 판 (전적 보조 줄). 불러오기 전이면 null */
  finished: readonly Game[] | null;
  onClose: () => void;
  /** "한 판 더": 앞 판 (상대는 그 판의 상대로 고정) */
  rematchOf?: Game;
  initialBet?: string | null;
}) {
  const navigate = useNavigate();
  const ledgerId = useLedgerId();
  const nameOf = useMemberName();
  const { me, members, open, refresh } = useGames();
  const now = useNow(1000);
  const [picked, setPicked] = useState<string | null>(null);
  const [bet, setBet] = useState(() => clampBet(initialBet ?? ''));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const betId = useId();
  const vs = kind === 'stack_vs';

  if (!me) return null;
  const fixed = rematchOf ? (rematchOf.black_id === me ? rematchOf.white_id : rematchOf.black_id) : null;
  const others = members.filter((m) => m.left_at === null && m.id !== me && (!fixed || m.id === fixed));
  const selectable = others.filter((m) => !isBusy(open, m.id, now));
  const opponent = picked && selectable.some((m) => m.id === picked) ? picked : selectable.length === 1 ? selectable[0].id : null;
  const recordText = (id: string) => {
    if (!finished) return '';
    const r = headToHead(finished, me, id, kind);
    if (r.win + r.loss + r.draw === 0) return vs ? '처음 하는 대전이에요' : formatHeadToHead(r);
    return vs ? `${r.win}승 ${r.loss}패` : formatHeadToHead(r);
  };

  async function send() {
    if (!opponent || sending) return;
    setSending(true);
    setError(null);
    try {
      const id = await inviteGame(ledgerId, opponent, rematchOf?.id, { kind, bet: vs ? normalizeBet(bet) : null });
      refresh();
      navigate(gamePath({ id, kind }), { replace: !!rematchOf });
    } catch (e) {
      setError(playErrorMessage(e, nameOf, opponent));
      refresh();
      setSending(false);
    }
  }

  return (
    <Sheet title={vs ? '누구랑 할까요?' : '누구랑 둘까요?'} onClose={onClose}>
      <div className="play-invite-sheet">
        <div role="radiogroup" aria-labelledby={titleId} className="play-opponents">
          <span id={titleId} className="sr-only">
            상대
          </span>
          {others.map((m) => {
            const busy = isBusy(open, m.id, now);
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
                  <span className="play-opponent__sub">{busy ? (vs ? '다른 판을 하는 중이에요' : '다른 판을 두는 중이에요') : recordText(m.id)}</span>
                </span>
              </label>
            );
          })}
        </div>

        {vs && (
          <div className="play-bet-field">
            <label htmlFor={betId} className="play-bet-field__label">
              <Ticket size={16} aria-hidden="true" />
              내기 걸기 <span className="play-bet-field__hint">(안 써도 돼요)</span>
            </label>
            <div className="play-bet-field__box">
              <input
                id={betId}
                className="input"
                type="text"
                value={bet}
                placeholder="예: 진 사람이 설거지"
                autoComplete="off"
                enterKeyHint="send"
                onChange={(e) => setBet(clampBet(e.target.value))}
                aria-describedby={`${betId}-count`}
              />
              <span id={`${betId}-count`} className="play-bet-field__count" aria-label={`${betLength(bet)}자, 최대 ${BET_MAX}자`}>
                {betLength(bet)}/{BET_MAX}
              </span>
            </div>
          </div>
        )}

        <p className="notice-box">
          <Info size={16} aria-hidden="true" />
          <span>
            {vs ? '줄을 지우면 상대 판에 영수증이 올라가요.' : '초대받은 사람이 흑으로 먼저 둬요.'}
            <br />
            10분 안에 답이 없으면 초대가 사라져요.
          </span>
        </p>
        {error && (
          <p className="play-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="button button--primary button--block play-send" disabled={!opponent || sending} onClick={send}>
          <Send size={18} aria-hidden="true" />
          {sending
            ? '보내고 있어요'
            : opponent
              ? `${nameOf(opponent)}님 초대하기`
              : selectable.length === 0
                ? `모두 다른 판을 ${vs ? '하는' : '두는'} 중이에요`
                : '상대를 골라 주세요'}
        </button>
      </div>
    </Sheet>
  );
}
