/** 가계부 멤버 조회 (나간 멤버 포함 — 지난 내역·자산의 이름 표시에 필요) */
import { getSupabase } from './supabase';
import type { Member } from './types';

export async function listMembers(ledgerId: string): Promise<Member[]> {
  const { data, error } = await getSupabase()
    .from('member')
    .select('id, ledger_id, user_id, role, display_name, joined_at, left_at')
    .eq('ledger_id', ledgerId)
    .order('joined_at');
  if (error) throw error;
  return (data ?? []) as Member[];
}
