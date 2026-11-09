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

/** 지금 가계부에서 내 이름 (현재 멤버 행). 멤버가 아니면 null */
export async function getMyMemberName(ledgerId: string, userId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('member')
    .select('display_name')
    .eq('ledger_id', ledgerId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data?.display_name as string | undefined) ?? null;
}

/**
 * 지금 가계부에서 내 이름 바꾸기 (BANB-45). 다른 가계부의 내 이름은 그대로.
 * 본인 현재 행만 바뀐다(DB 정책 member_update_self). 정책에 걸려 0행이면 조용히 성공하지 않게 오류로 던진다.
 */
export async function renameMyMember(ledgerId: string, userId: string, name: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('member')
    .update({ display_name: name.trim() })
    .eq('ledger_id', ledgerId)
    .eq('user_id', userId)
    .is('left_at', null)
    .select('id');
  if (error) throw error;
  if (!data || data.length !== 1) throw new Error('MEMBER_NOT_UPDATED');
}
