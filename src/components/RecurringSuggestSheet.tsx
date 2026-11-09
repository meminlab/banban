import { Delete } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import type { TxFlash } from '../app/routes';
import { recordRecurring } from '../data/recurring';
import type { TransactionFormOptions } from '../data/transaction';
import type { TransactionType } from '../data/types';
import {
  dueDateLabel,
  occurrenceKey,
  recordResultText,
  recurringRowText,
  spokenAmount,
  type RecurringDue,
} from '../domain/recurring';
import { amountAriaLabel, amountFromDigits, formatNumber, KEYPAD_MAX_DIGITS, memberLabel, pressKey, type KeypadKey } from '../domain/transactionForm';
import type { TabOutletContext } from './AppLayout';
import { CategoryIcon } from './CategoryIcon';
import { Sheet } from './Sheet';

const SIGN: Record<TransactionType, string> = { expense: '−', income: '+', saving: '' };

/** 기록·건너뛰기를 마친 결과: 토스트 문구 + 되돌리기(바뀐 회차가 있을 때) */
export type RecordDone = Extract<TxFlash, { kind: 'recorded' }>;

/**
 * 기록 후: 지금 탭을 다시 불러와(합계·칩 반영) 공통 토스트 "n건 기록했어요 · 되돌리기"를 띄운다.
 * 탭 공통 틀(AppLayout) 밖에서 쓰이면(테스트 등) 다시 불러오기는 건너뛴다
 */
export function useRecordDone(): (done: RecordDone) => void {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const ctx = useOutletContext<TabOutletContext | undefined>();
  return useCallback(
    (done: RecordDone) => {
      navigate({ pathname, search }, { replace: true, state: { txFlash: done } });
      ctx?.reload();
    },
    [navigate, pathname, search, ctx],
  );
}

/**
 * 정기 내역 기록 제안 시트 (design.md 5.27): 체크(기본 켬)한 것만 내역 생성, 끈 것은 이번 회차 건너뛰기.
 * 금액을 누르면 이번 회차 금액만 고친다. 날짜는 회차 날짜(오늘 아님).
 * onSnooze 가 있으면 "오늘은 그만"(홈), 없으면 "닫기"(일정 탭에서 1건)
 */
export function RecurringSuggestSheet({
  ledgerId,
  dues,
  options,
  today,
  onClose,
  onSnooze,
  onDone,
}: {
  ledgerId: string;
  dues: RecurringDue[];
  options: TransactionFormOptions;
  today: string;
  onClose: () => void;
  onSnooze?: () => void;
  onDone: (done: RecordDone) => void;
}) {
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [amounts, setAmounts] = useState<Map<string, number>>(() => new Map());
  const [editing, setEditing] = useState<RecurringDue | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const lookup = useMemo(() => {
    const cats = new Map(options.categories.map((c) => [c.id, c]));
    const pockets = new Map(options.pockets.map((p) => [p.id, p]));
    const members = new Map(options.members.map((m) => [m.id, m]));
    return { cats, pockets, members };
  }, [options]);

  const checkedCount = dues.length - dues.filter((d) => unchecked.has(occurrenceKey(d.recurring.id, d.date))).length;
  const amountOf = (d: RecurringDue) => amounts.get(occurrenceKey(d.recurring.id, d.date)) ?? d.recurring.amount;

  const toggle = (key: string) =>
    setUnchecked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const outcomes = await recordRecurring(
        ledgerId,
        dues.map((d) => {
          const key = occurrenceKey(d.recurring.id, d.date);
          const amount = amounts.get(key);
          return {
            recurring_id: d.recurring.id,
            occurs_on: d.date,
            record: !unchecked.has(key),
            amount: amount != null && amount !== d.recurring.amount ? amount : null,
          };
        }),
      );
      const applied = outcomes.filter((o) => o.applied);
      const text = recordResultText({
        recorded: applied.filter((o) => o.status === 'recorded').length,
        skipped: applied.filter((o) => o.status === 'skipped').length,
        already: outcomes.length - applied.length,
      });
      onDone({
        kind: 'recorded',
        text,
        undo:
          applied.length > 0
            ? { op: 'unrecord', ledgerId, keys: applied.map((o) => ({ recurring_id: o.recurring_id, occurs_on: o.occurs_on })) }
            : undefined,
      });
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  if (editing) {
    const key = occurrenceKey(editing.recurring.id, editing.date);
    return (
      <AmountSheet
        initial={amountOf(editing)}
        onClose={() => setEditing(null)}
        onDone={(amount) => {
          setAmounts((m) => new Map(m).set(key, amount));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <Sheet title={`정기 내역 ${dues.length}건`} onClose={onClose}>
      <p className="suggest__desc">이번 달 금액이 다르면 금액을 눌러 고쳐 주세요.</p>
      <ul className="suggest__list">
        {dues.map((d) => {
          const r = d.recurring;
          const key = occurrenceKey(r.id, d.date);
          const category = lookup.cats.get(r.category_id);
          const parent = category?.parent_id ? lookup.cats.get(category.parent_id) : null;
          const { title, sub } = recurringRowText(
            r,
            { categoryName: (id) => lookup.cats.get(id)?.name, pocketName: (id) => lookup.pockets.get(id)?.name },
            dueDateLabel(d.date, today),
            memberLabel(lookup.members.get(r.spender_id)),
          );
          const amount = amountOf(d);
          return (
            <li key={key} className="suggest__row">
              <label className="suggest__check">
                <input type="checkbox" checked={!unchecked.has(key)} onChange={() => toggle(key)} disabled={busy} />
                <CategoryIcon category={category ?? { name: title, icon: null }} parent={parent} />
                <span className="tx-row__main">
                  <span className="tx-row__title">{title}</span>
                  <span className="tx-row__sub">{sub}</span>
                </span>
              </label>
              <button
                type="button"
                className={`suggest__amount tx-row__amount--${r.type}`}
                aria-label={`${title} 금액 ${spokenAmount(r.type, amount)}, 눌러서 고치기`}
                onClick={() => setEditing(d)}
                disabled={busy}
              >
                <span className="money">
                  {SIGN[r.type]}
                  {formatNumber(amount)}원
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p className="form-error" role="alert">
          기록하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
        </p>
      )}
      <div className="suggest__buttons">
        <button type="button" className="button button--secondary" onClick={onSnooze ?? onClose} disabled={busy}>
          {onSnooze ? '오늘은 그만' : '닫기'}
        </button>
        <button type="button" className="button button--primary" onClick={submit} disabled={busy}>
          {busy ? '기록하는 중…' : checkedCount > 0 ? `${checkedCount}건 기록하기` : '건너뛰기'}
        </button>
      </div>
      <p className="suggest__note">체크를 끄면 이번엔 건너뛰어요</p>
    </Sheet>
  );
}

const KEYS: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];

/** 이번 회차 금액만 고치는 키패드 (5.15 키패드와 같은 모양). 0원이면 완료할 수 없다 */
function AmountSheet({ initial, onClose, onDone }: { initial: number; onClose: () => void; onDone: (amount: number) => void }) {
  const [digits, setDigits] = useState(String(initial));
  const amount = amountFromDigits(digits);
  const press = (key: KeypadKey) => setDigits((d) => pressKey(d, key).digits);
  return (
    <Sheet title="이번 금액" onClose={onClose}>
      <div className="amount-sheet">
        <output className={`tx-amount${amount === 0 ? ' is-zero' : ''}${digits.length >= KEYPAD_MAX_DIGITS ? ' is-long' : ''}`} aria-label={amountAriaLabel(amount)}>
          <span className="tx-amount__num">{formatNumber(amount)}</span>
          <span className="tx-amount__unit">원</span>
        </output>
        <div className="tx-keypad amount-sheet__keypad" role="group" aria-label="금액 키패드">
          {KEYS.map((k) =>
            k === 'back' ? (
              <button key={k} type="button" className="tx-key" aria-label="지우기" onClick={() => press('back')}>
                <Delete size={26} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : (
              <button key={k} type="button" className="tx-key" onClick={() => press(k)}>
                {k}
              </button>
            ),
          )}
        </div>
        <button type="button" className="button button--primary button--block" disabled={amount === 0} onClick={() => onDone(amount)}>
          완료
        </button>
      </div>
    </Sheet>
  );
}
