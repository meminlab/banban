import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronsUpDown } from 'lucide-react';
import { LEDGER_CREATE_PATH, LEDGER_JOIN_PATH } from '../app/routes';
import { useCurrentLedger, useLedgers } from '../app/ledgers';
import { useLoad } from '../app/useLoad';
import { listMembers } from '../data/member';
import { headerAvatars } from '../domain/ledgers';
import { Sheet } from './Sheet';

/**
 * 상단 왼쪽 가계부 전환 알약 버튼 (design.md 5.6·5.18): [멤버 아바타 묶음] 가계부 이름 ⇕
 * → 아래에서 올라오는 가계부 목록 (전환·새로 만들기·초대코드로 참여)
 */
export function LedgerSwitcher() {
  const current = useCurrentLedger();
  const [open, setOpen] = useState(false);
  const members = useLoad(() => listMembers(current.id), [current.id]).state;
  // 아바타는 장식(멤버를 못 불러와도 이름·전환은 그대로). 가계부를 바꾼 직후 이전 가계부 멤버는 보이지 않게
  const avatars =
    members.status === 'ready' ? headerAvatars(members.data.filter((m) => m.ledger_id === current.id)) : null;

  return (
    <>
      <button
        type="button"
        className="ledger-switch"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`가계부 전환, 지금 보는 가계부: ${current.name}`}
        onClick={() => setOpen(true)}
      >
        <span className="ledger-switch__pill">
          {avatars && avatars.initials.length > 0 && (
            <span className="ledger-switch__avatars" aria-hidden="true">
              {avatars.initials.map((initial, i) => (
                <span key={i} className={`ledger-switch__avatar ledger-switch__avatar--${i + 1}`}>
                  {initial}
                </span>
              ))}
              {avatars.more > 0 && (
                <span className="ledger-switch__avatar ledger-switch__avatar--more">+{avatars.more}</span>
              )}
            </span>
          )}
          <span className="ledger-switch__name">{current.name}</span>
          <ChevronsUpDown className="ledger-switch__caret" size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      </button>
      {open && <LedgerSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function LedgerSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { state, switchTo } = useLedgers();
  if (state.status !== 'ready') return null;

  function choose(id: string) {
    onClose();
    if (id !== (state.status === 'ready' ? state.currentId : null)) switchTo(id);
  }
  function go(path: string) {
    onClose();
    navigate(path);
  }

  return (
    <Sheet title="가계부" onClose={onClose}>
      <ul className="ledger-list" aria-label="내 가계부">
        {state.ledgers.map((l) => {
          const isCurrent = l.id === state.currentId;
          return (
            <li key={l.id}>
              <button
                type="button"
                className={`ledger-list__item${isCurrent ? ' is-current' : ''}`}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => choose(l.id)}
              >
                <span className="ledger-list__text">
                  <span className="ledger-list__name">{l.name}</span>
                  <span className="ledger-list__sub">멤버 {l.memberCount}명</span>
                </span>
                {isCurrent && <span className="badge badge--primary">지금 보는 중</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ledger-list__actions">
        <button type="button" className="button button--secondary button--block" onClick={() => go(LEDGER_CREATE_PATH)}>
          새 가계부 만들기
        </button>
        <button type="button" className="button button--secondary button--block" onClick={() => go(LEDGER_JOIN_PATH)}>
          초대코드로 참여
        </button>
      </div>
    </Sheet>
  );
}
