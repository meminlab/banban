import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BookPlus, ChevronRight, Ticket } from 'lucide-react';
import { useCurrentUser } from '../../app/auth';
import { useLedgers } from '../../app/ledgers';
import {
  LEDGER_CREATE_PATH,
  LEDGER_JOIN_PATH,
  LEDGER_MANAGE_PATH,
  SETTINGS_PATH,
  ledgerManageDetailPath,
} from '../../app/routes';
import { Dialog } from '../../components/Dialog';
import { SubPageTopbar } from '../../components/SubPageTopbar';
import { leaveLedger } from '../../data/ledger';
import { formatLedgerCreatedDate, ledgerInitial, ledgerSubLine } from '../../domain/ledgers';
import { USER_LEDGER_LIMIT_FALLBACK, ledgerLimitMessage } from '../../lib/ledgerRules';

/** 상세에서 나간 뒤 목록으로 돌아올 때 알려 줄 결과 (location.state.manageFlash) */
interface ManageFlashState {
  manageFlash?: { left: string };
}

/**
 * 설정 › 가계부 관리 (design.md 5.18): 내 가계부 전체 목록 + 새로 만들기 / 코드로 참여.
 * 행을 누르면 상세(전환·나가기). 만들기·참여는 기존 화면(/ledgers/new, /ledgers/join)으로 연결한다.
 */
export function LedgerManagePage() {
  const user = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useLedgers();
  const [toast, setToast] = useState<string | null>(() => {
    const left = (location.state as ManageFlashState | null)?.manageFlash?.left;
    return left ? `'${left}'에서 나갔어요` : null;
  });

  // 알림은 한 번만: 보여 준 뒤 history state 를 비워 새로고침·뒤로가기로 다시 뜨지 않게 한다
  useEffect(() => {
    if ((location.state as ManageFlashState | null)?.manageFlash) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // RequireLedger 안이라 여기 올 때는 항상 ready
  if (state.status !== 'ready') return null;
  const { ledgers, currentId } = state;
  const limit = USER_LEDGER_LIMIT_FALLBACK;
  const isFull = ledgers.length >= limit;

  return (
    <div className="shell shell--settings">
      <SubPageTopbar title="가계부 관리" fallback={SETTINGS_PATH} />
      <main className="content content--no-tabbar settings ledger-manage">
        <section aria-labelledby="ledger-manage-title">
          <h2 id="ledger-manage-title" className="ledger-manage__head">
            내 가계부 <span className="ledger-manage__count">{ledgers.length}/{limit}</span>
          </h2>
          <ul className="menu-list ledger-manage__list">
            {ledgers.map((l) => {
              const isCurrent = l.id === currentId;
              return (
                <li key={l.id}>
                  <Link
                    to={ledgerManageDetailPath(l.id)}
                    className="ledger-row"
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <span className="ledger-row__initial" aria-hidden="true">
                      {ledgerInitial(l.name)}
                    </span>
                    <span className="ledger-row__text">
                      <span className="ledger-row__name">{l.name}</span>
                      <span className="ledger-row__sub">{ledgerSubLine(l, user.id)}</span>
                    </span>
                    {isCurrent && <span className="badge badge--primary">지금 보는 중</span>}
                    <ChevronRight className="ledger-row__chevron" size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="ledger-manage__actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={isFull}
            aria-describedby={isFull ? 'ledger-manage-full' : undefined}
            onClick={() => navigate(LEDGER_CREATE_PATH)}
          >
            <BookPlus size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
            새로 만들기
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={isFull}
            aria-describedby={isFull ? 'ledger-manage-full' : undefined}
            onClick={() => navigate(LEDGER_JOIN_PATH)}
          >
            <Ticket size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
            코드로 참여
          </button>
        </div>
        {isFull ? (
          <p id="ledger-manage-full" className="ledger-manage__hint">
            {ledgerLimitMessage(limit)}
          </p>
        ) : (
          <p className="ledger-manage__hint">가계부는 1인 최대 {limit}개. 나가기는 각 가계부를 눌러서.</p>
        )}
        <p className="toast" role="status" aria-live="polite">
          {toast}
        </p>
      </main>
    </div>
  );
}

/** 설정 › 가계부 관리 › 가계부 상세: 이름·멤버 수·만든 날 + 이 가계부로 전환 + 가계부 나가기 */
export function LedgerManageDetailPage() {
  const { ledgerId = '' } = useParams();
  const navigate = useNavigate();
  const { state, switchTo, reload } = useLedgers();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (state.status !== 'ready') return null;
  const ledger = state.ledgers.find((l) => l.id === ledgerId);
  // 없는 가계부(주소를 직접 쳤거나 이미 나감)는 목록으로. 나가는 중에는 아래 leave() 가 직접 옮긴다
  if (!ledger) return busy ? null : <Navigate to={LEDGER_MANAGE_PATH} replace />;
  const isCurrent = ledger.id === state.currentId;
  const name = ledger.name;
  const isLastMember = ledger.memberCount <= 1;

  function switchHere() {
    switchTo(ledgerId);
    navigate('/');
  }

  async function leave() {
    setBusy(true);
    setError(false);
    try {
      await leaveLedger(ledgerId);
      setConfirming(false);
      // 남은 가계부 중 마지막으로 본 곳 → 가장 최근에 참여한 곳으로. 하나도 없으면 시작 화면 (RequireLedger 가 보낸다)
      await reload();
      navigate(LEDGER_MANAGE_PATH, { replace: true, state: { manageFlash: { left: name } } satisfies ManageFlashState });
    } catch {
      setError(true);
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="shell shell--settings">
      <SubPageTopbar title="가계부 정보" fallback={LEDGER_MANAGE_PATH} />
      <main className="content content--no-tabbar settings ledger-manage">
        <section className="ledger-detail" aria-labelledby="ledger-detail-name">
          <span className="ledger-row__initial ledger-detail__initial" aria-hidden="true">
            {ledgerInitial(name)}
          </span>
          <h2 id="ledger-detail-name" className="ledger-detail__name">
            {name}
          </h2>
          {isCurrent && <span className="badge badge--primary">지금 보는 중</span>}
          <dl className="ledger-detail__facts">
            <div>
              <dt>멤버</dt>
              <dd>{ledger.memberCount}명</dd>
            </div>
            <div>
              <dt>만든 날</dt>
              <dd>{formatLedgerCreatedDate(ledger.createdAt)}</dd>
            </div>
          </dl>
        </section>

        <div className="ledger-manage__detail-actions">
          {!isCurrent && (
            <button type="button" className="button button--primary button--block" onClick={switchHere} disabled={busy}>
              이 가계부로 전환
            </button>
          )}
          {error && (
            <p className="form-error" role="alert">
              나가지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
            </p>
          )}
          <button
            type="button"
            className="button button--danger-outline button--block"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            가계부 나가기
          </button>
        </div>

        {confirming && (
          <Dialog
            title={`'${name}'에서 나갈까요?`}
            onCancel={busy ? undefined : () => setConfirming(false)}
            actions={
              <>
                <button type="button" className="button button--secondary" onClick={() => setConfirming(false)} disabled={busy}>
                  취소
                </button>
                <button type="button" className="button button--danger" onClick={leave} disabled={busy}>
                  {busy ? '나가는 중…' : '나가기'}
                </button>
              </>
            }
          >
            <p className="dialog__body">
              가계부에서 나가면 이 가계부를 더 이상 볼 수 없어요. 내가 기록한 내역은 그대로 남아요.
              {isLastMember && ' 마지막 멤버라서 나가면 가계부가 보관되고 아무도 볼 수 없어요.'}
            </p>
          </Dialog>
        )}
      </main>
    </div>
  );
}
