/**
 * 화면 테마 (design.md 1절 테마 3종, 1.4 다크, 5.16 테마 고르기).
 * 값 목록은 DB(profile.theme check)·index.html 첫 그리기 스크립트와 같아야 한다.
 */
export const THEMES = ['clean', 'berry', 'cozy'] as const;
export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeName = 'clean';

export const THEME_LABEL: Record<ThemeName, string> = {
  clean: '클린',
  berry: '베리',
  cozy: '포근',
};

export const THEME_DESCRIPTION: Record<ThemeName, string> = {
  clean: '깔끔한 흰 화면',
  berry: '차분한 무채색 화면',
  cozy: '둘이 쓰는 따뜻한 화면',
};

/** <meta name="theme-color"> = 헤더 surface (1.4). 라이트는 세 테마 공통, 다크는 테마마다 */
export const LIGHT_THEME_COLOR = '#FFFFFF';
export const DARK_THEME_COLOR: Record<ThemeName, string> = {
  clean: '#1B1E22',
  berry: '#1D1E21',
  cozy: '#221C1A',
};

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

/** 기기·서버 값이 없거나 모르는 값이면 clean */
export function parseTheme(v: unknown): ThemeName {
  return isThemeName(v) ? v : DEFAULT_THEME;
}
