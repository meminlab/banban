import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLedgerId } from '../app/guards';
import { getMonthSummaryData, type MonthSummaryData } from '../data/summary';
import { formatPercent, formatWon } from '../domain/format';
import { addMonths, currentYearMonth, formatYearMonth, type YearMonth } from '../domain/month';
import { computeMonthSummary, type BreakdownRow } from '../domain/summary';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; month: YearMonth; data: MonthSummaryData };

function useMonthSummaryData(ledgerId: string, month: YearMonth) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    getMonthSummaryData(ledgerId, month).then(
      (data) => alive && setState({ status: 'ready', month, data }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, month, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

export function HomePage() {
  const ledgerId = useLedgerId();
  const [month, setMonth] = useState<YearMonth>(() => currentYearMonth());
  const { state, retry } = useMonthSummaryData(ledgerId, month);

  const summary = useMemo(
    () => (state.status === 'ready' ? computeMonthSummary(state.month, state.data.transactions, state.data) : null),
    [state],
  );

  return (
    <div className="home">
      <div className="month-nav">
        <button type="button" className="icon-button" aria-label="이전 달" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <span aria-hidden="true">‹</span>
        </button>
        <h2 className="month-nav__label" aria-live="polite">
          {formatYearMonth(month)}
        </h2>
        <button type="button" className="icon-button" aria-label="다음 달" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="home__status" role="status">
          <span className="spinner" aria-hidden="true" />
          <p>불러오고 있어요</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="home__status" role="alert">
          <p>요약을 불러오지 못했어요. 네트워크를 확인해 주세요.</p>
          <button type="button" className="button button--secondary" onClick={retry}>
            다시 시도
          </button>
        </div>
      )}

      {summary && (
        <>
          <section className="summary-card" aria-label="이번 달 요약">
            <dl className="summary-card__grid">
              <SummaryItem label="수입" amount={summary.income} />
              <SummaryItem label="지출" amount={summary.expense} />
              <SummaryItem label="저축" amount={summary.saving} />
              <SummaryItem label="남은 돈" amount={summary.remaining} emphasize />
            </dl>
            <p className="hint">남은 돈 = 수입 − 지출 − 저축</p>
            {summary.count === 0 && <p className="home__empty">이 달에 입력한 내역이 없어요.</p>}
          </section>

          <section className="breakdown" aria-labelledby="breakdown-title">
            <h2 id="breakdown-title" className="breakdown__title">
              지출 나눠 보기
            </h2>
            {summary.expense === 0 ? (
              <p className="hint">이 달 지출이 없어요.</p>
            ) : (
              <>
                <BreakdownList title="사람별" rows={summary.expenseBy.spender} />
                <BreakdownList title="공동·개인" rows={summary.expenseBy.scope} />
                <BreakdownList title="주머니별" rows={summary.expenseBy.pocket} />
                <BreakdownList title="고정·변동" rows={summary.expenseBy.fixed} />
                <BreakdownList title="카테고리 상위 5개" rows={summary.expenseBy.topCategories} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryItem({ label, amount, emphasize }: { label: string; amount: number; emphasize?: boolean }) {
  const negative = amount < 0;
  return (
    <div className={`summary-item${emphasize ? ' summary-item--emphasize' : ''}`}>
      <dt>{label}</dt>
      <dd className={negative ? 'is-negative' : undefined}>{formatWon(amount)}</dd>
    </div>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <div className="breakdown__group">
      <h3>{title}</h3>
      <ul aria-label={title}>
        {rows.map((r) => (
          <li key={r.key} className="breakdown__row">
            <span className="breakdown__label">{r.label}</span>
            <span className="breakdown__amount">{formatWon(r.amount)}</span>
            <span className="breakdown__ratio">{formatPercent(r.ratio)}</span>
            <span className="breakdown__bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, r.ratio * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
