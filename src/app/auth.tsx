import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthChange, type AuthUser } from '../data/auth';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser }
  | { status: 'error'; message: string };

const AuthContext = createContext<AuthState>({ status: 'loading' });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    try {
      return onAuthChange((user) => setState(user ? { status: 'signedIn', user } : { status: 'signedOut' }));
    } catch (e) {
      // 환경변수 누락 등 설정 오류
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** 로그인한 화면 안에서만 쓴다 (RequireAuth 아래) */
export function useCurrentUser(): AuthUser {
  const state = useAuth();
  if (state.status !== 'signedIn') throw new Error('로그인 화면 밖에서 useCurrentUser 사용');
  return state.user;
}
