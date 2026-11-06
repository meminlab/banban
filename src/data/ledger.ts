/** 가계부 조회 */
import { getSupabase } from './supabase';

/** 내가 현재 참여 중인 가계부 id. 없으면 null (사용자당 1개, MVP) */
export async function getMyLedgerId(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('member')
    .select('ledger_id')
    .eq('user_id', userId)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.ledger_id as string | undefined) ?? null;
}
