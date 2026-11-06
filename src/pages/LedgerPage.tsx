import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import {
  transactionPath,
  type LedgerFlash,
  type TransactionFormState,
} from '../app/routes';
import { Sheet } from '../components/Sheet';
import { getTransactionFormOptions, listMonthTransactions, type TransactionFormOptions } from '../data/transaction';
import type { Transaction, TransactionType } from '../data/types';
import {
  EMPTY_FILTER,
  WEEKDAY_LABELS,
  activeFilterCount,
  buildLedgerQuery,
  calendarWeeks,
  categoryFilterGroups,
  compactWon,
  dailyTotals,
  dayOfMonth,
  filterTransactions,
  knownFilter,
  formatDayLabel,
  groupByDate,
  parseLedgerQuery,
  pocketFilterOptions,
  spenderFilterOptions,
  toggleFilter,
  type DayTotals,
  type FilterKey,
  type FilterOption,
  type LedgerFilter,
  type LedgerQuery,
} from '../domain/ledgerView';
import { addMonths, formatYearMonth, isInMonth, type YearMonth } from '../domain/month';
import { TYPE_LABEL, TYPE_ORDER, formatNumber, memberLabel, todayKST } from '../domain/transactionForm';

const FLASH_TEXT: Record<LedgerFlash, string> = {
  saved: '저장했어요.',
  deleted: '삭제했어요.',
};

const SIGN: Record<TransactionType, string> = { expense: '−', income: '+', saving: '' };

type MonthData = { month: YearMonth; items: Transaction[]; options: TransactionFormOptions };
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: MonthData };

function useMonthTransactions(ledgerId: string, month: YearMonth) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([listMonthTransactions(ledgerId, month), getTransactionFormOptions(ledgerId)]).then(
      ([items, options]) => alive && setState({ status: 'ready', data: { month, items, options } }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, month, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // 달을 바꾼 직후 지난 달 데이터를 새 달 이름으로 보여 주지 않게
  const current: LoadState = state.status === 'ready' && state.data.month !== month ? { status: 'loading' } : state;
  return { state: current, retry };
}

/** 금액: 숫자+"원"을 한 덩어리로 (숫자 중간에서 줄바꿈하지 않음) */
function Money({ amount, type }: { amount: number; type?: TransactionType }) {
  return (
    <span className="money">
      {type ? SIGN[type] : ''}
      {formatNumber(amount)}원
    </span>
  );
}

/**
 * 가계부 탭: 월 이동 + 목록/달력 보기 + 필터. 내역을 누르면 수정 화면.
 * 보고 있는 달·보기·필터는 주소 쿼리에 담아, 수정 화면에서 돌아와도 그대로 남는다.
 */
export function LedgerPage() {
  const ledgerId = useLedgerId();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = useMemo(() => parseLedgerQuery(searchParams), [searchParams]);
  const [flash] = useState<LedgerFlash | undefined>(() => (location.state as { flash?: LedgerFlash } | null)?.flash);
  const [filterOpen, setFilterOpen] = useState(false);
  const { state, retry } = useMonthTransactions(ledgerId, query.month);

  const setQuery = useCallback(
    (next: Partial<LedgerQuery>) =>
      navigate({ pathname: location.pathname, search: buildLedgerQuery({ ...query, ...next }) }, { replace: true }),
    [navigate, location.pathname, query],
  );

  // 알림은 한 번만: 새로고침·뒤로가기로 다시 뜨지 않게 history state 를 지운다 (쿼리는 유지)
  useEffect(() => {
    if (location.state) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);

  const returnState: TransactionFormState = { returnTo: `${location.pathname}${location.search}` };
  const closeFilter = useCallback(() => setFilterOpen(false), []);

  const data = state.status === 'ready' ? state.data : null;
  // 주소에 남은 알 수 없는 값(삭제된 카테고리·주머니 등)은 무시한다. 불러오는 중에는 주소 그대로
  const filter = useMemo(() => (data ? knownFilter(query.filter, data.options) : query.filter), [data, query.filter]);
  const filterCount = activeFilterCount(filter);
  const filtered = useMemo(
    () => (data ? filterTransactions(data.items, filter, data.options.categories) : []),
    [data, filter],
  );

  return (
    <div className="ledger">
      {flash && (
        <p className="toast" role="status">
          {FLASH_TEXT[flash]}
        </p>
      )}

      <div className="month-nav">
        <button
          type="button"
          className="icon-button"
          aria-label="이전 달"
          onClick={() => setQuery({ month: addMonths(query.month, -1), day: null })}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <h2 className="month-nav__label" aria-live="polite">
          {formatYearMonth(query.month)}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="다음 달"
          onClick={() => setQuery({ month: addMonths(query.month, 1), day: null })}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="ledger-toolbar">
        <div className="view-toggle" role="group" aria-label="보기 방식">
          {(['list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`view-toggle__item${query.view === v ? ' is-active' : ''}`}
              aria-pressed={query.view === v}
              onClick={() => setQuery({ view: v })}
            >
              {v === 'list' ? '목록' : '달력'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`button button--small filter-button${filterCount > 0 ? ' is-active' : ''}`}
          onClick={() => setFilterOpen(true)}
          aria-haspopup="dialog"
          aria-label={filterCount > 0 ? `필터 (${filterCount}개 적용 중)` : '필터'}
        >
          필터{filterCount > 0 && <span className="filter-button__count"> {filterCount}</span>}
        </button>
      </div>
      {filterCount > 0 && (
        <p className="filter-status">
          <span>필터 {filterCount}개 적용 중</span>
          <button type="button" className="button--link" onClick={() => setQuery({ filter: EMPTY_FILTER })}>
            필터 초기화
          </button>
        </p>
      )}

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
      {data && data.items.length === 0 && (
        <div className="empty">
          <p className="empty__title">이 달에 입력한 내역이 없어요</p>
          <p className="hint">오른쪽 아래 ＋ 버튼으로 내역을 입력해 보세요.</p>
        </div>
      )}
      {data && data.items.length > 0 && filtered.length === 0 && query.view === 'list' && (
        <NoMatch onReset={() => setQuery({ filter: EMPTY_FILTER })} />
      )}
      {data && data.items.length > 0 && query.view === 'list' && filtered.length > 0 && (
        <MonthList items={filtered} options={data.options} returnState={returnState} />
      )}
      {data && data.items.length > 0 && query.view === 'calendar' && (
        <CalendarView
          month={query.month}
          day={query.day}
          items={filtered}
          options={data.options}
          returnState={returnState}
          onSelectDay={(day) => setQuery({ day })}
          onResetFilter={() => setQuery({ filter: EMPTY_FILTER })}
          filtered={filterCount > 0}
        />
      )}

      {filterOpen && data && (
        <FilterSheet
          filter={filter}
          data={data}
          resultCount={filtered.length}
          onChange={(filter) => setQuery({ filter })}
          onClose={closeFilter}
        />
      )}
    </div>
  );
}

function NoMatch({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty">
      <p className="empty__title">조건에 맞는 내역이 없어요</p>
      <button type="button" className="button button--secondary button--small" onClick={onReset}>
        필터 초기화
      </button>
    </div>
  );
}

// ── 내역 한 줄

function useLabels(options: TransactionFormOptions) {
  return useMemo(() => {
    const categoryById = new Map(options.categories.map((c) => [c.id, c]));
    const pocketById = new Map(options.pockets.map((p) => [p.id, p]));
    const memberById = new Map(options.members.map((m) => [m.id, m]));
    return {
      category(id: string) {
        const child = categoryById.get(id);
        if (!child) return '알 수 없음';
        const parent = child.parent_id ? categoryById.get(child.parent_id) : undefined;
        return parent && parent.name !== child.name ? `${parent.name} › ${child.name}` : child.name;
      },
      pocket: (id: string | null) => (id ? (pocketById.get(id)?.name ?? '알 수 없음') : null),
      member: (id: string) => memberLabel(memberById.get(id)),
    };
  }, [options]);
}

type Labels = ReturnType<typeof useLabels>;

function TxRow({ t, labels, returnState }: { t: Transaction; labels: Labels; returnState: TransactionFormState }) {
  const pocket = labels.pocket(t.pocket_id);
  const sub = [pocket, labels.member(t.spender_id), t.memo].filter(Boolean).join(' · ');
  return (
    <li>
      <Link to={transactionPath(t.id)} state={returnState} className="tx-row">
        <span className="tx-row__main">
          <span className="tx-row__title">{labels.category(t.category_id)}</span>
          <span className="tx-row__sub">
            <span className={`tx-badge tx-badge--${t.type}`}>{TYPE_LABEL[t.type]}</span>
            {t.is_fixed && <span className="tx-badge tx-badge--fixed">고정</span>}
            <span className="tx-row__meta">{sub}</span>
          </span>
        </span>
        <span className={`tx-row__amount tx-row__amount--${t.type}`}>
          <Money amount={t.amount} type={t.type} />
        </span>
      </Link>
    </li>
  );
}

// ── 목록 보기

function MonthList({
  items,
  options,
  returnState,
}: {
  items: Transaction[];
  options: TransactionFormOptions;
  returnState: TransactionFormState;
}) {
  const labels = useLabels(options);
  const groups = useMemo(() => groupByDate(items), [items]);
  return (
    <div className="day-groups">
      {groups.map((g) => (
        <section key={g.date} aria-labelledby={`day-${g.date}`} className="day-group">
          <h3 id={`day-${g.date}`} className="day-group__title">
            {formatDayLabel(g.date)}
          </h3>
          <ul className="tx-list">
            {g.items.map((t) => (
              <TxRow key={t.id} t={t} labels={labels} returnState={returnState} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── 달력 보기

function dayAriaLabel(date: string, totals: DayTotals | undefined): string {
  const parts = [formatDayLabel(date)];
  if (!totals || totals.count === 0) parts.push('내역 없음');
  else {
    if (totals.expense > 0) parts.push(`지출 ${formatNumber(totals.expense)}원`);
    if (totals.income > 0) parts.push(`수입 ${formatNumber(totals.income)}원`);
    if (totals.saving > 0) parts.push(`저축 ${formatNumber(totals.saving)}원`);
  }
  return parts.join(', ');
}

function CalendarView({
  month,
  day,
  items,
  options,
  returnState,
  onSelectDay,
  onResetFilter,
  filtered,
}: {
  month: YearMonth;
  day: string | null;
  items: Transaction[];
  options: TransactionFormOptions;
  returnState: TransactionFormState;
  onSelectDay: (day: string) => void;
  onResetFilter: () => void;
  filtered: boolean;
}) {
  const labels = useLabels(options);
  const weeks = useMemo(() => calendarWeeks(month), [month]);
  const totals = useMemo(() => dailyTotals(items, month), [items, month]);
  const today = todayKST();
  // 고른 날짜가 없으면 이번 달일 때 오늘
  const selected = day ?? (isInMonth(today, month) ? today : null);
  const dayItems = useMemo(
    () => (selected ? (groupByDate(items.filter((t) => t.occurred_on === selected))[0]?.items ?? []) : []),
    [items, selected],
  );

  return (
    <>
      <table className="calendar" aria-label={`${formatYearMonth(month)} 달력`}>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((w, i) => (
              <th key={w} scope="col" className={i === 0 ? 'is-sun' : i === 6 ? 'is-sat' : undefined}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, di) => {
                if (!date) return <td key={di} />;
                const t = totals.get(date);
                const cls = ['calendar__day', date === selected && 'is-selected', date === today && 'is-today']
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={date}>
                    <button
                      type="button"
                      className={cls}
                      aria-pressed={date === selected}
                      aria-label={dayAriaLabel(date, t)}
                      onClick={() => onSelectDay(date)}
                    >
                      <span className={`calendar__num${di === 0 ? ' is-sun' : di === 6 ? ' is-sat' : ''}`}>
                        {dayOfMonth(date)}
                      </span>
                      {t && t.expense > 0 && <span className="calendar__amt calendar__amt--expense">−{compactWon(t.expense)}</span>}
                      {t && t.income > 0 && <span className="calendar__amt calendar__amt--income">+{compactWon(t.income)}</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint calendar__legend">−지출 · +수입 (만·억 단위로 줄여 표시)</p>

      {filtered && items.length === 0 ? (
        <NoMatch onReset={onResetFilter} />
      ) : selected === null ? (
        <p className="hint day-detail__hint">날짜를 누르면 그날 내역이 보여요.</p>
      ) : (
        <section aria-labelledby="day-detail-title" className="day-group">
          <h3 id="day-detail-title" className="day-group__title">
            {formatDayLabel(selected)}
          </h3>
          {dayItems.length === 0 ? (
            <p className="hint day-detail__hint">이 날은 내역이 없어요.</p>
          ) : (
            <ul className="tx-list">
              {dayItems.map((t) => (
                <TxRow key={t.id} t={t} labels={labels} returnState={returnState} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

// ── 필터 시트

function FilterChips({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="manage-sheet__section filter-group">
      <legend className="manage-sheet__label">{legend}</legend>
      <div className="chips">
        {options.map((o) => (
          <label key={o.id} className="chip">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FilterSheet({
  filter,
  data,
  resultCount,
  onChange,
  onClose,
}: {
  filter: LedgerFilter;
  data: MonthData;
  resultCount: number;
  onChange: (f: LedgerFilter) => void;
  onClose: () => void;
}) {
  const { options, items } = data;
  const used = useMemo(
    () => ({
      spenders: new Set(items.map((t) => t.spender_id)),
      pockets: new Set(items.flatMap((t) => (t.pocket_id ? [t.pocket_id] : []))),
      categories: new Set(items.map((t) => t.category_id)),
    }),
    [items],
  );
  // 이미 고른 숨김·나감 항목은 이 달에 안 쓰였어도 칩으로 보여 끌 수 있게 한다
  const spenders = useMemo(
    () => spenderFilterOptions(options.members, used.spenders, filter.spenders),
    [options.members, used, filter.spenders],
  );
  const pockets = useMemo(
    () => pocketFilterOptions(options.pockets, used.pockets, filter.pockets),
    [options.pockets, used, filter.pockets],
  );
  const categoryGroups = useMemo(
    () => categoryFilterGroups(options.categories, used.categories, filter.categories),
    [options.categories, used, filter.categories],
  );
  const toggle = (key: FilterKey) => (id: string) => onChange(toggleFilter(filter, key, id));

  return (
    <Sheet title="필터" onClose={onClose}>
      <p className="hint">항목 안에서는 하나라도 맞으면, 항목끼리는 모두 맞는 내역만 보여요.</p>
      <FilterChips
        legend="유형"
        options={TYPE_ORDER.map((t) => ({ id: t, label: TYPE_LABEL[t] }))}
        selected={filter.types}
        onToggle={toggle('types')}
      />
      <FilterChips legend="사람" options={spenders} selected={filter.spenders} onToggle={toggle('spenders')} />
      {categoryGroups.map((g) => (
        <FilterChips
          key={g.type}
          legend={`${TYPE_LABEL[g.type]} 카테고리`}
          options={g.options}
          selected={filter.categories}
          onToggle={toggle('categories')}
        />
      ))}
      <FilterChips legend="주머니 (지출)" options={pockets} selected={filter.pockets} onToggle={toggle('pockets')} />
      <div className="manage-button-row filter-actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => onChange(EMPTY_FILTER)}
          disabled={activeFilterCount(filter) === 0}
        >
          초기화
        </button>
        <button type="button" className="button button--primary" onClick={onClose}>
          {resultCount}건 보기
        </button>
      </div>
    </Sheet>
  );
}
