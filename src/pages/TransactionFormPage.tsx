import { Calendar, Delete, Pause, Plus, Repeat, User, Wallet, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCurrentUser } from '../app/auth';
import { useLedgerId } from '../app/guards';
import { ledgerReturnPath, recurringReturnPath, type RecurringFlash, type TxFlash } from '../app/routes';
import { saveErrorMessage } from '../app/useSaving';
import { CategoryEditor, type CategoryEditorValues } from '../components/CategoryEditor';
import { LucideByKey } from '../components/CategoryIcon';
import { CategoryPicker } from '../components/CategoryPicker';
import { Dialog } from '../components/Dialog';
import { Sheet } from '../components/Sheet';
import { StatusScreen } from '../components/StatusScreen';
import { addChildCategory, addParentCategory } from '../data/catalog';
import { createRecurring, deleteRecurring, getRecurring, RecurringNotFoundError, updateRecurring } from '../data/recurring';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  getTransactionFormOptions,
  listCategoryUses,
  listMyRecentEntries,
  updateTransaction,
  type TransactionFormOptions,
} from '../data/transaction';
import type { Category, RecurringTransaction, Transaction, TransactionType } from '../data/types';
import { nextSortOrder } from '../domain/catalog';
import {
  draftCycleLabel,
  firstDateFrom,
  LAST_DAY,
  maxDayOfMonth,
  needsShortMonthHint,
  newScheduleDraft,
  scheduleDraftOf,
  validateSchedule,
  type RecurringScheduleDraft,
} from '../domain/recurring';
import { categoryGlyph } from '../domain/categoryIcon';
import { buildPickerModel, frequentRange, type CategoryUse, type ParentChoice } from '../domain/categoryPicker';
import {
  FIELD_ORDER,
  KEYPAD_MAX_DIGITS,
  MEMO_MAX,
  TYPE_LABEL,
  TYPE_ORDER,
  amountAriaLabel,
  amountFromDigits,
  categoryGroups,
  datePillLabel,
  formatDateTimeKST,
  formatNumber,
  keyFromKeyboard,
  koreanReading,
  lastUsedDefaults,
  memberLabel,
  missingForSave,
  missingMessage,
  pocketOptions,
  pressKey,
  spenderOptions,
  todayKST,
  validateDraft,
  type KeypadKey,
  type RecentEntry,
  type TransactionDraft,
  type TransactionValues,
} from '../domain/transactionForm';

type Loaded = { options: TransactionFormOptions; original: Transaction | null; myMemberId: string; recent: RecentEntry[] };
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'notFound' } | { status: 'ready'; data: Loaded };

function useFormData(ledgerId: string, transactionId: string | undefined) {
  const user = useCurrentUser();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([getTransactionFormOptions(ledgerId), transactionId ? getTransaction(transactionId) : null])
      .then(async ([options, original]) => {
        if (!alive) return;
        if (transactionId && !original) return setState({ status: 'notFound' });
        const me = options.members.find((m) => m.user_id === user.id && m.left_at === null);
        if (!me) return setState({ status: 'error' });
        // 새 내역 기본값(마지막에 쓴 카테고리·주머니). 못 읽으면 빈 알약으로 시작한다
        const recent = transactionId ? [] : await listMyRecentEntries(ledgerId, me.id).catch(() => []);
        if (alive) setState({ status: 'ready', data: { options, original, myMemberId: me.id, recent } });
      })
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [ledgerId, transactionId, user.id, attempt]);

  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

/** 내역 입력(/ledger/new) · 상세·수정(/ledger/:transactionId) — design.md 5.15 v1.4 키패드 + 알약 */
export function TransactionFormPage() {
  const ledgerId = useLedgerId();
  const { transactionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [returnTo] = useState(() => ledgerReturnPath(location.state));
  const { state, retry } = useFormData(ledgerId, transactionId);
  const close = useCallback(
    (txFlash?: TxFlash) => navigate(returnTo, { replace: true, state: txFlash ? { txFlash } : undefined }),
    [navigate, returnTo],
  );

  if (state.status === 'loading') return <StatusScreen kind="loading" message="내역을 불러오고 있어요" />;
  if (state.status === 'error')
    return <StatusScreen kind="error" message="내역을 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={retry} />;
  if (state.status === 'notFound')
    return (
      <div className="shell">
        <TopBar onClose={() => close()}>
          <h1 className="topbar__title">내역 수정</h1>
        </TopBar>
        <main className="content content--no-tabbar">
          <p className="status-text" role="alert">
            삭제된 내역입니다.
          </p>
          <button type="button" className="button button--secondary button--block" onClick={() => close()}>
            목록으로
          </button>
        </main>
      </div>
    );
  return <TransactionForm ledgerId={ledgerId} data={state.data} onClose={close} />;
}

type RecurringLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'notFound' }
  | { status: 'ready'; data: Loaded; original: RecurringTransaction | null };

/**
 * 정기 내역 추가(/settings/recurring/new) · 수정(/settings/recurring/:recurringId) — design.md 5.27:
 * 내역 입력(5.15) 화면 그대로 + 날짜 알약 대신 반복 알약, 메모 = 이름, 고정지출 없음, 수정은 일시정지·삭제
 */
export function RecurringFormPage() {
  const ledgerId = useLedgerId();
  const { recurringId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useCurrentUser();
  const [returnTo] = useState(() => recurringReturnPath(location.state));
  const [state, setState] = useState<RecurringLoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([getTransactionFormOptions(ledgerId), recurringId ? getRecurring(recurringId) : null])
      .then(async ([options, original]) => {
        if (!alive) return;
        if (recurringId && !original) return setState({ status: 'notFound' });
        const me = options.members.find((m) => m.user_id === user.id && m.left_at === null);
        if (!me) return setState({ status: 'error' });
        const recent = recurringId ? [] : await listMyRecentEntries(ledgerId, me.id).catch(() => []);
        if (alive) setState({ status: 'ready', data: { options, original: null, myMemberId: me.id, recent }, original });
      })
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [ledgerId, recurringId, user.id, attempt]);

  const close = useCallback(
    (recurringFlash?: RecurringFlash) => navigate(returnTo, { replace: true, state: recurringFlash ? { recurringFlash } : undefined }),
    [navigate, returnTo],
  );

  if (state.status === 'loading') return <StatusScreen kind="loading" message="정기 내역을 불러오고 있어요" />;
  if (state.status === 'error')
    return (
      <StatusScreen
        kind="error"
        message="정기 내역을 불러오지 못했어요. 네트워크를 확인해 주세요."
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  if (state.status === 'notFound')
    return (
      <div className="shell">
        <TopBar onClose={() => close()}>
          <h1 className="topbar__title">정기 내역 수정</h1>
        </TopBar>
        <main className="content content--no-tabbar">
          <p className="status-text" role="alert">
            삭제된 정기 내역이에요.
          </p>
          <button type="button" className="button button--secondary button--block" onClick={() => close()}>
            목록으로
          </button>
        </main>
      </div>
    );
  return (
    <TransactionForm
      ledgerId={ledgerId}
      data={state.data}
      onClose={() => close()}
      recurring={{ original: state.original, onClose: close }}
    />
  );
}

/** 정기 내역 모드: 원래 값(수정)과 닫기(목록 토스트) */
interface RecurringMode {
  original: RecurringTransaction | null;
  onClose: (flash?: RecurringFlash) => void;
}

function TopBar({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <header className="topbar tx-topbar">
      <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
        <X size={24} strokeWidth={2} aria-hidden="true" />
      </button>
      {children}
    </header>
  );
}

function valuesOf(t: Transaction): TransactionValues {
  return {
    type: t.type,
    amount: t.amount,
    occurred_on: t.occurred_on,
    category_id: t.category_id,
    pocket_id: t.pocket_id,
    spender_id: t.spender_id,
    is_fixed: t.is_fixed,
    memo: t.memo,
  };
}

const KEYS: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'];
const LONG_PRESS_MS = 500;
type SheetKind = 'category' | 'categoryAdd' | 'pocket' | 'spender' | 'date' | 'memo' | 'repeat';

/** 실제 자판 입력을 키패드로 넘길지: 글자 입력칸에 초점이 있으면 넘기지 않는다 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'submit'].includes(target.type);
}

function TransactionForm({
  ledgerId,
  data,
  onClose,
  recurring,
}: {
  ledgerId: string;
  data: Loaded;
  onClose: (flash?: TxFlash) => void;
  /** 있으면 정기 내역 추가·수정 (design.md 5.27) */
  recurring?: RecurringMode;
}) {
  const { options, original, myMemberId, recent } = data;
  const isRecurring = recurring !== undefined;
  const recOriginal = recurring?.original ?? null;
  const isEdit = original !== null || recOriginal !== null;
  const today = todayKST();
  // 처음 값이 숨김/나감 항목이어도 수정 화면에서 그대로 보이게 유지
  const keep = original ?? recOriginal ?? undefined;
  const [categories, setCategories] = useState<Category[]>(options.categories);
  const pockets = useMemo(() => pocketOptions(options.pockets, keep?.pocket_id), [options.pockets, keep]);
  const spenders = useMemo(() => spenderOptions(options.members, keep?.spender_id), [options.members, keep]);
  const memberById = useMemo(() => new Map(options.members.map((m) => [m.id, m])), [options.members]);

  // 새 내역 기본값: 유형별 마지막 카테고리, 마지막 주머니 (지금 고를 수 있는 것만)
  const [defaults] = useState(() =>
    lastUsedDefaults(recent, {
      categoryIds: (t) => new Set(categoryGroups(options.categories, t).flatMap((g) => g.children.map((c) => c.id))),
      pocketIds: new Set(pocketOptions(options.pockets).map((p) => p.id)),
    }),
  );
  const [draft, setDraft] = useState<TransactionDraft>(() =>
    recOriginal
      ? {
          type: recOriginal.type,
          amount: String(recOriginal.amount),
          occurredOn: today, // 정기 내역은 날짜 대신 반복을 쓴다 (검사용 자리 값)
          categoryId: recOriginal.category_id,
          pocketId: recOriginal.pocket_id ?? '',
          spenderId: recOriginal.spender_id,
          isFixed: false,
          memo: recOriginal.memo ?? '',
        }
      : original
      ? {
          type: original.type,
          amount: String(original.amount),
          occurredOn: original.occurred_on,
          categoryId: original.category_id,
          pocketId: original.pocket_id ?? '',
          spenderId: original.spender_id,
          isFixed: original.is_fixed,
          memo: original.memo ?? '',
        }
      : {
          type: 'expense',
          amount: '',
          occurredOn: today,
          categoryId: defaults.categoryByType.expense ?? '',
          pocketId: defaults.pocketId,
          spenderId: myMemberId,
          isFixed: false,
          memo: '',
        },
  );
  const [schedule, setSchedule] = useState<RecurringScheduleDraft>(() =>
    recOriginal ? scheduleDraftOf(recOriginal) : newScheduleDraft(today),
  );
  const [paused, setPaused] = useState(recOriginal?.is_paused ?? false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [failure, setFailure] = useState<'save' | 'delete' | null>(null);
  const [dialog, setDialog] = useState<'confirmDelete' | 'deleted' | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [uses, setUses] = useState<CategoryUse[]>([]);
  const [maxHits, setMaxHits] = useState(0); // 최대 금액을 넘겨 누른 횟수 → 흔들림·화면낭독 안내
  const [shaking, setShaking] = useState(false);
  const amountRef = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    let alive = true;
    // "자주 쓰는 것" 순위는 없어도 기본 순서로 고를 수 있으므로 실패하면 조용히 기본 순서로 둔다
    const { from, to } = frequentRange(todayKST());
    listCategoryUses(ledgerId, from, to).then(
      (rows) => alive && setUses(rows),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [ledgerId]);

  // 화면낭독기 첫 포커스는 금액 (5.15)
  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  const groups = useMemo(
    () => categoryGroups(categories, draft.type, keep?.type === draft.type ? keep.category_id : null),
    [categories, draft.type, keep],
  );
  const pickerModel = useMemo(() => buildPickerModel(groups, categories, uses), [groups, categories, uses]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const selectedCategory = categoryById.get(draft.categoryId);
  const selectedParent = selectedCategory?.parent_id ? categoryById.get(selectedCategory.parent_id) : undefined;
  const selectedPocket = pockets.find((p) => p.id === draft.pocketId);
  const selectedSpender = memberById.get(draft.spenderId);
  const isExpense = draft.type === 'expense';

  const amount = amountFromDigits(draft.amount);
  const hint = missingMessage(missingForSave(draft));
  // 저장 비활성 안내가 떠 있으면 읽기 줄은 숨긴다 (5.15)
  const reading = hint ? null : koreanReading(amount);

  const set = useCallback(<K extends keyof TransactionDraft>(key: K, value: TransactionDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSubmitError(null);
  }, []);

  const press = useCallback(
    (key: KeypadKey) => {
      const r = pressKey(draft.amount, key);
      if (r.overflow) {
        setMaxHits((n) => n + 1);
        setShaking(true);
        return;
      }
      if (r.digits !== draft.amount) set('amount', r.digits);
    },
    [draft.amount, set],
  );

  // 블루투스·PC 키보드의 숫자·Backspace (시트·확인 창이 열려 있으면 받지 않는다)
  const keyboardOn = sheet === null && dialog === null && busy === null;
  useEffect(() => {
    if (!keyboardOn) return;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;
      const key = keyFromKeyboard(e.key);
      if (!key) return;
      e.preventDefault();
      press(key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardOn, press]);

  // ⌫ 길게 누르면 전부 지움
  const longPress = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean }>({ fired: false });
  const startLongPress = () => {
    longPress.current.fired = false;
    clearTimeout(longPress.current.timer);
    longPress.current.timer = setTimeout(() => {
      longPress.current.fired = true;
      set('amount', '');
    }, LONG_PRESS_MS);
  };
  const stopLongPress = () => clearTimeout(longPress.current.timer);
  useEffect(() => () => clearTimeout(longPress.current.timer), []);

  const changeType = (type: TransactionType) => {
    if (type === draft.type) return;
    // 유형이 바뀌면 카테고리 선택지가 바뀐다 → 그 유형에서 마지막에 쓴 카테고리(없으면 비움)
    setDraft((d) => ({ ...d, type, categoryId: isEdit ? '' : (defaults.categoryByType[type] ?? '') }));
    setSubmitError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || hint) return;
    const result = validateDraft(draft, {
      categoryIds: new Set(groups.flatMap((g) => g.children.map((c) => c.id))),
      pocketIds: new Set(pockets.map((p) => p.id)),
      spenderIds: new Set(spenders.map((m) => m.id)),
    });
    if (!result.ok) {
      const first = FIELD_ORDER.find((f) => result.errors[f]);
      setSubmitError(first ? result.errors[first]! : '입력값을 확인해 주세요.');
      return;
    }
    setSubmitError(null);
    setFailure(null);
    if (recurring) {
      const sched = validateSchedule(schedule);
      if (!sched.ok) {
        setSubmitError(sched.error);
        return;
      }
      const { occurred_on: _date, is_fixed: _fixed, ...values } = result.values;
      const input = { ...values, ...sched.value, is_paused: paused };
      setBusy('save');
      try {
        if (recOriginal) await updateRecurring(recOriginal.id, input);
        else await createRecurring(ledgerId, input);
        recurring.onClose({ kind: 'saved' });
      } catch (err) {
        setBusy(null);
        if (err instanceof RecurringNotFoundError) setDialog('deleted');
        else setFailure('save');
      }
      return;
    }
    setBusy('save');
    try {
      if (original) {
        const outcome = await updateTransaction(original.id, result.values);
        if (outcome === 'deleted') {
          setBusy(null);
          setDialog('deleted');
          return;
        }
        onClose({ kind: 'saved', undo: { op: 'restore', id: original.id, values: valuesOf(original) } });
      } else {
        const id = await createTransaction(ledgerId, result.values);
        onClose({ kind: 'saved', undo: { op: 'delete', id } });
      }
    } catch {
      setBusy(null);
      setFailure('save'); // 입력값은 그대로 두고 다시 시도
    }
  };

  const closeSheet = useCallback(() => {
    setSheet(null);
    setCatError(null);
  }, []);
  const backToPicker = useCallback(() => {
    setSheet('category');
    setCatError(null);
  }, []);

  // 추가 화면에서 미리 고를 대분류: 지금 고른 카테고리의 대분류 (없으면 고르지 않음)
  const addInitialParent: ParentChoice | null =
    selectedParent && selectedParent.type === draft.type && !selectedParent.is_hidden ? { kind: 'existing', id: selectedParent.id } : null;

  const addCategory = async (v: CategoryEditorValues) => {
    if (catBusy || !v.parent) return;
    setCatBusy(true);
    setCatError(null);
    try {
      let added: Category[];
      let child: Category;
      if (v.parent.kind === 'new') {
        const siblings = categories.filter((c) => c.type === draft.type && c.parent_id === null);
        const r = await addParentCategory({ ledgerId, type: draft.type, name: v.name, icon: v.icon, sortOrder: nextSortOrder(siblings) });
        added = [r.parent, r.child];
        child = r.child;
      } else {
        const parentId = v.parent.id;
        const siblings = categories.filter((c) => c.parent_id === parentId);
        child = await addChildCategory({ ledgerId, type: draft.type, parentId, name: v.name, icon: v.icon, sortOrder: nextSortOrder(siblings) });
        added = [child];
      }
      setCategories((list) => [...list, ...added]);
      set('categoryId', child.id); // 추가한 카테고리가 선택된 상태로 선택 시트에 돌아온다
      setSheet('category');
    } catch (e) {
      setCatError(saveErrorMessage(e));
    } finally {
      setCatBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (recurring && recOriginal) {
      setDialog(null);
      setFailure(null);
      setBusy('delete');
      try {
        await deleteRecurring(recOriginal.id);
        recurring.onClose({ kind: 'deleted' });
      } catch {
        setBusy(null);
        setFailure('delete');
      }
      return;
    }
    if (!original) return;
    setDialog(null);
    setFailure(null);
    setBusy('delete');
    try {
      await deleteTransaction(original.id);
      onClose({ kind: 'deleted' });
    } catch {
      setBusy(null);
      setFailure('delete');
    }
  };

  const segment = (
    <fieldset className="segmented tx-segmented" aria-label="유형">
      {TYPE_ORDER.map((t) => (
        <label key={t} className={`segmented__item${draft.type === t ? ' is-selected' : ''}`}>
          <input type="radio" name="type" value={t} checked={draft.type === t} onChange={() => changeType(t)} />
          {TYPE_LABEL[t]}
        </label>
      ))}
    </fieldset>
  );

  const hiddenMark = (hidden: boolean | undefined) => (hidden ? ' (숨김)' : '');
  const categoryText = selectedCategory ? `${selectedCategory.name}${hiddenMark(selectedCategory.is_hidden || selectedParent?.is_hidden)}` : '';
  const categoryGlyphView = selectedCategory
    ? (() => {
        const g = categoryGlyph(selectedCategory, selectedParent);
        return g.kind === 'icon' ? <LucideByKey iconKey={g.key} size={18} /> : <span className="tx-pill__letter" aria-hidden="true">{g.letter}</span>;
      })()
    : null;
  const dateText = `${datePillLabel(draft.occurredOn, today)}${isExpense && draft.isFixed ? ' · 고정' : ''}`;
  const memoText = draft.memo.trim();

  return (
    <div className="shell">
      <TopBar onClose={() => (recurring ? recurring.onClose() : onClose())}>
        {isEdit ? (
          <h1 className="topbar__title">{isRecurring ? '정기 내역 수정' : '내역 수정'}</h1>
        ) : (
          <>
            <h1 className="sr-only">{isRecurring ? '정기 내역 추가' : '내역 입력'}</h1>
            {segment}
          </>
        )}
      </TopBar>

      <form className="tx-entry" onSubmit={submit} noValidate aria-busy={busy !== null}>
        <div className="tx-entry__top">
          {isEdit && segment}
          {isRecurring && (
            <p className="tx-entry__mode" aria-hidden="true">
              {isEdit ? '정기 내역 수정' : '정기 내역 추가'}
            </p>
          )}

          <div className="tx-entry__amount">
            <output
              ref={amountRef}
              tabIndex={-1}
              className={`tx-amount${amount === 0 ? ' is-zero' : ''}${draft.amount.length >= KEYPAD_MAX_DIGITS ? ' is-long' : ''}${shaking ? ' is-shaking' : ''}`}
              aria-label={amountAriaLabel(amount)}
              onAnimationEnd={() => setShaking(false)}
            >
              <span className="tx-amount__num">{formatNumber(amount)}</span>
              <span className="tx-amount__unit">원</span>
              <span className="tx-amount__caret" aria-hidden="true" />
            </output>
            {reading && (
              <p className="tx-reading" aria-hidden="true">
                {reading}
              </p>
            )}
            <p className="sr-only" role="status">
              {maxHits > 0 ? `최대 금액이에요${'​'.repeat(maxHits % 2)}` : ''}
            </p>
          </div>

          <div className="tx-pills">
            {isRecurring && (
              <Pill
                label={`반복: ${draftCycleLabel(schedule)}`}
                icon={<Repeat size={18} strokeWidth={2} aria-hidden="true" />}
                text={draftCycleLabel(schedule)}
                strong
                onClick={() => setSheet('repeat')}
              />
            )}
            <Pill
              label={`카테고리: ${categoryText || '없음'}`}
              empty={!selectedCategory}
              icon={categoryGlyphView}
              text={categoryText || '카테고리'}
              onClick={() => setSheet('category')}
            />
            {isExpense && (
              <Pill
                label={`주머니: ${selectedPocket ? selectedPocket.name : '없음'}`}
                empty={!selectedPocket}
                icon={<Wallet size={18} strokeWidth={2} aria-hidden="true" />}
                text={selectedPocket ? `${selectedPocket.name}${hiddenMark(selectedPocket.is_hidden)}` : '주머니'}
                onClick={() => setSheet('pocket')}
              />
            )}
            <Pill
              label={`사람: ${memberLabel(selectedSpender)}`}
              icon={<User size={18} strokeWidth={2} aria-hidden="true" />}
              text={memberLabel(selectedSpender)}
              onClick={() => setSheet('spender')}
            />
            {!isRecurring && (
              <Pill
                label={`날짜: ${dateText}`}
                icon={<Calendar size={18} strokeWidth={2} aria-hidden="true" />}
                text={dateText}
                onClick={() => setSheet('date')}
              />
            )}
            <Pill
              label={`${isRecurring ? '이름' : '메모'}: ${memoText || '없음'}`}
              empty={!memoText}
              text={memoText || (isRecurring ? '이름' : '메모')}
              memo
              onClick={() => setSheet('memo')}
            />
          </div>

          {original && (
            <p className="tx-meta-line">
              작성 {memberLabel(memberById.get(original.created_by))} · 마지막 수정: {memberLabel(memberById.get(original.updated_by))},{' '}
              {formatDateTimeKST(original.updated_at)}
            </p>
          )}
        </div>

        {isRecurring && isEdit && (
          <label className="switch-row tx-entry__pause">
            <Pause size={20} strokeWidth={2} aria-hidden="true" />
            <span className="switch-row__text">
              <span className="switch-row__label">일시정지</span>
              <span className="switch-row__sub">켜 두면 달력에 안 보이고 기록할지 묻지 않아요</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={paused}
              disabled={busy !== null}
              onChange={(e) => {
                setPaused(e.target.checked);
                setSubmitError(null);
              }}
            />
          </label>
        )}

        <div className="tx-keypad" role="group" aria-label="금액 키패드">
          {KEYS.map((k) => (
            <button key={k} type="button" className="tx-key" onClick={() => press(k)} disabled={busy !== null}>
              {k}
            </button>
          ))}
          <button
            type="button"
            className="tx-key"
            aria-label="지우기"
            disabled={busy !== null}
            onClick={() => {
              if (longPress.current.fired) {
                longPress.current.fired = false;
                return;
              }
              press('back');
            }}
            onPointerDown={startLongPress}
            onPointerUp={stopLongPress}
            onPointerLeave={stopLongPress}
            onPointerCancel={stopLongPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Delete size={26} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="tx-entry__actions">
          {hint && (
            <p id="tx-save-hint" className="tx-entry__hint">
              {hint}
            </p>
          )}
          {submitError && (
            <p className="form-error" role="alert">
              {submitError}
            </p>
          )}
          {failure === 'save' && (
            <p className="form-error" role="alert">
              저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
            </p>
          )}
          {failure === 'delete' && (
            <p className="form-error" role="alert">
              삭제하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
            </p>
          )}
          <div className={`tx-entry__buttons${isEdit ? ' tx-entry__buttons--edit' : ''}`}>
            {isEdit && (
              <button
                type="button"
                className="button button--danger-outline tx-entry__button"
                disabled={busy !== null}
                onClick={() => setDialog('confirmDelete')}
              >
                {busy === 'delete' ? '삭제하는 중…' : '삭제'}
              </button>
            )}
            <button
              type="submit"
              className="button button--primary tx-entry__button"
              disabled={busy !== null || hint !== null}
              aria-describedby={hint ? 'tx-save-hint' : undefined}
            >
              {busy === 'save' ? '저장하는 중…' : failure === 'save' ? '다시 저장' : '저장'}
            </button>
          </div>
        </div>
      </form>

      {sheet === 'category' && (
        <Sheet title={`${TYPE_LABEL[draft.type]} 카테고리`} onClose={closeSheet}>
          <CategoryPicker
            model={pickerModel}
            selectedId={draft.categoryId}
            onSelect={(c) => {
              set('categoryId', c.id);
              closeSheet();
            }}
            onAdd={() => setSheet('categoryAdd')}
          />
        </Sheet>
      )}
      {sheet === 'categoryAdd' && (
        <Sheet title="카테고리 추가" onClose={backToPicker}>
          <CategoryEditor
            categories={categories}
            type={draft.type}
            initialParent={addInitialParent}
            busy={catBusy}
            submitLabel="추가하기"
            onSubmit={addCategory}
          >
            {catError && (
              <p className="form-error" role="alert">
                {catError}
              </p>
            )}
          </CategoryEditor>
        </Sheet>
      )}
      {sheet === 'pocket' && (
        <Sheet title="주머니" onClose={closeSheet}>
          <ChoiceChips
            name="pocket"
            label="주머니"
            items={pockets.map((p) => ({ id: p.id, text: `${p.name}${hiddenMark(p.is_hidden)}` }))}
            selectedId={draft.pocketId}
            empty="고를 수 있는 주머니가 없어요. 설정에서 주머니를 추가해 주세요."
            onSelect={(id) => {
              set('pocketId', id);
              closeSheet();
            }}
          />
        </Sheet>
      )}
      {sheet === 'spender' && (
        <Sheet title="사용한 사람" onClose={closeSheet}>
          <ChoiceChips
            name="spender"
            label="사용한 사람"
            items={spenders.map((m) => ({ id: m.id, text: `${memberLabel(m)}${m.id === myMemberId ? ' (나)' : ''}` }))}
            selectedId={draft.spenderId}
            onSelect={(id) => {
              set('spenderId', id);
              closeSheet();
            }}
          />
        </Sheet>
      )}
      {sheet === 'date' && (
        <Sheet title="날짜" onClose={closeSheet}>
          <div className="tx-sheet">
            <label className="visually-hidden" htmlFor="tx-date">
              날짜
            </label>
            <input
              id="tx-date"
              className="manage-input"
              type="date"
              value={draft.occurredOn}
              onChange={(e) => set('occurredOn', e.target.value)}
            />
            {isExpense && (
              <label className="check">
                <input type="checkbox" checked={draft.isFixed} onChange={(e) => set('isFixed', e.target.checked)} />
                매달 나가는 돈(고정지출)
              </label>
            )}
            <button type="button" className="button button--primary button--block" onClick={closeSheet}>
              완료
            </button>
          </div>
        </Sheet>
      )}
      {sheet === 'repeat' && (
        <Sheet title="반복" onClose={closeSheet}>
          <RepeatSheet
            initial={schedule}
            today={today}
            autoStart={!isEdit}
            onDone={(next) => {
              setSchedule(next);
              setSubmitError(null);
              closeSheet();
            }}
          />
        </Sheet>
      )}
      {sheet === 'memo' && (
        <Sheet title={isRecurring ? '이름' : '메모'} onClose={closeSheet}>
          <MemoSheet initial={draft.memo} onDone={(memo) => {
            set('memo', memo);
            closeSheet();
          }} />
        </Sheet>
      )}

      {dialog === 'confirmDelete' && (
        <Dialog
          title={isRecurring ? '이 정기 내역을 삭제할까요?' : '이 내역을 삭제할까요?'}
          onCancel={() => setDialog(null)}
          actions={
            <>
              <button type="button" className="button button--secondary" onClick={() => setDialog(null)}>
                취소
              </button>
              <button type="button" className="button button--danger" onClick={remove}>
                삭제
              </button>
            </>
          }
        >
          <p className="dialog__body">
            {isRecurring ? '이미 기록한 내역은 그대로 남아요.' : '삭제하면 다른 멤버 화면에서도 사라지고 되돌릴 수 없어요.'}
          </p>
        </Dialog>
      )}
      {dialog === 'deleted' && (
        <Dialog
          title={isRecurring ? '삭제된 정기 내역이에요' : '삭제된 내역입니다'}
          onCancel={() => (recurring ? recurring.onClose({ kind: 'gone' }) : onClose())}
          actions={
            <button
              type="button"
              className="button button--primary"
              onClick={() => (recurring ? recurring.onClose({ kind: 'gone' }) : onClose())}
            >
              확인
            </button>
          }
        >
          <p className="dialog__body">
            다른 멤버가 이미 삭제한 {isRecurring ? '정기 내역' : '내역'}이라 저장하지 않았어요.
          </p>
        </Dialog>
      )}
    </div>
  );
}

/** 알약: 라벨 글자 없이 값만, aria-label 에 "카테고리: 외식"처럼 라벨을 넣는다. 비어 있으면 점선 + Plus */
function Pill({
  label,
  text,
  icon,
  empty = false,
  memo = false,
  strong = false,
  onClick,
}: {
  label: string;
  text: string;
  icon?: ReactNode;
  empty?: boolean;
  memo?: boolean;
  /** 꼭 정할 값 (정기 내역 반복 알약: 테두리 primary) */
  strong?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tx-pill${empty ? ' tx-pill--empty' : ''}${memo ? ' tx-pill--memo' : ''}${strong ? ' tx-pill--strong' : ''}`}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      {empty ? <Plus size={18} strokeWidth={2} aria-hidden="true" /> : icon}
      <span className="tx-pill__text">{text}</span>
    </button>
  );
}

/** 칩 시트(주머니·사람): 고르면 바로 닫힌다 */
function ChoiceChips({
  name,
  label,
  items,
  selectedId,
  empty,
  onSelect,
}: {
  name: string;
  label: string;
  items: { id: string; text: string }[];
  selectedId: string;
  empty?: string;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return <p className="hint">{empty}</p>;
  return (
    <fieldset className="tx-sheet chips" aria-label={label}>
      {items.map((it) => (
        <label key={it.id} className="chip">
          <input
            type="radio"
            name={name}
            value={it.id}
            checked={selectedId === it.id}
            onChange={() => onSelect(it.id)}
            // 이미 고른 칩을 다시 눌러도 시트를 닫는다
            onClick={() => selectedId === it.id && onSelect(it.id)}
          />
          <span>{it.text}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** 메모 한 줄 입력 시트 (100자) */
function MemoSheet({ initial, onDone }: { initial: string; onDone: (memo: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="tx-sheet"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(value);
      }}
    >
      <label className="visually-hidden" htmlFor="tx-memo">
        메모
      </label>
      <input
        id="tx-memo"
        className="manage-input"
        type="text"
        maxLength={MEMO_MAX}
        autoFocus
        enterKeyHint="done"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-describedby="tx-memo-count"
      />
      <p id="tx-memo-count" className="field__count">
        {[...value].length}/{MEMO_MAX}
      </p>
      <button type="submit" className="button button--primary button--block">
        완료
      </button>
    </form>
  );
}

const CYCLES: { value: RecurringScheduleDraft['cycle']; label: string }[] = [
  { value: 'monthly', label: '매월' },
  { value: 'weekly', label: '매주' },
  { value: 'yearly', label: '매년' },
];
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * 반복 시트 (design.md 5.27): [매월 | 매주 | 매년] → 매월 1~30 + 말일 / 매주 요일 7칸 / 매년 월·일,
 * 시작(새로 만들 때 기본 = 오늘 이후 첫 날짜)·끝(선택) → "매월 25일로 할게요"
 */
function RepeatSheet({
  initial,
  today,
  autoStart,
  onDone,
}: {
  initial: RecurringScheduleDraft;
  today: string;
  /** 시작일을 직접 고르기 전까지 주기에 맞춰 "오늘 이후 첫 날짜"로 맞춘다 (새 정기 내역) */
  autoStart: boolean;
  onDone: (next: RecurringScheduleDraft) => void;
}) {
  const [d, setD] = useState(initial);
  const [startTouched, setStartTouched] = useState(!autoStart);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<RecurringScheduleDraft>) => {
    setError(null);
    setD((prev) => {
      const next = { ...prev, ...patch };
      if (next.cycle === 'yearly') next.dayOfMonth = Math.min(next.dayOfMonth, maxDayOfMonth(next.month));
      if (!startTouched && !('startOn' in patch)) next.startOn = firstDateFrom(next, today);
      return next;
    });
  };
  const done = () => {
    const r = validateSchedule(d);
    if (!r.ok) return setError(r.error);
    onDone(d);
  };
  const days = Array.from({ length: LAST_DAY - 1 }, (_, i) => i + 1);

  return (
    <div className="tx-sheet repeat-sheet">
      <fieldset className="segmented" aria-label="주기">
        {CYCLES.map((c) => (
          <label key={c.value} className={`segmented__item${d.cycle === c.value ? ' is-selected' : ''}`}>
            <input type="radio" name="cycle" value={c.value} checked={d.cycle === c.value} onChange={() => update({ cycle: c.value })} />
            {c.label}
          </label>
        ))}
      </fieldset>

      {d.cycle === 'monthly' && (
        <fieldset className="repeat-sheet__grid" aria-label="날짜">
          {days.map((n) => (
            <label key={n} className={`repeat-sheet__cell${d.dayOfMonth === n ? ' is-selected' : ''}`}>
              <input type="radio" name="day" checked={d.dayOfMonth === n} onChange={() => update({ dayOfMonth: n })} />
              {n}
            </label>
          ))}
          <label className={`repeat-sheet__cell repeat-sheet__cell--wide${d.dayOfMonth === LAST_DAY ? ' is-selected' : ''}`}>
            <input type="radio" name="day" checked={d.dayOfMonth === LAST_DAY} onChange={() => update({ dayOfMonth: LAST_DAY })} />
            말일
          </label>
        </fieldset>
      )}
      {needsShortMonthHint(d) && <p className="hint">짧은 달은 말일에 기록해요</p>}

      {d.cycle === 'weekly' && (
        <fieldset className="repeat-sheet__week" aria-label="요일">
          {WEEKDAY_NAMES.map((w, i) => (
            <label key={w} className={`repeat-sheet__cell${d.weekday === i ? ' is-selected' : ''}`}>
              <input type="radio" name="weekday" checked={d.weekday === i} onChange={() => update({ weekday: i })} />
              <span aria-hidden="true">{w}</span>
              <span className="sr-only">{w}요일</span>
            </label>
          ))}
        </fieldset>
      )}

      {d.cycle === 'yearly' && (
        <div className="repeat-sheet__yearly">
          <label className="field">
            <span className="field__label">월</span>
            <select className="manage-input" value={d.month} onChange={(e) => update({ month: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">일</span>
            <select className="manage-input" value={d.dayOfMonth} onChange={(e) => update({ dayOfMonth: Number(e.target.value) })}>
              {Array.from({ length: maxDayOfMonth(d.month) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}일
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="repeat-sheet__row">
        <span>시작</span>
        <input
          className="manage-input"
          type="date"
          value={d.startOn}
          onChange={(e) => {
            setStartTouched(true);
            update({ startOn: e.target.value });
          }}
        />
      </label>
      <div className="repeat-sheet__row">
        <label htmlFor="repeat-end">끝</label>
        <input
          id="repeat-end"
          className="manage-input"
          type="date"
          value={d.endOn}
          min={d.startOn}
          aria-describedby="repeat-end-hint"
          onChange={(e) => update({ endOn: e.target.value })}
        />
        {d.endOn ? (
          <button type="button" className="button button--secondary repeat-sheet__clear" onClick={() => update({ endOn: '' })}>
            지우기
          </button>
        ) : (
          <span id="repeat-end-hint" className="repeat-sheet__none">
            정하지 않음
          </span>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="button button--primary button--block" onClick={done}>
        {draftCycleLabel(d)}로 할게요
      </button>
    </div>
  );
}
