import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { transactionPath, type TransactionFormState } from '../app/routes';
import type { TransactionFormOptions } from '../data/transaction';
import type { Transaction, TransactionType } from '../data/types';
import { txRowText, UNKNOWN_CATEGORY } from '../domain/ledgerView';
import { formatNumber, memberLabel } from '../domain/transactionForm';
import { CategoryIcon } from './CategoryIcon';

const SIGN: Record<TransactionType, string> = { expense: '−', income: '+', saving: '' };

/** 금액: 숫자+"원"을 한 덩어리로 (숫자 중간에서 줄바꿈하지 않음) */
function Money({ amount, type }: { amount: number; type: TransactionType }) {
  return (
    <span className="money">
      {SIGN[type]}
      {formatNumber(amount)}원
    </span>
  );
}

/** 내역 행 글자·아이콘 재료 (카테고리·멤버는 숨김·나감 포함 전체 목록에서 찾는다) */
export function useTxLabels(options: Pick<TransactionFormOptions, 'categories' | 'members'>) {
  return useMemo(() => {
    const categoryById = new Map(options.categories.map((c) => [c.id, c]));
    const memberById = new Map(options.members.map((m) => [m.id, m]));
    return (t: Transaction) => {
      const category = categoryById.get(t.category_id);
      const parent = category?.parent_id ? categoryById.get(category.parent_id) : null;
      return { ...txRowText(t, categoryById, memberLabel(memberById.get(t.spender_id))), category, parent };
    };
  }, [options]);
}

export type TxLabels = ReturnType<typeof useTxLabels>;

/**
 * 내역 행 (design.md 5.3 v1.4): [아이콘] 제목(메모·소분류) / "대분류 · 사람" — 배지 없음. 금액은 수입만 포인트 색.
 * 가계부 탭 목록·달력과 홈 "최근 내역"이 같이 쓴다. 누르면 수정 화면, 닫으면 returnState.returnTo 로 돌아온다.
 */
export function TxRow({ t, labels, returnState }: { t: Transaction; labels: TxLabels; returnState: TransactionFormState }) {
  const { title, sub, category, parent } = labels(t);
  return (
    <li>
      <Link to={transactionPath(t.id)} state={returnState} className="tx-row">
        <CategoryIcon category={category ?? { name: UNKNOWN_CATEGORY, icon: null }} parent={parent} />
        <span className="tx-row__main">
          <span className="tx-row__title">{title}</span>
          {sub && <span className="tx-row__sub">{sub}</span>}
        </span>
        <span className={`tx-row__amount tx-row__amount--${t.type}`}>
          <Money amount={t.amount} type={t.type} />
        </span>
      </Link>
    </li>
  );
}
