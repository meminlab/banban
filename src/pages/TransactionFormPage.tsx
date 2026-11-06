import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCurrentUser } from '../app/auth';
import { useLedgerId } from '../app/guards';
import { ledgerReturnPath, type LedgerFlash } from '../app/routes';
import { CategoryEditor, type CategoryEditorValues } from '../components/CategoryEditor';
import { CategoryIcon } from '../components/CategoryIcon';
import { CategoryPicker } from '../components/CategoryPicker';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { StatusScreen } from '../components/StatusScreen';
import { saveErrorMessage } from '../app/useSaving';
import { addChildCategory, addParentCategory } from '../data/catalog';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  getTransactionFormOptions,
  listRecentCategoryIds,
  updateTransaction,
  type TransactionFormOptions,
} from '../data/transaction';
import type { Category, Transaction, TransactionType } from '../data/types';
import { nextSortOrder } from '../domain/catalog';
import { buildPickerModel, type ParentChoice } from '../domain/categoryPicker';
import {
  FIELD_ORDER,
  MEMO_MAX,
  TYPE_LABEL,
  TYPE_ORDER,
  categoryGroups,
  formatAmountInput,
  formatDateTimeKST,
  formatNumber,
  memberLabel,
  pocketOptions,
  spenderOptions,
  todayKST,
  validateDraft,
  type DraftErrors,
  type DraftField,
  type TransactionDraft,
} from '../domain/transactionForm';

type Loaded = { options: TransactionFormOptions; original: Transaction | null; myMemberId: string };
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'notFound' } | { status: 'ready'; data: Loaded };

function useFormData(ledgerId: string, transactionId: string | undefined) {
  const user = useCurrentUser();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([getTransactionFormOptions(ledgerId), transactionId ? getTransaction(transactionId) : null]).then(
      ([options, original]) => {
        if (!alive) return;
        if (transactionId && !original) return setState({ status: 'notFound' });
        const me = options.members.find((m) => m.user_id === user.id && m.left_at === null);
        if (!me) return setState({ status: 'error' });
        setState({ status: 'ready', data: { options, original, myMemberId: me.id } });
      },
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, transactionId, user.id, attempt]);

  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

/** 내역 입력(/ledger/new) · 상세·수정(/ledger/:transactionId) */
export function TransactionFormPage() {
  const ledgerId = useLedgerId();
  const { transactionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [returnTo] = useState(() => ledgerReturnPath(location.state));
  const { state, retry } = useFormData(ledgerId, transactionId);
  const close = useCallback(
    (flash?: LedgerFlash) => navigate(returnTo, { replace: true, state: flash ? { flash } : undefined }),
    [navigate, returnTo],
  );
  const title = transactionId ? '내역 수정' : '내역 입력';

  if (state.status === 'loading') return <StatusScreen kind="loading" message="내역을 불러오고 있어요" />;
  if (state.status === 'error')
    return <StatusScreen kind="error" message="내역을 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={retry} />;

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="닫기" onClick={() => close()}>
          <Icon name="back" />
        </button>
        <h1 className="topbar__title">{title}</h1>
        <span className="icon-button" aria-hidden="true" />
      </header>
      {state.status === 'notFound' ? (
        <main className="content content--no-tabbar">
          <p className="status-text" role="alert">
            삭제된 내역입니다.
          </p>
          <button type="button" className="button button--secondary button--block" onClick={() => close()}>
            목록으로
          </button>
        </main>
      ) : (
        <TransactionForm ledgerId={ledgerId} data={state.data} onClose={close} />
      )}
    </div>
  );
}

function initialDraft(original: Transaction | null, myMemberId: string): TransactionDraft {
  if (!original) {
    return {
      type: 'expense',
      amount: '',
      occurredOn: todayKST(),
      categoryId: '',
      pocketId: '',
      spenderId: myMemberId,
      isFixed: false,
      memo: '',
    };
  }
  return {
    type: original.type,
    amount: formatNumber(original.amount),
    occurredOn: original.occurred_on,
    categoryId: original.category_id,
    pocketId: original.pocket_id ?? '',
    spenderId: original.spender_id,
    isFixed: original.is_fixed,
    memo: original.memo ?? '',
  };
}

const fieldId = (f: DraftField) => `tx-${f}`;

function focusField(field: DraftField) {
  const el =
    document.getElementById(fieldId(field)) ??
    document.querySelector<HTMLElement>(`[data-field="${field}"] input:checked, [data-field="${field}"] input`);
  el?.focus();
}

function TransactionForm({
  ledgerId,
  data,
  onClose,
}: {
  ledgerId: string;
  data: Loaded;
  onClose: (flash?: LedgerFlash) => void;
}) {
  const { options, original, myMemberId } = data;
  const isEdit = original !== null;
  const [draft, setDraft] = useState<TransactionDraft>(() => initialDraft(original, myMemberId));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [failure, setFailure] = useState<'save' | 'delete' | null>(null);
  const [dialog, setDialog] = useState<'confirmDelete' | 'deleted' | null>(null);
  // 카테고리 선택 시트 → 추가 화면. 추가한 카테고리는 이 화면 안에서 바로 고를 수 있게 목록에 더한다
  const [categories, setCategories] = useState<Category[]>(options.categories);
  const [catSheet, setCatSheet] = useState<null | 'pick' | 'add'>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    // "최근 쓴 것"은 없어도 고를 수 있으므로 실패하면 조용히 숨긴다
    listRecentCategoryIds(ledgerId, myMemberId).then(
      (ids) => alive && setRecentIds(ids),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, myMemberId]);

  // 처음 값이 숨김/나감 항목이어도 수정 화면에서 그대로 보이게 유지
  const keep = original ?? undefined;
  const groups = useMemo(
    () => categoryGroups(categories, draft.type, keep?.type === draft.type ? keep.category_id : null),
    [categories, draft.type, keep],
  );
  const pickerModel = useMemo(() => buildPickerModel(groups, recentIds), [groups, recentIds]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const selectedCategory = categoryById.get(draft.categoryId);
  const selectedParent = selectedCategory?.parent_id ? categoryById.get(selectedCategory.parent_id) : undefined;
  const pockets = useMemo(() => pocketOptions(options.pockets, keep?.pocket_id), [options.pockets, keep]);
  const spenders = useMemo(() => spenderOptions(options.members, keep?.spender_id), [options.members, keep]);
  const memberById = useMemo(() => new Map(options.members.map((m) => [m.id, m])), [options.members]);
  const isExpense = draft.type === 'expense';

  const set = <K extends keyof TransactionDraft>(key: K, value: TransactionDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const changeType = (type: TransactionType) => {
    if (type === draft.type) return;
    // 유형이 바뀌면 카테고리 선택지가 바뀌므로 고른 카테고리는 비운다
    setDraft((d) => ({ ...d, type, categoryId: '' }));
    setErrors((e) => ({ ...e, categoryId: undefined, pocketId: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const result = validateDraft(draft, {
      categoryIds: new Set(groups.flatMap((g) => g.children.map((c) => c.id))),
      pocketIds: new Set(pockets.map((p) => p.id)),
      spenderIds: new Set(spenders.map((m) => m.id)),
    });
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((f) => result.errors[f]);
      if (first) requestAnimationFrame(() => focusField(first));
      return;
    }
    setErrors({});
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
      } else {
        await createTransaction(ledgerId, result.values);
      }
      onClose('saved');
    } catch {
      setBusy(null);
      setFailure('save'); // 입력값은 그대로 두고 다시 시도
    }
  };

  const closeCategorySheet = useCallback(() => {
    setCatSheet(null);
    setCatError(null);
  }, []);
  const backToPicker = useCallback(() => {
    setCatSheet('pick');
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
      setCatSheet('pick');
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
      onClose('deleted');
    } catch {
      setBusy(null);
      setFailure('delete');
    }
  };

  const errorProps = (f: DraftField) =>
    errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': `${fieldId(f)}-error` } : {};
  const errorText = (f: DraftField) =>
    errors[f] ? (
      <p id={`${fieldId(f)}-error`} className="field__error">
        {errors[f]}
      </p>
    ) : null;
  const hasErrors = FIELD_ORDER.some((f) => errors[f]);

  return (
    <main className="content content--no-tabbar">
      <form className="tx-form" onSubmit={submit} noValidate aria-busy={busy !== null}>
        <fieldset className="segmented" aria-label="유형">
          {TYPE_ORDER.map((t) => (
            <label key={t} className={`segmented__item${draft.type === t ? ' is-selected' : ''}`}>
              <input type="radio" name="type" value={t} checked={draft.type === t} onChange={() => changeType(t)} />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor={fieldId('amount')}>
            금액
          </label>
          <div className="amount-input">
            <input
              id={fieldId('amount')}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="0"
              autoFocus={!isEdit}
              value={draft.amount}
              onChange={(e) => set('amount', formatAmountInput(e.target.value))}
              {...errorProps('amount')}
            />
            <span aria-hidden="true">원</span>
          </div>
          {errorText('amount')}
        </div>

        <div className="field">
          <label className="field__label" htmlFor={fieldId('occurredOn')}>
            날짜
          </label>
          <input
            id={fieldId('occurredOn')}
            className="input"
            type="date"
            value={draft.occurredOn}
            onChange={(e) => set('occurredOn', e.target.value)}
            {...errorProps('occurredOn')}
          />
          {errorText('occurredOn')}
        </div>

        <div className="field">
          <span className="field__label" id={`${fieldId('categoryId')}-label`}>
            카테고리
          </span>
          <button
            type="button"
            id={fieldId('categoryId')}
            className="category-field"
            aria-haspopup="dialog"
            aria-labelledby={`${fieldId('categoryId')}-label ${fieldId('categoryId')}-value`}
            onClick={() => setCatSheet('pick')}
            {...errorProps('categoryId')}
          >
            {selectedCategory ? (
              <>
                <CategoryIcon category={selectedCategory} parent={selectedParent} size="row" />
                <span className="category-field__value" id={`${fieldId('categoryId')}-value`}>
                  {selectedParent && selectedParent.name !== selectedCategory.name ? (
                    <span className="category-field__parent">{selectedParent.name} › </span>
                  ) : null}
                  {selectedCategory.name}
                  {selectedCategory.is_hidden || selectedParent?.is_hidden ? ' (숨김)' : ''}
                </span>
              </>
            ) : (
              <span className="category-field__value category-field__value--empty" id={`${fieldId('categoryId')}-value`}>
                {groups.length === 0 ? '고를 수 있는 카테고리가 없어요' : '카테고리 선택'}
              </span>
            )}
            <ChevronRight size={20} strokeWidth={2} aria-hidden="true" focusable="false" className="category-field__chevron" />
          </button>
          {errorText('categoryId')}
        </div>

        {isExpense && (
          <fieldset className="field" data-field="pocketId" {...errorProps('pocketId')}>
            <legend className="field__label">주머니</legend>
            <div className="chips">
              {pockets.map((p) => (
                <label key={p.id} className="chip">
                  <input
                    type="radio"
                    name="pocket"
                    value={p.id}
                    checked={draft.pocketId === p.id}
                    onChange={() => set('pocketId', p.id)}
                  />
                  <span>
                    {p.name}
                    {p.is_hidden ? ' (숨김)' : ''}
                  </span>
                </label>
              ))}
              {pockets.length === 0 && <p className="hint">고를 수 있는 주머니가 없어요. 설정에서 주머니를 추가해 주세요.</p>}
            </div>
            {errorText('pocketId')}
          </fieldset>
        )}

        <fieldset className="field" data-field="spenderId" {...errorProps('spenderId')}>
          <legend className="field__label">사용한 사람</legend>
          <div className="chips">
            {spenders.map((m) => (
              <label key={m.id} className="chip">
                <input
                  type="radio"
                  name="spender"
                  value={m.id}
                  checked={draft.spenderId === m.id}
                  onChange={() => set('spenderId', m.id)}
                />
                <span>
                  {memberLabel(m)}
                  {m.id === myMemberId ? ' (나)' : ''}
                </span>
              </label>
            ))}
          </div>
          {errorText('spenderId')}
        </fieldset>

        {isExpense && (
          <label className="check">
            <input type="checkbox" checked={draft.isFixed} onChange={(e) => set('isFixed', e.target.checked)} />
            고정지출
          </label>
        )}

        <div className="field">
          <label className="field__label" htmlFor={fieldId('memo')}>
            메모 <span className="field__optional">(선택)</span>
          </label>
          <input
            id={fieldId('memo')}
            className="input"
            type="text"
            maxLength={MEMO_MAX}
            value={draft.memo}
            onChange={(e) => set('memo', e.target.value)}
            aria-describedby={errors.memo ? `${fieldId('memo')}-error ${fieldId('memo')}-count` : `${fieldId('memo')}-count`}
            aria-invalid={errors.memo ? true : undefined}
          />
          <p id={`${fieldId('memo')}-count`} className="field__count">
            {[...draft.memo].length}/{MEMO_MAX}
          </p>
          {errorText('memo')}
        </div>

        <div className="tx-form__actions">
          {hasErrors && (
            <p className="form-error" role="alert">
              입력값을 확인해 주세요.
            </p>
          )}
          {failure === 'save' && (
            <p className="form-error" role="alert">
              저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
            </p>
          )}
          <button type="submit" className="button button--primary button--block" disabled={busy !== null}>
            {busy === 'save' ? '저장하는 중…' : failure === 'save' ? '다시 저장' : '저장'}
          </button>
        </div>

        {original && (
          <section className="tx-form__extra" aria-label="내역 정보">
            <p className="tx-meta">
              작성: {memberLabel(memberById.get(original.created_by))}
              <br />
              마지막 수정: {memberLabel(memberById.get(original.updated_by))}, {formatDateTimeKST(original.updated_at)}
            </p>
            {failure === 'delete' && (
              <p className="form-error" role="alert">
                삭제하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
              </p>
            )}
            <button
              type="button"
              className="button button--secondary button--danger-text button--block"
              disabled={busy !== null}
              onClick={() => setDialog('confirmDelete')}
            >
              {busy === 'delete' ? '삭제하는 중…' : '삭제'}
            </button>
          </section>
        )}
      </form>

      {catSheet === 'pick' && (
        <Sheet title={`${TYPE_LABEL[draft.type]} 카테고리`} onClose={closeCategorySheet}>
          <CategoryPicker
            model={pickerModel}
            parentById={categoryById}
            selectedId={draft.categoryId}
            onSelect={(c) => {
              set('categoryId', c.id);
              closeCategorySheet();
            }}
            onAdd={() => setCatSheet('add')}
          />
        </Sheet>
      )}
      {catSheet === 'add' && (
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
    </main>
  );
}
