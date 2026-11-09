import { Calendar, ChevronDown, ChevronRight, Clock, MapPin, Moon, Pin, Repeat, StickyNote, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { calendarMonthPath, type EventFlash, type EventFormState } from '../app/routes';
import { Dialog } from '../components/Dialog';
import { EventKindIcon } from '../components/EventKindIcon';
import { Sheet } from '../components/Sheet';
import { StatusScreen } from '../components/StatusScreen';
import { EventNotFoundError, EventPinLimitError, createEvent, deleteEvent, getEvent, listPinnedEventIds, updateEvent } from '../data/event';
import { listMembers } from '../data/member';
import type { CalendarEvent, EventRepeat, Member } from '../data/types';
import {
  EVENT_KINDS,
  EVENT_MEMO_MAX,
  EVENT_PIN_MAX,
  EVENT_PLACE_MAX,
  EVENT_TITLE_MAX,
  REPEAT_SHORT,
  TOGETHER_LABEL,
  eventColor,
  eventToValues,
  formatEventDay,
  formatTime,
  newEventValues,
  repeatOptions,
  solarDateOf,
  targetLabel,
  validateEventForm,
  withCalendar,
  withKind,
  type CalendarKind,
  type EventFormValues,
} from '../domain/event';
import { lunarMonthDays } from '../domain/lunar';
import { todayKST } from '../domain/transactionForm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'notFound' }
  | { status: 'ready'; event: CalendarEvent | null; members: Member[]; pinnedIds: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 일정 추가(/calendar/new) · 수정(/calendar/:eventId) — design.md 5.25 */
export function EventFormPage() {
  const ledgerId = useLedgerId();
  const { eventId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const initialDate = (() => {
    const d = (location.state as EventFormState | null)?.date;
    return typeof d === 'string' && DATE_RE.test(d) ? d : todayKST();
  })();

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([listMembers(ledgerId), eventId ? getEvent(eventId) : null, listPinnedEventIds(ledgerId)]).then(
      ([members, event, pinnedIds]) => {
        if (!alive) return;
        if (eventId && (!event || event.ledger_id !== ledgerId)) return setState({ status: 'notFound' });
        setState({ status: 'ready', event, members, pinnedIds });
      },
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, eventId, attempt]);

  const close = useCallback(
    (date: string, flash?: EventFlash) =>
      navigate(calendarMonthPath(date.slice(0, 7)), { replace: true, state: flash ? { eventFlash: flash } : undefined }),
    [navigate],
  );
  const title = eventId ? '일정 수정' : '일정 추가';

  if (state.status === 'loading') return <StatusScreen kind="loading" message="일정을 불러오고 있어요" />;
  if (state.status === 'error')
    return (
      <StatusScreen
        kind="error"
        message="일정을 불러오지 못했어요. 네트워크를 확인해 주세요."
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  if (state.status === 'notFound')
    return (
      <div className="shell">
        <header className="topbar">
          <button type="button" className="icon-button" aria-label="닫기" onClick={() => close(initialDate)}>
            <X size={24} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <h1 className="topbar__title">{title}</h1>
        </header>
        <main className="content content--no-tabbar">
          <p className="status-text" role="alert">
            삭제된 일정이에요.
          </p>
          <button type="button" className="button button--secondary button--block" onClick={() => close(initialDate)}>
            일정으로
          </button>
        </main>
      </div>
    );

  return (
    <EventForm
      key={state.event?.id ?? 'new'}
      ledgerId={ledgerId}
      title={title}
      event={state.event}
      members={state.members}
      pinnedIds={state.pinnedIds}
      initialDate={initialDate}
      onClose={close}
    />
  );
}

type SheetKind = 'date' | 'repeat' | 'time' | 'place' | 'memo' | null;

function EventForm({
  ledgerId,
  title,
  event,
  members,
  pinnedIds,
  initialDate,
  onClose,
}: {
  ledgerId: string;
  title: string;
  event: CalendarEvent | null;
  members: readonly Member[];
  pinnedIds: readonly string[];
  initialDate: string;
  onClose: (date: string, flash?: EventFlash) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<EventFormValues>(() => (event ? eventToValues(event) : newEventValues(initialDate)));
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pinFull, setPinFull] = useState(false);
  const closeSheet = useCallback(() => setSheet(null), []);

  const set = (patch: Partial<EventFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const solarDate = solarDateOf(values);
  const isAnniversary = values.kind === 'anniversary';
  const lunar = values.calendar === 'lunar';
  const otherPinned = pinnedIds.filter((p) => p !== event?.id).length;
  const pinDisabled = !values.pinned && (otherPinned >= EVENT_PIN_MAX || pinFull);
  const trimmedTitle = values.title.trim();

  // 누구: 함께 + 현재 멤버(참여 순). 수정 중인 일정의 대상이 나간 멤버면 그 사람도 남겨 둔다
  const targets: { id: string | null; label: string }[] = [
    { id: null, label: TOGETHER_LABEL },
    ...[...members]
      .filter((m) => !m.left_at)
      .sort((a, b) => (a.joined_at < b.joined_at ? -1 : 1))
      .map((m) => ({ id: m.id, label: m.display_name })),
  ];
  if (event?.target_member_id && !targets.some((t) => t.id === event.target_member_id)) {
    targets.push({ id: event.target_member_id, label: targetLabel(event.target_member_id, members) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const result = validateEventForm(values);
    if (!result.ok) {
      setError(Object.values(result.errors)[0] ?? null);
      return;
    }
    setBusy('save');
    setError(null);
    try {
      if (event) await updateEvent(event.id, result.value, event.pinned_at);
      else await createEvent(ledgerId, result.value);
      onClose(result.value.event_date, { kind: 'saved' });
    } catch (err) {
      setBusy(null);
      if (err instanceof EventNotFoundError) return onClose(result.value.event_date, { kind: 'gone' });
      if (err instanceof EventPinLimitError) {
        setPinFull(true);
        set({ pinned: false });
        setError('이미 2개를 고정했어요 · 다른 기념일의 고정을 풀어 주세요');
        return;
      }
      setError('저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.');
    }
  }

  async function remove() {
    if (!event) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteEvent(event.id);
      onClose(event.event_date, { kind: 'deleted' });
    } catch (err) {
      if (err instanceof EventNotFoundError) return onClose(event.event_date, { kind: 'gone' });
      setConfirmDelete(false);
      setBusy(null);
      setError('삭제하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.');
    }
  }

  const dateText = (() => {
    if (!lunar) return formatEventDay(values.date);
    return `음력 ${values.lunar.month}월 ${values.lunar.day}일`;
  })();
  const repeatText = lunar ? REPEAT_SHORT.yearly_lunar : REPEAT_SHORT[values.repeat];
  const timeText = values.allDay ? '종일' : formatTime(values.time);

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="닫기" onClick={() => onClose(event?.event_date ?? initialDate)}>
          <X size={24} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <h1 className="topbar__title">{title}</h1>
      </header>
      <main className="content content--no-tabbar">
        <form className="tx-form event-form" onSubmit={submit} noValidate aria-busy={busy !== null}>
          <div className="field">
            <div className="field__label-row">
              <label htmlFor={`${id}-title`} className="field__label">
                제목
              </label>
              <span className="field__count" aria-hidden="true">
                {[...trimmedTitle].length}/{EVENT_TITLE_MAX}
              </span>
            </div>
            <input
              id={`${id}-title`}
              className="input"
              value={values.title}
              maxLength={EVENT_TITLE_MAX}
              autoFocus={!event}
              autoComplete="off"
              placeholder="예: 결혼기념일"
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>

          <fieldset className="field">
            <legend className="field__label">종류</legend>
            <div className="chips">
              {EVENT_KINDS.map((k) => (
                <label key={k.value} className="chip">
                  <input
                    type="radio"
                    name="kind"
                    value={k.value}
                    checked={values.kind === k.value}
                    onChange={() => setValues((v) => withKind(v, k.value))}
                  />
                  <span>
                    <EventKindIcon kind={k.value} size={16} />
                    {k.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend className="field__label">누구 일정</legend>
            <div className="chips">
              {targets.map((t) => (
                <label key={t.id ?? 'together'} className="chip">
                  <input
                    type="radio"
                    name="target"
                    value={t.id ?? ''}
                    checked={values.targetMemberId === t.id}
                    onChange={() => set({ targetMemberId: t.id })}
                  />
                  <span>
                    <span className={`event-swatch event-color--${eventColor(t.id, members)}`} aria-hidden="true" />
                    {t.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <span className="field__label" id={`${id}-date-label`}>
              날짜
            </span>
            <button
              type="button"
              className="select-row"
              aria-labelledby={`${id}-date-label ${id}-date-value`}
              aria-haspopup="dialog"
              onClick={() => setSheet('date')}
            >
              {lunar ? <Moon size={20} strokeWidth={2} aria-hidden="true" /> : <Calendar size={20} strokeWidth={2} aria-hidden="true" />}
              <span id={`${id}-date-value`} className="select-row__text">
                {dateText}
                {lunar && solarDate && <span className="select-row__sub"> · 올해 {formatEventDay(solarDate)}</span>}
              </span>
              <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <div className="event-form__pair">
            <button
              type="button"
              className="select-row"
              aria-label={`반복: ${repeatText}`}
              aria-haspopup="dialog"
              disabled={lunar}
              onClick={() => setSheet('repeat')}
            >
              <Repeat size={20} strokeWidth={2} aria-hidden="true" />
              <span className="select-row__text">{repeatText}</span>
              {!lunar && <ChevronDown size={20} strokeWidth={2} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="select-row"
              aria-label={`시각: ${timeText}`}
              aria-haspopup="dialog"
              onClick={() => setSheet('time')}
            >
              {values.allDay ? <Sun size={20} strokeWidth={2} aria-hidden="true" /> : <Clock size={20} strokeWidth={2} aria-hidden="true" />}
              <span className="select-row__text">{timeText}</span>
              <ChevronDown size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {event && event.repeat !== 'none' && <p className="event-form__note">반복 일정은 모든 날짜에 함께 바뀌어요</p>}

          {isAnniversary && (
            <label className={`switch-row${pinDisabled ? ' is-disabled' : ''}`}>
              <Pin size={20} strokeWidth={2} aria-hidden="true" />
              <span className="switch-row__text">
                <span className="switch-row__label">홈에 D-day 고정</span>
                <span className="switch-row__sub" id={`${id}-pin-sub`}>
                  {pinDisabled
                    ? '이미 2개를 고정했어요 · 다른 기념일의 고정을 풀어 주세요'
                    : `${EVENT_PIN_MAX}개까지 · 지금 ${otherPinned + (values.pinned ? 1 : 0)}개 고정됨`}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={values.pinned}
                disabled={pinDisabled}
                aria-describedby={`${id}-pin-sub`}
                onChange={(e) => set({ pinned: e.target.checked })}
              />
            </label>
          )}

          <div className="event-form__pair">
            <button
              type="button"
              className="select-row"
              aria-label={values.place.trim() ? `장소: ${values.place.trim()}` : '장소 (선택)'}
              aria-haspopup="dialog"
              onClick={() => setSheet('place')}
            >
              <MapPin size={20} strokeWidth={2} aria-hidden="true" />
              <span className={`select-row__text${values.place.trim() ? '' : ' is-placeholder'}`}>
                {values.place.trim() || '장소 (선택)'}
              </span>
            </button>
            <button
              type="button"
              className="select-row"
              aria-label={values.memo.trim() ? `메모: ${values.memo.trim()}` : '메모 (선택)'}
              aria-haspopup="dialog"
              onClick={() => setSheet('memo')}
            >
              <StickyNote size={20} strokeWidth={2} aria-hidden="true" />
              <span className={`select-row__text${values.memo.trim() ? '' : ' is-placeholder'}`}>
                {values.memo.trim() || '메모 (선택)'}
              </span>
            </button>
          </div>

          <div className="tx-form__actions">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!error && !trimmedTitle && <p className="hint">제목을 적어 주세요</p>}
            <div className="asset-form__buttons">
              {event && (
                <button
                  type="button"
                  className="button button--danger-outline"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!!busy}
                >
                  삭제
                </button>
              )}
              <button type="submit" className="button button--primary asset-form__save" disabled={!!busy || !trimmedTitle}>
                {busy === 'save' ? '저장하는 중…' : '저장'}
              </button>
            </div>
          </div>
        </form>
      </main>

      {sheet === 'date' && (
        <Sheet title="날짜" onClose={closeSheet}>
          <DateSheet
            values={values}
            onDone={(next) => {
              setValues(next);
              closeSheet();
            }}
          />
        </Sheet>
      )}
      {sheet === 'repeat' && !lunar && solarDate && (
        <Sheet title="반복" onClose={closeSheet}>
          <RepeatSheet
            date={solarDate}
            values={values}
            onSelect={(repeat) => {
              // 매년(음력)을 고르면 날짜를 음력으로 바꾼다 (음력은 매년만)
              setValues((v) => (repeat === 'yearly_lunar' ? withCalendar(v, 'lunar') : { ...v, repeat }));
              closeSheet();
            }}
          />
        </Sheet>
      )}
      {sheet === 'time' && (
        <Sheet title="시각" onClose={closeSheet}>
          <TimeSheet
            allDay={values.allDay}
            time={values.time}
            onDone={(allDay, time) => {
              set({ allDay, time });
              closeSheet();
            }}
          />
        </Sheet>
      )}
      {(sheet === 'place' || sheet === 'memo') && (
        <Sheet title={sheet === 'place' ? '장소' : '메모'} onClose={closeSheet}>
          <TextSheet
            label={sheet === 'place' ? '장소' : '메모'}
            max={sheet === 'place' ? EVENT_PLACE_MAX : EVENT_MEMO_MAX}
            initial={sheet === 'place' ? values.place : values.memo}
            onDone={(text) => {
              set(sheet === 'place' ? { place: text } : { memo: text });
              closeSheet();
            }}
          />
        </Sheet>
      )}

      {confirmDelete && event && (
        <Dialog
          title={`'${event.title}'을(를) 삭제할까요?`}
          onCancel={() => !busy && setConfirmDelete(false)}
          actions={
            <>
              <button type="button" className="button button--secondary" onClick={() => setConfirmDelete(false)} disabled={!!busy}>
                취소
              </button>
              <button type="button" className="button button--danger" onClick={remove} disabled={!!busy}>
                {busy === 'delete' ? '삭제하는 중…' : '삭제하기'}
              </button>
            </>
          }
        >
          <p className="dialog__body">
            {event.repeat !== 'none' ? '모든 날짜의 일정이 지워져요. ' : ''}다른 멤버 화면에서도 사라지고 되돌릴 수 없어요.
          </p>
        </Dialog>
      )}
    </div>
  );
}

/** 날짜 시트: 기념일이면 [양력 | 음력]. 음력은 년·월·일 선택 + 올해 양력 안내 */
function DateSheet({ values, onDone }: { values: EventFormValues; onDone: (next: EventFormValues) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(values);
  const lunar = draft.calendar === 'lunar';
  const solar = solarDateOf(draft);
  const thisYear = Number(todayKST().slice(0, 4));
  const years = Array.from({ length: 2050 - 1900 + 1 }, (_, i) => 1900 + i);
  const maxDay = lunarMonthDays(draft.lunar.year, draft.lunar.month);
  const setLunar = (patch: Partial<EventFormValues['lunar']>) =>
    setDraft((d) => {
      const next = { ...d.lunar, ...patch };
      return { ...d, lunar: { ...next, day: Math.min(next.day, lunarMonthDays(next.year, next.month)) } };
    });

  return (
    <div className="tx-sheet event-date-sheet">
      {draft.kind === 'anniversary' && (
        <fieldset className="segmented segmented--two">
          <legend className="visually-hidden">달력</legend>
          {(['solar', 'lunar'] as CalendarKind[]).map((c) => (
            <label key={c} className={`segmented__item${draft.calendar === c ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name={`${id}-cal`}
                checked={draft.calendar === c}
                onChange={() => setDraft((d) => withCalendar(d, c))}
              />
              {c === 'solar' ? '양력' : '음력'}
            </label>
          ))}
        </fieldset>
      )}

      {!lunar ? (
        <>
          <label className="visually-hidden" htmlFor={`${id}-date`}>
            날짜
          </label>
          <input
            id={`${id}-date`}
            className="manage-input"
            type="date"
            value={draft.date}
            min="1900-01-01"
            max="2099-12-31"
            onChange={(e) => DATE_RE.test(e.target.value) && setDraft((d) => ({ ...d, date: e.target.value }))}
          />
        </>
      ) : (
        <>
          <div className="lunar-picker">
            <label>
              <span className="visually-hidden">음력 년</span>
              <select className="manage-input" value={draft.lunar.year} onChange={(e) => setLunar({ year: Number(e.target.value) })}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="visually-hidden">음력 월</span>
              <select className="manage-input" value={draft.lunar.month} onChange={(e) => setLunar({ month: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="visually-hidden">음력 일</span>
              <select className="manage-input" value={draft.lunar.day} onChange={(e) => setLunar({ day: Number(e.target.value) })}>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}일
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="notice-box" role="status">
            <Moon size={16} strokeWidth={2} aria-hidden="true" />
            <span>
              {solar ? (
                <>
                  음력 {draft.lunar.month}월 {draft.lunar.day}일 · {Number(solar.slice(0, 4)) === thisYear ? '올해는' : `${solar.slice(0, 4)}년은`}{' '}
                  <strong>{formatEventDay(solar)}</strong>이에요. 해마다 음력 날짜에 맞춰 보여 드려요. 윤달은 평달 날짜로 챙겨요.
                </>
              ) : (
                '이 음력 날짜는 양력으로 바꿀 수 없어요. 다른 해를 골라 주세요.'
              )}
            </span>
          </p>
        </>
      )}
      <button type="button" className="button button--primary button--block" disabled={!solar} onClick={() => onDone(draft)}>
        이 날짜로 할게요
      </button>
    </div>
  );
}

function RepeatSheet({ date, values, onSelect }: { date: string; values: EventFormValues; onSelect: (r: EventRepeat) => void }) {
  const id = useId();
  const options = repeatOptions(date, values.kind);
  const day = Number(date.slice(8));
  return (
    <div className="tx-sheet">
      <fieldset className="option-list">
        <legend className="visually-hidden">반복</legend>
        {options.map((o) => (
          <label key={o.value} className="option-list__item">
            <input type="radio" name={`${id}-repeat`} checked={values.repeat === o.value} onChange={() => onSelect(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
      {day >= 29 && <p className="hint">매월은 짧은 달은 말일에 보여요</p>}
    </div>
  );
}

function TimeSheet({ allDay, time, onDone }: { allDay: boolean; time: string; onDone: (allDay: boolean, time: string) => void }) {
  const id = useId();
  const [draftAllDay, setDraftAllDay] = useState(allDay);
  const [draftTime, setDraftTime] = useState(time);
  return (
    <div className="tx-sheet">
      <fieldset className="segmented segmented--two">
        <legend className="visually-hidden">시각</legend>
        <label className={`segmented__item${draftAllDay ? ' is-selected' : ''}`}>
          <input type="radio" name={`${id}-allday`} checked={draftAllDay} onChange={() => setDraftAllDay(true)} />
          종일
        </label>
        <label className={`segmented__item${!draftAllDay ? ' is-selected' : ''}`}>
          <input type="radio" name={`${id}-allday`} checked={!draftAllDay} onChange={() => setDraftAllDay(false)} />
          시각 정하기
        </label>
      </fieldset>
      {!draftAllDay && (
        <>
          <label className="visually-hidden" htmlFor={`${id}-time`}>
            시각
          </label>
          <input
            id={`${id}-time`}
            className="manage-input"
            type="time"
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
          />
        </>
      )}
      <button
        type="button"
        className="button button--primary button--block"
        disabled={!draftAllDay && !/^\d{2}:\d{2}$/.test(draftTime)}
        onClick={() => onDone(draftAllDay, draftTime)}
      >
        완료
      </button>
    </div>
  );
}

function TextSheet({ label, max, initial, onDone }: { label: string; max: number; initial: string; onDone: (text: string) => void }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  return (
    <form
      className="tx-sheet"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(value.trim());
      }}
    >
      <label className="visually-hidden" htmlFor={`${id}-text`}>
        {label}
      </label>
      <input
        id={`${id}-text`}
        className="manage-input"
        type="text"
        maxLength={max}
        autoFocus
        enterKeyHint="done"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-describedby={`${id}-count`}
      />
      <p id={`${id}-count`} className="field__count">
        {[...value].length}/{max}
      </p>
      <button type="submit" className="button button--primary button--block">
        완료
      </button>
    </form>
  );
}
