/** 홈 월 요약에 필요한 데이터 조회 (집계 자체는 src/domain/summary.ts) */
import { monthRange, type YearMonth } from '../domain/month';
import type { SummaryCategory, SummaryMember, SummaryPocket, SummaryTransaction } from '../domain/summary';
import { getSupabase } from './supabase';

export interface MonthSummaryData {
  transactions: SummaryTransaction[];
  members: SummaryMember[];
  pockets: SummaryPocket[];
  categories: SummaryCategory[];
}

/** Supabase(PostgREST)는 한 번에 최대 1,000행만 돌려주므로 나눠서 다 읽는다 */
const PAGE_SIZE = 1000;

async function fetchMonthTransactions(ledgerId: string, month: YearMonth): Promise<SummaryTransaction[]> {
  const { start, end } = monthRange(month);
  const rows: SummaryTransaction[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .from('transaction')
      .select('id, type, amount, occurred_on, category_id, pocket_id, spender_id, is_fixed')
      .eq('ledger_id', ledgerId)
      .gte('occurred_on', start)
      .lt('occurred_on', end)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    // bigint 금액을 숫자로 (월 합계도 Number 안전 범위 안: 건당 최대 99억)
    rows.push(...(data as SummaryTransaction[]).map((t) => ({ ...t, amount: Number(t.amount) })));
    if (data.length < PAGE_SIZE) return rows;
  }
}

/**
 * 선택한 달의 내역 + 이름 표시용 멤버·주머니·카테고리.
 * 숨긴 주머니·카테고리, 나간 멤버도 모두 가져온다 (지난 내역 집계·표시용).
 */
export async function getMonthSummaryData(ledgerId: string, month: YearMonth): Promise<MonthSummaryData> {
  const db = getSupabase();
  const [transactions, members, pockets, categories] = await Promise.all([
    fetchMonthTransactions(ledgerId, month),
    db.from('member').select('id, display_name, joined_at, left_at').eq('ledger_id', ledgerId),
    db.from('pocket').select('id, name, scope, sort_order').eq('ledger_id', ledgerId),
    db.from('category').select('id, parent_id, name, sort_order').eq('ledger_id', ledgerId).eq('type', 'expense'),
  ]);
  if (members.error) throw members.error;
  if (pockets.error) throw pockets.error;
  if (categories.error) throw categories.error;
  return {
    transactions,
    members: members.data as SummaryMember[],
    pockets: pockets.data as SummaryPocket[],
    categories: categories.data as SummaryCategory[],
  };
}
