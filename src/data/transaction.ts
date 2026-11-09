/** 내역(transaction) 조회·추가·수정·삭제와 입력 화면 선택지 조회 */
import type { CategoryUse } from '../domain/categoryPicker';
import { monthRange, type YearMonth } from '../domain/month';
import type { TransactionValues } from '../domain/transactionForm';
import { getSupabase } from './supabase';
import type { Category, Member, Pocket, Transaction } from './types';

const TRANSACTION_COLUMNS =
  'id, ledger_id, type, amount, occurred_on, category_id, pocket_id, spender_id, is_fixed, memo, source, created_by, updated_by, created_at, updated_at';

/** 입력 화면 선택지: 카테고리·주머니(숨김 포함 — 수정 중인 내역이 숨김 항목을 쓸 수 있어서), 멤버(나간 사람 포함) */
export interface TransactionFormOptions {
  categories: Category[];
  pockets: Pocket[];
  members: Member[];
}

export async function getTransactionFormOptions(ledgerId: string): Promise<TransactionFormOptions> {
  const db = getSupabase();
  const [categories, pockets, members] = await Promise.all([
    db
      .from('category')
      .select('id, ledger_id, type, parent_id, name, sort_order, is_hidden, icon, created_at')
      .eq('ledger_id', ledgerId),
    db.from('pocket').select('id, ledger_id, name, scope, sort_order, is_hidden, created_at').eq('ledger_id', ledgerId),
    db
      .from('member')
      .select('id, ledger_id, user_id, role, display_name, joined_at, left_at')
      .eq('ledger_id', ledgerId),
  ]);
  if (categories.error) throw categories.error;
  if (pockets.error) throw pockets.error;
  if (members.error) throw members.error;
  return {
    categories: categories.data as Category[],
    pockets: pockets.data as Pocket[],
    members: members.data as Member[],
  };
}

/** 내역 1건. 없거나(삭제됨) 볼 권한이 없으면 null */
export async function getTransaction(id: string): Promise<Transaction | null> {
  const { data, error } = await getSupabase().from('transaction').select(TRANSACTION_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Transaction | null;
}

/** Supabase(PostgREST)는 한 번에 최대 1,000행만 돌려주므로 나눠서 다 읽는다 */
const PAGE_SIZE = 1000;

/**
 * 카테고리 선택 시트의 "자주 쓰는 것" 순위용: 이 가계부(모든 멤버) 내역의 카테고리·날짜·입력 시각.
 * from ~ to (둘 다 포함, YYYY-MM-DD). to = 오늘이라 미래 날짜는 빠진다. 1,000행이 넘으면 나눠 읽는다.
 */
export async function listCategoryUses(ledgerId: string, from: string, to: string): Promise<CategoryUse[]> {
  const rows: CategoryUse[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .from('transaction')
      .select('category_id, occurred_on, created_at')
      .eq('ledger_id', ledgerId)
      .gte('occurred_on', from)
      .lte('occurred_on', to)
      .order('id')
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data as CategoryUse[]));
    if (data.length < PAGE_SIZE) return rows;
  }
}

/** 그 달(KST 날짜 기준) 내역 전부. 가계부 탭 달력·목록 */
export async function listMonthTransactions(ledgerId: string, month: YearMonth): Promise<Transaction[]> {
  const { start, end } = monthRange(month);
  const rows: Transaction[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .from('transaction')
      .select(TRANSACTION_COLUMNS)
      .eq('ledger_id', ledgerId)
      .gte('occurred_on', start)
      .lt('occurred_on', end)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    // bigint 금액을 숫자로 (건당 최대 99억 → Number 안전 범위)
    rows.push(...(data as Transaction[]).map((t) => ({ ...t, amount: Number(t.amount) })));
    if (data.length < PAGE_SIZE) return rows;
  }
}

/** 새 내역. source 는 manual, 작성자·마지막 수정자·시각은 서버(트리거)가 로그인 사용자로 기록한다 */
export async function createTransaction(ledgerId: string, values: TransactionValues): Promise<string> {
  const { data, error } = await getSupabase()
    .from('transaction')
    .insert({ ...values, ledger_id: ledgerId, source: 'manual' })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * 내역 수정. 나중에 저장한 쪽으로 덮어쓴다. 마지막 수정자·시각은 서버가 기록.
 * 그사이 다른 멤버가 삭제했으면 'deleted' (새로 만들지 않는다)
 */
export async function updateTransaction(id: string, values: TransactionValues): Promise<'updated' | 'deleted'> {
  const { data, error } = await getSupabase().from('transaction').update(values).eq('id', id).select('id');
  if (error) throw error;
  return data && data.length > 0 ? 'updated' : 'deleted';
}

/** 내역 삭제. 이미 지워졌어도 오류로 보지 않는다 */
export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await getSupabase().from('transaction').delete().eq('id', id);
  if (error) throw error;
}
