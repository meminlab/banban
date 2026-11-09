/**
 * 정기 내역 조회·추가·수정·삭제와 회차 확인(기록·건너뛰기·되돌리기).
 * 권한은 DB 행 단위 규칙이 가계부 현재 멤버로 제한한다. 작성자·수정자·시각은 DB 트리거가 정한다.
 * 회차는 record_recurring 함수로만 쓴다 — 같은 회차는 한 번만 생긴다(두 기기·두 멤버 동시 확인 포함).
 */
import type { RecurringScheduleValues } from '../domain/recurring';
import type { TransactionValues } from '../domain/transactionForm';
import { getSupabase } from './supabase';
import type { RecurringOccurrence, RecurringTransaction } from './types';

const COLUMNS =
  'id, ledger_id, type, amount, category_id, pocket_id, spender_id, memo, cycle, day_of_month, month, weekday, start_on, end_on, is_paused, created_by, updated_by, created_at, updated_at';
const OCCURRENCE_COLUMNS = 'recurring_id, occurs_on, ledger_id, status, transaction_id, decided_by, decided_at';

/** 수정·삭제하려는 정기 내역이 없음 (다른 멤버가 지웠거나 권한이 없어짐) */
export class RecurringNotFoundError extends Error {
  constructor() {
    super('RECURRING_NOT_FOUND');
    this.name = 'RecurringNotFoundError';
  }
}

/** 정기 내역 저장 값: 내역 입력값(날짜·고정지출 제외) + 반복 + 일시정지 */
export type RecurringInput = Omit<TransactionValues, 'occurred_on' | 'is_fixed'> & RecurringScheduleValues & { is_paused: boolean };

// bigint 금액을 숫자로 (최대 99억 → Number 안전 범위)
const normalize = (r: RecurringTransaction): RecurringTransaction => ({ ...r, amount: Number(r.amount) });

/** 이 가계부 정기 내역 전부 (일시정지 포함) */
export async function listRecurring(ledgerId: string): Promise<RecurringTransaction[]> {
  const { data, error } = await getSupabase()
    .from('recurring_transaction')
    .select(COLUMNS)
    .eq('ledger_id', ledgerId)
    .order('created_at')
    .order('id');
  if (error) throw error;
  return (data as RecurringTransaction[]).map(normalize);
}

export async function getRecurring(id: string): Promise<RecurringTransaction | null> {
  const { data, error } = await getSupabase().from('recurring_transaction').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? normalize(data as RecurringTransaction) : null;
}

export async function createRecurring(ledgerId: string, input: RecurringInput): Promise<string> {
  const { data, error } = await getSupabase()
    .from('recurring_transaction')
    .insert({ ...input, ledger_id: ledgerId })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** 나중에 저장한 쪽으로 덮어쓴다. 그사이 다른 멤버가 지웠으면 RecurringNotFoundError */
export async function updateRecurring(id: string, input: RecurringInput): Promise<void> {
  const { data, error } = await getSupabase().from('recurring_transaction').update(input).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new RecurringNotFoundError();
}

/** 삭제. 이미 기록한 내역은 그대로 남는다. 이미 지워졌어도 오류로 보지 않는다 */
export async function deleteRecurring(id: string): Promise<void> {
  const { error } = await getSupabase().from('recurring_transaction').delete().eq('id', id);
  if (error) throw error;
}

/** [start, end] (둘 다 포함) 안의 확인한 회차 (기록함·건너뜀) */
export async function listOccurrences(ledgerId: string, start: string, end: string): Promise<RecurringOccurrence[]> {
  const { data, error } = await getSupabase()
    .from('recurring_occurrence')
    .select(OCCURRENCE_COLUMNS)
    .eq('ledger_id', ledgerId)
    .gte('occurs_on', start)
    .lte('occurs_on', end);
  if (error) throw error;
  return (data ?? []) as RecurringOccurrence[];
}

/** 회차 확인 요청 1건: record = false 면 건너뛰기. amount 를 주면 이번 회차만 그 금액으로 기록 */
export interface RecordItem {
  recurring_id: string;
  occurs_on: string;
  record: boolean;
  amount?: number | null;
}

/** 회차 확인 결과 1건. applied = false 면 이미 누가 확인한 회차라 아무것도 안 바뀜 */
export interface RecordOutcome {
  recurring_id: string;
  occurs_on: string;
  status: 'recorded' | 'skipped';
  transaction_id: string | null;
  applied: boolean;
}

/**
 * 회차 확인: 기록은 내역(source 'recurring', 날짜 = 회차 날짜)을 만들고, 건너뛰기는 회차만 남긴다.
 * 하나라도 틀린 요청이면 전체가 취소된다.
 */
export async function recordRecurring(ledgerId: string, items: RecordItem[]): Promise<RecordOutcome[]> {
  const { data, error } = await getSupabase().rpc('record_recurring', {
    p_ledger_id: ledgerId,
    p_items: items.map((i) => ({ ...i, amount: i.amount ?? null })),
  });
  if (error) throw error;
  return (data ?? []) as RecordOutcome[];
}

/** 방금 한 확인 되돌리기: 내가 확인한 회차와 그때 만든 내역을 지운다 → 다시 제안된다. 지운 회차 수 */
export async function undoRecurringRecord(
  ledgerId: string,
  keys: readonly Pick<RecordItem, 'recurring_id' | 'occurs_on'>[],
): Promise<number> {
  const { data, error } = await getSupabase().rpc('undo_recurring_record', {
    p_ledger_id: ledgerId,
    p_items: keys.map((k) => ({ recurring_id: k.recurring_id, occurs_on: k.occurs_on })),
  });
  if (error) throw error;
  return Number(data ?? 0);
}
