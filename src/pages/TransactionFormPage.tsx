import { Calendar, Delete, Plus, User, Wallet, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCurrentUser } from '../app/auth';
import { useLedgerId } from '../app/guards';
import { ledgerReturnPath, type TxFlash } from '../app/routes';
import { saveErrorMessage } from '../app/useSaving';
import { CategoryEditor, type CategoryEditorValues } from '../components/CategoryEditor';
import { LucideByKey } from '../components/CategoryIcon';
import { CategoryPicker } from '../components/CategoryPicker';
import { Dialog } from '../components/Dialog';
import { Sheet } from '../components/Sheet';
import { StatusScreen } from '../components/StatusScreen';
import { addChildCategory, addParentCategory } from '../data/catalog';
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
import type { Category, Transaction, TransactionType } from '../data/types';
import { nextSortOrder } from '../domain/catalog';
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
type SheetKind = 'category' | 'categoryAdd' | 'pocket' | 'spender' | 'date' | 'memo';

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
}: {
  ledgerId: string;
  data: Loaded;
  onClose: (flash?: TxFlash) => void;
}) {
  const { options, original, myMemberId, recent } = data;
  const isEdit = original !== null;
  const today = todayKST();
  // 처음 값이 숨김/나감 항목이어도 수정 화면에서 그대로 보이게 유지
  const keep = original ?? undefined;
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
    original
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
    if (!original || busy) return;
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
      <TopBar onClose={() => onClose()}>
        {isEdit ? (
          <h1 className="topbar__title">내역 수정</h1>
        ) : (
          <>
            <h1 className="sr-only">내역 입력</h1>
            {segment}
          </>
        )}
      </TopBar>

      <form className="tx-entry" onSubmit={submit} noValidate aria-busy={busy !== null}>
        <div className="tx-entry__top">
          {isEdit && segment}

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
            <Pill
              label={`날짜: ${dateText}`}
              icon={<Calendar size={18} strokeWidth={2} aria-hidden="true" />}
              text={dateText}
              onClick={() => setSheet('date')}
            />
            <Pill
              label={`메모: ${memoText || '없음'}`}
              empty={!memoText}
              text={memoText || '메모'}
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
      {sheet === 'memo' && (
        <Sheet title="메모" onClose={closeSheet}>
          <MemoSheet initial={draft.memo} onDone={(memo) => {
            set('memo', memo);
            closeSheet();
          }} />
        </Sheet>
      )}

      {dialog === 'confirmDelete' && (
        <Dialog
          title="이 내역을 삭제할까요?"
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
          <p className="dialog__body">삭제하면 다른 멤버 화면에서도 사라지고 되돌릴 수 없어요.</p>
        </Dialog>
      )}
      {dialog === 'deleted' && (
        <Dialog
          title="삭제된 내역입니다"
          onCancel={() => onClose()}
          actions={
            <button type="button" className="button button--primary" onClick={() => onClose()}>
              확인
            </button>
          }
        >
          <p className="dialog__body">다른 멤버가 이미 삭제한 내역이라 저장하지 않았어요.</p>
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
  onClick,
}: {
  label: string;
  text: string;
  icon?: ReactNode;
  empty?: boolean;
  memo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tx-pill${empty ? ' tx-pill--empty' : ''}${memo ? ' tx-pill--memo' : ''}`}
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
