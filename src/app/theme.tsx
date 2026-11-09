import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getMyTheme, readDeviceTheme, saveMyTheme, writeDeviceTheme } from '../data/theme';
import { DARK_THEME_COLOR, DEFAULT_THEME, type ThemeName } from '../domain/theme';
import { useAuth } from './auth';

/** 테마를 앱 전체에 적용: <html data-theme> + 다크 theme-color (design.md 1.4). 첫 그리기 전 적용은 index.html 스크립트가 한다 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
  document
    .querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')
    ?.setAttribute('content', DARK_THEME_COLOR[theme]);
}

/**
 * 테마 고르기 결과
 * - saved: 서버에 저장됨 / failed: 저장 실패 → 이전 테마로 되돌림
 * - superseded: 그 사이 다른 테마를 또 골라서 이 결과는 의미 없음 / unchanged: 이미 그 테마
 */
export type ThemeSelectResult = 'saved' | 'failed' | 'superseded' | 'unchanged';

interface ThemeContextValue {
  theme: ThemeName;
  select: (theme: ThemeName) => Promise<ThemeSelectResult>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * 사람별 화면 테마 (BANB-29)
 * - 시작: 기기 값(없으면 clean). 로그인한 사람이 바뀌면 서버 값을 받아 맞추고 기기 값도 갱신한다.
 * - 고르기: 즉시 적용 + 기기 저장 → 서버 저장(차례대로 하나씩). 실패하면 마지막으로 서버에 있던 테마로 되돌린다.
 * - 로그아웃해도 기기 값·화면은 그대로 둔다(로그인 화면도 마지막 테마).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.user.id : null;
  const [theme, setTheme] = useState<ThemeName>(() => readDeviceTheme() ?? DEFAULT_THEME);
  const current = useRef(theme); // 화면에 적용된 테마 (고른 직후 값 포함)
  const stable = useRef(theme); // 서버에 있다고 믿는 테마 (실패 시 되돌릴 값)
  const seq = useRef(0); // 고를 때마다 +1. 늦게 온 응답이 최신 선택을 덮지 않게
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const show = useCallback((t: ThemeName) => {
    current.current = t;
    setTheme(t);
    applyTheme(t);
    writeDeviceTheme(t);
  }, []);

  useLayoutEffect(() => {
    applyTheme(current.current);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const startSeq = seq.current;
    getMyTheme(userId).then(
      (t) => {
        // 받는 사이 직접 골랐으면 그 선택이 우선
        if (!alive || seq.current !== startSeq) return;
        stable.current = t;
        show(t);
      },
      () => undefined, // 못 받아도 기기 값으로 계속 쓴다
    );
    return () => {
      alive = false;
    };
  }, [userId, show]);

  const select = useCallback(
    async (t: ThemeName): Promise<ThemeSelectResult> => {
      if (t === current.current) return 'unchanged';
      const mine = ++seq.current;
      show(t);
      // 빠르게 여러 번 골라도 서버에는 고른 순서대로 저장 → 마지막 선택이 남는다
      const job = queue.current.then(() => saveMyTheme(t));
      queue.current = job.catch(() => undefined);
      try {
        await job;
        stable.current = t;
        return mine === seq.current ? 'saved' : 'superseded';
      } catch {
        if (mine !== seq.current) return 'superseded';
        show(stable.current);
        return 'failed';
      }
    },
    [show],
  );

  const value = useMemo(() => ({ theme, select }), [theme, select]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('ThemeProvider 밖에서 useTheme 사용');
  return v;
}
