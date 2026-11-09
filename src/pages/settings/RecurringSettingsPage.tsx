import { Pause, Plus, Repeat } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLedgerId } from '../../app/guards';
import { RECURRING_NEW_PATH, recurringPath, SETTINGS_PATH, type RecurringFlash } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Icon } from '../../components/Icon';
import { listRecurring } from '../../data/recurring';
import { getTransactionFormOptions } from '../../data/transaction';
import type { TransactionType } from '../../data/types';
import { cycleLabel, recurringRowText, sortRecurringList } from '../../domain/recurring';
import { formatNumber, memberLabel, todayKST } from '../../domain/transactionForm';

const SIGN: Record<TransactionType, string> = { expense: '−', income: '+', saving: '' };
const FLASH_TEXT: Record<RecurringFlash['kind'], string> = {
  saved: '정기 내역을 저장했어요',
  deleted: '정기 내역을 삭제했어요',
  gone: '삭제된 정기 내역이에요',
};

/**
 * 설정 › 정기 내역 목록 (design.md 5.27): 다음 날짜가 가까운 순. 행 = 아이콘 / 이름 / "매월 25일 · 주머니 · 사람" / 금액.
 * 일시정지는 흐리게 + "일시정지" 배지. 헤더 오른쪽 ＋ = 정기 내역 추가
 */
export function RecurringSettingsPage() {
  const ledgerId = useLedgerId();
  const { state, reload } = useLoad(
    () => Promise.all([listRecurring(ledgerId), getTransactionFormOptions(ledgerId)]).then(([list, options]) => ({ list, options })),
    [ledgerId],
  );
  const today = todayKST();
  const sorted = useMemo(() => (state.status === 'ready' ? sortRecurringList(state.data.list, today) : []), [state, today]);

  return (
    <div className="shell">
      <Header />
      <RecurringFlashToast />
      {state.status === 'loading' && (
        <main className="content content--no-tabbar status-screen" role="status">
          <span className="spinner" aria-hidden="true" />
          <p>정기 내역을 불러오고 있어요</p>
        </main>
      )}
      {state.status === 'error' && (
        <main className="content content--no-tabbar status-screen" role="alert">
          <p>정기 내역을 불러오지 못했어요. 네트워크를 확인해 주세요.</p>
          <button type="button" className="button button--secondary" onClick={reload}>
            다시 시도
          </button>
        </main>
      )}
      {state.status === 'ready' && (
        <main className="content content--no-tabbar">
          {sorted.length === 0 ? (
            <section className="asset-empty recurring-empty">
              <span className="asset-empty__icon" aria-hidden="true">
                <Repeat size={28} strokeWidth={1.75} />
              </span>
              <p className="asset-empty__title">매달 나가는 돈을 등록해 두세요</p>
              <p className="hint">그날이 되면 기록할지 먼저 물어봐요</p>
              <Link to={RECURRING_NEW_PATH} className="button button--primary">
                정기 내역 추가
              </Link>
            </section>
          ) : (
            <>
              <ul className="tx-list recurring-list">
                {sorted.map((r) => {
                  const { categories, pockets, members } = state.data.options;
                  const category = categories.find((c) => c.id === r.category_id);
                  const parent = category?.parent_id ? categories.find((c) => c.id === category.parent_id) : null;
                  const { title, sub } = recurringRowText(
                    r,
                    {
                      categoryName: (id) => categories.find((c) => c.id === id)?.name,
                      pocketName: (id) => pockets.find((p) => p.id === id)?.name,
                    },
                    cycleLabel(r),
                    memberLabel(members.find((m) => m.id === r.spender_id)),
                  );
                  return (
                    <li key={r.id}>
                      <Link to={recurringPath(r.id)} className={`tx-row${r.is_paused ? ' is-paused' : ''}`}>
                        <CategoryIcon category={category ?? { name: title, icon: null }} parent={parent} />
                        <span className="tx-row__main">
                          <span className="tx-row__title">{title}</span>
                          <span className="tx-row__sub">{sub}</span>
                        </span>
                        <span className="recurring-list__end">
                          <span className={`tx-row__amount tx-row__amount--${r.type}`}>
                            <span className="money">
                              {SIGN[r.type]}
                              {formatNumber(r.amount)}원
                            </span>
                          </span>
                          {r.is_paused && (
                            <span className="badge recurring-list__paused">
                              <Pause size={12} strokeWidth={2} aria-hidden="true" />
                              일시정지
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="hint recurring-list__note">그날이 되면 기록할지 물어봐요. 자동으로 저장하지는 않아요.</p>
            </>
          )}
        </main>
      )}
    </div>
  );
}

function Header() {
  const navigate = useNavigate();
  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(SETTINGS_PATH, { replace: true });
  }
  return (
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="뒤로" onClick={goBack}>
        <Icon name="back" />
      </button>
      <h1 className="topbar__title">정기 내역</h1>
      <Link to={RECURRING_NEW_PATH} className="icon-button" aria-label="정기 내역 추가">
        <Plus size={24} strokeWidth={2} aria-hidden="true" />
      </Link>
    </header>
  );
}

/** 추가·수정에서 돌아왔을 때 토스트 (한 번만) */
function RecurringFlashToast() {
  const location = useLocation();
  const navigate = useNavigate();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const flash = (location.state as { recurringFlash?: RecurringFlash } | null)?.recurringFlash;
    if (!flash) return;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    setText(FLASH_TEXT[flash.kind]);
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 3000);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <p className="toast toast--no-tabbar" role="status" aria-live="polite">
      {text}
    </p>
  );
}
