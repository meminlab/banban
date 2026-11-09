import { Calendar, List, ListFilter } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { type LedgerFlash, type TransactionFormState } from '../app/routes';
import { MonthNav } from '../components/MonthNav';
import { Sheet } from '../components/Sheet';
import { TxRow, useTxLabels, type TxLabels } from '../components/TxRow';
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
  filterResultSummary,
  filterTransactions,
  knownFilter,
  formatDayLabel,
  groupByDate,
  parseLedgerQuery,
  pocketFilterOptions,
  spenderFilterOptions,
  sumExpense,
  toggleFilter,
  type DayTotals,
  type FilterKey,
  type FilterOption,
  type LedgerFilter,
  type LedgerQuery,
} from '../domain/ledgerView';
import { addMonths, formatYearMonth, isInMonth, type YearMonth } from '../domain/month';
import { MINUS } from '../domain/format';
import { TYPE_LABEL, TYPE_ORDER, formatNumber, todayKST } from '../domain/transactionForm';

const FLASH_TEXT: Record<LedgerFlash, string> = {
  saved: '저장했어요.',
  deleted: '삭제했어요.',
};

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

      <MonthNav month={query.month} onMove={(d) => setQuery({ month: addMonths(query.month, d), day: null })}>
        {query.view === 'list' ? (
          <button type="button" className="icon-button" aria-label="달력으로 보기" onClick={() => setQuery({ view: 'calendar' })}>
            <Calendar size={24} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="icon-button" aria-label="목록으로 보기" onClick={() => setQuery({ view: 'list' })}>
            <List size={24} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="icon-button filter-button"
          onClick={() => setFilterOpen(true)}
          aria-haspopup="dialog"
          aria-label={filterCount > 0 ? `필터 (${filterCount}개 적용 중)` : '필터'}
        >
          <ListFilter size={24} strokeWidth={2} aria-hidden="true" />
          {filterCount > 0 && <span className="filter-button__dot" aria-hidden="true" />}
        </button>
      </MonthNav>
      {filterCount > 0 && (
        <p className="filter-status">
          <span>{data ? filterResultText(filtered, filter.types) : `필터 ${filterCount}개 적용 중`}</span>
          <button type="button" className="filter-status__reset" onClick={() => setQuery({ filter: EMPTY_FILTER })}>
            초기화
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
          <p className="hint">아래 ＋ 버튼으로 내역을 입력해 보세요.</p>
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

/** "필터 결과 12건 · 지출 182,000" (design.md 5.23, BANB-37 Q1) — 지금 보이는 필터 결과 목록과 같은 값 */
function filterResultText(items: Transaction[], types: TransactionType[]): string {
  const { count, type, amount } = filterResultSummary(items, types);
  return `필터 결과 ${count}건 · ${TYPE_LABEL[type]} ${formatNumber(amount)}`;
}

// ── 내역 한 줄

/** 날짜 하루 = 카드 1장. 머리 "11월 6일 (금)" + 오른쪽 그날 지출 합(지출 없는 날은 비움) */
function DayCard({
  date,
  items,
  labels,
  returnState,
  titleId,
}: {
  date: string;
  items: Transaction[];
  labels: TxLabels;
  returnState: TransactionFormState;
  titleId: string;
}) {
  const expense = sumExpense(items);
  return (
    <section aria-labelledby={titleId} className="day-group">
      <div className="day-group__head">
        <h3 id={titleId} className="day-group__title">
          {formatDayLabel(date)}
          {date === todayKST() && ' 오늘'}
        </h3>
        {expense > 0 && (
          <span className="day-group__total money">
            <span aria-hidden="true">
              {MINUS}
              {formatNumber(expense)}
            </span>
            <span className="sr-only">지출 {formatNumber(expense)}원</span>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="hint day-detail__hint">이 날은 내역이 없어요.</p>
      ) : (
        <ul className="tx-list">
          {items.map((t) => (
            <TxRow key={t.id} t={t} labels={labels} returnState={returnState} />
          ))}
        </ul>
      )}
    </section>
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
  const labels = useTxLabels(options);
  const groups = useMemo(() => groupByDate(items), [items]);
  return (
    <div className="day-groups">
      {groups.map((g) => (
        <DayCard key={g.date} date={g.date} items={g.items} labels={labels} returnState={returnState} titleId={`day-${g.date}`} />
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
  const labels = useTxLabels(options);
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
                      {t && t.saving > 0 && <span className="calendar__saving" aria-hidden="true" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint calendar__legend">
        −지출 · +수입 · <span className="calendar__saving calendar__saving--legend" aria-hidden="true" /> 저축
      </p>

      {filtered && items.length === 0 ? (
        <NoMatch onReset={onResetFilter} />
      ) : selected === null ? (
        <p className="hint day-detail__hint">날짜를 누르면 그날 내역이 보여요.</p>
      ) : (
        <DayCard date={selected} items={dayItems} labels={labels} returnState={returnState} titleId="day-detail-title" />
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
