import { DARK_THEME_COLOR, DEFAULT_THEME, isThemeName, parseTheme, THEME_DESCRIPTION, THEME_LABEL, THEMES } from './theme';

describe('테마 값', () => {
  it('3종, 기본 clean', () => {
    expect(THEMES).toEqual(['clean', 'berry', 'cozy']);
    expect(DEFAULT_THEME).toBe('clean');
  });

  it('이름·한 줄 설명 (design.md 5.16)', () => {
    expect(THEMES.map((t) => [THEME_LABEL[t], THEME_DESCRIPTION[t]])).toEqual([
      ['클린', '깔끔한 흰 화면'],
      ['베리', '차분한 무채색 화면'],
      ['포근', '둘이 쓰는 따뜻한 화면'],
    ]);
  });

  it('다크 theme-color = 테마별 헤더 surface (design.md 1.4)', () => {
    expect(DARK_THEME_COLOR).toEqual({ clean: '#161E1B', berry: '#1F1A22', cozy: '#261C18' });
  });

  it('없거나 모르는 값은 clean (대소문자·공백 변형도 모르는 값)', () => {
    for (const t of THEMES) expect(parseTheme(t)).toBe(t);
    for (const v of [null, undefined, '', 'neon', 'Clean', ' berry', 'cozy ', '{}', 1, {}]) {
      expect(parseTheme(v)).toBe('clean');
      expect(isThemeName(v)).toBe(false);
    }
  });
});
