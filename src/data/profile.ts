/** 사용자 프로필 (구글 계정 이름·이미지). DB 트리거가 로그인 때 저장하고, 화면은 읽기만 한다. */
import { getSupabase } from './supabase';
import type { Profile } from './types';

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabase()
    .from('profile')
    .select('id, display_name, avatar_url, updated_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}
