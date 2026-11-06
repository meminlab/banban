import { useEffect, useState } from 'react';
import { getProfile } from '../data/profile';
import { useCurrentUser } from './auth';

export interface ProfileView {
  name: string;
  avatarUrl: string | null;
  email: string | null;
}

/** 내 프로필: DB(profile)에 저장된 값을 쓰고, 불러오기 전·실패 시 로그인 정보로 대신 보여 준다 */
export function useMyProfile(): ProfileView {
  const user = useCurrentUser();
  const fallback: ProfileView = {
    name: user.name ?? user.email?.split('@')[0] ?? '사용자',
    avatarUrl: user.avatarUrl,
    email: user.email,
  };
  const [saved, setSaved] = useState<{ name: string; avatarUrl: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    getProfile(user.id).then(
      (p) => alive && p && setSaved({ name: p.display_name, avatarUrl: p.avatar_url }),
      () => undefined, // 표시용이라 실패해도 로그인 정보로 보여 준다
    );
    return () => {
      alive = false;
    };
  }, [user.id]);

  return saved ? { ...fallback, ...saved } : fallback;
}
