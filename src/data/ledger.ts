/** 가계부·멤버·초대 저장소 접근. 화면은 이 함수들만 쓴다. */
import { getSupabase } from './supabase';
import type { Invite, Ledger, Member } from './types';

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

export async function getLedger(ledgerId: string): Promise<Ledger> {
  const { data, error } = await getSupabase()
    .from('ledger')
    .select('id, name, member_limit, created_by, created_at')
    .eq('id', ledgerId)
    .single();
  if (error) throw error;
  return data as Ledger;
}

export async function renameLedger(ledgerId: string, name: string): Promise<void> {
  const { error } = await getSupabase().from('ledger').update({ name: name.trim() }).eq('id', ledgerId);
  if (error) throw error;
}

/** 가계부 만들기 (만든 사람 = owner, 기본 카테고리·주머니는 DB가 만든다). 실패 시 오류 그대로 던짐 → parseLedgerError */
export async function createLedger(name: string, displayName: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_ledger', { p_name: name.trim(), p_display_name: displayName });
  if (error) throw error;
  return data as string;
}

/** 초대 코드로 참여. 실패 시 오류 그대로 던짐 → parseLedgerError */
export async function joinLedger(code: string, displayName: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('join_ledger', { p_code: code, p_display_name: displayName });
  if (error) throw error;
  return data as string;
}

/** 가계부에서 나가기 (내 내역은 남는다) */
export async function leaveLedger(): Promise<void> {
  const { error } = await getSupabase().rpc('leave_ledger');
  if (error) throw error;
}

/** 멤버 전체 (나간 사람 포함), 참여 순 */
export async function listMembers(ledgerId: string): Promise<Member[]> {
  const { data, error } = await getSupabase()
    .from('member')
    .select('id, ledger_id, user_id, role, display_name, joined_at, left_at')
    .eq('ledger_id', ledgerId)
    .order('joined_at');
  if (error) throw error;
  return data as Member[];
}

/** 무효가 아닌 초대 (가계부당 최대 1개). 만료 여부는 화면에서 판단 */
export async function getCurrentInvite(ledgerId: string): Promise<Invite | null> {
  const { data, error } = await getSupabase()
    .from('invite')
    .select('id, ledger_id, code, expires_at, is_revoked, created_by, created_at')
    .eq('ledger_id', ledgerId)
    .eq('is_revoked', false)
    .maybeSingle();
  if (error) throw error;
  return data as Invite | null;
}

/** 초대 새로 발급. 이전 초대는 DB가 무효로 만든다. 코드·만료 시각도 DB가 정한다 */
export async function issueInvite(ledgerId: string): Promise<Invite> {
  const { data, error } = await getSupabase()
    .from('invite')
    .insert({ ledger_id: ledgerId })
    .select('id, ledger_id, code, expires_at, is_revoked, created_by, created_at')
    .single();
  if (error) throw error;
  return data as Invite;
}
