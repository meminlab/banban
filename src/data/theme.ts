/**
 * 화면 테마 저장소 (BANB-29). 사람별로 서버(profile.theme)에 두고, 첫 화면 깜빡임을 막으려고 기기(localStorage)에도 같은 값을 둔다.
 * 기기 값 키는 index.html 첫 그리기 스크립트와 같다.
 */
import { isThemeName, parseTheme, type ThemeName } from '../domain/theme';
import { getSupabase } from './supabase';

export const DEVICE_THEME_KEY = 'banban.theme';

/** 기기에 저장한 테마. 없거나 모르는 값·읽기 실패면 null */
export function readDeviceTheme(): ThemeName | null {
  try {
    const v = localStorage.getItem(DEVICE_THEME_KEY);
    return isThemeName(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeDeviceTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(DEVICE_THEME_KEY, theme);
  } catch {
    // 사생활 보호 모드 등: 저장 못 해도 서버 값으로 맞춰진다
  }
}

/** 내 서버 테마. profile 행이 없거나 모르는 값이면 clean */
export async function getMyTheme(userId: string): Promise<ThemeName> {
  const { data, error } = await getSupabase().from('profile').select('theme').eq('id', userId).maybeSingle();
  if (error) throw error;
  return parseTheme((data as { theme?: unknown } | null)?.theme);
}

/** 내 테마 저장. 서버 함수가 로그인한 사람 자기 행만 바꾼다 */
export async function saveMyTheme(theme: ThemeName): Promise<void> {
  const { error } = await getSupabase().rpc('set_my_theme', { p_theme: theme });
  if (error) throw error;
}
