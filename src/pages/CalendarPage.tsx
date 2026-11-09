import { CalendarHeart, CalendarPlus, Check, Pin } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import {
  CALENDAR_PATH,
  calendarMonthPath,
  EVENT_NEW_PATH,
  eventPath,
  recurringPath,
  type EventFlash,
  type EventFormState,
  type RecurringFormState,
} from '../app/routes';
import { useLoad } from '../app/useLoad';
import { CategoryIcon } from '../components/CategoryIcon';
import { EventKindIcon } from '../components/EventKindIcon';
import { RecurringSuggestSheet, useRecordDone } from '../components/RecurringSuggestSheet';
import { MonthNav } from '../components/MonthNav';
import { Sheet } from '../components/Sheet';
import { hasAnyEvent, listEventsForRange } from '../data/event';
import { listMembers } from '../data/member';
import { listOccurrences, listRecurring } from '../data/recurring';
import { getTransactionFormOptions, type TransactionFormOptions } from '../data/transaction';
import type { Member, RecurringTransaction } from '../data/types';
import {
  cellChips,
  dayAriaLabel,
  eventColor,
  eventSubline,
  expandEvents,
  formatDday,
  formatEventDay,
  gridRange,
  monthGrid,
  type EventOccurrence,
} from '../domain/event';
import { addMonths, currentYearMonth, formatYearMonth, type YearMonth } from '../domain/month';
import {
  canRecord,
  chipAmount,
  expandRecurrings,
  occurrenceKey,
  occurrenceStatusMap,
  recurringRowText,
  spokenAmount,
  type RecurringDue,
} from '../domain/recurring';
import { formatNumber, memberLabel, todayKST } from '../domain/transactionForm';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const FLASH_TEXT: Record<EventFlash['kind'], string> = {
  saved: '일정을 저장했어요',
  deleted: '일정을 삭제했어요',
  gone: '삭제된 일정이에요',
};
/** 좌우로 이만큼 밀면 달을 옮긴다 (px) */
const SWIPE_MIN = 60;
const SIGN = { expense: '−', income: '+', saving: '' } as const;
const NO_OPTIONS: TransactionFormOptions = { categories: [], pockets: [], members: [] };

/** 한 칸에 그릴 것: 일정 회차 → 정기 내역 회차 (design.md 5.24 순서) */
type DayItem = { kind: 'event'; occ: EventOccurrence } | { kind: 'recurring'; r: RecurringTransaction; recorded: boolean };

function parseMonth(value: string | null): YearMonth | null {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

/**
 * 일정 탭 (design.md 5.24): 월 달력 — 칸마다 일정 색 칩(누구), 아이콘(종류), 넘치면 "+n". 날짜를 누르면 그날 목록 시트.
 * 반복 일정은 1건 저장, 여기서 펼쳐 그린다. 보던 달은 주소(?m=)에 남겨 수정 화면에서 돌아와도 그대로.
 */
export function CalendarPage() {
  const ledgerId = useLedgerId();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const month = parseMonth(params.get('m')) ?? currentYearMonth();
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayKST();

  const { state, reload } = useLoad(async () => {
    const { start, end } = gridRange(month);
    const [events, members, recurrings, occurrences] = await Promise.all([
      listEventsForRange(ledgerId, start, end),
      listMembers(ledgerId),
      listRecurring(ledgerId),
      listOccurrences(ledgerId, start, end),
    ]);
    // 정기 내역 행(카테고리 아이콘·주머니 이름)용 선택지. 정기 내역이 없으면 읽지 않는다
    const options = recurrings.length > 0 ? await getTransactionFormOptions(ledgerId) : NO_OPTIONS;
    // 이 달 근처에 없으면 가계부 전체에 일정이 있는지 한 번 더 본다 (일정 없음 안내 — 정기 내역도 일정으로 친다)
    const any = events.length > 0 || recurrings.length > 0 || (await hasAnyEvent(ledgerId));
    return { month, events, members, recurrings, decided: occurrenceStatusMap(occurrences), options, any };
  }, [ledgerId, month]);
  // 달을 바꾼 직후 지난 달 데이터를 새 달 이름으로 보여 주지 않게
  const data = state.status === 'ready' && state.data.month === month ? state.data : null;
  const loading = state.status === 'loading' || (state.status === 'ready' && !data);

  const move = useCallback(
    (delta: -1 | 1) => {
      setSelected(null);
      navigate({ pathname: CALENDAR_PATH, search: `?m=${addMonths(month, delta)}` }, { replace: true });
    },
    [month, navigate],
  );

  const weeks = useMemo(() => monthGrid(month), [month]);
  const byDate = useMemo(() => {
    const out = new Map<string, DayItem[]>();
    if (!data) return out;
    const { start, end } = gridRange(month);
    for (const [date, occs] of expandEvents(data.events, start, end))
      out.set(date, occs.map((occ) => ({ kind: 'event', occ })));
    for (const [date, list] of expandRecurrings(data.recurrings, start, end)) {
      const items = out.get(date) ?? [];
      for (const r of list) items.push({ kind: 'recurring', r, recorded: data.decided.get(occurrenceKey(r.id, date)) === 'recorded' });
      out.set(date, items);
    }
    return out;
  }, [data, month]);
  const recurringLabel = useCallback(
    (r: RecurringTransaction) => {
      const name = r.memo?.trim() || data?.options.categories.find((c) => c.id === r.category_id)?.name || '정기 내역';
      return `정기 내역 ${name} ${spokenAmount(r.type, r.amount)}`;
    },
    [data],
  );
  const [recording, setRecording] = useState<RecurringDue | null>(null);
  const onRecorded = useRecordDone();

  // 좌우 밀기로 달 이동
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(t.clientY - start.y)) move(dx < 0 ? 1 : -1);
  };

  const closeSheet = useCallback(() => setSelected(null), []);
  const addState = (date: string): EventFormState => ({ date });

  return (
    <div className="calendar-tab">
      <MonthNav month={month} onMove={move} />
      <EventFlashToast />

      {data && !data.any && (
        <p className="calendar-tab__empty">
          <CalendarHeart size={20} strokeWidth={2} aria-hidden="true" />
          아직 일정이 없어요. ＋로 첫 일정을 남겨 보세요
        </p>
      )}

      {state.status === 'error' ? (
        <div className="list-status" role="alert">
          <p>일정을 불러오지 못했어요. 네트워크를 확인해 주세요.</p>
          <button type="button" className="button button--secondary" onClick={reload}>
            다시 시도
          </button>
        </div>
      ) : (
        <section
          className="event-cal"
          aria-label={`${formatYearMonth(month)} 일정 달력`}
          aria-busy={loading}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {loading && (
            <p className="event-cal__loading" role="status">
              <span className="spinner spinner--small" aria-hidden="true" />
              일정을 불러오고 있어요
            </p>
          )}
          <div className="event-cal__head" aria-hidden="true">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="event-cal__weeks" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(74px, 1fr))` }}>
            {weeks.map((week) =>
              week.map((cell) => {
                const items = byDate.get(cell.date) ?? [];
                const { shown, more } = cellChips(items);
                const eventItems = items.flatMap((it) => (it.kind === 'event' ? [it.occ] : []));
                const extra = items.flatMap((it) =>
                  it.kind === 'recurring' ? [`${recurringLabel(it.r)}${it.recorded ? ' 기록함' : ''}`] : [],
                );
                const cls = [
                  'event-cal__day',
                  !cell.inMonth && 'is-outside',
                  cell.date === today && 'is-today',
                  cell.date === selected && 'is-selected',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={cell.date}
                    type="button"
                    className={cls}
                    aria-label={dayAriaLabel(cell.date, eventItems, data?.members ?? [], extra)}
                    aria-haspopup="dialog"
                    onClick={() => setSelected(cell.date)}
                  >
                    <span className="event-cal__num" aria-hidden="true">
                      {Number(cell.date.slice(8))}
                    </span>
                    {shown.map((it) =>
                      it.kind === 'event' ? (
                        <span
                          key={it.occ.event.id}
                          className={`event-chip event-color--${eventColor(it.occ.event.target_member_id, data?.members ?? [])}`}
                          aria-hidden="true"
                        >
                          <EventKindIcon kind={it.occ.event.kind} size={9} strokeWidth={2.5} />
                          <span className="event-chip__text">{it.occ.event.title}</span>
                        </span>
                      ) : (
                        <span key={`r-${it.r.id}`} className={`event-chip recurring-chip recurring-chip--${it.r.type}`} aria-hidden="true">
                          {it.recorded && <Check size={9} strokeWidth={2.5} />}
                          <span className="event-chip__text">{chipAmount(it.r.type, it.r.amount)}</span>
                        </span>
                      ),
                    )}
                    {more > 0 && (
                      <span className="event-cal__more" aria-hidden="true">
                        +{more}
                      </span>
                    )}
                  </button>
                );
              }),
            )}
          </div>
        </section>
      )}

      {selected && data && (
        <Sheet title={formatEventDay(selected)} onClose={closeSheet}>
          <DaySheet
            date={selected}
            today={today}
            items={byDate.get(selected) ?? []}
            members={data.members}
            options={data.options}
            decided={data.decided}
            returnTo={calendarMonthPath(month)}
            onRecord={(r) => setRecording({ recurring: r, date: selected })}
          />
          <Link to={EVENT_NEW_PATH} state={addState(selected)} className="button button--secondary button--block day-sheet__add">
            <CalendarPlus size={20} strokeWidth={2} aria-hidden="true" />이 날 일정 추가
          </Link>
        </Sheet>
      )}
      {recording && data && (
        <RecurringSuggestSheet
          ledgerId={ledgerId}
          dues={[recording]}
          options={data.options}
          today={today}
          onClose={() => setRecording(null)}
          onDone={(done) => {
            setRecording(null);
            setSelected(null);
            onRecorded(done);
          }}
        />
      )}
    </div>
  );
}

/** 날짜 시트 목록 (design.md 5.24): [색 원 + 종류 아이콘] 제목 / 누구 · 시각 · 반복 · 장소, 고정이면 Pin D-n */
function DaySheet({
  date,
  today,
  items,
  members,
  options,
  decided,
  returnTo,
  onRecord,
}: {
  date: string;
  today: string;
  items: DayItem[];
  members: Member[];
  options: TransactionFormOptions;
  decided: ReadonlyMap<string, unknown>;
  returnTo: string;
  onRecord: (r: RecurringTransaction) => void;
}) {
  if (items.length === 0)
    return (
      <div className="day-sheet__empty">
        <CalendarHeart size={32} strokeWidth={1.75} aria-hidden="true" />
        <p className="day-sheet__empty-title">이 날은 아직 비어 있어요</p>
        <p className="hint">약속이나 기념일을 남겨 두면 함께 챙길 수 있어요</p>
      </div>
    );
  const categoryById = new Map(options.categories.map((c) => [c.id, c]));
  const pocketById = new Map(options.pockets.map((p) => [p.id, p]));
  const memberById = new Map(options.members.map((m) => [m.id, m]));
  const recurringState: RecurringFormState = { returnTo };
  return (
    <ul className="day-sheet__list">
      {items.map((it) => {
        if (it.kind === 'recurring') {
          const r = it.r;
          const category = categoryById.get(r.category_id);
          const parent = category?.parent_id ? categoryById.get(category.parent_id) : null;
          const { title, sub } = recurringRowText(
            r,
            { categoryName: (id) => categoryById.get(id)?.name, pocketName: (id) => pocketById.get(id)?.name },
            '정기 내역',
            memberLabel(memberById.get(r.spender_id)),
          );
          return (
            <li key={`r-${r.id}`} className="day-sheet__recurring">
              <Link to={recurringPath(r.id)} state={recurringState} className="day-sheet__row">
                <CategoryIcon category={category ?? { name: title, icon: null }} parent={parent} />
                <span className="day-sheet__text">
                  <span className="day-sheet__title">{title}</span>
                  <span className="day-sheet__sub">
                    {sub}
                    {it.recorded && ' · 기록함'}
                  </span>
                </span>
                <span className={`day-sheet__amount tx-row__amount--${r.type}`}>
                  <span className="money">
                    {SIGN[r.type]}
                    {formatNumber(r.amount)}원
                  </span>
                </span>
              </Link>
              {canRecord(r.id, date, today, decided) && (
                <button type="button" className="text-button day-sheet__record" aria-label={`${title} 기록하기`} onClick={() => onRecord(r)}>
                  기록하기
                </button>
              )}
            </li>
          );
        }
        const { event } = it.occ;
        return (
        <li key={event.id}>
          <Link to={eventPath(event.id)} className="day-sheet__row">
            <span className={`day-sheet__icon event-color--${eventColor(event.target_member_id, members)}`} aria-hidden="true">
              <EventKindIcon kind={event.kind} size={18} fallback />
            </span>
            <span className="day-sheet__text">
              <span className="day-sheet__title">{event.title}</span>
              <span className="day-sheet__sub">{eventSubline(event, members)}</span>
            </span>
            {event.pinned_at && (
              <span className="badge day-sheet__pin">
                <Pin size={12} strokeWidth={2} aria-hidden="true" />
                <span className="visually-hidden">홈에 고정 </span>
                {formatDday(date, today)}
              </span>
            )}
          </Link>
        </li>
        );
      })}
    </ul>
  );
}

/** 일정 추가·수정에서 돌아왔을 때 토스트 (한 번만) */
function EventFlashToast() {
  const location = useLocation();
  const navigate = useNavigate();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const flash = (location.state as { eventFlash?: EventFlash } | null)?.eventFlash;
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
    <p className="toast" role="status" aria-live="polite">
      {text}
    </p>
  );
}
