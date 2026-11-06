import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { TRANSACTION_NEW_PATH, transactionPath, type LedgerFlash } from '../app/routes';
import {
  getTransactionFormOptions,
  listRecentTransactions,
  type TransactionFormOptions,
} from '../data/transaction';
import type { Transaction } from '../data/types';
import { TYPE_LABEL, formatNumber, memberLabel } from '../domain/transactionForm';

const FLASH_TEXT: Record<LedgerFlash, string> = {
  saved: '저장했어요.',
  deleted: '삭제했어요.',
};

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: Transaction[]; options: TransactionFormOptions };

/**
 * 가계부 탭: 내역 입력 버튼 + 최근 내역 목록(눌러서 수정·삭제).
 * 월 달력·목록은 BANB-9에서 이 화면을 바꾼다.
 */
export function LedgerPage() {
  const ledgerId = useLedgerId();
  const location = useLocation();
  const navigate = useNavigate();
  const [flash] = useState<LedgerFlash | undefined>(() => (location.state as { flash?: LedgerFlash } | null)?.flash);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // 알림은 한 번만: 새로고침·뒤로가기로 다시 뜨지 않게 history state 를 지운다
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([listRecentTransactions(ledgerId), getTransactionFormOptions(ledgerId)]).then(
      ([items, options]) => alive && setState({ status: 'ready', items, options }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, attempt]);

  return (
    <div className="ledger">
      {flash && (
        <p className="toast" role="status">
          {FLASH_TEXT[flash]}
        </p>
      )}

      <Link to={TRANSACTION_NEW_PATH} className="fab" aria-label="내역 입력">
        <span aria-hidden="true">＋</span>
      </Link>

      {state.status === 'loading' && (
        <p className="list-status" role="status">
          <span className="spinner spinner--small" aria-hidden="true" />
          내역을 불러오고 있어요
        </p>
      )}
      {state.status === 'error' && (
        <div className="list-status" role="alert">
          <p>내역을 불러오지 못했어요. 네트워크를 확인해 주세요.</p>
          <button type="button" className="button button--secondary" onClick={retry}>
            다시 시도
          </button>
        </div>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <div className="empty">
          <p className="empty__title">아직 내역이 없어요</p>
          <p className="hint">오른쪽 아래 ＋ 버튼으로 첫 내역을 입력해 보세요.</p>
        </div>
      )}
      {state.status === 'ready' && state.items.length > 0 && <RecentList items={state.items} options={state.options} />}
    </div>
  );
}

function RecentList({ items, options }: { items: Transaction[]; options: TransactionFormOptions }) {
  const categoryName = useMemo(() => {
    const byId = new Map(options.categories.map((c) => [c.id, c]));
    return (id: string) => {
      const child = byId.get(id);
      const parent = child?.parent_id ? byId.get(child.parent_id) : undefined;
      if (!child) return '';
      return parent && parent.name !== child.name ? `${parent.name} › ${child.name}` : child.name;
    };
  }, [options.categories]);
  const memberById = useMemo(() => new Map(options.members.map((m) => [m.id, m])), [options.members]);

  return (
    <section aria-labelledby="recent-title">
      <h2 id="recent-title" className="section-title">
        최근 내역
      </h2>
      <ul className="tx-list">
        {items.map((t) => (
          <li key={t.id}>
            <Link to={transactionPath(t.id)} className="tx-row">
              <span className="tx-row__main">
                <span className="tx-row__title">{categoryName(t.category_id)}</span>
                <span className="tx-row__sub">
                  {t.occurred_on.slice(5).replace('-', '.')} · {memberLabel(memberById.get(t.spender_id))}
                  {t.memo ? ` · ${t.memo}` : ''}
                </span>
              </span>
              <span className={`tx-row__amount tx-row__amount--${t.type}`}>
                <span className="visually-hidden">{TYPE_LABEL[t.type]} </span>
                {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}
                {formatNumber(t.amount)}원
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
