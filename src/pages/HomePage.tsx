import { ChevronRight, Landmark } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { ASSET_NEW_PATH, ASSETS_PATH } from '../app/routes';
import { Delta, deltaSpeech, signedWon } from '../components/NetWorthDelta';
import { MonthNav } from '../components/MonthNav';
import { WonText } from '../components/WonText';
import { listAssets, listBalanceHistory } from '../data/asset';
import { getMonthSummaryData, type MonthSummaryData } from '../data/summary';
import type { Asset, AssetBalanceHistory } from '../data/types';
import { formatPercent, formatWon } from '../domain/format';
import { addMonths, currentYearMonth, type YearMonth } from '../domain/month';
import { homeNetWorth, trendWindowStart } from '../domain/netWorth';
import { activeMemberCount, computeMonthSummary, type BreakdownRow, type MonthSummary } from '../domain/summary';
import { formatNumber } from '../domain/transactionForm';

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

/**
 * 자산·잔액 이력은 가계부마다 읽고, 달을 옮기면 화면에서 다시 계산한다.
 * 이력은 범위를 정해 받는다(BANB-30): 고른 달 기준 12개월치를 받아 두면 앞으로 6개월까지 옮겨도 다시 읽지 않는다.
 * 받은 범위로 고른 달의 6개월 추이를 계산할 수 없을 때만 그 달 기준 12개월치를 다시 받는다
 */
const HOME_HISTORY_MONTHS = 12;

function useAssetData(ledgerId: string, month: YearMonth) {
  const need = trendWindowStart(month);
  const [range, setRange] = useState(() => ({ ledgerId, since: trendWindowStart(month, HOME_HISTORY_MONTHS) }));
  if (range.ledgerId !== ledgerId || need < range.since) {
    setRange({ ledgerId, since: trendWindowStart(month, HOME_HISTORY_MONTHS) });
  }
  const [loaded, setLoaded] = useState<{ range: typeof range; state: AssetLoadState }>({ range, state: { status: 'loading' } });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoaded({ range, state: { status: 'loading' } });
    Promise.all([listAssets(range.ledgerId), listBalanceHistory(range.ledgerId, range.since)]).then(
      ([assets, history]) => alive && setLoaded({ range, state: { status: 'ready', assets, history } }),
      () => alive && setLoaded({ range, state: { status: 'error' } }),
    );
    return () => {
      alive = false;
    };
  }, [range, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // 지금 범위로 받은 결과가 아니면(다시 받는 중) 불러오는 중으로 본다 — 잘린 이력으로 계산하지 않는다
  const state: AssetLoadState = loaded.range === range ? loaded.state : { status: 'loading' };
  return { state, retry };
}

export function HomePage() {
  const ledgerId = useLedgerId();
  const [month, setMonth] = useState<YearMonth>(() => currentYearMonth());
  const { state, retry } = useMonthSummaryData(ledgerId, month);
  const asset = useAssetData(ledgerId, month);

  const summary = useMemo(
    () => (state.status === 'ready' ? computeMonthSummary(state.month, state.data.transactions, state.data) : null),
    [state],
  );
  const showWhoSpent = state.status === 'ready' && activeMemberCount(state.data.members) > 1;

  return (
    <div className="home">
      <MonthNav month={month} onMove={(d) => setMonth((m) => addMonths(m, d))} />

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
          <MonthSummaryCard summary={summary} />
          {showWhoSpent && <WhoSpentCard rows={summary.expenseBy.spender} total={summary.expense} />}

          {summary.expense > 0 && (
            <section className="breakdown" aria-labelledby="breakdown-title">
              <h2 id="breakdown-title" className="breakdown__title">
                지출 나눠 보기
              </h2>
              <BreakdownList title="공동·개인" rows={summary.expenseBy.scope} />
              <BreakdownList title="주머니별" rows={summary.expenseBy.pocket} />
              <BreakdownList title="고정·변동" rows={summary.expenseBy.fixed} />
              <BreakdownList title="카테고리 상위 5개" rows={summary.expenseBy.topCategories} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** 14자 이상(예: 9,999,999,999원 이상)이면 hero 36px → xl 28px (design.md 5.4) */
const heroSizeClass = (amount: number) => (formatWon(amount).length >= 14 ? ' summary-card__value--long' : '');

/**
 * 이번 달 카드 (design.md 5.23 홈 3): "11월 남은 돈" / hero 금액 / 한 줄 "수입 … · 지출 … · 저축 …"(원 생략, 수입 숫자만 포인트 색).
 * 계산식 문구는 쓰지 않는다. 360px에서 넘치면 항목 단위로 다음 줄(저축부터). 내역이 없으면 한 줄 대신 빈 상태 안내.
 */
function MonthSummaryCard({ summary }: { summary: MonthSummary }) {
  const remaining = summary.remaining;
  return (
    <section className="summary-card" aria-labelledby="summary-title">
      <h2 id="summary-title" className="summary-card__label">
        {monthNo(summary.month)}월 남은 돈
      </h2>
      <p
        className={`summary-card__value money${remaining < 0 ? ' is-negative' : ''}${heroSizeClass(remaining)}`}
        data-testid="home-remaining"
      >
        <WonText amount={remaining} />
      </p>
      {summary.count === 0 ? (
        <p className="summary-card__line">이 달에 입력한 내역이 없어요.</p>
      ) : (
        <p className="summary-card__line">
          <SummaryPart label="수입" amount={summary.income} income sep />{' '}
          <SummaryPart label="지출" amount={summary.expense} sep />{' '}
          <SummaryPart label="저축" amount={summary.saving} />
        </p>
      )}
    </section>
  );
}

/** "수입 4,200,000 ·" 한 덩어리 (덩어리 안에서는 줄바꿈하지 않는다) */
function SummaryPart({ label, amount, income, sep }: { label: string; amount: number; income?: boolean; sep?: boolean }) {
  return (
    <span className="summary-card__part">
      {label} <b className={income ? 'is-income' : undefined}>{formatNumber(amount)}</b>
      {sep && <span aria-hidden="true">{'\u00a0·'}</span>}
    </span>
  );
}

/**
 * 누가 썼나 (design.md 5.23 홈 4): 제목 + 오른쪽 이달 지출 합 / 나눔 막대 / 한 줄 범례(점 + 이름 + 금액). %는 쓰지 않는다.
 * 색은 참여 순 member-1~4. 지출이 0이면 막대 대신 안내 한 줄.
 */
function WhoSpentCard({ rows, total }: { rows: BreakdownRow[]; total: number }) {
  const colorOf = (i: number) => `who-spent__color--${(i % 4) + 1}`;
  return (
    <section className="who-spent" aria-labelledby="who-spent-title">
      <div className="who-spent__head">
        <h2 id="who-spent-title" className="who-spent__title">
          누가 썼나
        </h2>
        <span className="who-spent__total money">{formatWon(total)}</span>
      </div>
      {total === 0 ? (
        <p className="who-spent__empty">이 달 지출이 없어요.</p>
      ) : (
        <>
          <div className="who-spent__bar" aria-hidden="true">
            {rows.map((r, i) =>
              r.amount > 0 ? <span key={r.key} className={colorOf(i)} style={{ flexGrow: r.amount }} /> : null,
            )}
          </div>
          <ul className="who-spent__legend">
            {rows.map((r, i) => (
              <li key={r.key}>
                <span className={`who-spent__dot ${colorOf(i)}`} aria-hidden="true" />
                <span>
                  {r.label} <span className="money">{formatNumber(r.amount)}</span>
                  <span className="sr-only">원</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
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

/**
 * 홈 맨 위 "우리집 순자산" 카드 (design.md 5.23 홈 2): 라벨 / xl 금액 / 증감. 작은 추이 그래프는 없다(자산 탭에 있음). 카드 전체가 자산 탭(합친 보기)으로 가는 링크.
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
      <div className="home-nw__main" aria-hidden="true">
        <span
          className={`home-nw__value money${net !== null && net < 0 ? ' is-negative' : ''}`}
          data-testid="home-net-worth"
        >
          {breakAtCommas(netText)}
        </span>
        <Delta value={data.change} label={deltaLabel} />
      </div>
    </Link>
  );
}
