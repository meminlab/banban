import { ChevronRight, Landmark } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { ASSET_NEW_PATH, ASSETS_PATH } from '../app/routes';
import { Delta, deltaSpeech, signedWon } from '../components/NetWorthDelta';
import { MiniNetWorthTrend } from '../components/NetWorthTrend';
import { WonText } from '../components/WonText';
import { listAssets, listBalanceHistory } from '../data/asset';
import { getMonthSummaryData, type MonthSummaryData } from '../data/summary';
import type { Asset, AssetBalanceHistory } from '../data/types';
import { formatPercent, formatWon } from '../domain/format';
import { addMonths, currentYearMonth, formatYearMonth, type YearMonth } from '../domain/month';
import { homeNetWorth } from '../domain/netWorth';
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

type AssetLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; assets: Asset[]; history: AssetBalanceHistory[] };

/** 자산·잔액 이력은 가계부마다 한 번 읽고, 달을 옮기면 화면에서 다시 계산한다 */
function useAssetData(ledgerId: string) {
  const [state, setState] = useState<AssetLoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([listAssets(ledgerId), listBalanceHistory(ledgerId)]).then(
      ([assets, history]) => alive && setState({ status: 'ready', assets, history }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

export function HomePage() {
  const ledgerId = useLedgerId();
  const [month, setMonth] = useState<YearMonth>(() => currentYearMonth());
  const { state, retry } = useMonthSummaryData(ledgerId, month);
  const asset = useAssetData(ledgerId);

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

      <HomeNetWorthCard state={asset.state} retry={asset.retry} month={month} />

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
              <SummaryItem label="남은 돈" amount={summary.remaining} />
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

function SummaryItem({ label, amount }: { label: string; amount: number }) {
  const negative = amount < 0;
  return (
    <div className="summary-item">
      <dt>{label}</dt>
      <dd className={negative ? 'is-negative' : undefined}>
        <WonText amount={amount} />
      </dd>
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

const monthNo = (ym: YearMonth) => Number(ym.slice(5));

/** 360px에서 작은 추이(72px) 옆에 금액이 잘리지 않게: 13자부터 22px, 15자부터 20px (기본 28px, design.md 5.22) */
/** 큰 글자(200%)에서 금액이 줄바꿈될 때 쉼표 뒤에서 먼저 끊기게 <wbr> 을 넣는다 */
const breakAtCommas = (text: string) =>
  text.split(',').map((part, i) => (
    <Fragment key={i}>
      {i > 0 && (
        <>
          ,<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));

const netSizeClass = (text: string) =>
  text.length >= 15 ? ' home-nw__value--longer' : text.length >= 13 ? ' home-nw__value--long' : '';

/**
 * 홈 맨 위 "우리집 순자산" 카드 (design.md 5.22 홈 2번). 카드 전체가 자산 탭(합친 보기)으로 가는 링크.
 * 이번 달 = 현재 값, 지난 달 = 그 달 월말 값("10월 말 기준"), 미래 달 = 현재 값(Q13). 자산이 없으면 자산 추가로.
 */
function HomeNetWorthCard({ state, retry, month }: { state: AssetLoadState; retry: () => void; month: YearMonth }) {
  const data = useMemo(
    () => (state.status === 'ready' ? homeNetWorth(state.assets, state.history, month) : null),
    [state, month],
  );

  if (state.status === 'loading') {
    return (
      <section className="home-nw home-nw--status" aria-label="우리집 순자산">
        <p className="hint">순자산을 불러오고 있어요</p>
      </section>
    );
  }
  if (state.status === 'error' || !data) {
    return (
      <section className="home-nw home-nw--status" aria-label="우리집 순자산">
        <p className="hint">순자산을 불러오지 못했어요.</p>
        <button type="button" className="button button--secondary button--small" onClick={retry}>
          순자산 다시 불러오기
        </button>
      </section>
    );
  }

  if (data.kind === 'empty') {
    return (
      <Link to={ASSET_NEW_PATH} className="home-nw home-nw--empty">
        <span className="home-nw__empty-icon" aria-hidden="true">
          <Landmark size={22} />
        </span>
        <span className="home-nw__empty-text">
          <span className="home-nw__empty-title">자산을 등록해 보세요</span>
          <span className="home-nw__empty-desc">통장·대출 잔액을 적으면 우리집 순자산이 보여요</span>
        </span>
        <ChevronRight size={20} className="home-nw__chevron" aria-hidden="true" />
      </Link>
    );
  }

  const sub =
    data.basis === 'month_end' ? `${monthNo(month)}월 말 기준` : data.basis === 'future' ? '지금 기준' : null;
  const deltaLabel = data.basis === 'now' ? '지난달보다' : `${monthNo(addMonths(month, -1))}월 말보다`;
  const net = data.net;
  const netText = net === null ? '–' : `${signedWon(net)}원`;
  const netSpeech = net === null ? '기록이 없어요' : `${net < 0 ? '마이너스 ' : ''}${formatWon(Math.abs(net))}`;
  const label = ['우리집 순자산', sub, netSpeech, deltaSpeech(data.change, deltaLabel), '자산 탭으로 이동']
    .filter(Boolean)
    .join(', ');

  return (
    <Link to={ASSETS_PATH} className="home-nw" aria-label={label}>
      <div className="home-nw__head" aria-hidden="true">
        <span className="home-nw__label">우리집 순자산</span>
        {sub && <span className="home-nw__sub">{sub}</span>}
        <ChevronRight size={20} className="home-nw__chevron" />
      </div>
      <div className="home-nw__row" aria-hidden="true">
        <div className="home-nw__main">
          <span
            className={`home-nw__value money${net !== null && net < 0 ? ' is-negative' : ''}${netSizeClass(netText)}`}
            data-testid="home-net-worth"
          >
            {breakAtCommas(netText)}
          </span>
          <Delta value={data.change} label={deltaLabel} />
        </div>
        <MiniNetWorthTrend points={data.trend} />
      </div>
    </Link>
  );
}
