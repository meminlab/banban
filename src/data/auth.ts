/** 로그인·로그아웃·현재 사용자. 화면은 이 함수들만 쓴다. */
import type { User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export interface AuthUser {
  id: string;
  email: string | null;
  /** 구글 계정 이름 (DB profile 이 오기 전 임시 표시용) */
  name: string | null;
  avatarUrl: string | null;
}

/** 구글 로그인 후 돌아올 화면 (Supabase Auth 의 Redirect URLs 에 등록돼 있어야 한다) */
export const AUTH_CALLBACK_PATH = '/login';

function toAuthUser(user: User): AuthUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    name: (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null,
    avatarUrl: (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined) ?? null,
  };
}

/**
 * 로그인 상태가 바뀔 때마다 호출된다. 구독 직후 현재 상태로 한 번 호출된다(새로고침 시 저장된 세션 복원).
 * 반환값을 호출하면 구독 해제.
 */
export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    callback(session?.user ? toAuthUser(session.user) : null);
  });
  return () => data.subscription.unsubscribe();
}

/** 구글 로그인 화면으로 이동한다. 성공하면 AUTH_CALLBACK_PATH 로 돌아온다. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
      queryParams: { prompt: 'select_account' }, // 공용 기기에서 다른 계정으로 바꿀 수 있게
    },
  });
  if (error) throw error;
}

/** 이 기기에서만 로그아웃 */
export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut({ scope: 'local' });
  if (error) throw error;
}
